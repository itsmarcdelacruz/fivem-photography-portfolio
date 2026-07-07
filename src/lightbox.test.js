// @vitest-environment jsdom

import { beforeEach, expect, it } from 'vitest';
import { createLightbox } from './lightbox.js';

beforeEach(() => {
  document.body.innerHTML =
    '<button id="trigger">Open</button>' +
    '<div id="lb" role="dialog" aria-modal="true" aria-hidden="true">' +
    '<button data-lb-close>Close</button><button data-lb-prev>Previous</button>' +
    '<img data-lb-image><span data-lb-title></span><span data-lb-meta></span>' +
    '<span data-lb-count></span><button data-lb-next>Next</button>' +
    '<div data-lb-filmstrip></div>' +
    '</div>';
});

it('keeps the closed dialog inert and removes inert before focusing on open', () => {
  const trigger = document.getElementById('trigger');
  const root = document.getElementById('lb');
  const lightbox = createLightbox(root, {
    getItems: () => [{ src: '/a.webp', title: 'A', alt: 'A frame' }]
  });
  expect(root.inert).toBe(true);
  lightbox.open(0, trigger);
  expect(root.inert).toBe(false);
  expect(document.activeElement).toBe(root.querySelector('[data-lb-close]'));
  lightbox.close();
  expect(root.inert).toBe(true);
});

it('renders item details and updates the active filmstrip thumbnail', () => {
  const items = [
    { src: '/a.webp', title: 'A', alt: 'A frame', collection: 'Night', caption: 'Rain' },
    { src: '/b.webp', title: 'B', alt: 'B frame', meta: 'Downtown' }
  ];
  const trigger = document.getElementById('trigger');
  const lightbox = createLightbox(document.getElementById('lb'), { getItems: () => items });
  lightbox.open(0, trigger);
  const image = document.querySelector('[data-lb-image]');
  expect(image.getAttribute('src')).toBe('/a.webp');
  expect(image.alt).toBe('A frame');
  expect(document.querySelector('[data-lb-meta]').textContent).toBe('Night · Rain');
  expect(document.querySelector('[data-lb-count]').textContent).toBe('1 / 2');
  const thumbs = document.querySelectorAll('.lb-thumb');
  expect(thumbs[0].classList.contains('active')).toBe(true);
  thumbs[1].click();
  expect(document.querySelector('[data-lb-title]').textContent).toBe('B');
  expect(thumbs[1].classList.contains('active')).toBe(false);
  expect(document.querySelectorAll('.lb-thumb')[1].classList.contains('active')).toBe(true);
});

it('handles arrows and Escape and restores trigger focus', () => {
  const items = [
    { src: '/a.webp', title: 'A' },
    { src: '/b.webp', title: 'B' }
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

it('wraps focus in both directions', () => {
  const lightbox = createLightbox(document.getElementById('lb'), {
    getItems: () => [{ src: '/a.webp', title: 'A' }]
  });
  lightbox.open(0, document.getElementById('trigger'));
  const controls = document.querySelectorAll('#lb button');
  controls[controls.length - 1].focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
  expect(document.activeElement).toBe(controls[0]);
  controls[0].focus();
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true
    })
  );
  expect(document.activeElement).toBe(controls[controls.length - 1]);
});
