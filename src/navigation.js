export function initNavigation(root = document) {
  const navToggle = root.querySelector('.nav-toggle');
  const navLinks = root.querySelector('.nav-links');
  if (!navToggle || !navLinks) return;

  function setOpen(open) {
    navToggle.setAttribute('aria-expanded', String(open));
    navLinks.classList.toggle('open', open);
  }

  navToggle.addEventListener('click', () => {
    setOpen(navToggle.getAttribute('aria-expanded') !== 'true');
  });
  navLinks.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
}
