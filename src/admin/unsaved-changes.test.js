// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import {
  confirmAdminNavigation,
  handleAdminBeforeUnload,
  isAdminDirty,
  setAdminDirty
} from './unsaved-changes.js';

beforeEach(() => {
  setAdminDirty(false);
  vi.restoreAllMocks();
});

it('keeps dirty state when SPA navigation is cancelled', () => {
  setAdminDirty(true);
  vi.spyOn(window, 'confirm').mockReturnValue(false);

  expect(confirmAdminNavigation()).toBe(false);
  expect(isAdminDirty()).toBe(true);
});

it('uses the shared dirty state for beforeunload', () => {
  setAdminDirty(true);
  const event = { preventDefault: vi.fn() };

  expect(handleAdminBeforeUnload(event)).toBe('');
  expect(event.preventDefault).toHaveBeenCalledOnce();
});
