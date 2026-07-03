import { describe, expect, it } from 'vitest';
import { normalizeSlug, validateCollectionInput } from '../src/collection-domain.js';

describe('normalizeSlug', () => {
  it('produces a lowercase URL slug', () => {
    expect(normalizeSlug('  Neon & Rain — 3AM  ')).toBe('neon-rain-3am');
  });
});

describe('validateCollectionInput', () => {
  it('requires title and a valid slug on create', () => {
    expect(validateCollectionInput({ title: '', slug: 'x' }).error).toBe('title is required');
    expect(validateCollectionInput({ title: 'Night', slug: 'Not Valid!' }).error).toBe(
      'slug is invalid'
    );
  });

  it('normalizes optional fields and publishing state', () => {
    expect(
      validateCollectionInput({
        title: 'Neon & Rain',
        slug: 'neon-rain',
        introduction: 'After midnight.',
        location: '',
        event_date: '',
        cover_photo_id: '',
        is_published: false
      }).value
    ).toEqual({
      title: 'Neon & Rain',
      slug: 'neon-rain',
      introduction: 'After midnight.',
      location: null,
      event_date: null,
      cover_photo_id: null,
      is_published: 0
    });
  });
});
