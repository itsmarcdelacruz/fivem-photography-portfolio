import { describe, expect, it, vi } from 'vitest';
import { saveCollection } from './collection-save.js';

function fakeApi(log) {
  return {
    create: vi.fn(async payload => {
      log.push(['create', payload]);
      return { collection: { id: 'new-id' } };
    }),
    update: vi.fn(async (id, payload) => {
      log.push(['update', id, payload]);
      return { collection: { id } };
    }),
    replacePhotos: vi.fn(async (id, photos) => {
      log.push(['replacePhotos', id, photos]);
      return {};
    })
  };
}

describe('saveCollection', () => {
  it('creates unpublished, adds photos, then publishes', async () => {
    const log = [];
    const api = fakeApi(log);
    const photos = [{ photo_id: 'photo-1', caption: '' }];

    await saveCollection(api, { id: null, is_published: 0 }, {
      title: 'Night', slug: 'night', is_published: true
    }, photos);

    expect(log).toEqual([
      ['create', { title: 'Night', slug: 'night', is_published: false }],
      ['replacePhotos', 'new-id', photos],
      ['update', 'new-id', { is_published: true }]
    ]);
  });

  it('updates a draft, adds its first photo, then publishes', async () => {
    const log = [];
    const api = fakeApi(log);
    const photos = [{ photo_id: 'photo-1', caption: 'Opening' }];

    await saveCollection(api, { id: 'draft-id', is_published: 0 }, {
      title: 'Night', slug: 'night', is_published: true
    }, photos);

    expect(log).toEqual([
      ['update', 'draft-id', { title: 'Night', slug: 'night' }],
      ['replacePhotos', 'draft-id', photos],
      ['update', 'draft-id', { is_published: true }]
    ]);
  });

  it('unpublishes before removing all membership', async () => {
    const log = [];
    const api = fakeApi(log);

    await saveCollection(api, { id: 'published-id', is_published: 1 }, {
      title: 'Night', slug: 'night', is_published: false
    }, []);

    expect(log).toEqual([
      ['update', 'published-id', { title: 'Night', slug: 'night', is_published: false }],
      ['replacePhotos', 'published-id', []]
    ]);
  });

  it('keeps a published collection published while replacing valid membership', async () => {
    const log = [];
    const api = fakeApi(log);
    const photos = [{ photo_id: 'photo-1', caption: '' }];

    await saveCollection(api, { id: 'published-id', is_published: 1 }, {
      title: 'Night', slug: 'night', is_published: true
    }, photos);

    expect(log).toEqual([
      ['update', 'published-id', { title: 'Night', slug: 'night' }],
      ['replacePhotos', 'published-id', photos],
      ['update', 'published-id', { is_published: true }]
    ]);
  });
});
