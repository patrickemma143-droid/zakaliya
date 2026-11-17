/* Zakaliya website editor.
 * Signing in: WordPress (wp-content/mu-plugins/zakaliya-editor.php).
 * Forms: built from .pages.yml, the same definitions Pages CMS uses.
 * Saving: the server commits the changed content files to GitHub, which rebuilds and uploads the site. */
(function () {
  "use strict";

  var CFG = window.ZK_EDITOR || { ajax: "/wp-admin/admin-ajax.php" };
  var Y = window.jsyaml;
  var app = document.getElementById("app");

  // Pages the content files appear on (for "View on website")
  var PAGE_URLS = {
    "content/pages/home.yml": "/",
    "content/pages/about.yml": "/about-us.html",
    "content/pages/projects.yml": "/projects.html",
    "content/pages/donate.yml": "/donate.html",
    "content/pages/contact.yml": "/contact.html",
    "content/pages/thank-you.yml": "/thank-you.html",
    "content/pages/not-found.yml": "/404.html",
    "content/verses.yml": "/#verse-of-the-day",
    "content/site.yml": "/"
  };

  var S = {
    session: null,
    schema: null,
    components: {},
    files: {},        // path -> { text, oid, data, dirty, isNew, label }
    images: [],       // photos already in the website
    uploads: {},      // path -> { sha, url }  (uploaded, not saved yet)
    previews: {},     // path -> object URL for photos uploaded in this session
    nav: [],
    route: null,
    saving: false,
    publishTimer: null,
    errors: {}
  };

  /* ------------------------------------------------------------- helpers */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  // Small inline icons (fixed markup, never user content)
  var ICONS = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'
  };
  function icon(name) {
    var span = document.createElement("span");
    span.className = "zk-ic";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    return span;
  }
  function parseYaml(text) {
    var d = Y.load(text || "", { schema: Y.CORE_SCHEMA }); // keeps dates as plain text
    return d && typeof d === "object" ? d : {};
  }
  function dumpYaml(data) {
    return Y.dump(data, { lineWidth: -1, noRefs: true });
  }
  function slugify(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  function fill(template, item) {
    return String(template || "").replace(/\{(\w+)\}/g, function (_, k) {
      var v = item && item[k];
      return v === undefined || v === null ? "" : String(v);
    }).replace(/^[\s:·-]+|[\s:·-]+$/g, "");
  }
  function imgUrl(path) {
    if (!path) return "";
    return S.previews[path] || path;
  }

  /* ---------------------------------------------------------------- server */

  function post(action, fields) {
    var fd = new FormData();
    fd.append("action", "zakaliya_" + action);
    if (S.session && S.session.nonce) fd.append("_nonce", S.session.nonce);
    Object.keys(fields || {}).forEach(function (k) { fd.append(k, fields[k]); });
    return fetch(CFG.ajax, { method: "POST", body: fd, credentials: "same-origin", cache: "no-store" })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
          if (!j) throw new Error("The website gave an unexpected answer (HTTP " + r.status + "). Please try again.");
          if (j.signin && S.session) { location.href = S.session.loginUrl; }
          if (!j.ok) { var err = new Error(j.error || "Something went wrong."); err.data = j; err.status = r.status; throw err; }
          return j;
        });
      });
  }

  function uploadFile(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append("action", "zakaliya_upload");
      fd.append("_nonce", S.session.nonce);
      fd.append("file", file, file.name);
      var x = new XMLHttpRequest();
      x.open("POST", CFG.ajax);
      x.withCredentials = true;
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () {
        var j = null;
        try { j = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
        if (j && j.ok) resolve(j);
        else reject(new Error((j && j.error) || "The upload failed (HTTP " + x.status + "). Please try again."));
      };
      x.onerror = function () { reject(new Error("The upload was interrupted. Check your internet connection and try again.")); };
      x.send(fd);
    });
  }

  // Phone photos are large: shrink them in the browser first (faster upload on slow connections)
  function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return Promise.resolve(file);
    if (file.type === "image/png" && file.size < 1500000) return Promise.resolve(file);
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
      var max = 2400, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1500000 && file.type === "image/jpeg") return file;
      var c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.85); }).then(function (blob) {
        if (!blob) return file;
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
      });
    }).catch(function () { return file; });
  }

  /* ----------------------------------------------------------------- start */

  function bootMessage(title, text, actions) {
    app.className = "zk-boot";
    app.textContent = "";
    app.appendChild(h("div", { class: "zk-boot-card" },
      h("img", { src: CFG.logo || "/assets/logo.png", alt: "", width: 96, height: 58 }),
      h("p", { class: "zk-boot-title", text: title }),
      h("p", { class: "zk-boot-text", text: text }),
      actions ? h("div", { class: "zk-boot-actions" }, actions) : null));
  }

  function start() {
    if (!Y) { bootMessage("The editor could not start", "A file did not load. Please reload the page."); return; }
    post("session").then(function (s) {
      if (!s.signedIn) { location.replace(s.loginUrl); return; }
      S.session = s;
      var signOut = h("a", { class: "zk-btn zk-btn-ghost", href: s.logoutUrl, text: "Sign out" });
      if (!s.allowed) {
        bootMessage("No editor access", "Your account can't edit the website. Ask the website admin to give you the \"Website editor\" role.", [signOut]);
        return;
      }
      if (!s.configured) {
        bootMessage("The editor isn't connected yet",
          s.isAdmin ? "Add the GitHub access key under Settings > Website editor (see EDITING.md)." : "The website admin is still setting it up. Please try again later.",
          [s.settingsUrl ? h("a", { class: "zk-btn", href: s.settingsUrl, text: "Open editor settings" }) : null, signOut]);
        return;
      }
      return post("load").then(function (d) {
        S.schema = Y.load(d.schema) || {};
        S.components = S.schema.components || {};
        S.images = (d.images || []).slice().sort();
        Object.keys(d.files).forEach(function (p) {
          S.files[p] = { text: d.files[p].text, oid: d.files[p].oid, data: parseYaml(d.files[p].text), dirty: false };
        });
        buildNav();
        renderShell();
        window.addEventListener("hashchange", route);
        route();
      });
    }).catch(function (e) {
      bootMessage("The editor could not open", e.message || "Please check your internet connection and reload.",
        [h("button", { class: "zk-btn", type: "button", onclick: function () { location.reload(); }, text: "Try again" }),
         S.session ? h("a", { class: "zk-btn zk-btn-ghost", href: S.session.logoutUrl, text: "Sign out" }) : null]);
    });
  }

  function buildNav() {
    S.nav = [];
    (S.schema.content || []).forEach(function (c) {
      if (c.type === "group") {
        S.nav.push({ heading: c.label, items: (c.items || []).map(navItem) });
      } else {
        S.nav.push({ heading: null, items: [navItem(c)] });
      }
    });
  }
  function navItem(c) {
    var it = { name: c.name, label: c.label || c.name, type: c.type, def: c };
    if (c.type === "file" && S.files[c.path]) S.files[c.path].label = it.label;
    return it;
  }
  function findItem(name) {
    for (var i = 0; i < S.nav.length; i++) {
      for (var j = 0; j < S.nav[i].items.length; j++) if (S.nav[i].items[j].name === name) return S.nav[i].items[j];
    }
    return null;
  }

  /* ----------------------------------------------------------------- shell */

  var els = {};

  function renderShell() {
    app.className = "zk-app";
    app.textContent = "";
    var s = S.session;

    els.nav = h("nav", { class: "zk-nav", "aria-label": "Editor sections" });
    els.sidebar = h("aside", { class: "zk-sidebar", id: "zk-sidebar" },
      h("a", { class: "zk-brand", href: "#/" },
        h("img", { src: CFG.logo || "/assets/logo.png", alt: "", width: 56, height: 34 }),
        h("span", null, h("strong", { text: "Zakaliya" }), h("small", { text: "Website editor" }))),
      els.nav,
      h("a", { class: "zk-side-link", href: "/", target: "_blank", rel: "noopener" }, "View the website", icon("external")));

    els.title = h("h1", { class: "zk-title", text: "" });
    els.status = h("div", { class: "zk-status", role: "status", "aria-live": "polite" });
    var initials = (s.name || "?").split(/\s+/).map(function (p) { return p.charAt(0); }).join("").slice(0, 2).toUpperCase();
    els.menu = h("div", { class: "zk-menu", role: "menu", hidden: true },
      h("p", { class: "zk-menu-who" }, h("small", { text: "Signed in as" }), h("strong", { text: s.name })),
      h("a", { role: "menuitem", href: s.profileUrl, text: "Change my password" }),
      s.usersUrl ? h("a", { role: "menuitem", href: s.usersUrl, text: "Manage editors" }) : null,
      s.settingsUrl ? h("a", { role: "menuitem", href: s.settingsUrl, text: "Editor settings" }) : null,
      h("a", { role: "menuitem", href: s.logoutUrl, class: "zk-menu-out", text: "Sign out" }));
    var accountBtn = h("button", { class: "zk-account", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Account menu",
      onclick: function (e) { e.stopPropagation(); toggleMenu(); } }, h("span", { text: initials }));
    els.accountBtn = accountBtn;
    document.addEventListener("click", function (e) { if (!els.menu.hidden && !els.menu.contains(e.target)) toggleMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !els.menu.hidden) { toggleMenu(false); accountBtn.focus(); } });

    var menuBtn = h("button", { class: "zk-menu-btn", type: "button", "aria-controls": "zk-sidebar", "aria-expanded": "false", "aria-label": "Show sections",
      onclick: function () { var open = !app.classList.contains("nav-open"); app.classList.toggle("nav-open", open); menuBtn.setAttribute("aria-expanded", String(open)); } }, icon("menu"));
    els.menuBtn = menuBtn;

    els.view = h("div", { class: "zk-view" });
    els.savebar = h("div", { class: "zk-savebar", hidden: true },
      h("p", { class: "zk-savebar-text" }, h("span", { class: "zk-dot" }), h("span", { id: "zk-dirty-text", text: "You have unsaved changes" })),
      h("div", { class: "zk-savebar-actions" },
        h("button", { class: "zk-btn zk-btn-ghost-dark", type: "button", onclick: discardAll, text: "Discard" }),
        els.saveBtn = h("button", { class: "zk-btn zk-btn-save", type: "button", onclick: save }, "Save & publish")));

    app.appendChild(els.sidebar);
    app.appendChild(h("div", { class: "zk-scrim", onclick: function () { app.classList.remove("nav-open"); menuBtn.setAttribute("aria-expanded", "false"); } }));
    app.appendChild(h("div", { class: "zk-main" },
      h("header", { class: "zk-top" }, menuBtn, els.title, els.status, h("div", { class: "zk-account-wrap" }, accountBtn, els.menu)),
      h("main", { class: "zk-content", id: "zk-main" }, els.view)));
    app.appendChild(els.savebar);
    els.dialog = h("dialog", { class: "zk-dialog" });
    app.appendChild(els.dialog);

    window.addEventListener("beforeunload", function (e) {
      if (anyDirty() || S.saving) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  function toggleMenu(force) {
    var open = force === undefined ? els.menu.hidden : force;
    els.menu.hidden = !open;
    els.accountBtn.setAttribute("aria-expanded", String(open));
    if (open) { var first = els.menu.querySelector("a"); if (first) first.focus(); }
  }

  function renderNav() {
    els.nav.textContent = "";
    S.nav.forEach(function (g) {
      var list = h("ul", null);
      g.items.forEach(function (it) {
        var active = S.route && S.route.item === it.name;
        var dirty = it.type === "file" ? (S.files[it.def.path] || {}).dirty
          : Object.keys(S.files).some(function (p) { return p.indexOf(it.def.path + "/") === 0 && S.files[p].dirty; });
        list.appendChild(h("li", null, h("a", {
          href: it.type === "collection" ? "#/list/" + it.name : "#/edit/" + it.name,
          "aria-current": active ? "page" : null,
          class: dirty ? "is-dirty" : null
        }, h("span", { text: it.label }), dirty ? h("span", { class: "zk-dot", title: "Unsaved changes" }) : null)));
      });
      els.nav.appendChild(h("div", { class: "zk-nav-group" }, g.heading ? h("p", { class: "zk-nav-head", text: g.heading }) : null, list));
    });
  }

  /* ---------------------------------------------------------------- routes */

  function route() {
    var parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    var first = S.nav[0] && S.nav[0].items[0];
    var r;
    if (parts[0] === "edit" && findItem(parts[1])) r = { kind: "file", item: parts[1] };
    else if (parts[0] === "list" && findItem(parts[1])) r = { kind: "list", item: parts[1] };
    else if (parts[0] === "entry" && findItem(parts[1]) && parts[2]) r = { kind: "entry", item: parts[1], slug: parts[2] };
    else r = { kind: first.type === "collection" ? "list" : "file", item: first.name };
    S.route = r;
    app.classList.remove("nav-open");
    if (els.menuBtn) els.menuBtn.setAttribute("aria-expanded", "false");
    renderNav();
    var it = findItem(r.item);
    els.view.textContent = "";
    if (r.kind === "file") renderFile(it);
    else if (r.kind === "list") renderList(it);
    else renderEntry(it, r.slug);
    document.getElementById("zk-main").scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function pageHead(title, sub, actions, back) {
    els.title.textContent = title;
    document.title = title + " - Website editor";
    return h("div", { class: "zk-pagehead" },
      back ? h("a", { class: "zk-back", href: back.href }, icon("back"), back.label) : null,
      h("div", { class: "zk-pagehead-row" },
        h("div", null, h("h2", { class: "zk-h2", text: title }), sub ? h("p", { class: "zk-sub", text: sub }) : null),
        actions ? h("div", { class: "zk-pagehead-actions" }, actions) : null));
  }

  function viewLink(url) {
    return url ? h("a", { class: "zk-btn zk-btn-ghost", href: url, target: "_blank", rel: "noopener" }, "View on website", icon("external")) : null;
  }

  /* --------------------------------------------------------- single files */

  function renderFile(it) {
    var def = it.def, f = S.files[def.path];
    if (!f) {
      els.view.appendChild(pageHead(it.label));
      els.view.appendChild(h("p", { class: "zk-empty", text: "This file was not found in the website's content (" + def.path + ")." }));
      return;
    }
    els.view.appendChild(pageHead(it.label, def.description, [viewLink(PAGE_URLS[def.path])]));
    els.view.appendChild(renderForm(def.fields || [], f, def.path));
    showErrorsFor(def.path);
  }

  /* ----------------------------------------------------------- collections */

  function entriesOf(def) {
    var prefix = def.path.replace(/\/$/, "") + "/";
    return Object.keys(S.files).filter(function (p) {
      return p.indexOf(prefix) === 0 && p.slice(prefix.length).indexOf("/") === -1 && !S.files[p].deleted;
    }).map(function (p) {
      return { path: p, slug: p.slice(prefix.length).replace(/\.ya?ml$/, ""), file: S.files[p] };
    });
  }

  function renderList(it) {
    var def = it.def;
    var entries = entriesOf(def).sort(function (a, b) {
      var oa = a.file.data.order, ob = b.file.data.order;
      oa = typeof oa === "number" ? oa : 999; ob = typeof ob === "number" ? ob : 999;
      return oa - ob || String(a.file.data.title || "").localeCompare(String(b.file.data.title || ""));
    });
    els.view.appendChild(pageHead(it.label, "Click a project to edit it. Lower position numbers are shown first.",
      [h("button", { class: "zk-btn", type: "button", onclick: function () { newEntry(it); } }, icon("plus"), "Add project")]));
    var catLabels = {};
    (def.fields || []).forEach(function (fd) {
      if (fd.name === "category" && fd.options && fd.options.values) fd.options.values.forEach(function (v) { catLabels[v.name] = v.label; });
    });
    var list = h("ul", { class: "zk-cards" });
    entries.forEach(function (e) {
      var d = e.file.data;
      list.appendChild(h("li", null, h("a", { class: "zk-card-link", href: "#/entry/" + it.name + "/" + encodeURIComponent(e.slug) },
        h("span", { class: "zk-card-thumb" }, d.image ? h("img", { src: imgUrl(d.image), alt: "", loading: "lazy" }) : icon("image")),
        h("span", { class: "zk-card-body" },
          h("span", { class: "zk-card-meta" },
            d.category ? h("span", { class: "zk-chip zk-chip-" + d.category, text: catLabels[d.category] || d.category }) : null,
            d.show_on_home === false ? h("span", { class: "zk-chip", text: "Not on home page" }) : null,
            e.file.dirty ? h("span", { class: "zk-chip zk-chip-dirty", text: "Unsaved" }) : null),
          h("strong", { text: d.title || e.slug }),
          d.status_label ? h("small", { text: d.status_label }) : null),
        h("span", { class: "zk-card-order", title: "Position" }, typeof d.order === "number" ? String(d.order) : ""),
        icon("chevron"))));
    });
    els.view.appendChild(list);
  }

  function renderEntry(it, slug) {
    var def = it.def;
    var path = def.path.replace(/\/$/, "") + "/" + slug + ".yml";
    var f = S.files[path];
    var back = { href: "#/list/" + it.name, label: "All " + it.label.toLowerCase() };
    if (!f || f.deleted) {
      els.view.appendChild(pageHead("Not found", null, null, back));
      els.view.appendChild(h("p", { class: "zk-empty", text: "This project doesn't exist (any more)." }));
      return;
    }
    var d = f.data;
    var url = f.isNew ? null : (d.detail_page ? "/project-" + slug + ".html" : "/projects.html#" + slug);
    els.view.appendChild(pageHead(d.title || slug, f.isNew ? "New project. It appears on the website after you save." : null,
      [viewLink(url), h("button", { class: "zk-btn zk-btn-danger", type: "button", onclick: function () { removeEntry(it, path, f); } }, icon("trash"), "Remove")], back));
    els.view.appendChild(renderForm(def.fields || [], f, path));
    showErrorsFor(path);
  }

  function newEntry(it) {
    var def = it.def;
    var nameInput = h("input", { class: "zk-input", type: "text", id: "zk-new-name", required: true, maxlength: 90, autocomplete: "off" });
    var catField = (def.fields || []).filter(function (x) { return x.name === "category"; })[0];
    var catSelect = catField ? h("select", { class: "zk-input", id: "zk-new-cat" },
      (catField.options.values || []).map(function (v) { return h("option", { value: v.name, text: v.label }); })) : null;
    var err = h("p", { class: "zk-field-error", hidden: true });
    dialog("Add a project", [
      h("div", { class: "zk-field" }, h("label", { class: "zk-label", for: "zk-new-name", text: "Project name" }), nameInput),
      catSelect ? h("div", { class: "zk-field" }, h("label", { class: "zk-label", for: "zk-new-cat", text: "Completed or ongoing?" }), catSelect) : null,
      err
    ], "Create project", false, function () {
      var title = nameInput.value.trim();
      var slug = slugify(title);
      if (!title || !slug) { err.textContent = "Please enter a name."; err.hidden = false; nameInput.focus(); return false; }
      var path = def.path.replace(/\/$/, "") + "/" + slug + ".yml";
      if (S.files[path] && !S.files[path].deleted) { err.textContent = "There is already a project with this name."; err.hidden = false; return false; }
      var data = { title: title };
      var maxOrder = 0;
      entriesOf(def).forEach(function (e) { if (typeof e.file.data.order === "number") maxOrder = Math.max(maxOrder, e.file.data.order); });
      (def.fields || []).forEach(function (fd) {
        fd = resolve(fd);
        if (fd.default !== undefined && fd.default !== "" && data[fd.name] === undefined) data[fd.name] = fd.default;
      });
      if (catSelect) data.category = catSelect.value;
      data.order = maxOrder + 1;
      S.files[path] = { text: "", oid: null, data: data, dirty: true, isNew: true };
      location.hash = "#/entry/" + it.name + "/" + encodeURIComponent(slug);
      updateSavebar();
      return true;
    });
    setTimeout(function () { nameInput.focus(); }, 30);
  }

  function removeEntry(it, path, f) {
    var title = f.data.title || path;
    if (f.isNew) {
      delete S.files[path];
      location.hash = "#/list/" + it.name;
      updateSavebar();
      return;
    }
    dialog("Remove \"" + title + "\"?", [
      h("p", { text: "The project, its card and its project page are removed from the website right away. Photos stay available. An administrator can bring it back from the history if needed." })
    ], "Remove project", true, function () {
      var others = Object.keys(S.files).filter(function (p) { return p !== path && S.files[p].dirty; });
      if (others.length) {
        toast("Save or discard your other changes first.", "error");
        return true;
      }
      setStatus("saving", "Removing...");
      S.saving = true;
      post("save", { payload: JSON.stringify({ changes: [], deletes: [{ path: path, oid: f.oid }], uploads: [], summary: "remove project " + title }) })
        .then(function (res) {
          f.deleted = true;
          delete S.files[path];
          S.saving = false;
          location.hash = "#/list/" + it.name;
          trackPublish(res.commit);
        })
        .catch(function (e) { S.saving = false; saveFailed(e); });
      return true;
    });
  }

  /* ------------------------------------------------------------------ forms */

  function resolve(fd) {
    if (!fd || !fd.component) return fd;
    var c = S.components[fd.component] || {};
    var out = {};
    Object.keys(c).forEach(function (k) { out[k] = c[k]; });
    Object.keys(fd).forEach(function (k) { if (k !== "component") out[k] = fd[k]; });
    return out;
  }
  function isImageList(fd) { return fd.type === "image" && fd.options && fd.options.multiple; }
  function isList(fd) { return !!fd.list && !isImageList(fd); }

  // A "holder" reads an object without creating it, and creates it only when something is typed
  function rootHolder(file) { return { get: function () { return file.data; }, ensure: function () { return file.data; } }; }
  function childHolder(parent, name) {
    return {
      get: function () { var p = parent.get(); return p && typeof p[name] === "object" && p[name] !== null && !Array.isArray(p[name]) ? p[name] : undefined; },
      ensure: function () { var p = parent.ensure(); if (!p[name] || typeof p[name] !== "object" || Array.isArray(p[name])) p[name] = {}; return p[name]; }
    };
  }
  function itemHolder(item) { return { get: function () { return item; }, ensure: function () { return item; } }; }

  function renderForm(fields, file, path) {
    var form = h("div", { class: "zk-form" });
    var ctx = { file: file, path: path };
    var loose = null;
    var sections = [];
    var root = rootHolder(file);
    var used = {};
    function add(sec, label) { form.appendChild(sec.el); sections.push({ id: sec.id, label: label }); used[label] = true; }
    // Labels like "Project page: about heading" are shown as "About heading" inside a "Project page" section
    function split(label) {
      var m = /^([^:]{3,30}):\s*(.+)$/.exec(label);
      return m ? { group: m[1], rest: m[2].charAt(0).toUpperCase() + m[2].slice(1) } : null;
    }
    fields.forEach(function (raw) {
      var fd = resolve(raw), label = fd.label || fd.name, sec, sp = split(label);
      if (fd.type === "object" && !isList(fd)) {        // a group of fields: its own section
        loose = null;
        sec = section(label, fd.description, fd.name);
        renderFields(fd.fields || [], childHolder(root, fd.name), sec.body, ctx, fd.name + ".");
        add(sec, label);
      } else if (isList(fd)) {                           // a list (updates, gallery...): its own section
        loose = null;
        var lt = sp ? sp.rest : label;
        sec = section(lt, fd.description || (sp ? "On the " + sp.group.toLowerCase() + "." : null), fd.name);
        renderField(fd, root, sec.body, ctx, "", { bare: true });
        add(sec, lt);
      } else {                                           // single fields: grouped together
        if (!loose || (sp && loose.group !== sp.group)) {
          var title = sp ? sp.group : (!sections.length ? "Main details" : "More details");
          if (used[title]) title += " (continued)";
          sec = section(title, null, "part-" + sections.length);
          loose = { body: sec.body, group: sp ? sp.group : null };
          add(sec, title);
        }
        var shown = sp && loose.group === sp.group ? Object.assign({}, fd, { label: sp.rest }) : fd;
        renderField(shown, root, loose.body, ctx, "");
      }
    });
    if (sections.length > 3) {
      var jump = h("nav", { class: "zk-jump", "aria-label": "Jump to section" });
      sections.forEach(function (s) {
        jump.appendChild(h("a", { href: "#" + s.id, text: s.label, onclick: function (e) {
          e.preventDefault();
          var t = document.getElementById(s.id);
          if (t) { t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }
        } }));
      });
      form.insertBefore(jump, form.firstChild);
    }
    return form;
  }

  function section(title, description, key) {
    var id = "sec-" + String(key).replace(/[^a-z0-9_-]/gi, "-");
    var body = h("div", { class: "zk-section-body" });
    var el = h("section", { class: "zk-section", id: id },
      h("header", { class: "zk-section-head" }, h("h3", { text: title }), description ? h("p", { text: description }) : null),
      body);
    return { el: el, body: body, id: id };
  }

  function renderFields(fields, holder, container, ctx, prefix) {
    fields.forEach(function (raw) { renderField(resolve(raw), holder, container, ctx, prefix); });
  }

  function fieldWrap(fd, ctx, keyPath, control, opts) {
    opts = opts || {};
    var id = "f-" + (ctx.path + "-" + keyPath).replace(/[^a-z0-9_-]/gi, "-");
    var wrap = h("div", { class: "zk-field" + (opts.inline ? " zk-field-inline" : ""), "data-path": ctx.path + "::" + keyPath },
      opts.noLabel ? null : h("label", { class: "zk-label", for: opts.labelFor === false ? null : id },
        fd.label || fd.name, fd.required ? h("span", { class: "zk-req", "aria-hidden": "true", text: " *" }) : null),
      fd.description && !opts.inline ? h("p", { class: "zk-help", id: id + "-help", text: fd.description }) : null,
      control,
      fd.description && opts.inline ? h("p", { class: "zk-help", text: fd.description }) : null,
      h("p", { class: "zk-field-error", hidden: true }));
    var input = control.matches && control.matches("input,textarea,select") ? control : control.querySelector && control.querySelector("input,textarea,select");
    if (input && opts.labelFor !== false) {
      input.id = id;
      if (fd.description && !opts.inline) input.setAttribute("aria-describedby", id + "-help");
    }
    return wrap;
  }

  function changed(ctx) {
    ctx.file.dirty = true;
    updateSavebar();
  }

  function renderField(fd, holder, container, ctx, prefix, how) {
    var name = fd.name, keyPath = prefix + name;
    var get = function () { var o = holder.get(); return o ? o[name] : undefined; };
    var set = function (v) {
      var o = holder.ensure();
      if (v === undefined) delete o[name]; else o[name] = v;
      clearError(ctx.path, keyPath);
      changed(ctx);
    };
    var opt = fd.options || {};

    if (isList(fd)) { container.appendChild(renderList_(fd, holder, ctx, keyPath, how && how.bare)); return; }
    if (isImageList(fd)) { container.appendChild(fieldWrap(fd, ctx, keyPath, imageList(fd, get, set), { labelFor: false })); return; }

    if (fd.type === "object") {
      var group = h("fieldset", { class: "zk-group" }, h("legend", { text: fd.label || name }), fd.description ? h("p", { class: "zk-help", text: fd.description }) : null);
      renderFields(fd.fields || [], childHolder(holder, name), group, ctx, keyPath + ".");
      container.appendChild(group);
      return;
    }

    var v = get(), control;
    switch (fd.type) {
      case "text":
        control = h("textarea", { class: "zk-input zk-textarea", rows: 3, maxlength: opt.maxlength || null,
          oninput: function () { autosize(control); set(control.value); counter && updCount(); } });
        control.value = v == null ? "" : String(v);
        requestAnimationFrame(function () { autosize(control); });
        break;
      case "rich-text":
        control = richText(v, set);
        break;
      case "number":
        control = h("input", { class: "zk-input zk-input-short", type: "number", inputmode: "decimal", min: opt.min != null ? opt.min : null, max: opt.max != null ? opt.max : null, step: "any",
          oninput: function () { set(control.value === "" ? undefined : Number(control.value)); } });
        control.value = v == null ? "" : String(v);
        break;
      case "boolean":
        var on = v === undefined ? !!fd.default : !!v;
        var cb = h("input", { type: "checkbox", role: "switch", class: "zk-switch-input", onchange: function () { set(cb.checked); } });
        cb.checked = on;
        control = h("span", { class: "zk-switch" }, cb, h("span", { class: "zk-switch-track", "aria-hidden": "true" }));
        container.appendChild(fieldWrap(fd, ctx, keyPath, control, { inline: true }));
        return;
      case "select":
        control = h("select", { class: "zk-input", onchange: function () { set(control.value || undefined); } },
          fd.required ? null : h("option", { value: "", text: "-" }),
          (opt.values || []).map(function (o) { return typeof o === "object" ? h("option", { value: o.name, text: o.label || o.name }) : h("option", { value: o, text: o }); }));
        control.value = v == null ? "" : String(v);
        break;
      case "date":
        control = h("input", { class: "zk-input zk-input-short", type: "date", oninput: function () { set(control.value); } });
        control.value = v ? String(v).slice(0, 10) : "";
        break;
      case "image":
        container.appendChild(fieldWrap(fd, ctx, keyPath, imageSingle(fd, get, set), { labelFor: false }));
        return;
      default: // string
        control = h("input", { class: "zk-input", type: /(url|link|youtube|facebook)/i.test(name) ? "url" : name === "email" ? "email" : "text",
          maxlength: opt.maxlength || null, autocomplete: "off", spellcheck: "true",
          oninput: function () { set(control.value); counter && updCount(); } });
        control.value = v == null ? "" : String(v);
    }
    var counter = null, updCount = null;
    if (opt.maxlength && (fd.type === "text" || fd.type === "string" || !fd.type)) {
      counter = h("span", { class: "zk-count" });
      updCount = function () { counter.textContent = control.value.length + " / " + opt.maxlength; };
      updCount();
    }
    var wrap = fieldWrap(fd, ctx, keyPath, control);
    if (counter) wrap.insertBefore(counter, wrap.querySelector(".zk-field-error"));
    container.appendChild(wrap);
  }

  function autosize(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 600) + "px"; }

  function richText(v, set) {
    var ta = h("textarea", { class: "zk-input zk-textarea", rows: 6, oninput: function () { autosize(ta); set(ta.value); } });
    ta.value = v == null ? "" : String(v);
    requestAnimationFrame(function () { autosize(ta); });
    function wrapSel(before, after, placeholder) {
      var s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || placeholder;
      ta.setRangeText(before + sel + after, s, e, "end");
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
      ta.dispatchEvent(new Event("input"));
    }
    var bar = h("div", { class: "zk-rt-bar", role: "toolbar", "aria-label": "Text formatting" },
      h("button", { type: "button", class: "zk-rt-btn", title: "Bold", onclick: function () { wrapSel("**", "**", "bold text"); } }, h("b", { text: "B" })),
      h("button", { type: "button", class: "zk-rt-btn", title: "Italic", onclick: function () { wrapSel("*", "*", "italic text"); } }, h("i", { text: "I" })),
      h("button", { type: "button", class: "zk-rt-btn", title: "Link", onclick: function () {
        var url = window.prompt("Link address (starting with https://)", "https://");
        if (url && /^(https?:\/\/|mailto:|\/)/i.test(url)) wrapSel("[", "](" + url + ")", "link text");
      } }, "Link"),
      h("span", { class: "zk-rt-hint", text: "Leave an empty line between paragraphs." }));
    return h("div", { class: "zk-rt" }, bar, ta);
  }

  /* --------------------------------------------------------------- lists */

  function renderList_(fd, holder, ctx, keyPath, bare) {
    var name = fd.name;
    var listOpt = typeof fd.list === "object" ? fd.list : {};
    var summaryTpl = listOpt.collapsible && listOpt.collapsible.summary;
    var startCollapsed = !!(listOpt.collapsible && listOpt.collapsible.collapsed);
    var wrap = h("div", { class: "zk-field zk-list", "data-path": ctx.path + "::" + keyPath },
      bare ? null : h("p", { class: "zk-label", text: fd.label || name }),
      fd.description && !bare ? h("p", { class: "zk-help", text: fd.description }) : null);
    var ul = h("ol", { class: "zk-items" });
    var openSet = S.openItems || (S.openItems = {});
    wrap.appendChild(ul);
    var isObj = fd.type === "object";

    function arr() { var o = holder.get(); return o && Array.isArray(o[name]) ? o[name] : []; }
    function draw() {
      ul.textContent = "";
      var items = arr();
      items.forEach(function (item, i) {
        var key = ctx.path + "::" + keyPath + "::" + i;
        var open = openSet[key] !== undefined ? openSet[key] : !startCollapsed;
        var blank = "New " + singular(fd.label || "item");
        var summary = (isObj && summaryTpl ? fill(summaryTpl, item) : "") || (isObj ? "" : String(item || "")) || blank;
        var body = h("div", { class: "zk-item-body", hidden: !open });
        var toggle = h("button", { type: "button", class: "zk-item-toggle", "aria-expanded": String(open), onclick: function () {
          var now = body.hidden; body.hidden = !now; toggle.setAttribute("aria-expanded", String(now)); openSet[key] = now; li.classList.toggle("is-open", now);
        } }, icon("chevron"),
          isObj && item && item.image ? h("img", { class: "zk-item-thumb", src: imgUrl(item.image), alt: "" }) : null,
          h("span", { class: "zk-item-summary", text: summary }));
        var li = h("li", { class: "zk-item" + (open ? " is-open" : "") },
          h("div", { class: "zk-item-head" }, toggle,
            h("div", { class: "zk-item-tools" },
              h("button", { type: "button", class: "zk-icon-btn", title: "Move up", "aria-label": "Move up", disabled: i === 0, onclick: function () { move(i, -1); } }, icon("up")),
              h("button", { type: "button", class: "zk-icon-btn", title: "Move down", "aria-label": "Move down", disabled: i === items.length - 1, onclick: function () { move(i, 1); } }, icon("down")),
              h("button", { type: "button", class: "zk-icon-btn zk-icon-danger", title: "Remove", "aria-label": "Remove", onclick: function () { removeAt(i, summary); } }, icon("trash")))),
          body);
        if (isObj) {
          renderFields(fd.fields || [], itemHolder(item), body, ctx, keyPath + "." + i + ".");
          body.addEventListener("input", function () {
            var s2 = (summaryTpl ? fill(summaryTpl, item) : "") || blank;
            toggle.querySelector(".zk-item-summary").textContent = s2;
          });
        } else {
          var inp = h("input", { class: "zk-input", type: "text", oninput: function () { items[i] = inp.value; changed(ctx); } });
          inp.value = item == null ? "" : String(item);
          body.appendChild(inp);
        }
        ul.appendChild(li);
      });
      if (!items.length) ul.appendChild(h("li", { class: "zk-items-empty", text: "Nothing here yet." }));
    }
    function move(i, dir) {
      var a = arr(), j = i + dir;
      if (j < 0 || j >= a.length) return;
      var t = a[i]; a[i] = a[j]; a[j] = t;
      var k1 = ctx.path + "::" + keyPath + "::" + i, k2 = ctx.path + "::" + keyPath + "::" + j, o1 = openSet[k1];
      openSet[k1] = openSet[k2]; openSet[k2] = o1;
      changed(ctx); draw();
    }
    function removeAt(i, summary) {
      dialog("Remove this item?", [h("p", { text: "\"" + summary + "\" will be removed when you save." })], "Remove", true, function () {
        arr().splice(i, 1);
        Object.keys(openSet).forEach(function (k) { if (k.indexOf(ctx.path + "::" + keyPath + "::") === 0) delete openSet[k]; });
        changed(ctx); draw();
        return true;
      });
    }
    var addBtn = h("button", { type: "button", class: "zk-btn zk-btn-soft", onclick: function () {
      var o = holder.ensure();
      if (!Array.isArray(o[name])) o[name] = [];
      var item = isObj ? {} : "";
      if (isObj) (fd.fields || []).forEach(function (sf) { sf = resolve(sf); if (sf.default !== undefined && sf.default !== "") item[sf.name] = sf.default; });
      var atTop = /newest first|at the top/i.test((fd.label || "") + " " + (fd.description || ""));
      if (atTop) o[name].unshift(item); else o[name].push(item);
      var idx = atTop ? 0 : o[name].length - 1;
      if (atTop) {
        // shift remembered open/closed state down by one
        var shifted = {};
        Object.keys(openSet).forEach(function (k) {
          var pre = ctx.path + "::" + keyPath + "::";
          if (k.indexOf(pre) === 0) shifted[pre + (Number(k.slice(pre.length)) + 1)] = openSet[k]; else shifted[k] = openSet[k];
        });
        S.openItems = openSet = shifted;
      }
      openSet[ctx.path + "::" + keyPath + "::" + idx] = true;
      changed(ctx); draw();
      var newLi = ul.children[idx];
      var first = newLi && newLi.querySelector(".zk-item-body input, .zk-item-body textarea");
      if (first) first.focus();
    } }, icon("plus"), "Add " + singular(fd.label || "item"));
    wrap.appendChild(addBtn);
    draw();
    return wrap;
  }

  function singular(label) {
    var l = String(label).replace(/\s*\(.*\)\s*/g, "").toLowerCase();
    var map = { "photos": "photo", "values": "value", "items": "item", "verses": "verse", "progress updates": "update", "photo gallery": "photo",
      "one-time amounts": "amount", "monthly amounts": "monthly amount", "project page: quick facts": "fact" };
    return map[l] || l.replace(/ies$/, "y").replace(/s$/, "");
  }

  /* -------------------------------------------------------------- photos */

  function imageSingle(fd, get, set) {
    var box = h("div", { class: "zk-image" });
    function draw() {
      box.textContent = "";
      var v = get();
      box.appendChild(v
        ? h("div", { class: "zk-image-preview" }, previewImg(v), h("span", { class: "zk-image-name", text: String(v).split("/").pop() }))
        : h("div", { class: "zk-image-empty" }, icon("image"), h("span", { text: "No photo" })));
      box.appendChild(h("div", { class: "zk-image-actions" },
        uploadButton(function (path) { set(path); draw(); }),
        h("button", { type: "button", class: "zk-btn zk-btn-ghost zk-btn-sm", onclick: function () { pickImage(function (p) { set(p); draw(); }); } }, "Choose from website photos"),
        v && !fd.required ? h("button", { type: "button", class: "zk-btn zk-btn-link zk-btn-sm", onclick: function () { set(""); draw(); } }, "Remove photo") : null));
    }
    draw();
    return box;
  }

  function imageList(fd, get, set) {
    var max = fd.options.multiple && fd.options.multiple.max;
    var box = h("div", { class: "zk-image-list" });
    function list() { var v = get(); return Array.isArray(v) ? v : (v ? [v] : []); }
    function draw() {
      box.textContent = "";
      var items = list();
      var grid = h("div", { class: "zk-image-grid" });
      items.forEach(function (p, i) {
        grid.appendChild(h("div", { class: "zk-image-tile" }, previewImg(p),
          h("button", { type: "button", class: "zk-icon-btn zk-tile-remove", "aria-label": "Remove photo", title: "Remove photo",
            onclick: function () { var a = list().slice(); a.splice(i, 1); set(a); draw(); } }, icon("close"))));
      });
      box.appendChild(grid);
      if (!max || items.length < max) {
        box.appendChild(h("div", { class: "zk-image-actions" },
          uploadButton(function (path) { set(list().concat([path])); draw(); }),
          h("button", { type: "button", class: "zk-btn zk-btn-ghost zk-btn-sm", onclick: function () { pickImage(function (p) { set(list().concat([p])); draw(); }); } }, "Choose from website photos")));
      } else {
        box.appendChild(h("p", { class: "zk-help", text: "Maximum " + max + " photos. Remove one to add another." }));
      }
    }
    draw();
    return box;
  }

  function previewImg(path) {
    var img = h("img", { src: imgUrl(path), alt: "", loading: "lazy" });
    img.addEventListener("error", function () {
      var ph = h("span", { class: "zk-image-pending", text: "Photo is being published" });
      img.replaceWith(ph);
    }, { once: true });
    return img;
  }

  function uploadButton(onDone) {
    var input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "zk-visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    var label = h("span", { text: "Upload photo" });
    var btn = h("button", { type: "button", class: "zk-btn zk-btn-sm", onclick: function () { input.click(); } }, icon("upload"), label);
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      btn.disabled = true;
      label.textContent = "Preparing...";
      shrink(file).then(function (small) {
        return uploadFile(small, function (p) { label.textContent = "Uploading " + Math.round(p * 100) + "%"; }).then(function (res) {
          S.uploads[res.path] = { sha: res.sha };
          S.previews[res.path] = URL.createObjectURL(small);
          if (S.images.indexOf(res.path) === -1) S.images.unshift(res.path);
          onDone(res.path);
          toast("Photo added. Remember to describe it.", "ok");
        });
      }).catch(function (e) {
        toast(e.message || "The upload failed.", "error");
      }).then(function () {
        btn.disabled = false;
        label.textContent = "Upload photo";
      });
    });
    return h("span", { class: "zk-upload" }, btn, input);
  }

  function pickImage(onPick) {
    var search = h("input", { class: "zk-input", type: "search", placeholder: "Search by file name", "aria-label": "Search photos" });
    var grid = h("div", { class: "zk-picker" });
    function draw() {
      grid.textContent = "";
      var q = search.value.trim().toLowerCase();
      S.images.filter(function (p) { return !q || p.toLowerCase().indexOf(q) !== -1; }).forEach(function (p) {
        grid.appendChild(h("button", { type: "button", class: "zk-picker-item", title: p.split("/").pop(), onclick: function () { onPick(p); closeDialog(); } },
          previewImg(p), h("span", { text: p.split("/").pop() })));
      });
      if (!grid.children.length) grid.appendChild(h("p", { class: "zk-empty", text: "No photos match." }));
    }
    search.addEventListener("input", draw);
    draw();
    dialog("Choose a photo", [search, grid], null, false, null, "zk-dialog-wide");
    setTimeout(function () { search.focus(); }, 30);
  }

  /* ---------------------------------------------------------- validation */

  function validateFields(fields, obj, prefix, errs) {
    (fields || []).forEach(function (raw) {
      var fd = resolve(raw), v = obj ? obj[fd.name] : undefined, p = prefix + fd.name, opt = fd.options || {};
      if (isList(fd)) {
        (Array.isArray(v) ? v : []).forEach(function (item, i) {
          if (fd.type === "object") validateFields(fd.fields, item, p + "." + i + ".", errs);
        });
        return;
      }
      if (isImageList(fd)) return;
      if (fd.type === "object") { validateFields(fd.fields, v || {}, p + ".", errs); return; }
      var empty = v === undefined || v === null || v === "";
      if (empty) {
        if (fd.required) errs.push({ key: p, msg: "Please fill in \"" + (fd.label || fd.name) + "\"." });
        return;
      }
      if (fd.pattern && fd.pattern.regex) {
        var re;
        try { re = new RegExp(fd.pattern.regex); } catch (e) { re = null; }
        if (re && !re.test(String(v))) errs.push({ key: p, msg: fd.pattern.message || "This doesn't look right." });
      }
      if (opt.maxlength && String(v).length > opt.maxlength) errs.push({ key: p, msg: "Please shorten this to " + opt.maxlength + " characters." });
      if (fd.type === "number" && opt.min != null && Number(v) < opt.min) errs.push({ key: p, msg: "The lowest allowed number is " + opt.min + "." });
    });
  }

  function schemaFor(path) {
    var found = null;
    (S.schema.content || []).forEach(function (c) {
      (c.type === "group" ? c.items || [] : [c]).forEach(function (it) {
        if (it.type === "file" && it.path === path) found = { def: it, kind: "file" };
        if (it.type === "collection" && path.indexOf(it.path.replace(/\/$/, "") + "/") === 0) found = { def: it, kind: "entry" };
      });
    });
    return found;
  }

  function routeFor(path) {
    var sf = schemaFor(path);
    if (!sf) return "#/";
    if (sf.kind === "file") return "#/edit/" + sf.def.name;
    return "#/entry/" + sf.def.name + "/" + encodeURIComponent(path.split("/").pop().replace(/\.ya?ml$/, ""));
  }

  function clearError(path, key) {
    if (S.errors[path]) delete S.errors[path][key];
    var el = document.querySelector('[data-path="' + cssEsc(path + "::" + key) + '"]');
    if (el) { el.classList.remove("has-error"); var m = el.querySelector(":scope > .zk-field-error"); if (m) m.hidden = true; }
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"); }

  function showErrorsFor(path) {
    var errs = S.errors[path];
    if (!errs) return null;
    var firstEl = null;
    Object.keys(errs).forEach(function (key) {
      var el = document.querySelector('[data-path="' + cssEsc(path + "::" + key) + '"]');
      if (!el) return;
      el.classList.add("has-error");
      var m = el.querySelector(":scope > .zk-field-error");
      if (m) { m.textContent = errs[key]; m.hidden = false; }
      // open any collapsed list items around it
      var body = el.closest(".zk-item-body");
      while (body) {
        if (body.hidden) { body.hidden = false; var li = body.closest(".zk-item"); if (li) { li.classList.add("is-open"); var t = li.querySelector(".zk-item-toggle"); if (t) t.setAttribute("aria-expanded", "true"); } }
        body = body.parentElement && body.parentElement.closest(".zk-item-body");
      }
      if (!firstEl) firstEl = el;
    });
    return firstEl;
  }

  /* ---------------------------------------------------------------- save */

  function anyDirty() { return Object.keys(S.files).some(function (p) { return S.files[p].dirty; }); }

  function updateSavebar() {
    var dirty = Object.keys(S.files).filter(function (p) { return S.files[p].dirty; });
    var show = dirty.length > 0 || S.saving;
    if (show && els.savebar.hidden) {
      els.savebar.hidden = false;
      requestAnimationFrame(function () { els.savebar.classList.add("is-shown"); });
    } else if (!show && !els.savebar.hidden) {
      els.savebar.classList.remove("is-shown");
      setTimeout(function () { if (!anyDirty() && !S.saving) els.savebar.hidden = true; }, 220);
    }
    var t = document.getElementById("zk-dirty-text");
    if (t) t.textContent = dirty.length > 1 ? "Unsaved changes on " + dirty.length + " pages" : "You have unsaved changes";
    document.body.classList.toggle("has-savebar", show);
    renderNavSoon();
  }
  var navTimer = null;
  function renderNavSoon() { clearTimeout(navTimer); navTimer = setTimeout(renderNav, 120); }

  function labelFor(path) {
    var sf = schemaFor(path);
    if (sf && sf.kind === "file") return sf.def.label || path;
    var f = S.files[path];
    return "project " + ((f && f.data && f.data.title) || path.split("/").pop());
  }

  function save() {
    if (S.saving) return;
    var dirty = Object.keys(S.files).filter(function (p) { return S.files[p].dirty; });
    S.errors = {};
    var firstBad = null;
    dirty.forEach(function (p) {
      var sf = schemaFor(p), errs = [];
      if (sf) validateFields(sf.def.fields, S.files[p].data, "", errs);
      if (errs.length) {
        S.errors[p] = {};
        errs.forEach(function (e) { S.errors[p][e.key] = e.msg; });
        if (!firstBad) firstBad = p;
      }
    });
    if (firstBad) {
      var count = Object.keys(S.errors[firstBad]).length;
      toast(count === 1 ? "One thing needs fixing before saving." : count + " things need fixing before saving.", "error");
      var target = routeFor(firstBad);
      var go = function () {
        var el = showErrorsFor(firstBad);
        if (el) { el.scrollIntoView({ block: "center" }); var i = el.querySelector("input,textarea,select,button"); if (i) i.focus({ preventScroll: true }); }
      };
      if (location.hash !== target) { location.hash = target; setTimeout(go, 50); } else go();
      return;
    }

    var changes = [];
    dirty.forEach(function (p) {
      var f = S.files[p], text = dumpYaml(f.data);
      if (text !== f.text || f.isNew) changes.push({ path: p, text: text, oid: f.oid });
      else f.dirty = false;
    });
    if (!changes.length) { updateSavebar(); toast("Nothing changed.", "ok"); return; }
    var uploads = Object.keys(S.uploads).filter(function (up) {
      return changes.some(function (c) { return c.text.indexOf(up) !== -1; });
    }).map(function (up) { return { path: up, sha: S.uploads[up].sha }; });
    var summary = changes.map(function (c) { return labelFor(c.path); }).join(", ");

    S.saving = true;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = "Saving...";
    setStatus("saving", "Saving...");
    post("save", { payload: JSON.stringify({ changes: changes, deletes: [], uploads: uploads, summary: summary }) }).then(function (res) {
      changes.forEach(function (c) {
        var f = S.files[c.path];
        f.text = c.text;
        f.oid = (res.oids && res.oids[c.path]) || f.oid;
        f.dirty = false;
        f.isNew = false;
      });
      uploads.forEach(function (u) { delete S.uploads[u.path]; });
      S.saving = false;
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = "Save & publish";
      updateSavebar();
      if (S.route && S.route.kind !== "file") route(); // refresh lists (e.g. "Unsaved" chips, new project's link)
      trackPublish(res.commit);
    }).catch(function (e) {
      S.saving = false;
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = "Save & publish";
      updateSavebar();
      saveFailed(e);
    });
  }

  function saveFailed(e) {
    setStatus("error", "Not saved");
    if (e.data && e.data.conflict) {
      dialog("Someone else saved first", [h("p", { text: e.message })], "Reload the editor", false, function () {
        Object.keys(S.files).forEach(function (p) { S.files[p].dirty = false; });
        location.reload();
        return true;
      });
    } else if (e.data && e.data.reload) {
      dialog("Please reload", [h("p", { text: e.message + " Copy any long text you typed first, so you can paste it back." })], "Reload", false, function () { location.reload(); return true; });
    } else {
      toast(e.message || "Saving failed. Please try again.", "error");
    }
  }

  function discardAll() {
    dialog("Discard your changes?", [h("p", { text: "Everything you changed since the last save will be undone." })], "Discard changes", true, function () {
      Object.keys(S.files).forEach(function (p) {
        var f = S.files[p];
        if (!f.dirty) return;
        if (f.isNew) delete S.files[p];
        else { f.data = parseYaml(f.text); f.dirty = false; }
      });
      S.errors = {};
      updateSavebar();
      route();
      return true;
    });
  }

  // After saving: watch the website until the new version is online
  function trackPublish(commit) {
    clearInterval(S.publishTimer);
    var id = String(commit || "").slice(0, 12), tries = 0;
    setStatus("publishing", "Saved. Publishing to the website (about 2 minutes)...");
    toast("Saved. The website updates in about 2 minutes.", "ok");
    S.publishTimer = setInterval(function () {
      tries++;
      fetch("/build-id.txt?nocache=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
        if (String(t).trim().indexOf(id) === 0) {
          clearInterval(S.publishTimer);
          setTimeout(function () { setStatus("live", "Live on the website"); }, 8000);
        }
      }).catch(function () { /* keep waiting */ });
      if (tries > 54) { clearInterval(S.publishTimer); setStatus("slow", "Still publishing. Check the website in a few minutes."); }
    }, 10000);
  }

  /* ------------------------------------------------------- status, toasts */

  function setStatus(kind, text) {
    els.status.className = "zk-status is-" + kind;
    els.status.textContent = "";
    if (kind === "live") els.status.appendChild(icon("check"));
    else if (kind === "publishing" || kind === "saving") els.status.appendChild(h("span", { class: "zk-spinner", "aria-hidden": "true" }));
    els.status.appendChild(h("span", { text: text }));
  }

  var toastBox = null;
  function toast(text, kind) {
    if (!toastBox) { toastBox = h("div", { class: "zk-toasts", role: "status", "aria-live": "polite" }); document.body.appendChild(toastBox); }
    var t = h("div", { class: "zk-toast is-" + (kind || "ok") }, icon(kind === "error" ? "close" : "check"), h("span", { text: text }));
    toastBox.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("is-shown"); });
    setTimeout(function () { t.classList.remove("is-shown"); setTimeout(function () { t.remove(); }, 250); }, kind === "error" ? 7000 : 4000);
  }

  /* -------------------------------------------------------------- dialog */

  var dialogDone = null;
  function dialog(title, body, okLabel, danger, onOk, extraClass) {
    var d = els.dialog;
    d.className = "zk-dialog" + (extraClass ? " " + extraClass : "");
    d.textContent = "";
    var form = h("form", { method: "dialog", class: "zk-dialog-inner" },
      h("div", { class: "zk-dialog-head" }, h("h2", { text: title }),
        h("button", { type: "button", class: "zk-icon-btn", "aria-label": "Close", onclick: closeDialog }, icon("close"))),
      h("div", { class: "zk-dialog-body" }, body),
      okLabel ? h("div", { class: "zk-dialog-foot" },
        h("button", { type: "button", class: "zk-btn zk-btn-ghost", onclick: closeDialog, text: "Cancel" }),
        h("button", { type: "submit", class: "zk-btn" + (danger ? " zk-btn-danger-solid" : ""), text: okLabel })) : null);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!onOk || onOk() !== false) closeDialog();
    });
    d.appendChild(form);
    dialogDone = onOk;
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }
  function closeDialog() {
    var d = els.dialog;
    if (d.close && d.open) d.close(); else d.removeAttribute("open");
  }

  start();
})();
