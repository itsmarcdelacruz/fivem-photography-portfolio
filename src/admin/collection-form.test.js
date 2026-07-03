import { describe, expect, it } from 'vitest';
import { collectionPayload, slugFromTitle } from './collection-form.js';

describe('collection form helpers', () => {
  it('generates stable collection slugs', () => {
    expect(slugFromTitle('Neon & Rain — 3AM')).toBe('neon-rain-3am');
  });

  it('maps blank optional values to null', () => {
    expect(collectionPayload({
      title: 'Night',
      slug: 'night',
      introduction: '',
      location: '',
      event_date: '',
      cover_photo_id: '',
      is_published: false
    })).toEqual({
      title: 'Night',
      slug: 'night',
      introduction: '',
      location: null,
      event_date: null,
      cover_photo_id: null,
      is_published: false
    });
  });
});
