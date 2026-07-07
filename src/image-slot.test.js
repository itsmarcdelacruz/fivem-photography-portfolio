// @vitest-environment jsdom

import { expect, it } from 'vitest';

it('propagates the alt attribute to the visible shadow image', async () => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  await import('./image-slot.js');
  const slot = document.createElement('image-slot');
  slot.id = 'alt-test';
  slot.setAttribute('src', '/frame.webp');
  slot.setAttribute('alt', 'A driver beneath pink neon');
  document.body.appendChild(slot);
  await Promise.resolve();
  expect(slot.shadowRoot.querySelector('img[part="image"]').alt).toBe('A driver beneath pink neon');
});
