document.querySelectorAll(".site-header .menu-toggle").forEach((button) => {
  const nav = button.closest(".nav");
  const menu = document.getElementById(button.getAttribute("aria-controls"));
  if (!nav || !menu) return;

  const closeMenu = (restoreFocus = false) => {
    nav.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };

  button.addEventListener("click", () => {
    const isOpen = button.getAttribute("aria-expanded") === "true";
    nav.classList.toggle("is-open", !isOpen);
    button.setAttribute("aria-expanded", String(!isOpen));
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target)) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") closeMenu(true);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 820) closeMenu();
  });
});
