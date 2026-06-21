import { describe, it, expect } from 'vitest';
import { aspectRatio, scaledWidth } from './upload.js';

describe('aspectRatio', () => {
  it('formats the ratio to 4 decimals', () => {
    expect(aspectRatio(1600, 1200)).toBe('1.3333');
    expect(aspectRatio(1000, 1000)).toBe('1.0000');
  });
});

describe('scaledWidth', () => {
  it('scales down to the max width', () => {
    expect(scaledWidth(4000, 800)).toBe(800);
    expect(scaledWidth(4000, 1920)).toBe(1920);
  });

  it('never upscales past the source width', () => {
    expect(scaledWidth(600, 800)).toBe(600);
    expect(scaledWidth(1000, 1920)).toBe(1000);
  });
});
