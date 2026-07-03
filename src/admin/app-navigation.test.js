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

it('guards sign out before removing the token', () => {
  localStorage.setItem('admin_token', 'secret');
  const reload = vi.fn();
  bootAdmin(document.getElementById('root'), { reload });
  setAdminDirty(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

  document.getElementById('signOutBtn').click();
  expect(localStorage.getItem('admin_token')).toBe('secret');

  confirm.mockReturnValue(true);
  document.getElementById('signOutBtn').click();
  expect(localStorage.getItem('admin_token')).toBeNull();
  expect(reload).toHaveBeenCalledOnce();
});

it('restores the current hash and view when back navigation is cancelled', () => {
  bootAdmin(document.getElementById('root'));
  setAdminDirty(true);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  location.hash = '#photos';

  window.dispatchEvent(new HashChangeEvent('hashchange'));

  expect(location.hash).toBe('#overview');
  expect(viewMocks.photos).not.toHaveBeenCalled();
  expect(viewMocks.overview).toHaveBeenCalledOnce();
});

it('handles accepted hash navigation once without click double rendering', () => {
  bootAdmin(document.getElementById('root'));
  setAdminDirty(true);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  location.hash = '#photos';

  window.dispatchEvent(new HashChangeEvent('hashchange'));

  expect(viewMocks.photos).toHaveBeenCalledOnce();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(viewMocks.photos).toHaveBeenCalledOnce();
});
