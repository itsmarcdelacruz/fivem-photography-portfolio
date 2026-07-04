// @vitest-environment jsdom

import { beforeEach, expect, it } from 'vitest';
import { createLightbox } from './lightbox.js';

beforeEach(() => {
  document.body.innerHTML =
    '<button id="trigger">Open</button>' +
    '<div id="lb" role="dialog" aria-modal="true" aria-hidden="true">' +
      '<button data-lb-close>Close</button><button data-lb-prev>Previous</button>' +
      '<img data-lb-image><span data-lb-title></span><button data-lb-next>Next</button>' +
    '</div>';
});

it('opens, handles arrows and Escape, and restores trigger focus', () => {
  const items = [
    { src: '/a.webp', title: 'A', alt: 'A frame' },
    { src: '/b.webp', title: 'B', alt: 'B frame' }
  ];
  const trigger = document.getElementById('trigger');
  const lightbox = createLightbox(document.getElementById('lb'), { getItems: () => items });
  trigger.focus();
  lightbox.open(0, trigger);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(document.querySelector('[data-lb-title]').textContent).toBe('B');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.activeElement).toBe(trigger);
  expect(document.getElementById('lb').getAttribute('aria-hidden')).toBe('true');
});
