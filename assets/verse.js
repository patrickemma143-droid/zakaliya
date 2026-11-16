(function () {
  // Verses come from content/verses.yml (edited in the website editor), placed on the page at build time.
  var data = window.ZAKALIYA_VERSES || {};
  var translation = data.translation || "KJV";
  var verses = (data.verses || []).filter(function (v) { return v && v.ref && v.text; }).map(function (v) { return [v.ref, v.text]; });
  if (!verses.length) return;

  var root = document.getElementById("daily-verse");
  if (!root) return;
  var text = root.querySelector("[data-verse-text]");
  var ref = root.querySelector("[data-verse-ref]");
  var dateEl = root.querySelector("[data-verse-date]");
  var count = root.querySelector("[data-verse-count]");
  var body = root.querySelector("[data-verse-body]");
  var next = root.querySelector("[data-verse-next]");
  var copy = root.querySelector("[data-verse-copy]");

  var now = new Date();
  var today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  var start = today % verses.length;
  var offset = 0;

  function current() { return (start + offset) % verses.length; }

  function render(animate) {
    var i = current(), v = verses[i];
    function paint() {
      text.textContent = v[1];
      ref.textContent = v[0] + " · " + translation;
      count.textContent = "Verse " + (i + 1) + " of " + verses.length;
      body.classList.remove("is-swapping");
    }
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      body.classList.add("is-swapping");
      setTimeout(paint, 180);
    } else { paint(); }
  }

  try {
    dateEl.textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  } catch (e) {}

  render(false);

  next.addEventListener("click", function () { offset += 1; render(true); });

  copy.addEventListener("click", function () {
    var v = verses[current()];
    var line = "“" + v[1] + "” " + v[0] + " (" + translation + ")";
    var label = copy.querySelector("span");
    function done(ok) {
      label.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(function () { label.textContent = "Copy verse"; }, 1800);
    }
    try {
      navigator.clipboard.writeText(line).then(function () { done(true); }, function () { done(false); });
    } catch (e) { done(false); }
  });
})();
