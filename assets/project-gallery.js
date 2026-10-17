(() => {
  const gallery = document.querySelector("[data-progress-gallery]");
  if (!gallery) return;

  const slides = [...gallery.querySelectorAll("[data-gallery-slide]")];
  const status = gallery.querySelector("[data-gallery-status]");
  const previous = gallery.querySelector("[data-gallery-prev]");
  const next = gallery.querySelector("[data-gallery-next]");
  const toggle = gallery.querySelector("[data-gallery-toggle]");
  if (slides.length < 2 || !status || !previous || !next || !toggle) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let index = 0;
  let timer = 0;
  let playing = !reduceMotion.matches;

  function render() {
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === index;
      slide.removeAttribute("hidden");
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      slide.setAttribute("aria-label", `Photo ${slideIndex + 1} of ${slides.length}`);
    });
    status.textContent = `Photo ${index + 1} of ${slides.length}`;
    toggle.textContent = playing ? "Pause" : "Play";
    toggle.setAttribute("aria-label", playing ? "Pause slideshow" : "Play slideshow");
  }

  function stopTimer() {
    window.clearInterval(timer);
    timer = 0;
  }

  function startTimer() {
    stopTimer();
    if (!playing || reduceMotion.matches || document.hidden) return;
    timer = window.setInterval(() => {
      index = (index + 1) % slides.length;
      render();
    }, 6500);
  }

  function show(step) {
    index = (index + step + slides.length) % slides.length;
    render();
    startTimer();
  }

  previous.addEventListener("click", () => show(-1));
  next.addEventListener("click", () => show(1));
  toggle.addEventListener("click", () => {
    playing = !playing;
    render();
    startTimer();
  });

  gallery.addEventListener("mouseenter", stopTimer);
  gallery.addEventListener("mouseleave", startTimer);
  gallery.addEventListener("focusin", stopTimer);
  gallery.addEventListener("focusout", (event) => {
    if (!gallery.contains(event.relatedTarget)) startTimer();
  });
  document.addEventListener("visibilitychange", startTimer);
  reduceMotion.addEventListener?.("change", () => {
    if (reduceMotion.matches) {
      playing = false;
      render();
      stopTimer();
    }
  });

  render();
  startTimer();
})();
