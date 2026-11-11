/* Donation picker for donate.html. Reads assets/donate-links.js.
   Only links on Stripe's own checkout domain are accepted, so a typo or a
   tampered link can never send donors somewhere else. */
(function () {
  "use strict";
  var cfg = window.ZAKALIYA_DONATE;
  var box = document.querySelector("[data-give]");
  if (!cfg || !box) return;

  var STRIPE = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]+(\?[^\s"'<>]*)?$/;
  function ok(u) { return typeof u === "string" && STRIPE.test(u.trim()); }
  function clean(list) {
    return (list || []).filter(function (x) { return x && ok(x.url) && x.amount > 0; })
      .map(function (x) { return { amount: x.amount, url: x.url.trim() }; });
  }

  var once = clean(cfg.once);
  var other = ok(cfg.onceOther) ? cfg.onceOther.trim() : "";
  var monthly = clean(cfg.monthly);
  if (!once.length && !other && !monthly.length) return; // not set up yet: keep the original button

  var cur = cfg.currency || "$";
  var freqBox = box.querySelector("[data-give-freq]");
  var amountsBox = box.querySelector("[data-give-amounts]");
  var cta = box.querySelector("[data-give-cta]");
  var note = box.querySelector("[data-give-note]");
  var state = { freq: once.length || other ? "once" : "monthly", pick: null };

  var onceList = once.slice();
  if (other) onceList.push({ amount: 0, url: other, other: true });
  function options() { return state.freq === "monthly" ? monthly : onceList; }

  function label(o) { return o.other ? "Other amount" : cur + o.amount; }

  function renderAmounts() {
    var list = options();
    // Default to the second amount (a common "most chosen" middle option), else the first.
    if (!state.pick || list.indexOf(state.pick) < 0) state.pick = list[list.length > 2 ? 1 : 0];
    amountsBox.innerHTML = "";
    amountsBox.hidden = list.length < 2;
    list.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "give-amount" + (o.other ? " give-amount-other" : "");
      b.textContent = label(o);
      b.setAttribute("aria-pressed", String(o === state.pick));
      b.addEventListener("click", function () { state.pick = o; renderAmounts(); });
      amountsBox.appendChild(b);
    });
    var p = state.pick;
    cta.href = p.url;
    cta.textContent = p.other ? "Choose your amount securely" :
      (state.freq === "monthly" ? "Give " + cur + p.amount + " monthly" : "Donate " + cur + p.amount + " securely");
    note.textContent = state.freq === "monthly"
      ? "Billed monthly through Stripe. To change or stop it, just contact us."
      : (p.other ? "You'll enter your amount on Stripe's secure page." : "One-time gift.");
  }

  // Frequency switch only when both kinds exist
  if ((once.length || other) && monthly.length) {
    freqBox.hidden = false;
    var btns = freqBox.querySelectorAll("button");
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        state.freq = b.getAttribute("data-freq");
        state.pick = null;
        Array.prototype.forEach.call(btns, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        renderAmounts();
      });
    });
  }

  renderAmounts();
  box.hidden = false;
  var legacy = document.querySelector("[data-legacy-donate]");
  if (legacy) legacy.hidden = true;
})();
