// Builds the Zakaliya website from the editable content in /content
// (edited in the website editor at /admin) and the page templates in /src.
//   npm run build   -> writes the finished site to /_site
//   npm start       -> local preview at http://localhost:8080
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const markdownIt = require("markdown-it");
const { imageSize } = require("image-size");

const md = markdownIt({ html: false, linkify: true, typographer: false });

function readYaml(file) {
  return yaml.load(fs.readFileSync(file, "utf8")) || {};
}

function loadProjects() {
  const dir = path.join(__dirname, "content", "projects");
  return fs.readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => {
      const data = readYaml(path.join(dir, f));
      const slug = f.replace(/\.ya?ml$/, "");
      return {
        ...data,
        slug,
        url: data.detail_page ? `/projects/${slug}` : `/projects#${slug}`,
        updates: data.updates || [],
        gallery: data.gallery || [],
        facts: data.facts || [],
      };
    })
    .filter((p) => p.title)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title));
}

function loadPages() {
  const dir = path.join(__dirname, "content", "pages");
  const pages = {};
  for (const f of fs.readdirSync(dir)) {
    if (/\.ya?ml$/.test(f)) pages[f.replace(/\.ya?ml$/, "").replace(/-/g, "_")] = readYaml(path.join(dir, f));
  }
  return pages;
}

const sizeCache = new Map();
function dimensions(src) {
  if (!src || /^https?:/i.test(src)) return null;
  const file = path.join(__dirname, decodeURI(src.replace(/^\//, "").split(/[?#]/)[0]));
  if (sizeCache.has(file)) return sizeCache.get(file);
  let dims = null;
  try {
    const d = imageSize(fs.readFileSync(file));
    const swap = d.orientation && d.orientation >= 5; // EXIF rotation
    dims = { width: swap ? d.height : d.width, height: swap ? d.width : d.height };
  } catch (e) {
    console.warn(`[images] could not read size of ${src}: ${e.message}`);
  }
  sizeCache.set(file, dims);
  return dims;
}

module.exports = function (eleventyConfig) {
  eleventyConfig.setNunjucksEnvironmentOptions({ autoescape: true, throwOnUndefined: false });

  // Content from /content (YAML, edited in the website editor)
  eleventyConfig.addGlobalData("site", () => readYaml(path.join(__dirname, "content", "site.yml")));
  eleventyConfig.addGlobalData("pages", loadPages);
  eleventyConfig.addGlobalData("projects", loadProjects);
  eleventyConfig.addGlobalData("detailProjects", () => loadProjects().filter((p) => p.detail_page));
  eleventyConfig.addGlobalData("verses", () => readYaml(path.join(__dirname, "content", "verses.yml")));
  // Website editor sign-in (Supabase): public project address and key
  eleventyConfig.addGlobalData("editorConfig", () => JSON.parse(fs.readFileSync(path.join(__dirname, "editor-config.json"), "utf8")));
  // build.id changes on every build; the deploy uses it to refresh GoDaddy's cache exactly once per upload
  eleventyConfig.addGlobalData("build", () => {
    const now = new Date();
    const sha = (process.env.GITHUB_SHA || "local").slice(0, 12);
    return { year: String(now.getFullYear()), date: now.toISOString().slice(0, 10), id: `${sha}-${now.getTime()}` };
  });
  eleventyConfig.addWatchTarget("./content/");

  // Pages are built into /pages and shown at clean addresses (/about, /projects/farming).
  // On the live site wp-content/mu-plugins/zakaliya-static.php does this; here the local preview does the same.
  eleventyConfig.setServerOptions({
    middleware: [(req, res, next) => {
      const [p, q = ""] = req.url.split("?");
      let m, to = null;
      if (p === "/" || p === "/index.html") to = "/pages/home.html";
      else if ((m = /^\/(about|projects|contact|donate|thank-you)\/?$/.exec(p))) to = `/pages/${m[1]}.html`;
      else if ((m = /^\/projects\/([a-z0-9-]+)\/?$/.exec(p))) to = `/pages/projects/${m[1]}.html`;
      else if (/^\/(admin|editor|login)\/?$/.test(p)) to = "/pages/editor.html";
      if (to) req.url = to + (q ? "?" + q : "");
      next();
    }],
  });

  // Files copied as they are
  eleventyConfig.addPassthroughCopy({ assets: "assets" }, { filter: (p) => !/(^|[\\/])(donate-links\.js|SOURCES\.txt)$/.test(p) });
  // The YAML reader the website editor uses in the browser
  eleventyConfig.addPassthroughCopy({ "node_modules/js-yaml/dist/js-yaml.min.js": "assets/admin/js-yaml.min.js" });
  eleventyConfig.addPassthroughCopy(".htaccess");
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("wp-content");

  // Filters used by the templates
  eleventyConfig.addFilter("md", (text) => md.render(String(text || "")));
  eleventyConfig.addFilter("mdInline", (text) => md.renderInline(String(text || "")));
  eleventyConfig.addFilter("lines", (text) => String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  eleventyConfig.addFilter("dims", (src) => {
    const d = dimensions(src);
    return d ? { w: d.width, h: d.height } : null;
  });
  // Dates may arrive as text ("2025-06-04") or as a parsed date; always work with YYYY-MM-DD
  const toIso = (v) => (!v ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  eleventyConfig.addFilter("dateLong", (v) => {
    const iso = toIso(v);
    if (!iso) return "";
    const d = new Date(iso + "T12:00:00Z");
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  });
  eleventyConfig.addFilter("isoDate", toIso);
  eleventyConfig.addFilter("pad2", (n) => String(n).padStart(2, "0"));
  eleventyConfig.addFilter("tel", (phone) => "tel:" + String(phone || "").replace(/[^\d+]/g, ""));
  eleventyConfig.addFilter("youtubeId", (url) => {
    const m = String(url || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{6,})/);
    return m ? m[1] : "";
  });
  // Progress photos oldest-first, each paired with its update (for the Projects page slideshow)
  eleventyConfig.addFilter("slidePhotos", (project) => {
    const out = [];
    for (const u of [...((project && project.updates) || [])].reverse()) {
      for (const ph of u.photos || []) if (ph && ph.image) out.push({ ph, u });
    }
    return out;
  });
  eleventyConfig.addFilter("where", (arr, key, value) => (arr || []).filter((x) => x && x[key] === value));
  // JSON that is safe to place inside a <script> tag
  eleventyConfig.addFilter("json", (value) => JSON.stringify(value).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029"));

  return {
    dir: { input: "src", includes: "_includes", output: "_site" },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
  };
};
