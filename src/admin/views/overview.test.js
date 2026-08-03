// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  photos: { adminList: vi.fn() },
  collections: { list: vi.fn() },
  commissions: { list: vi.fn() },
  shoots: { list: vi.fn() },
  settings: { get: vi.fn(), update: vi.fn() }
}));

vi.mock('../api.js', () => ({ api: mocks }));

import { deriveOverview, initOverview } from './overview.js';

beforeEach(() => {
  document.body.innerHTML =
    '<div id="sidebarAvailability"><span></span><span><strong></strong></span></div><main></main>';
  vi.clearAllMocks();
  mocks.photos.adminList.mockResolvedValue({
    photos: [
      {
        id: 'p1',
        title: 'Neon rain',
        thumb_url: '/rain.jpg',
        is_published: 1,
        created_at: '2026-07-31 12:00:00'
      },
      { id: 'p2', title: 'Draft', thumb_url: '/draft.jpg', is_published: 0 }
    ]
  });
  mocks.collections.list.mockResolvedValue({
    collections: [{ id: 'c1', title: 'After dark', is_published: 1 }]
  });
  mocks.commissions.list.mockResolvedValue({
    commissions: [
      { id: 'i1', name: 'Alex', shoot_type: 'Portrait', status: 'new', created_at: '2026-08-01' }
    ]
  });
  mocks.shoots.list.mockResolvedValue({
    shoots: [
      { id: 's1', name: 'Mara', status: 'booked', date: '2026-08-04' },
      { id: 's2', name: 'Jordan', status: 'shooting', date: '2026-08-09' },
      { id: 's3', name: 'Old', status: 'delivered', date: '2026-07-01' }
    ]
  });
  mocks.settings.get.mockResolvedValue({
    availability: 'open',
    availability_label: 'Open for August'
  });
  mocks.settings.update.mockResolvedValue({});
});

it('derives counts, pipeline stages, and the nearest future shoot', () => {
  const result = deriveOverview(
    {
      photos: [
        { is_published: 1, created_at: '2026-07-01' },
        { is_published: 0, created_at: '2026-07-02' }
      ],
      collections: [{ is_published: true }, { is_published: false }],
      commissions: [{ status: 'new' }, { status: 'seen' }],
      shoots: [
        { name: 'Past', status: 'delivered', date: '2026-07-31' },
        { name: 'Later', status: 'shooting', date: '2026-08-08' },
        { name: 'Next', status: 'booked', date: '2026-08-03' }
      ]
    },
    new Date('2026-08-01T12:00:00')
  );

  expect(result).toMatchObject({
    totalPhotos: 2,
    publishedPhotos: 1,
    newInquiries: 1,
    activeShoots: 2,
    publishedCollections: 1,
    pipeline: { booked: 1, shooting: 1, delivered: 1 }
  });
  expect(result.upcoming.name).toBe('Next');
});

it('renders useful data while showing a scoped warning for a failed source', async () => {
  mocks.collections.list.mockRejectedValueOnce(new Error('offline'));
  await initOverview(document.querySelector('main'));

  expect(document.querySelectorAll('.overview-metric.is-unavailable')).toHaveLength(1);
  expect(document.querySelector('.overview-metrics').textContent).toContain('2');
  expect(document.querySelector('.upcoming-shoot').textContent).toContain('Mara');
  expect(document.querySelector('.recent-frame img').getAttribute('src')).toBe('/rain.jpg');
});

it('escapes API-backed labels instead of creating injected elements', async () => {
  mocks.photos.adminList.mockResolvedValueOnce({
    photos: [
      {
        id: 'unsafe',
        title: '<img id="injected" src=x>',
        thumb_url: '/safe.jpg',
        created_at: '2026-08-01'
      }
    ]
  });
  await initOverview(document.querySelector('main'));

  expect(document.getElementById('injected')).toBeNull();
  expect(document.querySelector('.recent-frame figcaption').textContent).toContain('<img');
});

it('rolls availability back when saving fails', async () => {
  mocks.settings.update.mockRejectedValueOnce(new Error('offline'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await initOverview(document.querySelector('main'));
  const check = document.getElementById('availCheck');

  check.checked = false;
  check.dispatchEvent(new Event('change', { bubbles: true }));

  await vi.waitFor(() => expect(check.checked).toBe(true));
  expect(document.getElementById('availabilityText').textContent).toBe('Open for commissions');
});

it('renders clear empty states when the studio has no records', async () => {
  mocks.photos.adminList.mockResolvedValueOnce({ photos: [] });
  mocks.collections.list.mockResolvedValueOnce({ collections: [] });
  mocks.commissions.list.mockResolvedValueOnce({ commissions: [] });
  mocks.shoots.list.mockResolvedValueOnce({ shoots: [] });
  await initOverview(document.querySelector('main'));

  expect(document.querySelector('.recent-panel').textContent).toContain('first upload');
  expect(document.querySelector('.upcoming-panel').textContent).toContain('No upcoming shoot');
  expect(document.querySelector('.activity-panel').textContent).toContain('will collect here');
});
