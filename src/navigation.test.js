// @vitest-environment jsdom

import { expect, it } from 'vitest';
import { initNavigation } from './navigation.js';

it('opens and closes the menu on a story-route navigation shell', () => {
  history.replaceState({}, '', '/stories/night-drive');
  document.body.innerHTML =
    '<nav><button class="nav-toggle" aria-expanded="false" aria-controls="primaryNav">Menu</button>' +
    '<div class="nav-links" id="primaryNav"><a href="/">Home</a></div></nav>';
  initNavigation();
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  links.querySelector('a').addEventListener('click', (event) => event.preventDefault());
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(links.classList.contains('open')).toBe(true);
  links.querySelector('a').click();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(links.classList.contains('open')).toBe(false);
});
