// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const queue = {
    add: vi.fn(),
    run: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    subscribe: vi.fn()
  };
  return {
    queue,
    queueListener: null,
    photos: {
      adminList: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      reorder: vi.fn(),
      batch: vi.fn(),
      findHash: vi.fn(),
      remove: vi.fn()
    },
    collections: { list: vi.fn() }
  };
});

vi.mock('../api.js', () => ({
  api: { photos: mocks.photos, collections: mocks.collections }
}));
vi.mock('../upload-queue.js', () => ({
  createUploadQueue: vi.fn(() => {
    mocks.queue.subscribe.mockImplementation((listener) => {
      mocks.queueListener = listener;
      return () => {};
    });
    return mocks.queue;
  })
}));
vi.mock('../upload.js', () => ({
  hashFile: vi.fn(),
  uploadPhoto: vi.fn()
}));

import { initPhotos, toggleSelection } from './photos.js';

const photos = [
  { id: 'a', title: 'Alpha', category: 'portraits', thumb_url: '/a.jpg', is_published: true },
  { id: 'b', title: 'Beta', category: 'events', thumb_url: '/b.jpg', is_published: true },
  { id: 'c', title: 'Gamma', category: 'automotive', thumb_url: '/c.jpg', is_published: true }
];

async function render() {
  const main = document.querySelector('main');
  await initPhotos(main);
  return main;
}

function drag(type, target) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { effectAllowed: '', files: [] }
  });
  target.dispatchEvent(event);
}

beforeEach(() => {
  document.body.innerHTML = '<main></main>';
  vi.clearAllMocks();
  mocks.queueListener = null;
  mocks.photos.adminList.mockResolvedValue({ photos: photos.map((photo) => ({ ...photo })) });
  mocks.collections.list.mockResolvedValue({ collections: [{ id: 'night', title: 'Night' }] });
  mocks.photos.update.mockResolvedValue({});
  mocks.photos.reorder.mockResolvedValue({});
  mocks.photos.batch.mockResolvedValue({});
  mocks.photos.remove.mockResolvedValue({});
});

describe('toggleSelection', () => {
  it('adds and removes photo IDs without mutating the input set', () => {
    const original = new Set(['a']);
    expect([...toggleSelection(original, 'b', true)]).toEqual(['a', 'b']);
    expect([...toggleSelection(original, 'a', false)]).toEqual([]);
    expect([...original]).toEqual(['a']);
  });
});

it('reorders cards and persists the exact resulting global order atomically', async () => {
  const main = await render();
  const [alpha, beta] = main.querySelectorAll('[data-photo-id]');

  drag('dragstart', beta);
  drag('dragover', alpha);
  drag('drop', main.querySelector('#photoGrid'));

  await vi.waitFor(() => expect(mocks.photos.reorder).toHaveBeenCalledTimes(1));
  expect([...main.querySelectorAll('[data-photo-id]')].map((card) => card.dataset.photoId)).toEqual(
    ['b', 'a', 'c']
  );
  expect(mocks.photos.reorder).toHaveBeenCalledWith(['b', 'a', 'c']);
});

it('restores the original DOM order and shows an error when atomic reorder rejects', async () => {
  const main = await render();
  const [alpha, beta] = main.querySelectorAll('[data-photo-id]');
  mocks.photos.reorder.mockRejectedValueOnce(new Error('Network unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});

  drag('dragstart', beta);
  drag('dragover', alpha);
  drag('drop', main.querySelector('#photoGrid'));

  await vi.waitFor(() =>
    expect(main.querySelector('[data-reorder-error]').textContent).toBe(
      'Could not save photo order: Network unavailable. Try again.'
    )
  );
  expect([...main.querySelectorAll('[data-photo-id]')].map((card) => card.dataset.photoId)).toEqual(
    ['a', 'b', 'c']
  );
});

it('restores the original DOM order without persisting when drag ends outside the grid', async () => {
  const main = await render();
  const [alpha, beta] = main.querySelectorAll('[data-photo-id]');

  drag('dragstart', beta);
  drag('dragover', alpha);
  drag('dragend', beta);

  expect([...main.querySelectorAll('[data-photo-id]')].map((card) => card.dataset.photoId)).toEqual(
    ['a', 'b', 'c']
  );
  expect(mocks.photos.reorder).not.toHaveBeenCalled();
});

it('renders an aggregate terminal summary and keeps it accurate after retry and cancel', async () => {
  const main = await render();
  mocks.queueListener([
    { id: '1', file: { name: 'one.jpg' }, status: 'complete', message: 'Complete' },
    { id: '2', file: { name: 'two.jpg' }, status: 'failed', message: 'Failed', error: 'network' },
    { id: '3', file: { name: 'three.jpg' }, status: 'cancelled', message: 'Cancelled' }
  ]);
  expect(main.querySelector('[data-upload-summary]').textContent).toBe(
    '1 complete, 1 failed, 1 cancelled/skipped'
  );

  mocks.queueListener([
    { id: '1', file: { name: 'one.jpg' }, status: 'complete', message: 'Complete' },
    { id: '2', file: { name: 'two.jpg' }, status: 'complete', message: 'Complete' },
    { id: '3', file: { name: 'three.jpg' }, status: 'cancelled', message: 'Cancelled' }
  ]);
  expect(main.querySelector('[data-upload-summary]').textContent).toBe(
    '2 complete, 0 failed, 1 cancelled/skipped'
  );
});

it('names collection usage and forces deletion only after the second confirmation', async () => {
  const main = await render();
  mocks.photos.remove
    .mockRejectedValueOnce(
      Object.assign(new Error('used'), {
        status: 409,
        data: { usage: { collection_count: 2, cover_count: 1 } }
      })
    )
    .mockResolvedValueOnce({});
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

  main.querySelector('[data-photo-id="a"] .photo-delete').click();

  await vi.waitFor(() => expect(mocks.photos.remove).toHaveBeenCalledTimes(2));
  expect(confirm).toHaveBeenNthCalledWith(1, 'Delete "Alpha"?');
  expect(confirm).toHaveBeenNthCalledWith(
    2,
    '"Alpha" is used in 2 collection(s) and is a collection cover. Delete it everywhere?'
  );
  expect(mocks.photos.remove.mock.calls).toEqual([['a'], ['a', true]]);
  expect(main.querySelector('[data-photo-id="a"]')).toBeNull();
});

it('publishes selected photos in one batch and updates cards only after success', async () => {
  const main = await render();
  const checkbox = main.querySelector('[data-photo-id="a"] .photo-select input');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));

  main.querySelector('[data-bulk-hide]').click();

  await vi.waitFor(() =>
    expect(mocks.photos.batch).toHaveBeenCalledWith({
      photo_ids: ['a'],
      changes: { is_published: false },
      add_collection_ids: [],
      remove_collection_ids: []
    })
  );
  await vi.waitFor(() =>
    expect(main.querySelector('[data-photo-id="a"]').classList.contains('unpublished')).toBe(true)
  );
});
