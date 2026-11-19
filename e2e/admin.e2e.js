import { expect, test } from '@playwright/test';

const fixtures = {
  photos: {
    photos: [
      {
        id: 1,
        title: 'Neon portrait',
        category: 'Portrait',
        is_published: 1,
        created_at: '2026-08-01T12:00:00Z',
        thumb_url: '/favicon.svg'
      },
      {
        id: 2,
        title: 'City after dark',
        category: 'Cityscape',
        is_published: 0,
        created_at: '2026-07-31T12:00:00Z',
        thumb_url: '/favicon.svg'
      }
    ]
  },
  collections: {
    collections: [{ id: 1, title: 'Night Work', is_published: 1 }]
  },
  commissions: {
    commissions: [
      {
        id: 1,
        name: 'Avery Stone',
        shoot_type: 'Portrait',
        status: 'new',
        created_at: '2026-08-02T12:00:00Z'
      }
    ]
  },
  shoots: {
    shoots: [
      {
        id: 1,
        name: 'Avery Stone',
        shoot_type: 'Portrait',
        status: 'booked',
        date: '2099-08-15',
        created_at: '2026-08-02T13:00:00Z'
      },
      {
        id: 2,
        name: 'Downtown editorial',
        shoot_type: 'Cityscape',
        status: 'shooting',
        date: '2099-08-20',
        created_at: '2026-08-01T13:00:00Z'
      },
      {
        id: 3,
        name: 'Delivered set',
        shoot_type: 'Crew',
        status: 'delivered',
        date: '2026-07-20',
        created_at: '2026-07-20T13:00:00Z'
      }
    ]
  },
  settings: {
    availability: 'open',
    availability_label: 'Open for commissions'
  }
};

async function mockApi(page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === '/api/login') {
      await route.fulfill({ json: { token: 'browser-test-token' } });
      return;
    }

    const responses = {
      '/api/admin/photos': fixtures.photos,
      '/api/admin/collections': fixtures.collections,
      '/api/commissions': fixtures.commissions,
      '/api/shoots': fixtures.shoots,
      '/api/settings': fixtures.settings
    };

    await route.fulfill({
      status: responses[path] ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(responses[path] || { error: `Unhandled browser-test route: ${path}` })
    });
  });
}

async function openAuthenticatedAdmin(page, hash = 'overview') {
  await page.addInitScript(() => localStorage.setItem('admin_token', 'browser-test-token'));
  await mockApi(page);
  await page.goto(`/admin/#${hash}`);
  await expect(page.locator('#adminMain')).not.toHaveText('Loading…');
}

test('signs in and opens the studio workspace', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/');

  await expect(page.getByRole('heading', { name: 'Enter the studio.' })).toBeVisible();
  await page.getByLabel('Studio password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: /The studio,/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('admin_token')))
    .toBe('browser-test-token');
});

test('renders the derived overview and navigates between workspaces', async ({ page }) => {
  await openAuthenticatedAdmin(page);

  await expect(page.locator('.overview-metric').filter({ hasText: 'Total frames' })).toContainText(
    '2'
  );
  await expect(page.locator('.overview-metric').filter({ hasText: 'New inquiries' })).toContainText(
    '1'
  );
  await expect(page.locator('.pipeline-stages')).toContainText('Booked');
  await expect(page.locator('.upcoming-shoot')).toContainText('Avery Stone');

  if (page.viewportSize().width <= 960) {
    await page.locator('#adminMenuBtn').click();
  }
  await page
    .locator('.admin-nav')
    .getByRole('link', { name: /Schedule/ })
    .click();
  await expect(page).toHaveURL(/#schedule$/);
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.locator('.kanban-col')).toHaveCount(3);

  await page.getByRole('button', { name: '+ Add Shoot' }).click();
  await expect(page.getByRole('dialog', { name: 'Add Shoot' })).toBeVisible();
});

test('uses an accessible off-canvas menu on smaller screens', async ({ page }, testInfo) => {
  test.skip(!['tablet', 'mobile'].includes(testInfo.project.name));
  await openAuthenticatedAdmin(page);

  const menu = page.locator('#adminMenuBtn');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAccessibleName('Open navigation');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toHaveAccessibleName('Close navigation');
  await expect(page.locator('.admin-layout')).toHaveClass(/nav-open/);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
});

test('honors reduced-motion preferences', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'reduced-motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAuthenticatedAdmin(page);

  await expect
    .poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
    .toBe(true);
  const duration = await page
    .locator('.recent-frame img')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
});
