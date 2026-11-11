/* Homepage motion (GSAP + ScrollTrigger + SplitText).
   Calm by design: transform/opacity/clip only, ease-out curves, nothing loops.
   Visitors who prefer reduced motion get the page with no movement. */
(function () {
  "use strict";
  var root = document.documentElement;
  function showAll() { root.classList.remove("js-anim"); }

  if (!window.gsap || !window.ScrollTrigger) { showAll(); return; }
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);

  var started = false;
  function start() {
  if (started) return;
  started = true;
  var mm = gsap.matchMedia();

  mm.add({
    motion: "(prefers-reduced-motion: no-preference)",
    reduce: "(prefers-reduced-motion: reduce)",
    wide: "(min-width: 768px)"
  }, function (ctx) {
    var c = ctx.conditions;
    if (c.reduce) { showAll(); return; }

    /* ---------- Hero entrance ---------- */
    var copy = document.querySelector(".hero-copy");
    var backdrop = document.querySelector(".hero-backdrop");
    var h1 = copy && copy.querySelector("h1");
    var split = null;
    var tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    if (copy) {
      gsap.set(copy, { autoAlpha: 1 });
      if (h1 && window.SplitText) {
        split = SplitText.create(h1, { type: "lines", mask: "lines", linesClass: "hero-line" });
      }
      if (backdrop) tl.from(backdrop, { scale: 1.08, duration: 1.8, ease: "power2.out" }, 0);
      tl.from(copy.querySelector(".eyebrow"), { autoAlpha: 0, x: -12, duration: 0.7 }, 0.15);
      if (split) tl.from(split.lines, { yPercent: 105, duration: 0.95, stagger: 0.09 }, 0.25);
      else if (h1) tl.from(h1, { autoAlpha: 0, y: 24, duration: 0.9 }, 0.25);
      tl.from(copy.querySelectorAll(":scope > p, .hero-actions > *"), { autoAlpha: 0, y: 18, duration: 0.8, stagger: 0.08 }, 0.55);
    }

    /* Background drifts slowly as the hero scrolls away (desktop only) */
    if (c.wide && document.querySelector(".hero-slide")) {
      gsap.set(".hero-slide", { scale: 1.16 });
      gsap.to(".hero-slide", {
        yPercent: 7, ease: "none",
        scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true }
      });
    }

    /* ---------- Section reveals ---------- */
    // CSS transitions on these elements would fight GSAP's transforms, so pause them during the reveal.
    var clean = "transform,opacity,visibility,transition";
    function reveal(selector, opts) {
      var els = gsap.utils.toArray(selector);
      if (!els.length) return;
      gsap.set(els, { autoAlpha: 0, y: opts.y, transition: "none" });
      ScrollTrigger.batch(els, {
        start: "top 88%",
        once: true,
        onEnter: function (batch) {
          gsap.to(batch, { autoAlpha: 1, y: 0, duration: opts.duration, ease: "power3.out", stagger: opts.stagger, overwrite: true, clearProps: clean });
        }
      });
    }

    reveal([
      ".intro-grid > div:first-child", ".intro-copy > p", ".mission-verse",
      ".story-video-copy", ".video-frame",
      ".about-brief-copy > *", ".about-brief-photo figcaption",
      ".home-projects h2", ".home-projects-lead", ".home-projects .wrap > .button",
      ".home-ongoing-heading > *", ".home-ongoing-cta",
      ".dv-side", ".dv-body",
      ".invitation-inner > *"
    ].join(","), { y: 24, duration: 0.8, stagger: 0.08 });

    reveal(".hp-card", { y: 34, duration: 0.9, stagger: 0.1 });

    /* Award photo: soft wipe upward */
    var award = document.querySelector(".about-brief-photo img");
    if (award) {
      gsap.fromTo(award,
        { clipPath: "inset(100% 0% 0% 0% round 18px)", scale: 1.06 },
        { clipPath: "inset(0% 0% 0% 0% round 18px)", scale: 1, duration: 1.2, ease: "power3.out", clearProps: "clipPath,transform",
          scrollTrigger: { trigger: award, start: "top 85%", once: true } });
    }

    return function () { if (split) split.revert(); };
  });
  }

  // Split the headline only after the web font has loaded (line breaks depend on it),
  // but never wait longer than 1.2s.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
  setTimeout(start, 1200);

  // Recalculate trigger positions once lazy images have settled
  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
})();
