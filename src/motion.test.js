// @vitest-environment jsdom

import { expect, it, vi } from 'vitest';
import { initGalleryTilt, initHeroMotion } from './motion.js';

it('does not register gallery tilt effects when reduced motion is requested', () => {
  document.body.innerHTML =
    '<figure class="shot"><div class="shot-inner" style="transform:rotate(2deg)">' +
    '<div class="shot-glare" style="--gx:20%;--gy:30%"></div><image-slot></image-slot></div></figure>';
  const shot = document.querySelector('.shot');
  const listen = vi.spyOn(shot, 'addEventListener');
  const matchMedia = vi.fn(() => ({ matches: true }));
  vi.stubGlobal('matchMedia', matchMedia);
  initGalleryTilt();
  expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  expect(listen).not.toHaveBeenCalled();
  expect(document.querySelector('.shot-inner').style.transform).toBe('');
  expect(document.querySelector('.shot-glare').style.getPropertyValue('--gx')).toBe('');
});

it('does not run hero RAF or pointer effects when reduced motion is requested', () => {
  document.body.innerHTML =
    '<header class="hero"><div id="heroPhoto" data-depth="2" style="transform:translateX(1px)"></div></header>';
  const hero = document.querySelector('.hero');
  const listen = vi.spyOn(hero, 'addEventListener');
  const raf = vi.fn();
  const matchMedia = vi.fn(() => ({ matches: true }));
  vi.stubGlobal('matchMedia', matchMedia);
  vi.stubGlobal('requestAnimationFrame', raf);
  initHeroMotion();
  expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  expect(listen).not.toHaveBeenCalled();
  expect(raf).not.toHaveBeenCalled();
  expect(document.getElementById('heroPhoto').style.transform).toBe('');
});
