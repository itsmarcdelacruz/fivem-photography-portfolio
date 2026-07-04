import { describe, expect, it } from 'vitest';
import { toggleSelection } from './photos.js';

describe('toggleSelection', () => {
  it('adds and removes photo IDs without mutating the input set', () => {
    const original = new Set(['a']);
    expect([...toggleSelection(original, 'b', true)]).toEqual(['a', 'b']);
    expect([...toggleSelection(original, 'a', false)]).toEqual([]);
    expect([...original]).toEqual(['a']);
  });
});
