/* Project detail pages: photo lightbox + gentle scroll reveal.
   Every photo link still works without JavaScript (it simply opens the image). */
(function () {
  "use strict";

  /* ---------- Lightbox ---------- */
  var galleryLinks = Array.prototype.slice.call(document.querySelectorAll(".pd-gallery a[data-lightbox]"));
  var triggers = document.querySelectorAll("a[data-lightbox]");
  if (galleryLinks.length && typeof HTMLDialogElement === "function") {
    var items = galleryLinks.map(function (a) {
      var img = a.querySelector("img");
      return { src: a.getAttribute("href"), alt: img ? img.getAttribute("alt") : "", caption: a.getAttribute("data-caption") || "" };
    });

    var dlg = document.createElement("dialog");
    dlg.className = "lb";
    dlg.setAttribute("aria-label", "Photo viewer");
    dlg.innerHTML =
      '<div class="lb-inner">' +
        '<div class="lb-top"><p class="lb-count" aria-live="polite"></p>' +
        '<button type="button" class="lb-close" aria-label="Close photo viewer">&times;</button></div>' +
        '<div class="lb-stage"><img alt=""></div>' +
        '<p class="lb-caption"></p>' +
      '</div>' +
      '<button type="button" class="lb-prev" aria-label="Previous photo">&larr;</button>' +
      '<button type="button" class="lb-next" aria-label="Next photo">&rarr;</button>';
    document.body.appendChild(dlg);

    var stage = dlg.querySelector(".lb-stage");
    var img = stage.querySelector("img");
    var count = dlg.querySelector(".lb-count");
    var caption = dlg.querySelector(".lb-caption");
    var index = 0;
    var opener = null;

    if (items.length < 2) dlg.setAttribute("data-single", "");

    function show(i) {
      index = (i + items.length) % items.length;
      var it = items[index];
      img.src = it.src;
      img.alt = it.alt;
      caption.textContent = it.caption;
      count.textContent = "Photo " + (index + 1) + " of " + items.length;
      // Warm the next image so arrows feel instant
      if (items.length > 1) { var pre = new Image(); pre.src = items[(index + 1) % items.length].src; }
    }

    function open(i, from) {
      opener = from || null;
      show(i);
      document.documentElement.classList.add("lb-open");
      dlg.showModal();
    }

    dlg.addEventListener("close", function () {
      document.documentElement.classList.remove("lb-open");
      if (opener) opener.focus();
    });

    Array.prototype.forEach.call(triggers, function (a) {
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let "open in new tab" work
        var i = items.map(function (it) { return it.src; }).indexOf(a.getAttribute("href"));
        if (i < 0) return;
        e.preventDefault();
        open(i, a);
      });
    });

    dlg.querySelector(".lb-close").addEventListener("click", function () { dlg.close(); });
    dlg.querySelector(".lb-prev").addEventListener("click", function () { show(index - 1); });
    dlg.querySelector(".lb-next").addEventListener("click", function () { show(index + 1); });

    // Click the dark area around the photo to close
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg || e.target === stage || e.target.classList.contains("lb-inner")) dlg.close();
    });

    dlg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); show(index - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); show(index + 1); }
    });

    // Swipe left/right on touch screens
    var startX = null, startY = null;
    stage.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      startX = e.clientX; startY = e.clientY;
    });
    stage.addEventListener("pointerup", function (e) {
      if (startX === null) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      startX = startY = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2 && items.length > 1) show(index + (dx < 0 ? 1 : -1));
    });
    stage.addEventListener("pointercancel", function () { startX = startY = null; });
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll("[data-reveal]");
  if (revealEls.length && "IntersectionObserver" in window && !window.gsap) {
    document.documentElement.classList.add("reveal-ready");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    Array.prototype.forEach.call(revealEls, function (el) { io.observe(el); });
  }
})();
