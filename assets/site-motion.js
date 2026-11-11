/* Site-wide motion (GSAP + ScrollTrigger + SplitText), used on every page.
   - Hero: plays once when the page opens.
   - Sections: fade up when scrolled into view, and reset when they drop back
     below the screen, so they play again every time you scroll down to them.
   Calm by design: transform/opacity/clip only, ease-out curves.
   Visitors who prefer reduced motion get no movement; if GSAP fails to load,
   the page simply shows normally. */
(function () {
  "use strict";
  var root = document.documentElement;
  function showAll() { root.classList.remove("js-anim"); }

  if (!window.gsap || !window.ScrollTrigger) { showAll(); return; }
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);

  var HERO_COPY = ".hero-copy, .page-hero-copy, .ct-form-wrap, .don-hero-copy, .pd-hero-copy";
  var HERO_MEDIA = ".hero-backdrop, .projects-hero-image img, .about-photo img, .don-hero-media img, .pd-hero-media img";

  var TEXT = [
    // shared
    ".intro-grid > div:first-child", ".intro-copy > p", ".intro-copy > ul", ".mission-verse",
    ".invitation-inner > *",
    // home
    ".story-video-copy", ".video-frame", ".about-brief-copy > *", ".about-brief-photo figcaption",
    ".home-projects h2", ".home-projects-lead", ".home-projects .wrap > .button",
    ".home-ongoing-heading > *", ".home-ongoing-cta", ".dv-side", ".dv-body",
    // about
    ".founders-copy > *", ".founders-photo figcaption", ".recognition-heading > *", ".beliefs-grid > h2",
    // projects
    ".project-section-heading > *",
    // donate / contact
    ".don-use-copy > h2", ".don-list > div", ".don-verse", ".don-other-inner > *", ".ct-details",
    // project detail pages
    ".pd-section-head > *", ".pd-facts dl > div", ".pd-gallery-note"
  ].join(",");

  var CARDS = [
    ".hp-card", ".belief-list > article", ".recognition-gallery figure",
    ".pj-project-row", ".pd-update", ".pd-gallery > li", ".pd-other"
  ].join(",");

  var WIPES = ".about-brief-photo img, .founders-photo img";

  var started = false;
  function start() {
    if (started) return;
    started = true;
    var mm = gsap.matchMedia();

    mm.add({
      reduce: "(prefers-reduced-motion: reduce)",
      wide: "(min-width: 768px)"
    }, function (ctx) {
      var c = ctx.conditions;
      if (c.reduce) { showAll(); return; }

      /* ---------- Hero entrance (once, on page open) ---------- */
      var copy = document.querySelector(HERO_COPY);
      var splits = [];
      var tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      var media = document.querySelector(HERO_MEDIA);
      if (media) tl.from(media, { scale: 1.07, autoAlpha: media.classList.contains("hero-backdrop") ? 1 : 0, duration: 1.6, ease: "power2.out" }, 0);

      if (copy) {
        gsap.set(copy, { autoAlpha: 1 });
        var parts = gsap.utils.toArray(copy.children);
        var at = 0.15;
        parts.forEach(function (el) {
          if (el.tagName === "H1" && window.SplitText) {
            var s = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "split-line" });
            splits.push(s);
            tl.from(s.lines, { yPercent: 105, duration: 0.95, stagger: 0.09 }, at);
            at += 0.25 + s.lines.length * 0.09;
          } else {
            tl.from(el, { autoAlpha: 0, y: 18, duration: 0.8 }, at);
            at += 0.08;
          }
        });
      }

      /* Home hero photo drifts slowly as it scrolls away (desktop only) */
      if (c.wide && document.querySelector(".hero-slide")) {
        gsap.set(".hero-slide", { scale: 1.16 });
        gsap.to(".hero-slide", {
          yPercent: 7, ease: "none",
          scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true }
        });
      }

      /* ---------- Section reveals (replay on every scroll down) ---------- */
      // CSS hover transitions would fight GSAP's transforms, so they are paused while hidden/animating.
      function reveal(selector, y, duration, stagger) {
        var els = gsap.utils.toArray(selector).filter(function (el) { return !el.closest(HERO_COPY); });
        if (!els.length) return;
        var hidden = { autoAlpha: 0, y: y, transition: "none", overwrite: true };
        gsap.set(els, hidden);
        ScrollTrigger.batch(els, {
          start: "top 90%",
          onEnter: function (batch) {
            gsap.to(batch, { autoAlpha: 1, y: 0, duration: duration, ease: "power3.out", stagger: stagger, overwrite: true,
              clearProps: "transform,opacity,visibility,transition" });
          },
          // Scrolled back up so the element is below the screen again: hide it, ready to replay.
          onLeaveBack: function (batch) { gsap.set(batch, hidden); }
        });
      }
      reveal(TEXT, 24, 0.8, 0.08);
      reveal(CARDS, 34, 0.9, 0.1);

      /* Photos revealed with a soft upward wipe (also replays) */
      gsap.utils.toArray(WIPES).forEach(function (img) {
        gsap.fromTo(img,
          { clipPath: "inset(100% 0% 0% 0% round 18px)", scale: 1.06 },
          { clipPath: "inset(0% 0% 0% 0% round 18px)", scale: 1, duration: 1.2, ease: "power3.out",
            scrollTrigger: { trigger: img, start: "top 88%", toggleActions: "play none none reset" } });
      });

      return function () { splits.forEach(function (s) { s.revert(); }); };
    });
  }

  // Split headlines only after the web font has loaded (line breaks depend on it), but never wait over 1.2s.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
  setTimeout(start, 1200);

  // Lazy images change the page height as they load
  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
})();
