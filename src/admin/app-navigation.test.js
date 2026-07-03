// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const viewMocks = vi.hoisted(() => ({
  overview: vi.fn(),
  photos: vi.fn(),
  collections: vi.fn(),
  inbox: vi.fn(),
  schedule: vi.fn(),
  settings: vi.fn()
}));

vi.mock('./views/overview.js', () => ({ initOverview: viewMocks.overview }));
vi.mock('./views/photos.js', () => ({ initPhotos: viewMocks.photos }));
vi.mock('./views/collections.js', () => ({ initCollections: viewMocks.collections }));
vi.mock('./views/inbox.js', () => ({ initInbox: viewMocks.inbox }));
vi.mock('./views/schedule.js', () => ({ initSchedule: viewMocks.schedule }));
vi.mock('./views/settings.js', () => ({ initSettings: viewMocks.settings }));

import { bootAdmin } from './app.js';
import { setAdminDirty } from './unsaved-changes.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  location.hash = '#overview';
  setAdminDirty(false);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it('keeps the current view and hash when SPA navigation is cancelled', () => {
  bootAdmin(document.getElementById('root'));
  setAdminDirty(true);
  vi.spyOn(window, 'confirm').mockReturnValue(false);

  document.querySelector('[data-view="photos"]').click();

  expect(location.hash).toBe('#overview');
  expect(viewMocks.photos).not.toHaveBeenCalled();
  expect(document.querySelector('[data-view="overview"]').classList.contains('active')).toBe(true);
});
