(function () {
  var verses = [
    ["Galatians 6:9", "And let us not be weary in well doing: for in due season we shall reap, if we faint not."],
    ["Proverbs 19:17", "He that hath pity upon the poor lendeth unto the LORD; and that which he hath given will he pay him again."],
    ["Proverbs 22:9", "He that hath a bountiful eye shall be blessed; for he giveth of his bread to the poor."],
    ["Acts 20:35", "It is more blessed to give than to receive."],
    ["2 Corinthians 9:7", "Every man according as he purposeth in his heart, so let him give; not grudgingly, or of necessity: for God loveth a cheerful giver."],
    ["Hebrews 13:16", "But to do good and to communicate forget not: for with such sacrifices God is well pleased."],
    ["Matthew 25:40", "Inasmuch as ye have done it unto one of the least of these my brethren, ye have done it unto me."],
    ["Luke 6:38", "Give, and it shall be given unto you; good measure, pressed down, and shaken together, and running over, shall men give into your bosom."],
    ["Proverbs 11:25", "The liberal soul shall be made fat: and he that watereth shall be watered also himself."],
    ["Psalm 82:3", "Defend the poor and fatherless: do justice to the afflicted and needy."],
    ["Isaiah 1:17", "Learn to do well; seek judgment, relieve the oppressed, judge the fatherless, plead for the widow."],
    ["James 1:27", "Pure religion and undefiled before God and the Father is this, To visit the fatherless and widows in their affliction, and to keep himself unspotted from the world."],
    ["Mark 10:14", "Suffer the little children to come unto me, and forbid them not: for of such is the kingdom of God."],
    ["Proverbs 22:6", "Train up a child in the way he should go: and when he is old, he will not depart from it."],
    ["Philippians 4:19", "But my God shall supply all your need according to his riches in glory by Christ Jesus."],
    ["1 John 3:18", "My little children, let us not love in word, neither in tongue; but in deed and in truth."],
    ["Proverbs 3:27", "Withhold not good from them to whom it is due, when it is in the power of thine hand to do it."],
    ["Jeremiah 29:11", "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end."],
    ["Psalm 126:5", "They that sow in tears shall reap in joy."],
    ["1 Thessalonians 5:18", "In every thing give thanks: for this is the will of God in Christ Jesus concerning you."],
    ["Romans 12:13", "Distributing to the necessity of saints; given to hospitality."],
    ["Deuteronomy 15:11", "Thou shalt open thine hand wide unto thy brother, to thy poor, and to thy needy, in thy land."],
    ["Proverbs 28:27", "He that giveth unto the poor shall not lack: but he that hideth his eyes shall have many a curse."],
    ["Isaiah 58:10", "And if thou draw out thy soul to the hungry, and satisfy the afflicted soul; then shall thy light rise in obscurity, and thy darkness be as the noonday."],
    ["Luke 3:11", "He that hath two coats, let him impart to him that hath none; and he that hath meat, let him do likewise."],
    ["1 Peter 4:10", "As every man hath received the gift, even so minister the same one to another, as good stewards of the manifold grace of God."],
    ["Psalm 112:9", "He hath dispersed, he hath given to the poor; his righteousness endureth for ever."],
    ["Matthew 5:16", "Let your light so shine before men, that they may see your good works, and glorify your Father which is in heaven."],
    ["Psalm 127:3", "Lo, children are an heritage of the LORD: and the fruit of the womb is his reward."],
    ["Isaiah 40:31", "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint."],
    ["Psalm 23:1", "The LORD is my shepherd; I shall not want."]
  ];

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
      ref.textContent = v[0] + " · KJV";
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
    var line = "“" + v[1] + "” " + v[0] + " (KJV)";
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
