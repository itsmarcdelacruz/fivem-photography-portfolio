import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Back the worker with a single shared in-memory libSQL client so state persists
// across the per-request createClient() calls inside the worker.
vi.mock('@libsql/client/web', async () => {
  const { createClient } = await import('@libsql/client');
  const shared = createClient({ url: ':memory:' });
  return { createClient: () => shared };
});

import { createClient } from '@libsql/client/web';
import worker from '../src/index.js';

const PASSWORD = 'correct-horse-battery';
const env = {
  TURSO_URL: 'libsql://test',
  TURSO_TOKEN: 'test',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  ADMIN_PASSWORD: PASSWORD,
  R2_PUBLIC_URL: 'https://r2.example',
  R2: { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
};

function req(method, path, { body, token, origin } = {}, customEnv = env) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (origin) headers['Origin'] = origin;
  return worker.fetch(
    new Request('https://api.test' + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),
    customEnv
  );
}

async function adminToken() {
  const res = await req('POST', '/api/login', { body: { password: PASSWORD } });
  return (await res.json()).token;
}

async function createTestPhoto(token, overrides = {}) {
  const key = crypto.randomUUID();
  const body = {
    title: 'Shot',
    thumb_url: `https://r2.example/photos/thumb/${key}.webp`,
    full_url: `https://r2.example/photos/full/${key}.webp`,
    ...overrides
  };
  return (await (await req('POST', '/api/photos', { token, body })).json()).id;
}

async function createTestCollection(token, overrides = {}) {
  const body = { title: 'Story', slug: 'story-' + crypto.randomUUID(), ...overrides };
  return (await (await req('POST', '/api/admin/collections', { token, body })).json()).collection;
}

const db = () => createClient();

beforeAll(async () => {
  // Trigger lazy migrations.
  await req('GET', '/api/photos');
});

beforeEach(async () => {
  for (const t of [
    'collection_photos',
    'collections',
    'photos',
    'commissions',
    'shoots',
    'settings',
    'rate_limits'
  ]) {
    await db().execute('DELETE FROM ' + t);
  }
  env.R2.put.mockClear();
  env.R2.delete.mockClear();
});

describe('migrations', () => {
  it('creates all required tables', async () => {
    const { rows } = await db().execute("SELECT name FROM sqlite_master WHERE type='table'");
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['photos', 'commissions', 'shoots', 'settings', 'rate_limits'])
    );
  });

  it('creates collection tables and photo publishing columns', async () => {
    const tables = await db().execute("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining(['collections', 'collection_photos'])
    );
    const photoInfo = await db().execute('PRAGMA table_info(photos)');
    expect(photoInfo.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining(['alt_text', 'is_published', 'content_hash'])
    );
  });
});

describe('public collections', () => {
  it('returns only published collections and published photos in order', async () => {
    await db().execute({
      sql: `INSERT INTO photos
            (id,title,thumb_url,full_url,is_published,sort_order)
            VALUES ('photo-a','A','https://r2.example/a-t.webp','https://r2.example/a.webp',1,0),
                   ('photo-b','B','https://r2.example/b-t.webp','https://r2.example/b.webp',0,1)`,
      args: []
    });
    await db().execute({
      sql: `INSERT INTO collections
            (id,title,slug,is_published,sort_order)
            VALUES ('published','Neon Rain','neon-rain',1,0),
                   ('draft','Draft','draft',0,1)`,
      args: []
    });
    await db().execute({
      sql: `INSERT INTO collection_photos
            (collection_id,photo_id,sort_order,caption)
            VALUES ('published','photo-b',0,'hidden'),
                   ('published','photo-a',1,'visible')`,
      args: []
    });

    const list = await (await req('GET', '/api/collections')).json();
    expect(list.collections.map((c) => c.slug)).toEqual(['neon-rain']);

    const detail = await (await req('GET', '/api/collections/neon-rain')).json();
    expect(detail.collection.photos.map((p) => p.title)).toEqual(['A']);
    expect(detail.collection.photos[0].caption).toBe('visible');
  });

  it('404s an unpublished or unknown slug', async () => {
    await db().execute({
      sql: `INSERT INTO collections (id,title,slug,is_published)
            VALUES ('draft','Draft','draft',0)`,
      args: []
    });
    expect((await req('GET', '/api/collections/draft')).status).toBe(404);
    expect((await req('GET', '/api/collections/missing')).status).toBe(404);
  });

  it('returns one deterministic fallback cover when photo sort orders tie', async () => {
    await db().execute({
      sql: `INSERT INTO photos
            (id,title,thumb_url,full_url,is_published,sort_order,created_at)
            VALUES ('tied-a','A','https://r2.example/a-t.webp','https://r2.example/a.webp',1,0,'2026-01-01'),
                   ('tied-b','B','https://r2.example/b-t.webp','https://r2.example/b.webp',1,0,'2026-01-01')`,
      args: []
    });
    await db().execute({
      sql: `INSERT INTO collections (id,title,slug,is_published,sort_order)
            VALUES ('tied','Tied','tied',1,0)`,
      args: []
    });
    await db().execute({
      sql: `INSERT INTO collection_photos (collection_id,photo_id,sort_order)
            VALUES ('tied','tied-b',0), ('tied','tied-a',0)`,
      args: []
    });

    const { collections } = await (await req('GET', '/api/collections')).json();
    expect(collections).toHaveLength(1);
    expect(collections[0].cover_thumb_url).toBe('https://r2.example/a-t.webp');
  });
});

describe('admin collections', () => {
  it('requires auth and rejects duplicate slugs', async () => {
    expect((await req('GET', '/api/admin/collections')).status).toBe(401);
    const token = await adminToken();
    expect(
      (
        await req('POST', '/api/admin/collections', {
          token,
          body: { title: 'One', slug: 'same' }
        })
      ).status
    ).toBe(201);
    expect(
      (
        await req('POST', '/api/admin/collections', {
          token,
          body: { title: 'Two', slug: 'same' }
        })
      ).status
    ).toBe(409);
  });

  it('rejects creating a published collection without a visible photo', async () => {
    const token = await adminToken();
    const res = await req('POST', '/api/admin/collections', {
      token,
      body: { title: 'Published too soon', slug: 'published-too-soon', is_published: true }
    });
    expect(res.status).toBe(409);
    expect((await db().execute('SELECT * FROM collections')).rows).toHaveLength(0);
  });

  it('replaces ordered membership and refuses to publish an empty collection', async () => {
    const token = await adminToken();
    const collection = await createTestCollection(token, { slug: 'ordered-story' });
    expect(
      (
        await req('PATCH', `/api/admin/collections/${collection.id}`, {
          token,
          body: { is_published: true }
        })
      ).status
    ).toBe(409);
    const a = await createTestPhoto(token, { title: 'A' });
    const b = await createTestPhoto(token, { title: 'B' });
    expect(
      (
        await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
          token,
          body: [
            { photo_id: b, caption: 'Second first' },
            { photo_id: a, caption: '' }
          ]
        })
      ).status
    ).toBe(200);
    const detail = await (
      await req('GET', `/api/admin/collections/${collection.id}`, { token })
    ).json();
    expect(detail.collection.photos.map((p) => p.id)).toEqual([b, a]);
  });

  it('keeps visible membership when a published collection receives no visible photos', async () => {
    const token = await adminToken();
    const visible = await createTestPhoto(token, { title: 'Visible' });
    const hidden = await createTestPhoto(token, { title: 'Hidden' });
    await db().execute({
      sql: 'UPDATE photos SET is_published=0 WHERE id=?',
      args: [hidden]
    });
    const collection = await createTestCollection(token, { slug: 'published-membership' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token,
      body: [{ photo_id: visible }]
    });
    expect(
      (
        await req('PATCH', `/api/admin/collections/${collection.id}`, {
          token,
          body: { is_published: true }
        })
      ).status
    ).toBe(200);

    for (const body of [[], [{ photo_id: hidden }]]) {
      expect(
        (
          await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
            token,
            body
          })
        ).status
      ).toBe(409);
      const detail = await (
        await req('GET', `/api/admin/collections/${collection.id}`, { token })
      ).json();
      expect(detail.collection.photos.map((photo) => photo.id)).toEqual([visible]);
    }
  });

  it('rolls back membership when a batch insert fails', async () => {
    const token = await adminToken();
    const original = await createTestPhoto(token, { title: 'Original' });
    const duplicate = await createTestPhoto(token, { title: 'Duplicate' });
    const collection = await createTestCollection(token, { slug: 'atomic-membership' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token,
      body: [{ photo_id: original }]
    });

    expect(
      (
        await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
          token,
          body: [{ photo_id: duplicate }, { photo_id: duplicate }]
        })
      ).status
    ).toBe(409);
    const detail = await (
      await req('GET', `/api/admin/collections/${collection.id}`, { token })
    ).json();
    expect(detail.collection.photos.map((photo) => photo.id)).toEqual([original]);
  });

  it('rejects malformed membership entries', async () => {
    const token = await adminToken();
    const collection = await createTestCollection(token, { slug: 'malformed-membership' });
    expect(
      (
        await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
          token,
          body: [null]
        })
      ).status
    ).toBe(400);
  });

  it('requires auth to reorder collections', async () => {
    expect(
      (
        await req('PATCH', '/api/admin/collections/order', {
          body: { ids: [] }
        })
      ).status
    ).toBe(401);
  });

  it('persists the exact requested collection order', async () => {
    const token = await adminToken();
    const a = await createTestCollection(token, { slug: 'order-a' });
    const b = await createTestCollection(token, { slug: 'order-b' });
    const c = await createTestCollection(token, { slug: 'order-c' });
    const ids = [c.id, a.id, b.id];

    expect(
      (
        await req('PATCH', '/api/admin/collections/order', {
          token,
          body: { ids }
        })
      ).status
    ).toBe(200);
    const listed = await (await req('GET', '/api/admin/collections', { token })).json();
    expect(listed.collections.map((collection) => collection.id)).toEqual(ids);
  });

  it('rejects malformed, unknown, and duplicate order IDs without partial updates', async () => {
    const token = await adminToken();
    const a = await createTestCollection(token, { slug: 'invalid-order-a' });
    const b = await createTestCollection(token, { slug: 'invalid-order-b' });
    const c = await createTestCollection(token, { slug: 'invalid-order-c' });
    const original = [a.id, b.id, c.id];
    const invalidBodies = [
      { ids: 'not-an-array' },
      { ids: [c.id, 'missing', a.id] },
      { ids: [c.id, c.id, a.id] }
    ];

    for (const body of invalidBodies) {
      expect(
        (
          await req('PATCH', '/api/admin/collections/order', {
            token,
            body
          })
        ).status
      ).toBe(400);
    }
    const listed = await (await req('GET', '/api/admin/collections', { token })).json();
    expect(listed.collections.map((collection) => collection.id)).toEqual(original);
  });

  it('deletes a collection without deleting its photos', async () => {
    const token = await adminToken();
    const photoId = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'delete-story' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token,
      body: [{ photo_id: photoId }]
    });
    expect((await req('DELETE', `/api/admin/collections/${collection.id}`, { token })).status).toBe(
      200
    );
    expect((await db().execute('SELECT * FROM photos')).rows).toHaveLength(1);
  });
});

describe('auth', () => {
  it('logs in with the correct password', async () => {
    const res = await req('POST', '/api/login', { body: { password: PASSWORD } });
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const res = await req('POST', '/api/login', { body: { password: 'nope' } });
    expect(res.status).toBe(401);
  });

  it('blocks gated routes without a token', async () => {
    const res = await req('GET', '/api/commissions');
    expect(res.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const res = await req('GET', '/api/commissions', { token: 'not.a.jwt' });
    expect(res.status).toBe(401);
  });

  it('allows gated routes with a valid token', async () => {
    const res = await req('GET', '/api/commissions', { token: await adminToken() });
    expect(res.status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('429s after the commission threshold', async () => {
    const body = { name: 'A', contact: 'x' };
    for (let i = 0; i < 3; i++) {
      expect((await req('POST', '/api/commissions', { body })).status).toBe(201);
    }
    expect((await req('POST', '/api/commissions', { body })).status).toBe(429);
  });
});

describe('commissions (public POST)', () => {
  it('requires name and contact', async () => {
    expect((await req('POST', '/api/commissions', { body: { name: 'A' } })).status).toBe(400);
    expect((await req('POST', '/api/commissions', { body: { contact: 'x' } })).status).toBe(400);
  });

  it('rejects over-long fields', async () => {
    const base = { name: 'A', contact: 'x' };
    expect(
      (await req('POST', '/api/commissions', { body: { ...base, notes: 'n'.repeat(2001) } })).status
    ).toBe(400);
    expect(
      (await req('POST', '/api/commissions', { body: { ...base, refs: 'r'.repeat(501) } })).status
    ).toBe(400);
    expect(
      (await req('POST', '/api/commissions', { body: { ...base, name: 'n'.repeat(121) } })).status
    ).toBe(400);
  });

  it('stores a valid commission', async () => {
    const res = await req('POST', '/api/commissions', {
      body: { name: 'Jane', contact: 'jane#1234' }
    });
    expect(res.status).toBe(201);
    const { rows } = await db().execute('SELECT name, contact, status FROM commissions');
    expect(rows[0].name).toBe('Jane');
    expect(rows[0].status).toBe('new');
  });
});

describe('commission status + archive', () => {
  async function newCommission() {
    await req('POST', '/api/commissions', { body: { name: 'Jane', contact: 'x' } });
    const list = await (await req('GET', '/api/commissions', { token: await adminToken() })).json();
    return list.commissions[0].id;
  }

  it('rejects an invalid status', async () => {
    const id = await newCommission();
    const res = await req('PATCH', '/api/commissions/' + id, {
      body: { status: 'bogus' },
      token: await adminToken()
    });
    expect(res.status).toBe(400);
  });

  it('archives a commission so it drops out of the list', async () => {
    const id = await newCommission();
    const token = await adminToken();
    expect((await req('POST', '/api/commissions/' + id + '/archive', { token })).status).toBe(200);
    const list = await (await req('GET', '/api/commissions', { token })).json();
    expect(list.commissions).toHaveLength(0);
  });
});

describe('promote + delete cascade', () => {
  async function promoted() {
    const token = await adminToken();
    await req('POST', '/api/commissions', { body: { name: 'Jane', contact: 'x' } });
    const list = await (await req('GET', '/api/commissions', { token })).json();
    const id = list.commissions[0].id;
    const res = await req('POST', '/api/commissions/' + id + '/promote', { token });
    return { token, id, res };
  }

  it('creates a booked shoot and marks the commission promoted', async () => {
    const { res } = await promoted();
    expect(res.status).toBe(201);
    const { rows } = await db().execute('SELECT status, source FROM shoots');
    expect(rows[0].status).toBe('booked');
    expect(rows[0].source).toBe('inbox');
  });

  it('refuses to promote twice', async () => {
    const { token, id } = await promoted();
    const res = await req('POST', '/api/commissions/' + id + '/promote', { token });
    expect(res.status).toBe(409);
  });

  it('404s promoting a missing commission', async () => {
    const res = await req('POST', '/api/commissions/does-not-exist/promote', {
      token: await adminToken()
    });
    expect(res.status).toBe(404);
  });

  it('archives the linked shoot when deleting a promoted commission', async () => {
    const { token, id } = await promoted();
    expect((await req('DELETE', '/api/commissions/' + id, { token })).status).toBe(200);
    const { rows } = await db().execute('SELECT status FROM shoots');
    // No orphan left active.
    expect(rows.every((r) => r.status === 'archived')).toBe(true);
  });
});

describe('photos', () => {
  const valid = {
    title: 'Shot',
    thumb_url: 'https://r2.example/photos/thumb/a.webp',
    full_url: 'https://r2.example/photos/full/a.webp'
  };

  it('excludes unpublished photos from the public list', async () => {
    await db().execute({
      sql: `INSERT INTO photos
            (id,title,thumb_url,full_url,is_published,sort_order)
            VALUES ('public','Public','https://r2.example/public-t.webp','https://r2.example/public.webp',1,0),
                   ('private','Private','https://r2.example/private-t.webp','https://r2.example/private.webp',0,1)`,
      args: []
    });

    const { photos } = await (await req('GET', '/api/photos')).json();
    expect(photos.map((photo) => photo.title)).toEqual(['Public']);
  });

  it('requires title, thumb_url and full_url', async () => {
    const res = await req('POST', '/api/photos', {
      body: { title: 'x' },
      token: await adminToken()
    });
    expect(res.status).toBe(400);
  });

  it('auto-increments sort_order', async () => {
    const token = await adminToken();
    await req('POST', '/api/photos', { body: valid, token });
    await req('POST', '/api/photos', { body: { ...valid, title: 'Shot 2' }, token });
    const { rows } = await db().execute('SELECT sort_order FROM photos ORDER BY sort_order');
    expect(rows.map((r) => Number(r.sort_order))).toEqual([0, 1]);
  });

  it('rejects a patch with no fields', async () => {
    const token = await adminToken();
    const { id } = await (await req('POST', '/api/photos', { body: valid, token })).json();
    const res = await req('PATCH', '/api/photos/' + id, { body: {}, token });
    expect(res.status).toBe(400);
  });

  it('deletes the row and both R2 objects', async () => {
    const token = await adminToken();
    const { id } = await (await req('POST', '/api/photos', { body: valid, token })).json();
    const res = await req('DELETE', '/api/photos/' + id, { token });
    expect(res.status).toBe(200);
    expect(env.R2.delete).toHaveBeenCalledTimes(2);
    const { rows } = await db().execute('SELECT * FROM photos');
    expect(rows).toHaveLength(0);
  });

  it('404s deleting a missing photo', async () => {
    const res = await req('DELETE', '/api/photos/missing', { token: await adminToken() });
    expect(res.status).toBe(404);
  });
});

describe('photo publishing and batches', () => {
  it('atomically reorders every photo and requires admin auth', async () => {
    const token = await adminToken();
    const a = await createTestPhoto(token);
    const b = await createTestPhoto(token);
    const c = await createTestPhoto(token);

    expect(
      (
        await req('PATCH', '/api/admin/photos/order', {
          body: { ids: [c, a, b] }
        })
      ).status
    ).toBe(401);
    const response = await req('PATCH', '/api/admin/photos/order', {
      token,
      body: { ids: [c, a, b] }
    });

    expect(response.status).toBe(200);
    const ordered = await db().execute('SELECT id FROM photos ORDER BY sort_order');
    expect(ordered.rows.map((row) => row.id)).toEqual([c, a, b]);
  });

  it('rejects malformed and non-permutation photo orders without changing state', async () => {
    const token = await adminToken();
    const a = await createTestPhoto(token);
    const b = await createTestPhoto(token);

    expect(
      (
        await req('PATCH', '/api/admin/photos/order', {
          token,
          body: { ids: 'wrong' }
        })
      ).status
    ).toBe(400);
    expect(
      (
        await req('PATCH', '/api/admin/photos/order', {
          token,
          body: { ids: [a, a] }
        })
      ).status
    ).toBe(400);
    expect(
      (
        await req('PATCH', '/api/admin/photos/order', {
          token,
          body: { ids: [a, 'missing'] }
        })
      ).status
    ).toBe(400);
    const ordered = await db().execute('SELECT id FROM photos ORDER BY sort_order');
    expect(ordered.rows.map((row) => row.id)).toEqual([a, b]);
  });

  it('rolls back the complete photo order when one update fails', async () => {
    const token = await adminToken();
    const a = await createTestPhoto(token);
    const b = await createTestPhoto(token);
    await db().execute(
      `CREATE TRIGGER reject_photo_reorder BEFORE UPDATE OF sort_order ON photos
       WHEN NEW.id='${b}' BEGIN SELECT RAISE(ABORT, 'reorder rejected'); END`
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await req('PATCH', '/api/admin/photos/order', {
      token,
      body: { ids: [b, a] }
    });

    error.mockRestore();
    await db().execute('DROP TRIGGER reject_photo_reorder');
    expect(response.status).toBe(500);
    const ordered = await db().execute('SELECT id,sort_order FROM photos ORDER BY sort_order');
    expect(ordered.rows.map((row) => [row.id, Number(row.sort_order)])).toEqual([
      [a, 0],
      [b, 1]
    ]);
  });

  it('hides unpublished photos publicly but returns their metadata to the admin photo list', async () => {
    const token = await adminToken();
    const hiddenId = await createTestPhoto(token, {
      title: 'Hidden',
      is_published: false,
      alt_text: 'Rainy alley',
      content_hash: 'a'.repeat(64)
    });

    expect((await (await req('GET', '/api/photos')).json()).photos).toHaveLength(0);
    const response = await req('GET', '/api/admin/photos', { token });
    expect(response.status).toBe(200);
    const admin = await response.json();
    expect(admin.photos[0]).toMatchObject({
      id: hiddenId,
      alt_text: 'Rainy alley',
      content_hash: 'a'.repeat(64),
      collection_ids: []
    });
  });

  it('batch updates category, publishing state, and collection membership atomically', async () => {
    const token = await adminToken();
    const a = await createTestPhoto(token);
    const b = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'batch-story' });
    const res = await req('PATCH', '/api/admin/photos/batch', {
      token,
      body: {
        photo_ids: [a, b],
        changes: { category: 'nightlife', is_published: false },
        add_collection_ids: [collection.id],
        remove_collection_ids: []
      }
    });

    expect(res.status).toBe(200);
    const rows = await db().execute('SELECT id,category,is_published FROM photos ORDER BY id');
    expect(
      rows.rows.every((row) => row.category === 'nightlife' && Number(row.is_published) === 0)
    ).toBe(true);
    const membership = await db().execute({
      sql: 'SELECT photo_id FROM collection_photos WHERE collection_id=? ORDER BY photo_id',
      args: [collection.id]
    });
    expect(membership.rows.map((row) => row.photo_id)).toEqual([a, b].sort());
  });

  it('unpublishes a collection when a batch hides its last published photo', async () => {
    const token = await adminToken();
    const photoId = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'last-visible-batch' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token,
      body: [{ photo_id: photoId }]
    });
    await req('PATCH', `/api/admin/collections/${collection.id}`, {
      token,
      body: { is_published: true }
    });

    const response = await req('PATCH', '/api/admin/photos/batch', {
      token,
      body: {
        photo_ids: [photoId],
        changes: { is_published: false }
      }
    });

    expect(response.status).toBe(200);
    const stored = await db().execute({
      sql: 'SELECT is_published FROM collections WHERE id=?',
      args: [collection.id]
    });
    expect(Number(stored.rows[0].is_published)).toBe(0);
  });

  it('finds duplicate content hashes and validates their format', async () => {
    const token = await adminToken();
    const hash = 'b'.repeat(64);
    const photoId = await createTestPhoto(token, { title: 'Duplicate source', content_hash: hash });

    expect((await req('GET', `/api/admin/photos/hash/${hash}`)).status).toBe(401);
    const found = await req('GET', `/api/admin/photos/hash/${hash}`, { token });
    expect(found.status).toBe(200);
    expect((await found.json()).photo).toMatchObject({ id: photoId, title: 'Duplicate source' });
    expect((await req('GET', '/api/admin/photos/hash/not-a-hash', { token })).status).toBe(400);
  });

  it('warns about collection usage before forced deletion', async () => {
    const token = await adminToken();
    const photoId = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'used-story' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token,
      body: [{ photo_id: photoId }]
    });

    const warning = await req('DELETE', `/api/photos/${photoId}`, { token });
    expect(warning.status).toBe(409);
    expect((await warning.json()).usage.collection_count).toBe(1);
    expect((await req('DELETE', `/api/photos/${photoId}?force=1`, { token })).status).toBe(200);
  });

  it('unpublishes a collection when force-deleting its last published photo', async () => {
    const token = await adminToken();
    const photoId = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'last-visible-delete' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token,
      body: [{ photo_id: photoId }]
    });
    await req('PATCH', `/api/admin/collections/${collection.id}`, {
      token,
      body: { is_published: true }
    });

    const response = await req('DELETE', `/api/photos/${photoId}?force=1`, { token });

    expect(response.status).toBe(200);
    const stored = await db().execute({
      sql: 'SELECT is_published FROM collections WHERE id=?',
      args: [collection.id]
    });
    expect(Number(stored.rows[0].is_published)).toBe(0);
  });

  it('cleans uploaded R2 objects when photo metadata is rejected', async () => {
    const token = await adminToken();
    const res = await req('POST', '/api/photos', {
      token,
      body: {
        title: '',
        thumb_url: 'https://r2.example/photos/thumb/cleanup.webp',
        full_url: 'https://r2.example/photos/full/cleanup.webp',
        upload_keys: ['photos/thumb/cleanup.webp', 'photos/full/cleanup.webp']
      }
    });

    expect(res.status).toBe(400);
    expect(env.R2.delete).toHaveBeenCalledTimes(2);
  });

  it('cleans uploaded R2 objects when the sort-order metadata query fails', async () => {
    const token = await adminToken();
    const execute = vi
      .spyOn(db(), 'execute')
      .mockRejectedValueOnce(new Error('metadata unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await req('POST', '/api/photos', {
      token,
      body: {
        title: 'Cleanup failure',
        thumb_url: 'https://r2.example/photos/thumb/query-failure.webp',
        full_url: 'https://r2.example/photos/full/query-failure.webp',
        upload_keys: ['photos/thumb/query-failure.webp', 'photos/full/query-failure.webp']
      }
    });
    execute.mockRestore();
    error.mockRestore();

    expect(res.status).toBe(500);
    expect(env.R2.delete).toHaveBeenCalledWith('photos/thumb/query-failure.webp');
    expect(env.R2.delete).toHaveBeenCalledWith('photos/full/query-failure.webp');
  });

  it('rolls back earlier batch changes when a later statement fails', async () => {
    const token = await adminToken();
    const photoId = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'rollback-story' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await req('PATCH', '/api/admin/photos/batch', {
      token,
      body: {
        photo_ids: [photoId],
        changes: { category: 'nightlife' },
        add_collection_ids: [collection.id, 'missing-collection'],
        remove_collection_ids: []
      }
    });
    error.mockRestore();

    expect(res.status).toBe(500);
    const photo = await db().execute({
      sql: 'SELECT category FROM photos WHERE id=?',
      args: [photoId]
    });
    expect(photo.rows[0].category).toBe('portraits');
    const membership = await db().execute({
      sql: 'SELECT * FROM collection_photos WHERE photo_id=?',
      args: [photoId]
    });
    expect(membership.rows).toHaveLength(0);
  });
});

describe('shoots', () => {
  it('requires name and contact', async () => {
    const res = await req('POST', '/api/shoots', {
      body: { name: 'A' },
      token: await adminToken()
    });
    expect(res.status).toBe(400);
  });

  it('normalizes the date to 10 chars', async () => {
    const token = await adminToken();
    await req('POST', '/api/shoots', {
      body: { name: 'A', contact: 'x', date: '2026-07-15T10:00:00Z' },
      token
    });
    const { rows } = await db().execute('SELECT date FROM shoots');
    expect(rows[0].date).toBe('2026-07-15');
  });

  it('enforces the status allowlist on patch', async () => {
    const token = await adminToken();
    const { id } = await (
      await req('POST', '/api/shoots', { body: { name: 'A', contact: 'x' }, token })
    ).json();
    const res = await req('PATCH', '/api/shoots/' + id, { body: { status: 'bogus' }, token });
    expect(res.status).toBe(400);
  });
});

describe('settings', () => {
  it('upserts and reads back', async () => {
    const token = await adminToken();
    await req('PUT', '/api/settings', { body: { available: 'true', badge: 'Open' }, token });
    const out = await (await req('GET', '/api/settings')).json();
    expect(out).toMatchObject({ available: 'true', badge: 'Open' });
  });
});

describe('CORS + security headers', () => {
  it('reflects an allowed origin and omits a foreign one', async () => {
    const lockedEnv = { ...env, ALLOWED_ORIGINS: 'https://katie.example' };
    const ok = await req('GET', '/api/photos', { origin: 'https://katie.example' }, lockedEnv);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://katie.example');

    const foreign = await req('GET', '/api/photos', { origin: 'https://evil.example' }, lockedEnv);
    expect(foreign.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
  });

  it('sets security headers on responses', async () => {
    const res = await req('GET', '/api/photos');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('answers OPTIONS preflight with allowed methods', async () => {
    const res = await req('OPTIONS', '/api/photos');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('routing', () => {
  it('404s an unknown path', async () => {
    const res = await req('GET', '/api/nope');
    expect(res.status).toBe(404);
  });
});
