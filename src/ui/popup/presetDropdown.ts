export const attachPresetDropdown = (
  dropdown: HTMLElement,
  toggle: HTMLElement,
  menu: HTMLElement,
) => {
  const close = (restoreFocus = false): void => {
    menu.style.display = "none";
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener("click", () => {
    const open = menu.style.display !== "block";
    menu.style.display = open ? "block" : "none";
    toggle.setAttribute("aria-expanded", String(open));
  });
  dropdown.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.style.display !== "block") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !dropdown.contains(event.target)) close();
  });
  return { close };
};
