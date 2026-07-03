// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collections: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    replacePhotos: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn()
  },
  adminList: vi.fn()
}));

vi.mock('../api.js', () => ({
  api: {
    collections: mocks.collections,
    photos: { adminList: mocks.adminList }
  }
}));

import { isAdminDirty, setAdminDirty } from '../unsaved-changes.js';
import { initCollections } from './collections.js';

beforeEach(() => {
  document.body.innerHTML = '<main class="admin-main"></main>';
  setAdminDirty(false);
  vi.clearAllMocks();
  mocks.collections.list.mockResolvedValue({
    collections: [{ id: 'collection-1', title: 'Night', is_published: 0 }]
  });
  mocks.adminList.mockResolvedValue({
    photos: [{ id: 'photo-1', title: 'Frame', thumb_url: '/frame.jpg' }]
  });
  mocks.collections.get.mockResolvedValue({
    collection: {
      id: 'collection-1', title: 'Night', slug: 'night', introduction: '',
      location: '', event_date: '', cover_photo_id: '', is_published: 0,
      photos: [{ id: 'photo-1', title: 'Frame', thumb_url: '/frame.jpg', caption: '' }]
    }
  });
});

it('marks membership caption edits and removals dirty', async () => {
  const main = document.querySelector('main');
  await initCollections(main);
  main.querySelector('[data-collection-id]').click();
  await vi.waitFor(() => expect(main.querySelector('.sequence-card')).not.toBeNull());

  const caption = main.querySelector('.sequence-card input');
  caption.value = 'Changed';
  caption.dispatchEvent(new Event('input', { bubbles: true }));
  expect(isAdminDirty()).toBe(true);

  setAdminDirty(false);
  main.querySelector('.sequence-card button').click();
  expect(isAdminDirty()).toBe(true);
});

it('shows save failures without losing edits or disabling controls', async () => {
  const main = document.querySelector('main');
  mocks.collections.update.mockRejectedValueOnce(new Error('Network unavailable'));
  await initCollections(main);
  main.querySelector('[data-collection-id]').click();
  await vi.waitFor(() => expect(main.querySelector('.collection-form')).not.toBeNull());

  const title = main.querySelector('[name="title"]');
  title.value = 'Changed title';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  main.querySelector('.collection-form').dispatchEvent(new Event('submit', {
    bubbles: true,
    cancelable: true
  }));

  await vi.waitFor(() => {
    expect(main.querySelector('.save-state').textContent).toBe('Save failed: Network unavailable');
  });
  expect(mocks.collections.update).toHaveBeenCalledWith('collection-1', expect.objectContaining({
    title: 'Changed title'
  }));
  expect(isAdminDirty()).toBe(true);
  expect(main.querySelector('[name="title"]').disabled).toBe(false);
  expect(main.querySelector('[type="submit"]').disabled).toBe(false);
});
