// @ts-nocheck  (written as plain JavaScript so it can also be tested with Node; no type checking needed)
// Zakaliya website editor: the server part, deployed as the Supabase Edge Function "editor".
//
// The editor at https://zakaliyasbm-mn.com/admin signs people in with Supabase (email + password).
// This function checks that sign-in, then reads the website content from GitHub and saves edits
// back to GitHub, which rebuilds and uploads the website. The GitHub access key never leaves here.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   GITHUB_TOKEN   fine-grained GitHub token for the zakaliya repository, "Contents: Read and write"
//   GITHUB_REPO    optional, default patrickemma143-droid/zakaliya
//   GITHUB_BRANCH  optional, default main
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.
//
// Editors may only change content/site.yml, content/verses.yml, existing content/pages/*.yml,
// content/projects/*.yml (add/remove) and add new photos under assets/uploads/.

const REPO = Deno.env.get("GITHUB_REPO") || "patrickemma143-droid/zakaliya";
const BRANCH = Deno.env.get("GITHUB_BRANCH") || "main";
const TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const GITHUB_API = Deno.env.get("GITHUB_API") || "https://api.github.com"; // only changed for local tests
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ||
  "https://zakaliyasbm-mn.com,http://localhost:8080,http://localhost:8085").split(",").map((s) => s.trim());

const enc = new TextEncoder();

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

class Fail extends Error {
  status;
  extra;
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

async function gh(method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : GITHUB_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "zakaliya-website-editor",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_e) { /* empty body */ }
  return [res.status, data];
}

function ghMessage(data, status) {
  return (data && (data.message || (data.errors && data.errors[0] && data.errors[0].message))) || `HTTP ${status}`;
}

async function blobSha(text) {
  const bytes = enc.encode(text);
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const digest = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ who is signed in

async function currentUser(req) {
  const auth = req.headers.get("authorization") || "";
  const apikey = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
  if (!/^Bearer\s+\S+$/.test(auth)) throw new Fail(401, "Please sign in again.", { signin: true });
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!res.ok) throw new Fail(401, "Your session has ended. Please sign in again.", { signin: true });
  const user = await res.json();
  if (!user || !user.id) throw new Fail(401, "Please sign in again.", { signin: true });
  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    throw new Fail(403, "This account has been switched off. Ask the website admin.");
  }
  return user;
}

function displayName(user) {
  const m = user.user_metadata || {};
  // The repository is public, so the email address is never written into the history.
  const name = String(m.name || m.full_name || m.display_name || "").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60);
  return name || `Editor ${String(user.id).slice(0, 6)}`;
}

// ------------------------------------------------------------------ actions

async function load() {
  const [owner, name] = REPO.split("/");
  const blob = "... on Blob { text oid }";
  const tree = `... on Tree { entries { name type oid object { ${blob} } } }`;
  const query = `query($owner:String!,$name:String!,$ref:String!,$schema:String!,$content:String!,$assets:String!){
    repository(owner:$owner,name:$name){
      ref(qualifiedName:$ref){ target{ oid } }
      schema: object(expression:$schema){ ${blob} }
      content: object(expression:$content){ ... on Tree { entries { name type oid object { ${blob} ${tree} } } } }
      assets: object(expression:$assets){ ... on Tree { entries { name type object { ... on Tree { entries { name type } } } } } }
    }
  }`;
  const [status, res] = await gh("POST", "/graphql", {
    query,
    variables: {
      owner, name, ref: `refs/heads/${BRANCH}`,
      schema: `${BRANCH}:.pages.yml`, content: `${BRANCH}:content`, assets: `${BRANCH}:assets`,
    },
  });
  const repo = res && res.data && res.data.repository;
  if (status !== 200 || !repo || !repo.schema || !repo.schema.text) {
    throw new Fail(502, `Could not load the website content from GitHub (${ghMessage(res, status)}). Check the GITHUB_TOKEN secret in Supabase.`);
  }
  const files = {};
  const isYaml = (n) => /\.ya?ml$/.test(n);
  for (const e of (repo.content && repo.content.entries) || []) {
    const path = `content/${e.name}`;
    if (e.type === "blob" && isYaml(e.name) && e.object && typeof e.object.text === "string") {
      files[path] = { text: e.object.text, oid: e.oid };
    } else if (e.type === "tree" && e.object && e.object.entries) {
      for (const c of e.object.entries) {
        if (c.type === "blob" && isYaml(c.name) && c.object && typeof c.object.text === "string") {
          files[`${path}/${c.name}`] = { text: c.object.text, oid: c.oid };
        }
      }
    }
  }
  const images = [];
  const isImage = (n) => /\.(jpe?g|png|webp|gif)$/i.test(n);
  for (const e of (repo.assets && repo.assets.entries) || []) {
    if (e.type === "blob" && isImage(e.name)) images.push(`/assets/${e.name}`);
    else if (e.type === "tree" && e.object && e.object.entries) {
      for (const c of e.object.entries) if (c.type === "blob" && isImage(c.name)) images.push(`/assets/${e.name}/${c.name}`);
    }
  }
  return { head: (repo.ref && repo.ref.target && repo.ref.target.oid) || "", schema: repo.schema.text, files, images };
}

// Photos arrive already shrunk by the editor (max 2400px, JPEG re-encoded, so phone location data is gone).
async function upload(body) {
  const data = typeof body.data === "string" ? body.data.replace(/^data:[^,]*,/, "") : "";
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Fail(400, "The photo did not arrive. Please try again.");
  const size = Math.floor((data.length * 3) / 4);
  if (size > 12 * 1024 * 1024) throw new Fail(413, "That photo is too large. Please use a photo under 12 MB.");
  const head = atob(data.slice(0, 24));
  const b = (i) => head.charCodeAt(i);
  let ext = "";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) ext = "jpg";
  else if (b(0) === 0x89 && head.slice(1, 4) === "PNG") ext = "png";
  else if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") ext = "webp";
  if (!ext) throw new Fail(400, "Please upload a JPG, PNG or WebP photo.");
  const base = String(body.name || "photo").replace(/\.[^.]*$/, "").toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "photo";
  const rand = [...crypto.getRandomValues(new Uint8Array(6))].map((x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
  const name = `${base}-${rand}.${ext}`;
  const [o, r] = REPO.split("/");
  const [status, res] = await gh("POST", `/repos/${o}/${r}/git/blobs`, { content: data, encoding: "base64" });
  if (status !== 201 || !res || !res.sha) throw new Fail(502, `Could not store the photo in GitHub (${ghMessage(res, status)}).`);
  return { path: `/assets/uploads/${name}`, sha: res.sha, size };
}

const PROJECT = /^content\/projects\/[a-z0-9][a-z0-9-]{0,80}\.yml$/;
function allowedPath(path, isNew) {
  if (PROJECT.test(path)) return true;        // projects may be added and removed
  if (isNew) return false;                    // other files can only be changed
  return /^content\/((site|verses)\.yml|pages\/[a-z0-9-]+\.yml)$/.test(path);
}

async function save(body, user) {
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  const uploads = Array.isArray(body.uploads) ? body.uploads : [];
  if (!changes.length && !deletes.length) throw new Fail(400, "Nothing to save.");
  if (changes.length + deletes.length > 20 || uploads.length > 60) throw new Fail(400, "Too many changes at once. Please save in smaller steps.");

  const entries = [];
  const expect = new Map(); // path -> blob id the editor started from (null = new file)
  for (const c of changes) {
    const path = String((c && c.path) || "");
    const text = typeof (c && c.text) === "string" ? c.text : "";
    const oid = c && c.oid ? String(c.oid) : null;
    if (!allowedPath(path, oid === null)) throw new Fail(403, `That file can not be changed from the editor: ${path}`);
    if (!text || text.length > 300000 || text.includes("\0")) throw new Fail(400, `The content of ${path} is empty or not valid.`);
    entries.push({ path, mode: "100644", type: "blob", content: text });
    expect.set(path, oid);
  }
  for (const d of deletes) {
    const path = String((d && d.path) || "");
    const oid = String((d && d.oid) || "");
    if (!PROJECT.test(path) || !oid) throw new Fail(403, "Only projects can be removed.");
    entries.push({ path, mode: "100644", type: "blob", sha: null });
    expect.set(path, oid);
  }
  for (const u of uploads) {
    const path = String((u && u.path) || "").replace(/^\//, "");
    const sha = String((u && u.sha) || "");
    if (!/^assets\/uploads\/[a-z0-9-]+\.(jpg|png|webp)$/.test(path) || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new Fail(400, "A photo upload is not valid. Please upload it again.");
    }
    entries.push({ path, mode: "100644", type: "blob", sha });
  }

  const who = displayName(user);
  const summary = String(body.summary || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  const message = `Website edit: ${summary || [...expect.keys()].join(", ")} (${who})`;
  const [o, r] = REPO.split("/");

  for (let attempt = 1; attempt <= 3; attempt++) {
    let [status, ref] = await gh("GET", `/repos/${o}/${r}/git/ref/heads/${BRANCH}`);
    if (status !== 200 || !ref || !ref.object) throw new Fail(502, `Could not reach GitHub (HTTP ${status}). Please try again.`);
    const head = ref.object.sha;
    const [cs, commit] = await gh("GET", `/repos/${o}/${r}/git/commits/${head}`);
    if (cs !== 200 || !commit || !commit.tree) throw new Fail(502, "Could not read the latest version from GitHub. Please try again.");
    const baseTree = commit.tree.sha;

    // Has someone else changed one of these files in the meantime?
    const [ts, tree] = await gh("GET", `/repos/${o}/${r}/git/trees/${baseTree}?recursive=1`);
    if (ts !== 200 || !tree || !tree.tree) throw new Fail(502, "Could not check the latest version on GitHub. Please try again.");
    const current = new Map();
    for (const t of tree.tree) if (expect.has(t.path)) current.set(t.path, t.sha);
    for (const [path, oid] of expect) {
      const now = current.has(path) ? current.get(path) : null;
      if (oid === null && now !== null) throw new Fail(409, "A project with this name already exists. Please choose a different name.", { conflict: path });
      if (oid !== null && now !== oid) {
        throw new Fail(409, "Someone else saved changes to this page while you were editing. Reload to get the latest version, then make your change again.", { conflict: path });
      }
    }

    const [ns, newTree] = await gh("POST", `/repos/${o}/${r}/git/trees`, { base_tree: baseTree, tree: entries });
    if (ns !== 201 || !newTree || !newTree.sha) throw new Fail(502, `GitHub did not accept the changes (${ghMessage(newTree, ns)}).`);
    const [ms, newCommit] = await gh("POST", `/repos/${o}/${r}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: [head],
      author: { name: `${who} (website editor)`, email: "website-editor@zakaliyasbm-mn.com", date: new Date().toISOString() },
    });
    if (ms !== 201 || !newCommit || !newCommit.sha) throw new Fail(502, `GitHub did not accept the changes (${ghMessage(newCommit, ms)}).`);
    [status] = await gh("PATCH", `/repos/${o}/${r}/git/refs/heads/${BRANCH}`, { sha: newCommit.sha, force: false });
    if (status === 200) {
      const oids = {};
      for (const e of entries) if (typeof e.content === "string") oids[e.path] = await blobSha(e.content);
      return { commit: newCommit.sha, oids };
    }
    if (status !== 422 && status !== 409) throw new Fail(502, `GitHub did not accept the changes (HTTP ${status}).`);
    // Someone else saved at the same moment: start again from their version.
  }
  throw new Fail(503, "GitHub is busy. Please click Save again.");
}

// ------------------------------------------------------------------ entry point

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const cors = corsHeaders(origin);
  const reply = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") throw new Fail(405, "Use POST.");
    if (!ALLOWED_ORIGINS.includes(origin)) throw new Fail(403, "The editor can only be used from the Zakaliya website.");
    const user = await currentUser(req);
    if (!TOKEN) throw new Fail(503, "The editor is not connected to GitHub yet. Add the GITHUB_TOKEN secret in Supabase (see EDITING.md).");
    let body;
    try { body = await req.json(); } catch (_e) { throw new Fail(400, "The request was not understood."); }
    switch (body && body.action) {
      case "load": return reply(200, { ok: true, ...(await load()), name: displayName(user) });
      case "upload": return reply(200, { ok: true, ...(await upload(body)) });
      case "save": return reply(200, { ok: true, ...(await save(body, user)) });
      default: throw new Fail(400, "Unknown action.");
    }
  } catch (e) {
    if (e instanceof Fail) return reply(e.status, { ok: false, error: e.message, ...e.extra });
    console.error(e);
    return reply(500, { ok: false, error: "Something went wrong on the server. Please try again." });
  }
});
