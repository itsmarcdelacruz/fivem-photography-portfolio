# Portfolio Collections and Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add curated, shareable photo collections, richer gallery browsing, and a bulk-oriented admin publishing workflow without rewriting the existing application.

**Architecture:** Extend Turso with collections, ordered collection membership, and photo publishing metadata. Keep HTTP routing in the existing Cloudflare Worker, isolate collection validation and persistence in focused modules, add dedicated public story and lightbox modules, and add separate admin collection and upload-queue modules. The public and admin Vite entries remain separate.

**Tech Stack:** Vite 8, vanilla ES modules, Cloudflare Workers, Turso/libSQL, Cloudflare R2, Vitest 2 with jsdom, existing JWT admin authentication.

## Global Constraints

- Keep the existing Vite, Cloudflare Worker, Turso, and R2 stack; do not add a frontend framework.
- Keep public and admin bundles separate.
- Collections use a simple published/unpublished toggle; no scheduling.
- Public collection routes use `/stories/:slug`.
- A photo may belong to multiple collections with collection-specific order and caption.
- Unpublished collections and unpublished photos never appear through public endpoints.
- Static fallback content is allowed only when `VITE_WORKER_URL` is absent during local development.
- Keep individual photo pages, advanced search, FiveM lore systems, payments, proofing, downloads, and commission workflow changes out of scope.
- Use test-driven development: add a failing focused test, observe the failure, add the minimum implementation, and rerun the focused and full suites.

---

## File Structure

### Worker

- `worker/src/index.js` — HTTP routing, auth gates, migrations, existing resources, and thin adapters into collection persistence.
- `worker/src/collection-domain.js` — slug normalization and collection input validation.
- `worker/src/collection-store.js` — collection and membership SQL operations with no HTTP concerns.
- `worker/test/collection-domain.test.js` — pure collection validation tests.
- `worker/test/api.test.js` — collection, photo publishing, batch mutation, cleanup, and auth integration tests.

### Public site

- `src/data.js` — public portfolio and story API loading with development-only fallback behavior.
- `src/data.test.js` — data mapping and production failure tests.
- `src/stories.js` — featured collection, collection index, and story-page DOM rendering.
- `src/stories.test.js` — story rendering and empty/error state tests.
- `src/lightbox.js` — dialog lifecycle, filtered sequencing, focus trap, and focus restoration.
- `src/lightbox.test.js` — keyboard and focus behavior tests.
- `src/image-slot.js` — existing image component, extended to expose meaningful image alt text.
- `src/image-slot.test.js` — alt-text propagation test for the custom element.
- `src/app.js` — homepage orchestration, gallery filtering, and existing non-lightbox interactions.
- `src/main.js` — route selection between homepage and `/stories/:slug`.
- `index.html` — Stories navigation, story mounts, mobile menu, and accessible lightbox shell.
- `src/styles.css` — Hybrid Dispatches layout, story page, gallery controls, mobile menu, focus, touch, and reduced-motion styles.
- `vercel.json` — direct-load rewrite for story routes.

### Admin

- `src/admin/api.js` — typed-by-convention API methods for collections, batches, hashes, and photo usage.
- `src/admin/app.js` — Collections navigation registration.
- `src/admin/collection-form.js` — pure form-to-payload mapping and slug helpers.
- `src/admin/collection-form.test.js` — collection form validation tests.
- `src/admin/views/collections.js` — collection list/editor, membership ordering, preview, and publishing.
- `src/admin/upload.js` — image hashing, resize/upload primitives, and uploaded object keys.
- `src/admin/upload.test.js` — hashing and upload result tests.
- `src/admin/upload-queue.js` — independent per-file queue state and retry behavior.
- `src/admin/upload-queue.test.js` — deterministic queue transition tests.
- `src/admin/views/photos.js` — queue UI, bulk selection, inline metadata, batch assignment, and guarded deletion.
- `src/admin/styles.css` — collection editor, upload queue, selection toolbar, state, and responsive styles.

---

### Task 1: Collection schema and domain validation

**Files:**
- Create: `worker/src/collection-domain.js`
- Create: `worker/test/collection-domain.test.js`
- Modify: `worker/src/index.js`
- Modify: `worker/test/api.test.js`

**Interfaces:**
- Produces: `normalizeSlug(value: unknown): string`
- Produces: `validateCollectionInput(input: object, { partial?: boolean }): { value?: CollectionInput, error?: string }`
- Produces database tables `collections`, `collection_photos` and photo columns `alt_text`, `is_published`, `content_hash`.

- [ ] **Step 1: Write failing domain and migration tests**

```js
// worker/test/collection-domain.test.js
import { describe, expect, it } from 'vitest';
import { normalizeSlug, validateCollectionInput } from '../src/collection-domain.js';

describe('normalizeSlug', () => {
  it('produces a lowercase URL slug', () => {
    expect(normalizeSlug('  Neon & Rain — 3AM  ')).toBe('neon-rain-3am');
  });
});

describe('validateCollectionInput', () => {
  it('requires title and a valid slug on create', () => {
    expect(validateCollectionInput({ title: '', slug: 'x' }).error).toBe('title is required');
    expect(validateCollectionInput({ title: 'Night', slug: 'Not Valid!' }).error).toBe('slug is invalid');
  });

  it('normalizes optional fields and publishing state', () => {
    expect(validateCollectionInput({
      title: 'Neon & Rain',
      slug: 'neon-rain',
      introduction: 'After midnight.',
      location: '',
      event_date: '',
      cover_photo_id: '',
      is_published: false
    }).value).toEqual({
      title: 'Neon & Rain',
      slug: 'neon-rain',
      introduction: 'After midnight.',
      location: null,
      event_date: null,
      cover_photo_id: null,
      is_published: 0
    });
  });
});
```

Add to `worker/test/api.test.js`:

```js
it('creates collection tables and photo publishing columns', async () => {
  const tables = await db().execute("SELECT name FROM sqlite_master WHERE type='table'");
  expect(tables.rows.map(r => r.name)).toEqual(
    expect.arrayContaining(['collections', 'collection_photos'])
  );
  const photoInfo = await db().execute('PRAGMA table_info(photos)');
  expect(photoInfo.rows.map(r => r.name)).toEqual(
    expect.arrayContaining(['alt_text', 'is_published', 'content_hash'])
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- worker/test/collection-domain.test.js worker/test/api.test.js`  
Expected: FAIL because `collection-domain.js` and the new tables do not exist.

- [ ] **Step 3: Implement validation and idempotent migrations**

```js
// worker/src/collection-domain.js
export function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function validateCollectionInput(input, { partial = false } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  if (!partial && !String(body.title || '').trim()) return { error: 'title is required' };
  if (!partial && !String(body.slug || '').trim()) return { error: 'slug is required' };
  if (body.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug))) {
    return { error: 'slug is invalid' };
  }
  const value = {};
  if (body.title !== undefined) value.title = String(body.title).trim().slice(0, 120);
  if (body.slug !== undefined) value.slug = String(body.slug);
  if (body.introduction !== undefined) value.introduction = String(body.introduction).trim().slice(0, 1200);
  for (const key of ['location', 'event_date', 'cover_photo_id']) {
    if (body[key] !== undefined) value[key] = String(body[key] || '').trim() || null;
  }
  if (body.is_published !== undefined) value.is_published = body.is_published ? 1 : 0;
  return { value };
}
```

In `worker/src/index.js`, add an `ensureColumn` helper and call it from `runMigrations`:

```js
async function ensureColumn(db, table, column, definition) {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  if (!info.rows.some(row => row.name === column || row[1] === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

await db.execute(`CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  introduction TEXT NOT NULL DEFAULT '',
  location TEXT,
  event_date TEXT,
  cover_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
await db.execute(`CREATE TABLE IF NOT EXISTS collection_photos (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  PRIMARY KEY (collection_id, photo_id)
)`);
await db.execute('CREATE INDEX IF NOT EXISTS idx_collection_photos_photo ON collection_photos(photo_id)');
await ensureColumn(db, 'photos', 'alt_text', "TEXT NOT NULL DEFAULT ''");
await ensureColumn(db, 'photos', 'is_published', 'INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0,1))');
await ensureColumn(db, 'photos', 'content_hash', 'TEXT');
await db.execute('CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash)');
```

Update `beforeEach` in `worker/test/api.test.js` so dependent records are cleared first:

```js
for (const t of ['collection_photos', 'collections', 'photos', 'commissions', 'shoots', 'settings', 'rate_limits']) {
  await db().execute('DELETE FROM ' + t);
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- worker/test/collection-domain.test.js worker/test/api.test.js`  
Expected: PASS.

Run: `npm test`  
Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/collection-domain.js worker/src/index.js worker/test/collection-domain.test.js worker/test/api.test.js
git commit -m "feat: add collection data model"
```

### Task 2: Public collection persistence and API

**Files:**
- Create: `worker/src/collection-store.js`
- Modify: `worker/src/index.js`
- Modify: `worker/test/api.test.js`

**Interfaces:**
- Consumes: `validateCollectionInput` from Task 1.
- Produces: `listPublishedCollections(db): Promise<CollectionSummary[]>`
- Produces: `findPublishedCollection(db, slug): Promise<CollectionDetail | null>`
- Produces public routes `GET /api/collections` and `GET /api/collections/:slug`.

- [ ] **Step 1: Write failing public API tests**

```js
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
    expect(list.collections.map(c => c.slug)).toEqual(['neon-rain']);

    const detail = await (await req('GET', '/api/collections/neon-rain')).json();
    expect(detail.collection.photos.map(p => p.title)).toEqual(['A']);
    expect(detail.collection.photos[0].caption).toBe('visible');
  });

  it('404s an unpublished or unknown slug', async () => {
    expect((await req('GET', '/api/collections/missing')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the public API tests**

Run: `npm test -- worker/test/api.test.js`  
Expected: FAIL with `404` for the collection routes.

- [ ] **Step 3: Implement published collection queries**

```js
// worker/src/collection-store.js
export async function listPublishedCollections(db) {
  const { rows } = await db.execute(`
    SELECT c.*,
      COALESCE(cp_count.frame_count, 0) AS frame_count,
      COALESCE(cover.thumb_url, first_photo.thumb_url) AS cover_thumb_url
    FROM collections c
    LEFT JOIN photos cover ON cover.id=c.cover_photo_id AND cover.is_published=1
    LEFT JOIN (
      SELECT collection_id, COUNT(*) AS frame_count
      FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
      WHERE p.is_published=1 GROUP BY collection_id
    ) cp_count ON cp_count.collection_id=c.id
    LEFT JOIN (
      SELECT cp.collection_id, p.thumb_url
      FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
      WHERE p.is_published=1 AND cp.sort_order=(
        SELECT MIN(cp2.sort_order) FROM collection_photos cp2
        JOIN photos p2 ON p2.id=cp2.photo_id
        WHERE cp2.collection_id=cp.collection_id AND p2.is_published=1
      )
    ) first_photo ON first_photo.collection_id=c.id
    WHERE c.is_published=1
    ORDER BY c.sort_order ASC, c.created_at DESC
  `);
  return rows;
}

export async function findPublishedCollection(db, slug) {
  const found = await db.execute({
    sql: 'SELECT * FROM collections WHERE slug=? AND is_published=1',
    args: [slug]
  });
  if (!found.rows.length) return null;
  const collection = found.rows[0];
  const photos = await db.execute({
    sql: `SELECT p.*, cp.caption
          FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
          WHERE cp.collection_id=? AND p.is_published=1
          ORDER BY cp.sort_order ASC`,
    args: [collection.id]
  });
  return { ...collection, photos: photos.rows };
}
```

Add routes and handlers to `worker/src/index.js`:

```js
import { findPublishedCollection, listPublishedCollections } from './collection-store.js';

if (method === 'GET' && path === '/api/collections') return getPublicCollections(env);
if (method === 'GET' && path.startsWith('/api/collections/')) {
  return getPublicCollection(env, decodeURIComponent(path.split('/')[3] || ''));
}

async function getPublicCollections(env) {
  try {
    return json({ collections: await listPublishedCollections(turso(env)) });
  } catch (err) {
    console.error('getPublicCollections:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function getPublicCollection(env, slug) {
  try {
    const collection = await findPublishedCollection(turso(env), slug);
    return collection ? json({ collection }) : json({ error: 'not found' }, 404);
  } catch (err) {
    console.error('getPublicCollection:', err);
    return json({ error: 'internal server error' }, 500);
  }
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- worker/test/api.test.js -t "public collections"`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/collection-store.js worker/src/index.js worker/test/api.test.js
git commit -m "feat: expose published photo collections"
```

### Task 3: Protected collection CRUD, membership, and ordering

**Files:**
- Modify: `worker/src/collection-store.js`
- Modify: `worker/src/index.js`
- Modify: `worker/test/api.test.js`

**Interfaces:**
- Consumes: collection tables and validation from Task 1.
- Produces protected routes under `/api/admin/collections`.
- Produces: `replaceCollectionPhotos(db, id, items): Promise<void>` using `db.batch(statements, 'write')`.

- [ ] **Step 1: Write failing CRUD and atomic membership tests**

```js
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

describe('admin collections', () => {
  it('requires auth and rejects duplicate slugs', async () => {
    expect((await req('GET', '/api/admin/collections')).status).toBe(401);
    const token = await adminToken();
    expect((await req('POST', '/api/admin/collections', {
      token, body: { title: 'One', slug: 'same' }
    })).status).toBe(201);
    expect((await req('POST', '/api/admin/collections', {
      token, body: { title: 'Two', slug: 'same' }
    })).status).toBe(409);
  });

  it('replaces ordered membership and refuses to publish an empty collection', async () => {
    const token = await adminToken();
    const collection = await createTestCollection(token, { slug: 'ordered-story' });
    expect((await req('PATCH', `/api/admin/collections/${collection.id}`, {
      token, body: { is_published: true }
    })).status).toBe(409);
    const a = await createTestPhoto(token, { title: 'A' });
    const b = await createTestPhoto(token, { title: 'B' });
    expect((await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token,
      body: [{ photo_id: b, caption: 'Second first' }, { photo_id: a, caption: '' }]
    })).status).toBe(200);
    const detail = await (await req('GET', `/api/admin/collections/${collection.id}`, { token })).json();
    expect(detail.collection.photos.map(p => p.id)).toEqual([b, a]);
  });

  it('deletes a collection without deleting its photos', async () => {
    const token = await adminToken();
    const photoId = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'delete-story' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token, body: [{ photo_id: photoId }]
    });
    expect((await req('DELETE', `/api/admin/collections/${collection.id}`, { token })).status).toBe(200);
    expect((await db().execute('SELECT * FROM photos')).rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests and observe missing routes**

Run: `npm test -- worker/test/api.test.js -t "admin collections"`  
Expected: FAIL with `404`.

- [ ] **Step 3: Add store operations**

```js
// append to worker/src/collection-store.js
export async function replaceCollectionPhotos(db, collectionId, items) {
  const normalized = items.map((item, index) => ({
    photo_id: String(item.photo_id || ''),
    caption: String(item.caption || '').trim().slice(0, 500) || null,
    sort_order: index
  }));
  if (normalized.some(item => !item.photo_id)) throw new Error('photo_id is required');
  const statements = [
    { sql: 'DELETE FROM collection_photos WHERE collection_id=?', args: [collectionId] },
    ...normalized.map(item => ({
      sql: `INSERT INTO collection_photos
            (collection_id,photo_id,sort_order,caption) VALUES (?,?,?,?)`,
      args: [collectionId, item.photo_id, item.sort_order, item.caption]
    }))
  ];
  await db.batch(statements, 'write');
}

export async function getAdminCollection(db, id) {
  const found = await db.execute({ sql: 'SELECT * FROM collections WHERE id=?', args: [id] });
  if (!found.rows.length) return null;
  const photos = await db.execute({
    sql: `SELECT p.*, cp.caption FROM collection_photos cp
          JOIN photos p ON p.id=cp.photo_id
          WHERE cp.collection_id=? ORDER BY cp.sort_order`,
    args: [id]
  });
  return { ...found.rows[0], photos: photos.rows };
}
```

Import the domain and store functions, then add these handlers to `worker/src/index.js`:

```js
import { validateCollectionInput } from './collection-domain.js';
import {
  getAdminCollection,
  replaceCollectionPhotos
} from './collection-store.js';

function collectionConstraintError(error) {
  return String(error?.message || '').includes('collections.slug');
}

async function listAdminCollections(request, env) {
  try {
    const { rows } = await turso(env).execute(
      'SELECT * FROM collections ORDER BY sort_order ASC, created_at DESC'
    );
    return json({ collections: rows });
  } catch (error) {
    console.error('listAdminCollections:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function createAdminCollection(request, env) {
  try {
    const checked = validateCollectionInput(await request.json());
    if (checked.error) return json({ error: checked.error }, 400);
    const db = turso(env);
    const order = await db.execute('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM collections');
    const collection = {
      id: crypto.randomUUID(),
      ...checked.value,
      introduction: checked.value.introduction || '',
      location: checked.value.location || null,
      event_date: checked.value.event_date || null,
      cover_photo_id: checked.value.cover_photo_id || null,
      is_published: checked.value.is_published || 0,
      sort_order: Number(order.rows[0].next)
    };
    await db.execute({
      sql: `INSERT INTO collections
            (id,slug,title,introduction,location,event_date,cover_photo_id,is_published,sort_order)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        collection.id, collection.slug, collection.title, collection.introduction,
        collection.location, collection.event_date, collection.cover_photo_id,
        collection.is_published, collection.sort_order
      ]
    });
    return json({ collection }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    if (collectionConstraintError(error)) return json({ error: 'slug already exists' }, 409);
    console.error('createAdminCollection:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function getAdminCollectionHandler(env, id) {
  try {
    const collection = await getAdminCollection(turso(env), id);
    return collection ? json({ collection }) : json({ error: 'not found' }, 404);
  } catch (error) {
    console.error('getAdminCollection:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function patchAdminCollection(request, env, id) {
  try {
    const checked = validateCollectionInput(await request.json(), { partial: true });
    if (checked.error) return json({ error: checked.error }, 400);
    const value = checked.value;
    if (!Object.keys(value).length) return json({ error: 'nothing to update' }, 400);
    const db = turso(env);
    if (value.is_published === 1) {
      const visible = await db.execute({
        sql: `SELECT COUNT(*) AS count FROM collection_photos cp
              JOIN photos p ON p.id=cp.photo_id
              WHERE cp.collection_id=? AND p.is_published=1`,
        args: [id]
      });
      if (Number(visible.rows[0].count) === 0) {
        return json({ error: 'a collection needs a published photo before publishing' }, 409);
      }
    }
    const fields = Object.keys(value);
    const result = await db.execute({
      sql: `UPDATE collections SET ${fields.map(key => key + '=?').join(',')},
            updated_at=datetime('now') WHERE id=?`,
      args: [...fields.map(key => value[key]), id]
    });
    if (!Number(result.rowsAffected)) return json({ error: 'not found' }, 404);
    return json({ collection: await getAdminCollection(db, id) });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    if (collectionConstraintError(error)) return json({ error: 'slug already exists' }, 409);
    console.error('patchAdminCollection:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function putAdminCollectionPhotos(request, env, id) {
  try {
    const items = await request.json();
    if (!Array.isArray(items)) return json({ error: 'an array of photos is required' }, 400);
    const db = turso(env);
    if (!await getAdminCollection(db, id)) return json({ error: 'not found' }, 404);
    await replaceCollectionPhotos(db, id, items);
    return json({ collection: await getAdminCollection(db, id) });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    if (error.message === 'photo_id is required') return json({ error: error.message }, 400);
    console.error('putAdminCollectionPhotos:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function reorderAdminCollections(request, env) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
      return json({ error: 'ids must be an array of strings' }, 400);
    }
    await turso(env).batch(ids.map((id, sortOrder) => ({
      sql: 'UPDATE collections SET sort_order=?,updated_at=datetime("now") WHERE id=?',
      args: [sortOrder, id]
    })), 'write');
    return json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('reorderAdminCollections:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function deleteAdminCollection(env, id) {
  try {
    const result = await turso(env).execute({
      sql: 'DELETE FROM collections WHERE id=?',
      args: [id]
    });
    return Number(result.rowsAffected)
      ? json({ ok: true })
      : json({ error: 'not found' }, 404);
  } catch (error) {
    console.error('deleteAdminCollection:', error);
    return json({ error: 'internal server error' }, 500);
  }
}
```

Add this exact route block before the generic photo routes:

```js
if (path === '/api/admin/collections' && method === 'GET') return gated(request, env, listAdminCollections);
if (path === '/api/admin/collections' && method === 'POST') return gated(request, env, createAdminCollection);
if (path === '/api/admin/collections/order' && method === 'PATCH') return gated(request, env, reorderAdminCollections);
if (/^\/api\/admin\/collections\/[^/]+\/photos$/.test(path) && method === 'PUT') {
  return gated(request, env, (r, e) => putAdminCollectionPhotos(r, e, path.split('/')[4]));
}
if (/^\/api\/admin\/collections\/[^/]+$/.test(path) && method === 'GET') {
  return gated(request, env, (r, e) => getAdminCollectionHandler(e, path.split('/')[4]));
}
if (/^\/api\/admin\/collections\/[^/]+$/.test(path) && method === 'PATCH') {
  return gated(request, env, (r, e) => patchAdminCollection(r, e, path.split('/')[4]));
}
if (/^\/api\/admin\/collections\/[^/]+$/.test(path) && method === 'DELETE') {
  return gated(request, env, (r, e) => deleteAdminCollection(e, path.split('/')[4]));
}
```

- [ ] **Step 4: Run collection and full Worker tests**

Run: `npm test -- worker/test/api.test.js -t "admin collections"`  
Expected: PASS.

Run: `npm test -- worker/test/api.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/collection-store.js worker/src/index.js worker/test/api.test.js
git commit -m "feat: manage collection publishing"
```

### Task 4: Photo publishing metadata, batch edits, duplicate lookup, and guarded deletion

**Files:**
- Modify: `worker/src/index.js`
- Modify: `worker/test/api.test.js`

**Interfaces:**
- Produces photo fields `alt_text`, `is_published`, `content_hash`, and `collection_ids` from `GET /api/photos`.
- Produces protected `PATCH /api/admin/photos/batch`.
- Produces protected `GET /api/admin/photos/hash/:hash`.
- Changes `DELETE /api/photos/:id` to return `409` with usage unless `?force=1`.

- [ ] **Step 1: Write failing photo behavior tests**

```js
describe('photo publishing and batches', () => {
  it('hides unpublished photos publicly but returns them to the admin photo list', async () => {
    const token = await adminToken();
    await createTestPhoto(token, { title: 'Hidden', is_published: false, alt_text: 'Rainy alley' });
    expect((await (await req('GET', '/api/photos')).json()).photos).toHaveLength(0);
    const admin = await (await req('GET', '/api/admin/photos', { token })).json();
    expect(admin.photos[0].alt_text).toBe('Rainy alley');
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
    const rows = await db().execute('SELECT category,is_published FROM photos ORDER BY id');
    expect(rows.rows.every(row => row.category === 'nightlife' && Number(row.is_published) === 0)).toBe(true);
  });

  it('warns about collection usage before forced deletion', async () => {
    const token = await adminToken();
    const photoId = await createTestPhoto(token);
    const collection = await createTestCollection(token, { slug: 'used-story' });
    await req('PUT', `/api/admin/collections/${collection.id}/photos`, {
      token, body: [{ photo_id: photoId }]
    });
    const warning = await req('DELETE', `/api/photos/${photoId}`, { token });
    expect(warning.status).toBe(409);
    expect((await warning.json()).usage.collection_count).toBe(1);
    expect((await req('DELETE', `/api/photos/${photoId}?force=1`, { token })).status).toBe(200);
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
});
```

- [ ] **Step 2: Run tests and observe failures**

Run: `npm test -- worker/test/api.test.js -t "photo publishing and batches"`  
Expected: FAIL because public photos include hidden rows and admin batch routes are absent.

- [ ] **Step 3: Implement photo route changes**

Update `createPhoto` to accept and persist the new fields:

```js
async function cleanupUploadKeys(env, keys) {
  const safeKeys = Array.isArray(keys)
    ? keys.filter(key => /^photos\/(?:thumb|full)\/[a-zA-Z0-9-]+\.webp$/.test(String(key)))
    : [];
  await Promise.allSettled(safeKeys.map(key => env.R2.delete(key)));
}

const {
  title, category, meta, thumb_url, full_url, aspect_ratio,
  alt_text = '', is_published = true, content_hash = null, upload_keys = []
} = await request.json();
if (!title || !thumb_url || !full_url) {
  await cleanupUploadKeys(env, upload_keys);
  return json({ error: 'title, thumb_url, full_url required' }, 400);
}
```

Wrap the insert so failed metadata persistence cleans the objects before the existing outer handler returns `500`:

```js
try {
  await db.execute({
    sql: `INSERT INTO photos
          (id,title,category,meta,thumb_url,full_url,aspect_ratio,sort_order,alt_text,is_published,content_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, title, category || 'portraits', meta || '', thumb_url, full_url,
      aspect_ratio || '4/5', sort_order, String(alt_text).slice(0, 300),
      is_published ? 1 : 0, content_hash || null
    ]
  });
} catch (error) {
  await cleanupUploadKeys(env, upload_keys);
  throw error;
}
return json({ id }, 201);
```

Replace the public photo query and add the protected admin query:

```js
async function photoRowsWithCollections(db, { publishedOnly }) {
  const where = publishedOnly ? 'WHERE p.is_published=1' : '';
  const { rows } = await db.execute(`
    SELECT p.*, GROUP_CONCAT(cp.collection_id) AS collection_ids_csv
    FROM photos p
    LEFT JOIN collection_photos cp ON cp.photo_id=p.id
    ${where}
    GROUP BY p.id
    ORDER BY p.sort_order ASC, p.created_at DESC
  `);
  return rows.map(row => ({
    ...row,
    collection_ids: row.collection_ids_csv ? String(row.collection_ids_csv).split(',') : []
  }));
}

async function getPhotos(env) {
  try {
    return json({ photos: await photoRowsWithCollections(turso(env), { publishedOnly: true }) });
  } catch (error) {
    console.error('getPhotos:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function getAdminPhotos(request, env) {
  try {
    return json({ photos: await photoRowsWithCollections(turso(env), { publishedOnly: false }) });
  } catch (error) {
    console.error('getAdminPhotos:', error);
    return json({ error: 'internal server error' }, 500);
  }
}
```

Expand `patchPhoto`’s allowlist:

```js
const cols = [
  'title', 'category', 'meta', 'aspect_ratio', 'sort_order', 'alt_text', 'is_published'
].filter(key => body[key] !== undefined);
```

Add the route block:

```js
if (method === 'GET' && path === '/api/admin/photos') return gated(request, env, getAdminPhotos);
if (method === 'PATCH' && path === '/api/admin/photos/batch') return gated(request, env, batchPatchPhotos);
if (method === 'GET' && path.startsWith('/api/admin/photos/hash/')) {
  return gated(request, env, (r, e) => findPhotoHash(e, decodeURIComponent(path.split('/')[5] || '')));
}
```

Implement duplicate lookup:

```js
async function findPhotoHash(env, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'invalid hash' }, 400);
  const { rows } = await turso(env).execute({
    sql: 'SELECT id,title,thumb_url FROM photos WHERE content_hash=? LIMIT 1',
    args: [hash]
  });
  return json({ photo: rows[0] || null });
}
```

Implement `batchPatchPhotos` with a validated allowlist and one write batch:

```js
const photoIds = Array.isArray(body.photo_ids)
  ? [...new Set(body.photo_ids.filter(id => typeof id === 'string' && id))]
  : [];
if (!photoIds.length) return json({ error: 'photo_ids is required' }, 400);
const allowed = ['category', 'is_published'];
const changes = Object.fromEntries(
  allowed.filter(key => body.changes?.[key] !== undefined).map(key => [key, body.changes[key]])
);
const statements = Object.keys(changes).length
  ? photoIds.map(id => ({
      sql: `UPDATE photos SET ${Object.keys(changes).map(key => key + '=?').join(',')} WHERE id=?`,
      args: [...Object.values(changes), id]
    }))
  : [];
for (const collectionId of body.add_collection_ids || []) {
  for (const photoId of photoIds) {
    statements.push({
      sql: `INSERT OR IGNORE INTO collection_photos
            (collection_id,photo_id,sort_order)
            VALUES (?,?,COALESCE((SELECT MAX(sort_order)+1 FROM collection_photos WHERE collection_id=?),0))`,
      args: [collectionId, photoId, collectionId]
    });
  }
}
for (const collectionId of body.remove_collection_ids || []) {
  for (const photoId of photoIds) {
    statements.push({
      sql: 'DELETE FROM collection_photos WHERE collection_id=? AND photo_id=?',
      args: [collectionId, photoId]
    });
  }
}
if (!statements.length) return json({ error: 'nothing to update' }, 400);
await db.batch(statements, 'write');
return json({ ok: true });
```

Update the delete route to pass `request`, then guard R2 deletion:

```js
if (method === 'DELETE' && path.startsWith('/api/photos/')) {
  return gated(request, env, (r, e) => deletePhoto(r, e, path.split('/')[3]));
}

async function deletePhoto(request, env, id) {
  try {
    const db = turso(env);
    const found = await db.execute({
      sql: 'SELECT thumb_url,full_url FROM photos WHERE id=?',
      args: [id]
    });
    if (!found.rows.length) return json({ error: 'not found' }, 404);
    const usage = await db.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM collection_photos WHERE photo_id=?) AS collection_count,
              (SELECT COUNT(*) FROM collections WHERE cover_photo_id=?) AS cover_count`,
      args: [id, id]
    });
    const counts = {
      collection_count: Number(usage.rows[0].collection_count),
      cover_count: Number(usage.rows[0].cover_count)
    };
    const force = new URL(request.url).searchParams.get('force') === '1';
    if (!force && (counts.collection_count || counts.cover_count)) {
      return json({ error: 'photo is in use', usage: counts }, 409);
    }
    const thumbKey = new URL(String(found.rows[0].thumb_url)).pathname.slice(1);
    const fullKey = new URL(String(found.rows[0].full_url)).pathname.slice(1);
    await Promise.all([env.R2.delete(thumbKey), env.R2.delete(fullKey)]);
    await db.execute({ sql: 'DELETE FROM photos WHERE id=?', args: [id] });
    return json({ ok: true });
  } catch (error) {
    console.error('deletePhoto:', error);
    return json({ error: 'internal server error' }, 500);
  }
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- worker/test/api.test.js -t "photo publishing and batches"`  
Expected: PASS.

Run: `npm test`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.js worker/test/api.test.js
git commit -m "feat: add batch photo publishing controls"
```

### Task 5: Admin API client and collection navigation

**Files:**
- Modify: `src/admin/api.js`
- Modify: `src/admin/app.js`
- Create: `src/admin/collection-form.js`
- Create: `src/admin/collection-form.test.js`

**Interfaces:**
- Produces `api.collections.list/get/create/update/remove/replacePhotos/reorder`.
- Produces `api.photos.adminList/batch/findHash/remove(id, force)`.
- Produces `slugFromTitle(title)` and `collectionPayload(formValues)`.

- [ ] **Step 1: Write failing form-helper tests**

```js
// src/admin/collection-form.test.js
import { describe, expect, it } from 'vitest';
import { collectionPayload, slugFromTitle } from './collection-form.js';

it('generates stable collection slugs', () => {
  expect(slugFromTitle('Neon & Rain — 3AM')).toBe('neon-and-rain-3am');
});

it('maps blank optional values to null', () => {
  expect(collectionPayload({
    title: 'Night', slug: 'night', introduction: '',
    location: '', event_date: '', cover_photo_id: '', is_published: false
  })).toEqual({
    title: 'Night', slug: 'night', introduction: '',
    location: null, event_date: null, cover_photo_id: null, is_published: false
  });
});
```

- [ ] **Step 2: Run the helper test**

Run: `npm test -- src/admin/collection-form.test.js`  
Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement helpers and API methods**

```js
// src/admin/collection-form.js
export function slugFromTitle(title) {
  return String(title || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
}

export function collectionPayload(values) {
  return {
    title: String(values.title || '').trim(),
    slug: String(values.slug || '').trim(),
    introduction: String(values.introduction || '').trim(),
    location: String(values.location || '').trim() || null,
    event_date: String(values.event_date || '').trim() || null,
    cover_photo_id: String(values.cover_photo_id || '').trim() || null,
    is_published: Boolean(values.is_published)
  };
}
```

Replace `req` so callers can inspect structured `409` responses:

```js
async function req(path, opts = {}) {
  const res = await fetch(WORKER + path, opts);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: text || 'Request failed' }; }
  if (!res.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}
```

Add to the `api` object:

```js
photos: {
  list: () => req('/api/photos'),
  adminList: () => authJson('/api/admin/photos', 'GET'),
  create: body => authJson('/api/photos', 'POST', body),
  update: (id, body) => authJson('/api/photos/' + id, 'PATCH', body),
  batch: body => authJson('/api/admin/photos/batch', 'PATCH', body),
  findHash: hash => authJson('/api/admin/photos/hash/' + encodeURIComponent(hash), 'GET'),
  remove: (id, force = false) => authJson('/api/photos/' + id + (force ? '?force=1' : ''), 'DELETE')
},
collections: {
  list: () => authJson('/api/admin/collections', 'GET'),
  get: id => authJson('/api/admin/collections/' + id, 'GET'),
  create: body => authJson('/api/admin/collections', 'POST', body),
  update: (id, body) => authJson('/api/admin/collections/' + id, 'PATCH', body),
  remove: id => authJson('/api/admin/collections/' + id, 'DELETE'),
  replacePhotos: (id, photos) => authJson('/api/admin/collections/' + id + '/photos', 'PUT', photos),
  reorder: ids => authJson('/api/admin/collections/order', 'PATCH', { ids })
}
```

Register the view in `src/admin/app.js`:

```js
import { initCollections } from './views/collections.js';
const VIEWS = {
  overview: initOverview,
  photos: initPhotos,
  collections: initCollections,
  inbox: initInbox,
  schedule: initSchedule,
  settings: initSettings
};
```

Add this navigation item immediately after Photos:

```html
<li><a href="#collections" data-view="collections">Collections</a></li>
```

- [ ] **Step 4: Run focused tests and static checks**

Run: `npm test -- src/admin/collection-form.test.js`  
Expected: PASS.

Run: `npm run lint && npm run typecheck`  
Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/admin/api.js src/admin/app.js src/admin/collection-form.js src/admin/collection-form.test.js
git commit -m "feat: add collection admin client"
```

### Task 6: Collection list and visual editor

**Files:**
- Create: `src/admin/views/collections.js`
- Modify: `src/admin/styles.css`
- Modify: `src/admin/collection-form.test.js`

**Interfaces:**
- Consumes: `api.collections`, `api.photos.adminList`, `collectionPayload`, and `slugFromTitle`.
- Produces the Collections admin view with create, edit, membership ordering, cover selection, preview, and publish controls.

- [ ] **Step 1: Add a failing rendering contract test**

Append to `src/admin/collection-form.test.js`:

```js
import { collectionStatus } from './collection-form.js';

it('labels publishing states consistently', () => {
  expect(collectionStatus({ is_published: 0 })).toBe('Unpublished');
  expect(collectionStatus({ is_published: 1 })).toBe('Published');
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- src/admin/collection-form.test.js`  
Expected: FAIL because `collectionStatus` is absent.

- [ ] **Step 3: Implement the status helper and collection view**

Add to `src/admin/collection-form.js`:

```js
export function collectionStatus(collection) {
  return Number(collection?.is_published) === 1 ? 'Published' : 'Unpublished';
}
```

Create `src/admin/views/collections.js` with these exported and local functions:

```js
import { api } from '../api.js';
import { collectionPayload, collectionStatus, slugFromTitle } from '../collection-form.js';

export async function initCollections(container) {
  container.textContent = 'Loading…';
  try {
    const [{ collections }, { photos }] = await Promise.all([
      api.collections.list(), api.photos.adminList()
    ]);
    renderCollectionList(container, collections, photos);
  } catch (err) {
    container.innerHTML = '<div class="admin-error">Collections could not be loaded. <button data-retry>Retry</button></div>';
    container.querySelector('[data-retry]').addEventListener('click', () => initCollections(container));
  }
}

function renderCollectionList(container, collections, photos) {
  container.innerHTML =
    '<div class="collections-head"><h2 class="view-title">Collections</h2>' +
    '<button class="primary-btn" data-new-collection>New collection</button></div>' +
    '<div class="collection-workspace"><div class="collection-list"></div>' +
    '<div class="collection-editor"><p>Select a collection or create one.</p></div></div>';
  const list = container.querySelector('.collection-list');
  for (const collection of collections) {
    const button = document.createElement('button');
    button.className = 'collection-row';
    button.dataset.collectionId = collection.id;
    button.innerHTML = '<span class="collection-row-title"></span><span class="collection-row-state"></span>';
    button.querySelector('.collection-row-title').textContent = collection.title;
    button.querySelector('.collection-row-state').textContent = collectionStatus(collection);
    button.draggable = true;
    button.addEventListener('click', async () => {
      const { collection: detail } = await api.collections.get(collection.id);
      renderEditor(container.querySelector('.collection-editor'), detail, photos);
    });
    list.appendChild(button);
  }
  let dragging = null;
  list.addEventListener('dragstart', event => {
    dragging = event.target.closest('[data-collection-id]');
  });
  list.addEventListener('dragover', event => {
    event.preventDefault();
    const target = event.target.closest('[data-collection-id]');
    if (!dragging || !target || target === dragging) return;
    const box = target.getBoundingClientRect();
    list.insertBefore(dragging, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
  });
  list.addEventListener('drop', async event => {
    event.preventDefault();
    await api.collections.reorder(
      [...list.querySelectorAll('[data-collection-id]')].map(row => row.dataset.collectionId)
    );
    dragging = null;
  });
  container.querySelector('[data-new-collection]').addEventListener('click', () => {
    renderEditor(container.querySelector('.collection-editor'), {
      id: null, title: '', slug: '', introduction: '', location: '',
      event_date: '', cover_photo_id: '', is_published: 0, photos: []
    }, photos);
  });
}

function renderEditor(editor, collection, allPhotos) {
  editor.innerHTML =
    '<form class="collection-form">' +
      '<label>Title<input name="title" required maxlength="120"></label>' +
      '<label>Slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></label>' +
      '<label>Introduction<textarea name="introduction" maxlength="1200"></textarea></label>' +
      '<div class="field-row"><label>Location<input name="location"></label>' +
      '<label>Event date<input name="event_date" type="date"></label></div>' +
      '<label>Cover photo<select name="cover_photo_id"><option value="">First visible frame</option></select></label>' +
      '<label class="publish-toggle"><input name="is_published" type="checkbox"> Published</label>' +
      '<div class="collection-actions"><button type="button" data-preview>Preview</button>' +
      '<button type="button" class="danger-btn" data-delete-collection>Delete</button>' +
      '<button class="primary-btn" type="submit">Save collection</button></div>' +
    '</form><div class="collection-members"><h3>Story sequence</h3>' +
    '<button type="button" data-add-photos>Add photos</button><div class="collection-sequence"></div></div>' +
    '<p class="save-state" aria-live="polite"></p>';
  const form = editor.querySelector('form');
  for (const key of ['title', 'slug', 'introduction', 'location', 'event_date']) {
    form.elements[key].value = collection[key] || '';
  }
  form.elements.is_published.checked = Number(collection.is_published) === 1;
  const cover = form.elements.cover_photo_id;
  for (const photo of allPhotos) {
    cover.add(new Option(photo.title, photo.id, false, photo.id === collection.cover_photo_id));
  }
  renderSequence(editor.querySelector('.collection-sequence'), collection.photos || []);
  let dirty = false;
  form.addEventListener('input', () => { dirty = true; });
  window.onbeforeunload = event => {
    if (!dirty) return undefined;
    event.preventDefault();
    return '';
  };
  form.elements.title.addEventListener('input', () => {
    if (!collection.id && !form.elements.slug.dataset.edited) {
      form.elements.slug.value = slugFromTitle(form.elements.title.value);
    }
  });
  form.elements.slug.addEventListener('input', () => { form.elements.slug.dataset.edited = '1'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const payload = collectionPayload(Object.fromEntries(new FormData(form)));
    payload.is_published = form.elements.is_published.checked;
    const saved = collection.id
      ? await api.collections.update(collection.id, payload)
      : await api.collections.create(payload);
    const id = collection.id || saved.collection.id;
    const ordered = [...editor.querySelectorAll('[data-photo-id]')].map(card => ({
      photo_id: card.dataset.photoId,
      caption: card.querySelector('input').value
    }));
    await api.collections.replacePhotos(id, ordered);
    dirty = false;
    editor.querySelector('.save-state').textContent = 'Saved.';
  });
}
```

Add these sequence and picker functions to the same file:

```js
function renderSequence(root, photos) {
  root.textContent = '';
  for (const photo of photos) {
    const card = document.createElement('article');
    card.className = 'sequence-card';
    card.dataset.photoId = photo.id;
    card.draggable = true;
    const image = document.createElement('img');
    image.src = photo.thumb_url;
    image.alt = '';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = photo.title;
    const caption = document.createElement('input');
    caption.value = photo.caption || '';
    caption.maxLength = 500;
    caption.placeholder = 'Story-specific caption';
    copy.append(title, caption);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => card.remove());
    card.append(image, copy, remove);
    root.appendChild(card);
  }
  let dragging = null;
  root.addEventListener('dragstart', event => {
    dragging = event.target.closest('[data-photo-id]');
    dragging?.classList.add('dragging');
  });
  root.addEventListener('dragover', event => {
    event.preventDefault();
    const target = event.target.closest('[data-photo-id]');
    if (!dragging || !target || target === dragging) return;
    const box = target.getBoundingClientRect();
    root.insertBefore(dragging, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
  });
  root.addEventListener('dragend', () => {
    dragging?.classList.remove('dragging');
    dragging = null;
  });
}

function openPhotoPicker(editor, allPhotos) {
  const existing = new Set(
    [...editor.querySelectorAll('.collection-sequence [data-photo-id]')]
      .map(card => card.dataset.photoId)
  );
  const dialog = document.createElement('dialog');
  dialog.className = 'photo-picker';
  const form = document.createElement('form');
  form.method = 'dialog';
  for (const photo of allPhotos.filter(item => !existing.has(item.id))) {
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.value = photo.id;
    check.dataset.photoTitle = photo.title;
    check.dataset.photoThumb = photo.thumb_url;
    label.append(check, document.createTextNode(photo.title));
    form.appendChild(label);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add selected';
  add.addEventListener('click', () => {
    const additions = [...form.querySelectorAll('input:checked')].map(input => ({
      id: input.value,
      title: input.dataset.photoTitle,
      thumb_url: input.dataset.photoThumb,
      caption: ''
    }));
    const current = [...editor.querySelectorAll('.collection-sequence [data-photo-id]')].map(card => ({
      id: card.dataset.photoId,
      title: card.querySelector('strong').textContent,
      thumb_url: card.querySelector('img').src,
      caption: card.querySelector('input').value
    }));
    renderSequence(editor.querySelector('.collection-sequence'), [...current, ...additions]);
    dialog.close();
  });
  const cancel = document.createElement('button');
  cancel.value = 'cancel';
  cancel.textContent = 'Cancel';
  form.append(add, cancel);
  dialog.appendChild(form);
  editor.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
```

Inside `renderEditor`, wire the remaining actions:

```js
editor.querySelector('[data-add-photos]').addEventListener('click', () => {
  openPhotoPicker(editor, allPhotos);
});
editor.querySelector('[data-preview]').addEventListener('click', () => {
  const preview = document.createElement('dialog');
  preview.className = 'collection-preview';
  const heading = document.createElement('h2');
  heading.textContent = form.elements.title.value || 'Untitled collection';
  const intro = document.createElement('p');
  intro.textContent = form.elements.introduction.value;
  const frames = editor.querySelector('.collection-sequence').cloneNode(true);
  frames.querySelectorAll('input,button').forEach(control => control.remove());
  const close = document.createElement('button');
  close.textContent = 'Close preview';
  close.addEventListener('click', () => preview.close());
  preview.append(heading, intro, frames, close);
  editor.appendChild(preview);
  preview.addEventListener('close', () => preview.remove(), { once: true });
  preview.showModal();
});
const deleteButton = editor.querySelector('[data-delete-collection]');
deleteButton.hidden = !collection.id;
deleteButton.addEventListener('click', async () => {
  if (!collection.id || !confirm(`Delete "${collection.title}"? The photos will be kept.`)) return;
  await api.collections.remove(collection.id);
  window.onbeforeunload = null;
  await initCollections(editor.closest('.admin-main'));
});
```

Add these exact structural styles to `src/admin/styles.css`:

```css
.collection-workspace{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.8fr);gap:24px}
.collection-list,.collection-editor{border:1px solid var(--admin-line);border-radius:14px;background:var(--admin-surface)}
.collection-row{width:100%;display:flex;justify-content:space-between;padding:14px;border:0;border-bottom:1px solid var(--admin-line);background:none;color:inherit;text-align:left}
.collection-form{display:grid;gap:16px;padding:22px}
.collection-form label{display:grid;gap:7px}
.collection-sequence{display:grid;gap:10px;padding:16px}
.sequence-card{display:grid;grid-template-columns:72px 1fr auto;gap:12px;align-items:center;padding:10px;border:1px solid var(--admin-line);border-radius:10px}
.sequence-card img{width:72px;height:54px;object-fit:cover;border-radius:6px}
.save-state{min-height:24px;padding:0 22px 22px}
@media(max-width:850px){.collection-workspace{grid-template-columns:1fr}}
```

- [ ] **Step 4: Run tests, lint, typecheck, and build**

Run: `npm test -- src/admin/collection-form.test.js`  
Expected: PASS.

Run: `npm run lint && npm run typecheck && npm run build`  
Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/admin/views/collections.js src/admin/collection-form.js src/admin/collection-form.test.js src/admin/styles.css
git commit -m "feat: add collection publishing workspace"
```

### Task 7: Resilient bulk upload queue

**Files:**
- Modify: `src/admin/upload.js`
- Modify: `src/admin/upload.test.js`
- Create: `src/admin/upload-queue.js`
- Create: `src/admin/upload-queue.test.js`

**Interfaces:**
- Produces `hashFile(file): Promise<string>`.
- Changes `uploadPhoto` result to `{ id, thumbUrl, fullUrl, aspectRatio, contentHash, uploadKeys }`.
- Produces `createUploadQueue({ uploadOne }): UploadQueue`.
- `UploadQueue` exposes `add(files)`, `run(context)`, `retry(id, context)`, `cancel(id)`, `items()`, and `subscribe(listener)`.

- [ ] **Step 1: Write failing queue-state tests**

```js
// src/admin/upload-queue.test.js
import { describe, expect, it, vi } from 'vitest';
import { createUploadQueue } from './upload-queue.js';

it('continues after one file fails and retries only that item', async () => {
  const uploadOne = vi.fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ photoId: 'two' })
    .mockResolvedValue({ photoId: 'one' });
  const queue = createUploadQueue({ uploadOne });
  queue.add([new File(['a'], 'one.png'), new File(['b'], 'two.png')]);
  await queue.run({ category: 'portraits', collectionId: null });
  expect(queue.items().map(item => item.status)).toEqual(['failed', 'complete']);
  await queue.retry(queue.items()[0].id, { category: 'portraits', collectionId: null });
  expect(queue.items().map(item => item.status)).toEqual(['complete', 'complete']);
  expect(uploadOne).toHaveBeenCalledTimes(3);
});

it('cancels only queued items', () => {
  const queue = createUploadQueue({ uploadOne: vi.fn() });
  queue.add([new File(['a'], 'one.png')]);
  queue.cancel(queue.items()[0].id);
  expect(queue.items()[0].status).toBe('cancelled');
});
```

Append to `src/admin/upload.test.js`:

```js
import { hashFile } from './upload.js';

it('returns a stable lowercase SHA-256 hash', async () => {
  expect(await hashFile(new Blob(['same']))).toMatch(/^[a-f0-9]{64}$/);
  expect(await hashFile(new Blob(['same']))).toBe(await hashFile(new Blob(['same'])));
});
```

- [ ] **Step 2: Run queue and upload tests**

Run: `npm test -- src/admin/upload-queue.test.js src/admin/upload.test.js`  
Expected: FAIL because the new exports are absent.

- [ ] **Step 3: Implement hashing, upload keys, and queue transitions**

Add to `src/admin/upload.js`:

```js
export async function hashFile(file) {
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
```

Inside `uploadPhoto`, compute the hash before decoding and return keys:

```js
const contentHash = await hashFile(file);
const thumbKey = 'photos/thumb/' + id + '.webp';
const fullKey = 'photos/full/' + id + '.webp';
const { publicUrl: thumbUrl } = await uploadFile(thumb, thumbKey);
const { publicUrl: fullUrl } = await uploadFile(full, fullKey);
return {
  id, thumbUrl, fullUrl, aspectRatio: ar, contentHash,
  uploadKeys: [thumbKey, fullKey]
};
```

Create `src/admin/upload-queue.js`:

```js
export function createUploadQueue({ uploadOne }) {
  let state = [];
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener(state.map(item => ({ ...item }))));
  const patch = (id, changes) => {
    state = state.map(item => item.id === id ? { ...item, ...changes } : item);
    emit();
  };
  const runItem = async (item, context) => {
    if (item.status === 'cancelled') return;
    patch(item.id, { status: 'uploading', error: null });
    try {
      const result = await uploadOne(item.file, context, message => patch(item.id, { message }));
      patch(item.id, { status: 'complete', result, message: 'Complete' });
    } catch (error) {
      patch(item.id, { status: 'failed', error: error.message, message: 'Failed' });
    }
  };
  return {
    add(files) {
      state.push(...files.map(file => ({
        id: crypto.randomUUID(), file, status: 'queued', message: 'Queued', error: null
      })));
      emit();
    },
    async run(context) {
      for (const item of state.filter(entry => entry.status === 'queued')) {
        await runItem(item, context);
      }
    },
    async retry(id, context) {
      const item = state.find(entry => entry.id === id && entry.status === 'failed');
      if (item) await runItem(item, context);
    },
    cancel(id) {
      const item = state.find(entry => entry.id === id);
      if (item?.status === 'queued') patch(id, { status: 'cancelled', message: 'Cancelled' });
    },
    items: () => state.map(item => ({ ...item })),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- src/admin/upload-queue.test.js src/admin/upload.test.js`  
Expected: PASS.

Run: `npm test`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/upload.js src/admin/upload.test.js src/admin/upload-queue.js src/admin/upload-queue.test.js
git commit -m "feat: add resilient upload queue"
```

### Task 8: Bulk photo-management UI and safe deletion

**Files:**
- Modify: `src/admin/views/photos.js`
- Modify: `src/admin/styles.css`
- Modify: `src/admin/api.js`

**Interfaces:**
- Consumes: `createUploadQueue`, `uploadPhoto`, collection list, duplicate hash lookup, batch endpoint, and forced deletion.
- Produces queue progress, batch category/collection/visibility actions, inline metadata editing, and usage-aware deletion confirmation.

- [ ] **Step 1: Add a failing pure selection helper test**

Create `src/admin/views/photos.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { toggleSelection } from './photos.js';

it('adds and removes photo IDs without mutating the input set', () => {
  const original = new Set(['a']);
  expect([...toggleSelection(original, 'b', true)]).toEqual(['a', 'b']);
  expect([...toggleSelection(original, 'a', false)]).toEqual([]);
  expect([...original]).toEqual(['a']);
});
```

- [ ] **Step 2: Run the selection test**

Run: `npm test -- src/admin/views/photos.test.js`  
Expected: FAIL because `toggleSelection` is not exported.

- [ ] **Step 3: Implement the bulk workspace**

Add the helper:

```js
export function toggleSelection(current, id, selected) {
  const next = new Set(current);
  selected ? next.add(id) : next.delete(id);
  return next;
}
```

Change `initPhotos` to load admin photos and collections together:

```js
const [{ photos }, { collections }] = await Promise.all([
  api.photos.adminList(),
  api.collections.list()
]);
renderPhotos(c, photos, collections);
```

Replace the single status paragraph with:

```html
<div class="upload-options">
  <label>Category<select id="uploadCategory"></select></label>
  <label>Collection<select id="uploadCollection"><option value="">None</option></select></label>
</div>
<div id="uploadQueue" class="upload-queue" aria-live="polite"></div>
<div id="bulkToolbar" class="bulk-toolbar" hidden>
  <strong><span data-selected-count>0</span> selected</strong>
  <select data-bulk-category><option value="">Change category…</option></select>
  <select data-bulk-collection><option value="">Add to collection…</option></select>
  <button data-bulk-hide>Unpublish</button>
  <button data-bulk-show>Publish</button>
  <button data-bulk-delete class="danger-btn">Delete</button>
</div>
```

Construct one queue per view:

```js
const queue = createUploadQueue({
  uploadOne: async (file, context, onProgress) => {
    const hash = await hashFile(file);
    const duplicate = await api.photos.findHash(hash);
    if (duplicate.photo && !confirm(`"${file.name}" appears to already exist. Upload another copy?`)) {
      throw new Error('Skipped duplicate');
    }
    const uploaded = await uploadPhoto(file, onProgress);
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const created = await api.photos.create({
      title,
      category: context.category,
      meta: '',
      alt_text: '',
      is_published: true,
      thumb_url: uploaded.thumbUrl,
      full_url: uploaded.fullUrl,
      aspect_ratio: uploaded.aspectRatio,
      content_hash: uploaded.contentHash,
      upload_keys: uploaded.uploadKeys
    });
    if (context.collectionId) {
      await api.photos.batch({
        photo_ids: [created.id],
        changes: {},
        add_collection_ids: [context.collectionId],
        remove_collection_ids: []
      });
    }
    return { ...uploaded, photoId: created.id, title };
  }
});
```

Subscribe once and render each queue item with filename, status, message, Retry for failed items, and Cancel for queued items. Bulk buttons call `api.photos.batch` with the selected IDs and then update the affected cards only after success.

Each photo card must include:

```html
<label class="photo-select"><input type="checkbox" aria-label="Select photo"></label>
<button class="photo-edit" type="button">Edit metadata</button>
```

The metadata drawer edits `title`, `meta`, `alt_text`, `category`, and `is_published`, calls `api.photos.update`, shows `Saving…`, then `Saved.` in an `aria-live` region. Use this deletion helper so a `409` names the affected usage before retrying:

```js
async function removePhotoWithUsage(photo) {
  if (!confirm(`Delete "${photo.title}"?`)) return false;
  try {
    await api.photos.remove(photo.id);
    return true;
  } catch (error) {
    if (error.status !== 409) throw error;
    const usage = error.data?.usage || {};
    const message =
      `"${photo.title}" is used in ${Number(usage.collection_count || 0)} collection(s)` +
      (Number(usage.cover_count || 0) ? ' and is a collection cover.' : '.') +
      ' Delete it everywhere?';
    if (!confirm(message)) return false;
    await api.photos.remove(photo.id, true);
    return true;
  }
}
```

Add styles:

```css
.upload-options,.bulk-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.upload-queue{display:grid;gap:8px;margin:16px 0}
.upload-item{display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:10px 12px;border:1px solid var(--admin-line);border-radius:9px}
.upload-item[data-status="failed"]{border-color:#c8495b}
.bulk-toolbar{position:sticky;top:12px;z-index:5;padding:12px;background:var(--admin-surface);border:1px solid var(--admin-line);border-radius:12px}
.photo-card.selected{outline:2px solid var(--accent)}
.photo-select{position:absolute;top:10px;left:10px;z-index:2}
.photo-metadata-drawer{position:fixed;inset:0 0 0 auto;width:min(440px,100%);z-index:30;background:var(--admin-surface);padding:24px;box-shadow:-20px 0 60px #0008}
```

- [ ] **Step 4: Run tests and build checks**

Run: `npm test -- src/admin/views/photos.test.js src/admin/upload-queue.test.js`  
Expected: PASS.

Run: `npm run lint && npm run typecheck && npm run build`  
Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/admin/views/photos.js src/admin/views/photos.test.js src/admin/styles.css src/admin/api.js
git commit -m "feat: add bulk photo management"
```

### Task 9: Public data layer and story routing

**Files:**
- Modify: `src/data.js`
- Modify: `src/data.test.js`
- Create: `src/stories.js`
- Create: `src/stories.test.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `vercel.json`

**Interfaces:**
- Produces `loadPortfolio(): Promise<{ shots, cats, collections, source }>`
- Produces `loadStory(slug): Promise<CollectionDetail>`
- Produces `routeFromPath(pathname): { name: 'home' } | { name: 'story', slug: string }`
- Produces `renderStoryPage(root, collection)`.

- [ ] **Step 1: Write failing data, route, and rendering tests**

```js
// additions to src/data.test.js
it('throws in production instead of silently showing demo content', async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
  await expect(loadPortfolio({ workerUrl: 'https://api.example' })).rejects.toThrow('offline');
});

it('loads one story by encoded slug', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ collection: { slug: 'neon-rain', photos: [] } })
  });
  expect((await loadStory('neon-rain', { workerUrl: 'https://api.example' })).slug).toBe('neon-rain');
  expect(fetch).toHaveBeenCalledWith('https://api.example/api/collections/neon-rain');
});
```

```js
// src/stories.test.js
import { describe, expect, it } from 'vitest';
import { renderStoryPage, routeFromPath } from './stories.js';

it('parses home and story routes', () => {
  expect(routeFromPath('/')).toEqual({ name: 'home' });
  expect(routeFromPath('/stories/neon-rain')).toEqual({ name: 'story', slug: 'neon-rain' });
});

it('renders ordered story frames and captions', () => {
  const root = document.createElement('section');
  renderStoryPage(root, {
    title: 'Neon Rain',
    introduction: 'After midnight.',
    photos: [
      { title: 'First', full_url: '/first.webp', alt_text: 'A wet alley', caption: 'Opening frame' }
    ]
  });
  expect(root.querySelector('h1').textContent).toBe('Neon Rain');
  expect(root.querySelector('img').alt).toBe('A wet alley');
  expect(root.querySelector('figcaption').textContent).toContain('Opening frame');
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `npm test -- src/data.test.js src/stories.test.js`  
Expected: FAIL because the new functions and module do not exist.

- [ ] **Step 3: Implement explicit data behavior and story rendering**

Refactor `src/data.js` so dependency injection is available to tests:

```js
const DEFAULT_WORKER = import.meta.env.VITE_WORKER_URL || '';

function mapPhoto(photo) {
  return {
    id: photo.id,
    cat: photo.category,
    t: photo.title,
    m: photo.meta,
    ar: photo.aspect_ratio,
    thumb: photo.thumb_url,
    full: photo.full_url,
    alt: photo.alt_text,
    collection_ids: photo.collection_ids || []
  };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Request failed with status ' + response.status);
  return response.json();
}

export async function loadPortfolio({ workerUrl = DEFAULT_WORKER } = {}) {
  if (!workerUrl) return { shots: SHOTS, cats: CATS, collections: [], source: 'local' };
  const [{ photos }, { collections }] = await Promise.all([
    getJson(workerUrl + '/api/photos'),
    getJson(workerUrl + '/api/collections')
  ]);
  return {
    shots: photos.map(mapPhoto),
    cats: CATS,
    collections,
    source: 'remote'
  };
}

export async function loadStory(slug, { workerUrl = DEFAULT_WORKER } = {}) {
  if (!workerUrl) throw new Error('Story routes require VITE_WORKER_URL');
  return (await getJson(workerUrl + '/api/collections/' + encodeURIComponent(slug))).collection;
}

export const loadData = loadPortfolio;
```

Create `src/stories.js`:

```js
export function routeFromPath(pathname) {
  const match = String(pathname).match(/^\/stories\/([^/]+)\/?$/);
  return match
    ? { name: 'story', slug: decodeURIComponent(match[1]) }
    : { name: 'home' };
}

export function renderStoryPage(root, collection) {
  root.textContent = '';
  const header = document.createElement('header');
  header.className = 'story-header';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Photo story';
  const title = document.createElement('h1');
  title.textContent = collection.title;
  const intro = document.createElement('p');
  intro.textContent = collection.introduction || '';
  const details = document.createElement('p');
  details.className = 'story-details';
  details.textContent = [collection.event_date, collection.location].filter(Boolean).join(' · ');
  header.append(eyebrow, title, intro);
  if (details.textContent) header.appendChild(details);
  const sequence = document.createElement('div');
  sequence.className = 'story-sequence';
  for (const photo of collection.photos || []) {
    const figure = document.createElement('figure');
    figure.className = 'story-frame';
    figure.dataset.photoId = photo.id || '';
    const image = document.createElement('img');
    image.src = photo.full_url;
    image.alt = photo.alt_text || photo.title || '';
    image.loading = 'lazy';
    const caption = document.createElement('figcaption');
    caption.textContent = photo.caption || photo.title || '';
    figure.append(image, caption);
    sequence.appendChild(figure);
  }
  root.append(header, sequence);
}
```

In `index.html`, add `id="homeContent"` to the existing `<main>`, add `<main id="storyContent" hidden></main>` after it, and add a Stories link before Work.

In `src/main.js`, route before importing homepage behavior:

```js
import './styles.css';
import './image-slot.js';
import { loadStory } from './data.js';
import { renderStoryPage, routeFromPath } from './stories.js';

const route = routeFromPath(location.pathname);
if (route.name === 'story') {
  document.querySelector('.hero').hidden = true;
  document.getElementById('homeContent').hidden = true;
  const root = document.getElementById('storyContent');
  root.hidden = false;
  try {
    renderStoryPage(root, await loadStory(route.slug));
  } catch {
    root.innerHTML = '<section class="story-error"><h1>Story unavailable</h1><p>Try again or return to all stories.</p><a href="/">Return home</a></section>';
  }
} else {
  await import('./app.js');
}
```

Add this top-level property to `vercel.json`:

```json
"rewrites": [
  { "source": "/stories/:slug", "destination": "/index.html" }
]
```

- [ ] **Step 4: Run focused tests and build**

Run: `npm test -- src/data.test.js src/stories.test.js`  
Expected: PASS.

Run: `npm run build`  
Expected: Vite emits both public and admin entries successfully.

- [ ] **Step 5: Commit**

```bash
git add src/data.js src/data.test.js src/stories.js src/stories.test.js src/main.js index.html vercel.json
git commit -m "feat: add shareable photo story routes"
```

### Task 10: Hybrid Dispatches homepage and stronger gallery browsing

**Files:**
- Modify: `index.html`
- Modify: `src/stories.js`
- Modify: `src/stories.test.js`
- Modify: `src/app.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes `loadPortfolio` collections and photos.
- Produces `renderStoryHighlights(root, collections)`.
- Produces category and collection filters with visible count and reset behavior.

- [ ] **Step 1: Write failing highlight and filter tests**

Append to `src/stories.test.js`:

```js
import { filterShots, renderStoryHighlights } from './stories.js';

it('uses the first collection as Latest Dispatch', () => {
  const root = document.createElement('div');
  renderStoryHighlights(root, [
    { slug: 'first', title: 'First', introduction: 'Lead', cover_thumb_url: '/one.webp', frame_count: 8 },
    { slug: 'second', title: 'Second', cover_thumb_url: '/two.webp', frame_count: 4 }
  ]);
  expect(root.querySelector('[data-featured-story]').getAttribute('href')).toBe('/stories/first');
  expect(root.querySelectorAll('[data-story-card]')).toHaveLength(2);
});

it('combines category and collection filters', () => {
  const shots = [
    { cat: 'crew', collection_ids: ['a'] },
    { cat: 'crew', collection_ids: ['b'] },
    { cat: 'vehicles', collection_ids: ['a'] }
  ];
  expect(filterShots(shots, { category: 'crew', collectionId: 'a' })).toEqual([shots[0]]);
});
```

- [ ] **Step 2: Run tests and observe missing exports**

Run: `npm test -- src/stories.test.js`  
Expected: FAIL because `filterShots` and `renderStoryHighlights` are absent.

- [ ] **Step 3: Implement story highlights and unified filtering**

Add to `src/stories.js`:

```js
export function filterShots(shots, { category = 'all', collectionId = 'all' } = {}) {
  return shots.filter(shot =>
    (category === 'all' || shot.cat === category) &&
    (collectionId === 'all' || (shot.collection_ids || []).includes(collectionId))
  );
}

export function renderStoryHighlights(root, collections) {
  root.textContent = '';
  if (!collections.length) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const featured = collections[0];
  const feature = document.createElement('a');
  feature.className = 'featured-dispatch';
  feature.dataset.featuredStory = '';
  feature.href = '/stories/' + encodeURIComponent(featured.slug);
  const image = document.createElement('img');
  image.src = featured.cover_thumb_url || '';
  image.alt = '';
  const copy = document.createElement('div');
  const label = document.createElement('span');
  label.className = 'eyebrow';
  label.textContent = 'Latest Dispatch';
  const title = document.createElement('h2');
  title.textContent = featured.title;
  const intro = document.createElement('p');
  intro.textContent = featured.introduction || `${featured.frame_count} frames`;
  copy.append(label, title, intro);
  feature.append(image, copy);
  const grid = document.createElement('div');
  grid.className = 'story-card-grid';
  for (const collection of collections) {
    const card = document.createElement('a');
    card.dataset.storyCard = '';
    card.className = 'story-card';
    card.href = '/stories/' + encodeURIComponent(collection.slug);
    card.innerHTML = '<img alt=""><div><h3></h3><span></span></div>';
    card.querySelector('img').src = collection.cover_thumb_url || '';
    card.querySelector('h3').textContent = collection.title;
    card.querySelector('span').textContent = `${collection.frame_count} frames`;
    grid.appendChild(card);
  }
  root.append(feature, grid);
}
```

Add `<section class="stories wrap" id="stories" hidden></section>` between the hero and gallery in `index.html`. Add a collection-filter row and result controls after the existing category filters:

```html
<div class="filters collection-filters" id="collectionFilters"></div>
<p class="gallery-results" id="galleryResults" aria-live="polite"></p>
<button class="filter-reset" id="filterReset" type="button">Reset filters</button>
<p class="gallery-empty" id="galleryEmpty" hidden>No frames match these filters. Reset them to see the full portfolio.</p>
```

At the top of `src/app.js`, consume the complete portfolio payload and render the story section:

```js
import { CATS, loadPortfolio } from './data.js';
import { filterShots, renderStoryHighlights } from './stories.js';

var portfolioLoadError = null;
var portfolio;
try {
  portfolio = await loadPortfolio();
} catch (error) {
  portfolioLoadError = error;
  portfolio = { shots: [], collections: [] };
}
var SHOTS = portfolio.shots;
var COLLECTIONS = portfolio.collections;
renderStoryHighlights(document.getElementById('stories'), COLLECTIONS);
if (portfolioLoadError) {
  var galleryRoot = document.getElementById('grid');
  galleryRoot.innerHTML =
    '<div class="portfolio-error"><p>The portfolio could not be loaded.</p>' +
    '<button type="button" id="portfolioRetry">Try again</button></div>';
  document.getElementById('portfolioRetry').addEventListener('click', function () {
    location.reload();
  });
}
```

Replace the category-only filter handler with this shared state:

```js
var filterState = { category: 'all', collectionId: 'all' };
var collectionFilters = document.getElementById('collectionFilters');
var galleryResults = document.getElementById('galleryResults');
var galleryEmpty = document.getElementById('galleryEmpty');

function makeFilter(label, value, kind, active) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'filter' + (active ? ' active' : '');
  button.dataset.filterKind = kind;
  button.dataset.filterValue = value;
  button.textContent = label;
  return button;
}

collectionFilters.appendChild(makeFilter('All stories', 'all', 'collectionId', true));
COLLECTIONS.forEach(function (collection) {
  collectionFilters.appendChild(
    makeFilter(collection.title, collection.id, 'collectionId', false)
  );
});

function applyFilters() {
  var visible = new Set(filterShots(SHOTS, filterState));
  document.querySelectorAll('.shot').forEach(function (figure) {
    figure.classList.toggle('hide', !visible.has(SHOTS[Number(figure.dataset.idx)]));
  });
  galleryResults.textContent = visible.size + ' of ' + SHOTS.length + ' frames';
  galleryEmpty.hidden = visible.size !== 0 || Boolean(portfolioLoadError);
}

document.querySelector('.gallery').addEventListener('click', function (event) {
  var button = event.target.closest('[data-filter-kind]');
  if (!button) return;
  var kind = button.dataset.filterKind;
  filterState[kind] = button.dataset.filterValue;
  button.parentElement.querySelectorAll('[data-filter-kind="' + kind + '"]').forEach(function (item) {
    item.classList.toggle('active', item === button);
  });
  applyFilters();
});

document.getElementById('filterReset').addEventListener('click', function () {
  filterState = { category: 'all', collectionId: 'all' };
  document.querySelectorAll('[data-filter-kind]').forEach(function (button) {
    button.classList.toggle('active', button.dataset.filterValue === 'all');
  });
  applyFilters();
});
applyFilters();
```

When creating the existing category buttons, replace `b.dataset.cat = c.id` with:

```js
b.dataset.filterKind = 'category';
b.dataset.filterValue = c.id;
```

The visible count must use the exact format `"8 of 14 frames"`.

Add layout styles:

```css
.stories{padding:clamp(70px,11vh,150px) clamp(20px,5vw,72px) 40px}
.featured-dispatch{display:grid;grid-template-columns:1.25fr .75fr;min-height:420px;color:inherit;text-decoration:none;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.featured-dispatch img{width:100%;height:100%;object-fit:cover}
.featured-dispatch>div{display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(24px,5vw,64px);background:var(--surface)}
.story-card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:18px}
.story-card{position:relative;min-height:220px;color:inherit;text-decoration:none;overflow:hidden;border-radius:8px}
.story-card img{width:100%;height:100%;object-fit:cover;transition:transform .5s var(--ease)}
.story-card:hover img{transform:scale(1.035)}
.gallery-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.gallery-results{margin-left:auto;color:var(--ink-dim)}
.gallery-empty,.portfolio-error{padding:32px;border:1px solid var(--line);border-radius:10px;color:var(--ink-dim)}
@media(max-width:800px){.featured-dispatch{grid-template-columns:1fr}.story-card-grid{grid-template-columns:1fr 1fr}}
@media(max-width:540px){.story-card-grid{grid-template-columns:1fr}}
```

- [ ] **Step 4: Run tests and build**

Run: `npm test -- src/stories.test.js src/data.test.js`  
Expected: PASS.

Run: `npm run lint && npm run typecheck && npm run build`  
Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add index.html src/stories.js src/stories.test.js src/app.js src/styles.css
git commit -m "feat: add hybrid dispatches portfolio"
```

### Task 11: Accessible lightbox, mobile navigation, and interaction polish

**Files:**
- Create: `src/lightbox.js`
- Create: `src/lightbox.test.js`
- Create: `src/image-slot.test.js`
- Modify: `src/app.js`
- Modify: `src/stories.js`
- Modify: `src/image-slot.js`
- Modify: `index.html`
- Modify: `src/styles.css`

**Interfaces:**
- Produces `createLightbox(root, { getItems }): { open(index, trigger), close(), step(direction) }`.
- Consumes filtered gallery items or story photos through `getItems`.

- [ ] **Step 1: Write failing dialog lifecycle tests**

```js
// src/lightbox.test.js
import { beforeEach, expect, it } from 'vitest';
import { createLightbox } from './lightbox.js';

beforeEach(() => {
  document.body.innerHTML =
    '<button id="trigger">Open</button>' +
    '<div id="lb" role="dialog" aria-modal="true" aria-hidden="true">' +
      '<button data-lb-close>Close</button><button data-lb-prev>Previous</button>' +
      '<img data-lb-image><span data-lb-title></span><button data-lb-next>Next</button>' +
    '</div>';
});

it('opens, handles arrows and Escape, and restores trigger focus', () => {
  const items = [
    { src: '/a.webp', title: 'A', alt: 'A frame' },
    { src: '/b.webp', title: 'B', alt: 'B frame' }
  ];
  const trigger = document.getElementById('trigger');
  const lightbox = createLightbox(document.getElementById('lb'), { getItems: () => items });
  trigger.focus();
  lightbox.open(0, trigger);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(document.querySelector('[data-lb-title]').textContent).toBe('B');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.activeElement).toBe(trigger);
  expect(document.getElementById('lb').getAttribute('aria-hidden')).toBe('true');
});
```

Create `src/image-slot.test.js`:

```js
import { expect, it } from 'vitest';
import './image-slot.js';

it('propagates the alt attribute to the visible shadow image', async () => {
  const slot = document.createElement('image-slot');
  slot.id = 'alt-test';
  slot.setAttribute('src', '/frame.webp');
  slot.setAttribute('alt', 'A driver beneath pink neon');
  document.body.appendChild(slot);
  await Promise.resolve();
  expect(slot.shadowRoot.querySelector('img[part="image"]').alt)
    .toBe('A driver beneath pink neon');
});
```

- [ ] **Step 2: Run the lightbox test**

Run: `npm test -- src/lightbox.test.js src/image-slot.test.js`  
Expected: FAIL because `lightbox.js` is absent and `image-slot` does not propagate alt text.

- [ ] **Step 3: Implement dialog focus and reusable sequencing**

```js
// src/lightbox.js
export function createLightbox(root, { getItems }) {
  let index = 0;
  let trigger = null;
  const image = root.querySelector('[data-lb-image]');
  const title = root.querySelector('[data-lb-title]');
  const meta = root.querySelector('[data-lb-meta]');
  const count = root.querySelector('[data-lb-count]');
  const filmstrip = root.querySelector('[data-lb-filmstrip]');
  const focusable = () => [...root.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])')];

  function render() {
    const items = getItems();
    const item = items[index];
    if (!item) return;
    image.src = item.src;
    image.alt = item.alt || item.title || '';
    title.textContent = item.title || '';
    if (meta) {
      meta.textContent = [item.collection, item.caption, item.meta].filter(Boolean).join(' · ');
    }
    if (count) count.textContent = `${index + 1} / ${items.length}`;
    if (filmstrip) {
      filmstrip.replaceChildren(...items.map((entry, itemIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lb-thumb';
        button.classList.toggle('active', itemIndex === index);
        button.setAttribute('aria-label', 'View ' + (entry.title || `image ${itemIndex + 1}`));
        const thumb = document.createElement('img');
        thumb.src = entry.thumb || entry.src;
        thumb.alt = '';
        button.appendChild(thumb);
        button.addEventListener('click', () => { index = itemIndex; render(); });
        return button;
      }));
    }
  }
  function open(nextIndex, nextTrigger) {
    index = nextIndex;
    trigger = nextTrigger || document.activeElement;
    render();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-active');
    root.querySelector('[data-lb-close]').focus();
  }
  function close() {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-active');
    trigger?.focus();
  }
  function step(direction) {
    const items = getItems();
    if (!items.length) return;
    index = (index + direction + items.length) % items.length;
    render();
  }
  function onKey(event) {
    if (root.getAttribute('aria-hidden') === 'true') return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
    if (event.key === 'Tab') {
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKey);
  root.querySelector('[data-lb-close]').addEventListener('click', close);
  root.querySelector('[data-lb-prev]').addEventListener('click', () => step(-1));
  root.querySelector('[data-lb-next]').addEventListener('click', () => step(1));
  return { open, close, step };
}
```

Replace the inline lightbox implementation in `src/app.js` with this module and use the clicked card button as the focus-return trigger. Initialize the same module from `stories.js` after rendering a story sequence.

Use these item adapters so the dialog receives the same interface from either surface:

```js
// Gallery adapter in src/app.js
function galleryLightboxItems() {
  return visibleFilledShots().map(figure => {
    const shot = SHOTS[Number(figure.dataset.idx)];
    return {
      src: shot.full || slotImg(figure),
      thumb: shot.thumb || slotImg(figure),
      title: shot.t,
      alt: shot.alt || shot.t,
      meta: shot.m,
      collection: COLLECTIONS.find(collection =>
        (shot.collection_ids || []).includes(collection.id)
      )?.title || ''
    };
  });
}

// Story adapter in src/stories.js
function storyLightboxItems(collection) {
  return (collection.photos || []).map(photo => ({
    src: photo.full_url,
    thumb: photo.thumb_url,
    title: photo.title,
    alt: photo.alt_text || photo.title,
    caption: photo.caption,
    meta: photo.meta,
    collection: collection.title
  }));
}
```

In `src/image-slot.js`, add `alt` to `observedAttributes` and set the visible shadow image’s alt value during `_render`:

```js
static get observedAttributes() {
  return ['shape', 'radius', 'mask', 'fit', 'position', 'placeholder', 'src', 'id', 'alt'];
}

// At the beginning of _render():
this._img.alt = this.getAttribute('alt') || '';
this._ghost.alt = '';
```

When `src/app.js` creates a gallery `<image-slot>`, include `alt="${esc(s.alt || s.t)}"`.

Update the lightbox shell in `index.html`:

```html
<div class="lightbox" id="lightbox" role="dialog" aria-modal="true"
     aria-labelledby="lbTitle" aria-hidden="true">
  <button class="lb-close" data-lb-close aria-label="Close full-screen image">×</button>
  <button class="lb-nav prev" data-lb-prev aria-label="Previous image">‹</button>
  <figure class="lb-fig">
    <img data-lb-image alt="">
    <figcaption>
      <span id="lbTitle" data-lb-title></span>
      <span data-lb-meta></span>
      <span data-lb-count></span>
    </figcaption>
  </figure>
  <button class="lb-nav next" data-lb-next aria-label="Next image">›</button>
  <div class="lb-filmstrip" data-lb-filmstrip aria-label="Images in this story"></div>
</div>
```

Add this button between the brand and `.nav-links` in `index.html`:

```html
<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primaryNav">
  Menu
</button>
```

Set `id="primaryNav"` on `.nav-links`, then initialize it in `src/app.js`:

```js
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
navToggle.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') !== 'true';
  navToggle.setAttribute('aria-expanded', String(open));
  navLinks.classList.toggle('open', open);
});
navLinks.addEventListener('click', event => {
  if (!event.target.closest('a')) return;
  navToggle.setAttribute('aria-expanded', 'false');
  navLinks.classList.remove('open');
});
```

Add persistent touch styles, filmstrip styles, focus styles, and reduced motion:

```css
:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.nav-toggle{display:none}
.lightbox-active{overflow:hidden}
.lb-filmstrip{display:flex;gap:8px;max-width:min(720px,80vw);overflow:auto}
.lb-thumb{width:64px;height:48px;padding:0;border:1px solid var(--line);opacity:.55}
.lb-thumb.active{border-color:var(--accent);opacity:1}
.lb-thumb img{width:100%;height:100%;object-fit:cover}
@media(hover:none){
  .shot-cap,.shot-cat,.shot-expand{opacity:1;transform:none}
  .shot-cap{position:relative;background:var(--surface)}
}
@media(max-width:720px){
  .nav-toggle{display:inline-flex;min-width:44px;min-height:44px;align-items:center;justify-content:center}
  .nav-links{position:absolute;top:100%;left:12px;right:12px;display:none;flex-direction:column;align-items:stretch;padding:14px;background:rgba(10,10,11,.96);border:1px solid var(--line);border-radius:10px}
  .nav-links.open{display:flex}
  .nav-links a{min-height:44px;display:flex;align-items:center}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
```

- [ ] **Step 4: Run tests and all static checks**

Run: `npm test -- src/lightbox.test.js src/image-slot.test.js src/stories.test.js`  
Expected: PASS.

Run: `npm test && npm run lint && npm run typecheck && npm run build`  
Expected: all tests and commands PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lightbox.js src/lightbox.test.js src/image-slot.js src/image-slot.test.js src/app.js src/stories.js index.html src/styles.css
git commit -m "feat: improve portfolio navigation accessibility"
```

### Task 12: End-to-end regression and deployment verification

**Files:**
- Inspect: every file changed by Tasks 1–11.
- Modify: only a tracked file whose automated or manual verification fails; record the exact path in the task handoff before editing it.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified phase-one release candidate.

- [ ] **Step 1: Run the complete automated verification suite**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

Expected:

```text
All Vitest test files pass.
ESLint exits 0.
TypeScript check exits 0.
Prettier reports all matched files use Prettier formatting.
Vite emits dist/index.html and dist/admin/index.html.
```

- [ ] **Step 2: Exercise the Worker locally**

Run from `worker/`:

```bash
npm test
npx wrangler dev
```

Verify with authenticated and public requests:

```text
GET /api/collections returns only published collections.
GET /api/collections/:slug returns ordered published photos.
GET /api/admin/collections without a token returns 401.
PATCH /api/admin/photos/batch changes all requested photos atomically.
DELETE /api/photos/:id returns 409 when the photo is in use and succeeds with ?force=1.
```

- [ ] **Step 3: Verify the public experience in a browser**

Run: `npm run dev -- --host 127.0.0.1`

Verify at desktop and 390×844 mobile viewports:

```text
The hero remains visually intact.
Latest Dispatch uses the first published collection.
Collection cards open /stories/:slug.
Direct reload on a story URL works.
Category and collection filters combine and reset.
Touch users can see captions and open images without hover.
The lightbox traps focus, responds to arrows/Escape, and restores focus.
Reduced-motion mode removes parallax, tilt, reveal, and long dialog motion.
```

- [ ] **Step 4: Verify the admin experience in a browser**

Verify:

```text
Multiple files enter one queue.
One failed file can retry without restarting successful files.
Duplicate detection allows an explicit override.
Batch category, collection, and publishing changes persist.
Collection photo ordering persists after reload.
An empty collection cannot be published.
Preview works for an unpublished saved collection.
Deleting an in-use photo names its usage before forced deletion.
```

- [ ] **Step 5: Verify a Vercel preview**

Run: `npx vercel --yes`

Expected: Vercel prints a successful preview deployment URL. Open that URL and verify:

```text
/stories/:slug direct loads return index.html and render the story.
The CSP permits the configured Worker and R2 origins.
Admin assets remain absent from the public entry bundle.
Production API failures show retry/error UI and never demo data.
```

- [ ] **Step 6: Commit only verification fixes**

If verification required fixes:

```bash
git status --short
git add -u
git commit -m "fix: resolve portfolio verification findings"
```

Before `git add -u`, verify that `git status --short` lists only tracked files changed to resolve this task’s verification failures. If it lists unrelated work, stage each verified fix by its exact path instead. If no files changed, record the successful commands and browser checks in the implementation handoff without creating an empty commit.
