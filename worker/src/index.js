import { createClient } from '@libsql/client/web';
import { SignJWT, jwtVerify } from 'jose';
import { validateCollectionInput } from './collection-domain.js';
import {
  findPublishedCollection,
  getAdminCollection,
  listPublishedCollections,
  replaceCollectionPhotos
} from './collection-store.js';

let migrated = false;

async function ensureColumn(db, table, column, definition) {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  if (!info.rows.some(row => row.name === column || row[1] === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function runMigrations(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS commissions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    shoot_type TEXT,
    contact TEXT NOT NULL,
    deadline TEXT,
    refs TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    promoted_shoot_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS shoots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    shoot_type TEXT,
    contact TEXT NOT NULL,
    date TEXT,
    refs TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'booked',
    source TEXT NOT NULL DEFAULT 'manual',
    commission_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    meta TEXT,
    thumb_url TEXT NOT NULL,
    full_url TEXT NOT NULL,
    aspect_ratio TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
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
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_collection_photos_photo ON collection_photos(photo_id)'
  );
  await ensureColumn(db, 'photos', 'alt_text', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(
    db,
    'photos',
    'is_published',
    'INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0,1))'
  );
  await ensureColumn(db, 'photos', 'content_hash', 'TEXT');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash)');
  await db.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT NOT NULL,
    ts INTEGER NOT NULL
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_rate_limits ON rate_limits (bucket, ts)`);
  // libSQL does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS
  const info = await db.execute(`PRAGMA table_info(commissions)`);
  const hasCol = info.rows.some(r => r[1] === 'promoted_shoot_id');
  if (!hasCol) {
    await db.execute(`ALTER TABLE commissions ADD COLUMN promoted_shoot_id TEXT`);
  }
}

function turso(env) {
  return createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function corsOk() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// Resolve which origin to allow. If ALLOWED_ORIGINS is set (comma-separated),
// echo the request origin only when it matches; otherwise fall back to '*' so
// the live site keeps working until the allowlist is configured.
function pickOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return '*';
  return origin && list.includes(origin) ? origin : list[0];
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

// Apply CORS + security headers to every response in one place.
function withHeaders(res, allowOrigin) {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', allowOrigin);
  if (allowOrigin !== '*') headers.append('Vary', 'Origin');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

const IP = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';

// Fixed-window per-key limiter backed by Turso. Returns true when over limit.
async function rateLimited(env, bucket, limit, windowSec) {
  try {
    const db = turso(env);
    const now = Math.floor(Date.now() / 1000);
    const since = now - windowSec;
    await db.execute({ sql: 'DELETE FROM rate_limits WHERE ts < ?', args: [since] });
    const { rows } = await db.execute({
      sql: 'SELECT COUNT(*) AS c FROM rate_limits WHERE bucket=? AND ts >= ?',
      args: [bucket, since]
    });
    if (Number(rows[0].c) >= limit) return true;
    await db.execute({ sql: 'INSERT INTO rate_limits (bucket, ts) VALUES (?, ?)', args: [bucket, now] });
    return false;
  } catch (err) {
    // Never let limiter failure take down the endpoint.
    console.error('rateLimited:', err);
    return false;
  }
}

async function requireAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { err: json({ error: 'Unauthorized' }, 401) };
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    await jwtVerify(token, secret);
    return { ok: true };
  } catch {
    return { err: json({ error: 'Invalid token' }, 401) };
  }
}

async function login(request, env) {
  try {
    const { password } = await request.json();
    if (!password || password !== env.ADMIN_PASSWORD) return json({ error: 'Invalid password' }, 401);
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(secret);
    return json({ token });
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
}

async function gated(request, env, handler) {
  const auth = await requireAuth(request, env);
  if (auth.err) return auth.err;
  return handler(request, env);
}

export default {
  async fetch(request, env) {
    const allowOrigin = pickOrigin(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') return withHeaders(corsOk(), allowOrigin);
    const res = await handle(request, env);
    return withHeaders(res, allowOrigin);
  }
};

async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!migrated) { try { await runMigrations(turso(env)); migrated = true; } catch (e) { console.error('migration:', e); } }

    if (method === 'POST' && path === '/api/login') {
      if (await rateLimited(env, 'login:' + IP(request), 5, 900)) return json({ error: 'Too many attempts, try again later' }, 429);
      return login(request, env);
    }
    if (method === 'GET'  && path === '/api/photos')       return getPhotos(env);
    if (method === 'GET' && path === '/api/collections') return getPublicCollections(env);
    if (method === 'GET' && path.startsWith('/api/collections/')) {
      return getPublicCollection(env, decodeURIComponent(path.split('/')[3] || ''));
    }
    if (method === 'GET'  && path === '/api/settings')     return getSettings(env);
    if (method === 'POST' && path === '/api/commissions') {
      if (await rateLimited(env, 'commission:' + IP(request), 3, 60)) return json({ error: 'Too many requests, slow down' }, 429);
      return postCommission(request, env);
    }

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

    if (method === 'POST'   && path === '/api/upload')               return gated(request, env, upload);
    if (method === 'POST'   && path === '/api/photos')               return gated(request, env, createPhoto);
    if (method === 'PATCH'  && path.startsWith('/api/photos/'))      return gated(request, env, (r,e) => patchPhoto(r, e, path.split('/')[3]));
    if (method === 'DELETE' && path.startsWith('/api/photos/'))      return gated(request, env, (r,e) => deletePhoto(e, path.split('/')[3]));
    if (method === 'GET'    && path === '/api/commissions')          return gated(request, env, getCommissions);
    if (method === 'PATCH'  && path.startsWith('/api/commissions/') && !path.endsWith('/promote') && !path.endsWith('/archive')) return gated(request, env, (r,e) => patchCommission(r, e, path.split('/')[3]));
    if (method === 'POST'   && path.startsWith('/api/commissions/') && path.endsWith('/promote')) return gated(request, env, (r,e) => promoteCommission(r, e, path.split('/')[3]));
    if (method === 'POST'   && path.startsWith('/api/commissions/') && path.endsWith('/archive')) return gated(request, env, (r,e) => archiveCommission(e, path.split('/')[3]));
    if (method === 'DELETE' && path.startsWith('/api/commissions/') && path.split('/').length === 4) return gated(request, env, (r,e) => deleteCommission(e, path.split('/')[3]));
    if (method === 'PUT'    && path === '/api/settings')             return gated(request, env, putSettings);

    if (method === 'GET'    && path === '/api/shoots')               return gated(request, env, getShoots);
    if (method === 'POST'   && path === '/api/shoots')               return gated(request, env, createShoot);
    if (method === 'PATCH'  && path.startsWith('/api/shoots/') && !path.endsWith('/archive')) return gated(request, env, (r,e) => patchShoot(r, e, path.split('/')[3]));
    if (method === 'POST'   && path.startsWith('/api/shoots/') && path.endsWith('/archive'))  return gated(request, env, (r,e) => archiveShoot(e, path.split('/')[3]));

    return json({ error: 'not found' }, 404);
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
    if (checked.value.is_published === 1) {
      return json({ error: 'a collection needs a published photo before publishing' }, 409);
    }
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
    if (items.some(item => item === null || typeof item !== 'object' || Array.isArray(item))) {
      return json({ error: 'each photo must be an object' }, 400);
    }
    if (items.some(item => !String(item.photo_id || ''))) {
      return json({ error: 'photo_id is required' }, 400);
    }
    const db = turso(env);
    const collection = await getAdminCollection(db, id);
    if (!collection) return json({ error: 'not found' }, 404);
    if (Number(collection.is_published) === 1) {
      if (!items.length) {
        return json({ error: 'a published collection needs a published photo' }, 409);
      }
      const ids = items.map(item => String(item.photo_id));
      const visible = await db.execute({
        sql: `SELECT COUNT(*) AS count FROM photos
              WHERE is_published=1 AND id IN (${ids.map(() => '?').join(',')})`,
        args: ids
      });
      if (Number(visible.rows[0].count) === 0) {
        return json({ error: 'a published collection needs a published photo' }, 409);
      }
    }
    await replaceCollectionPhotos(db, id, items);
    return json({ collection: await getAdminCollection(db, id) });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    if (['photo_id is required', 'each photo must be an object'].includes(error.message)) {
      return json({ error: error.message }, 400);
    }
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return json({ error: 'collection membership conflicts with stored data' }, 409);
    }
    console.error('putAdminCollectionPhotos:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

async function reorderAdminCollections(request, env) {
  try {
    const body = await request.json();
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
      return json({ error: 'ids must be an array of strings' }, 400);
    }
    const db = turso(env);
    const current = await db.execute('SELECT id FROM collections');
    const currentIds = current.rows.map(row => String(row.id));
    const uniqueIds = new Set(ids);
    if (
      ids.length !== currentIds.length ||
      uniqueIds.size !== ids.length ||
      currentIds.some(id => !uniqueIds.has(id))
    ) {
      return json({ error: 'ids must contain every collection exactly once' }, 400);
    }
    if (!ids.length) return json({ ok: true });
    await db.batch(ids.map((id, sortOrder) => ({
      sql: `UPDATE collections SET sort_order=?,updated_at=datetime('now') WHERE id=?`,
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

async function getPhotos(env) {
  try {
    const { rows } = await turso(env).execute(
      'SELECT id,title,category,meta,thumb_url,full_url,aspect_ratio,sort_order,created_at FROM photos WHERE is_published=1 ORDER BY sort_order ASC, created_at DESC'
    );
    return json({ photos: rows });
  } catch (err) {
    console.error('getPhotos:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function getSettings(env) {
  try {
    const { rows } = await turso(env).execute('SELECT key,value FROM settings');
    const out = {};
    rows.forEach(r => { out[r.key] = r.value; });
    return json(out);
  } catch (err) {
    console.error('getSettings:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function upload(request, env) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const key  = form.get('key');
    if (!file || !key) return json({ error: 'file and key required' }, 400);
    await env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/webp' } });
    return json({ publicUrl: env.R2_PUBLIC_URL + '/' + key });
  } catch (err) {
    console.error('upload:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function createPhoto(request, env) {
  try {
    const { title, category, meta, thumb_url, full_url, aspect_ratio } = await request.json();
    if (!title || !thumb_url || !full_url) return json({ error: 'title, thumb_url, full_url required' }, 400);
    const id = crypto.randomUUID();
    const db = turso(env);
    const { rows } = await db.execute('SELECT COALESCE(MAX(sort_order),-1) AS m FROM photos');
    const sort_order = Number(rows[0].m) + 1;
    await db.execute({
      sql: 'INSERT INTO photos (id,title,category,meta,thumb_url,full_url,aspect_ratio,sort_order) VALUES (?,?,?,?,?,?,?,?)',
      args: [id, title, category || 'portraits', meta || '', thumb_url, full_url, aspect_ratio || '4/5', sort_order]
    });
    return json({ id }, 201);
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('createPhoto:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function patchPhoto(request, env, id) {
  try {
    const body = await request.json();
    const cols = ['title','category','meta','aspect_ratio','sort_order'].filter(k => body[k] !== undefined);
    if (!cols.length) return json({ error: 'nothing to update' }, 400);
    const args = cols.map(k => body[k]);
    args.push(id);
    await turso(env).execute({ sql: `UPDATE photos SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`, args });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('patchPhoto:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function deletePhoto(env, id) {
  try {
    const db = turso(env);
    const { rows } = await db.execute({ sql: 'SELECT thumb_url,full_url FROM photos WHERE id=?', args: [id] });
    if (!rows.length) return json({ error: 'not found' }, 404);
    const thumbKey = new URL(String(rows[0].thumb_url)).pathname.slice(1);
    const fullKey  = new URL(String(rows[0].full_url)).pathname.slice(1);
    await Promise.all([env.R2.delete(thumbKey), env.R2.delete(fullKey)]);
    await db.execute({ sql: 'DELETE FROM photos WHERE id=?', args: [id] });
    return json({ ok: true });
  } catch (err) {
    console.error('deletePhoto:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function getCommissions(request, env) {
  try {
    const { rows } = await turso(env).execute("SELECT * FROM commissions WHERE status != 'archived' ORDER BY created_at DESC");
    return json({ commissions: rows });
  } catch (err) {
    console.error('getCommissions:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function patchCommission(request, env, id) {
  try {
    const { status } = await request.json();
    if (!['new','seen','done'].includes(status)) return json({ error: 'invalid status' }, 400);
    await turso(env).execute({ sql: 'UPDATE commissions SET status=? WHERE id=?', args: [status, id] });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('patchCommission:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function archiveCommission(env, id) {
  try {
    await turso(env).execute({ sql: `UPDATE commissions SET status='archived' WHERE id=?`, args: [id] });
    return json({ ok: true });
  } catch (err) {
    console.error('archiveCommission:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function deleteCommission(env, id) {
  try {
    const db = turso(env);
    const { rows } = await db.execute({ sql: 'SELECT promoted_shoot_id FROM commissions WHERE id=?', args: [id] });
    if (!rows.length) return json({ error: 'not found' }, 404);
    const shootId = rows[0].promoted_shoot_id;
    // Avoid orphaning the shoot this commission was promoted into.
    const stmts = [{ sql: 'DELETE FROM commissions WHERE id=?', args: [id] }];
    if (shootId) stmts.push({ sql: `UPDATE shoots SET status='archived' WHERE id=?`, args: [shootId] });
    await db.batch(stmts);
    return json({ ok: true });
  } catch (err) {
    console.error('deleteCommission:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function promoteCommission(request, env, id) {
  try {
    const db = turso(env);
    const { rows } = await db.execute({ sql: 'SELECT * FROM commissions WHERE id=?', args: [id] });
    if (!rows.length) return json({ error: 'not found' }, 404);
    const c = rows[0];
    if (c.promoted_shoot_id) return json({ error: 'already promoted' }, 409);
    const shootId = crypto.randomUUID();
    await db.batch([
      { sql: 'INSERT INTO shoots (id,name,shoot_type,contact,date,refs,notes,status,source,commission_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        args: [shootId, c.name, c.shoot_type || null, c.contact, c.deadline || null, c.refs || null, c.notes || null, 'booked', 'inbox', id] },
      { sql: 'UPDATE commissions SET promoted_shoot_id=? WHERE id=?', args: [shootId, id] }
    ]);
    return json({ shoot: { id: shootId } }, 201);
  } catch (err) {
    console.error('promoteCommission:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function getShoots(request, env) {
  try {
    const { rows } = await turso(env).execute(
      `SELECT * FROM shoots WHERE status != 'archived' ORDER BY date ASC, created_at DESC`
    );
    return json({ shoots: rows });
  } catch (err) {
    console.error('getShoots:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function createShoot(request, env) {
  try {
    const { name, shoot_type, contact, date, refs, notes } = await request.json();
    if (!name || !contact) return json({ error: 'name and contact required' }, 400);
    const id = crypto.randomUUID();
    const normDate = date ? String(date).slice(0, 10) : null;
    await turso(env).execute({
      sql: 'INSERT INTO shoots (id,name,shoot_type,contact,date,refs,notes) VALUES (?,?,?,?,?,?,?)',
      args: [id, name, shoot_type || null, contact, normDate, refs || null, notes || null]
    });
    return json({ id }, 201);
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('createShoot:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function patchShoot(request, env, id) {
  try {
    const body = await request.json();
    const allowed = ['name','shoot_type','contact','date','refs','notes','status'];
    const cols = allowed.filter(k => body[k] !== undefined);
    if (!cols.length) return json({ error: 'nothing to update' }, 400);
    if (body.status && !['booked','shooting','delivered','archived'].includes(body.status)) return json({ error: 'invalid status' }, 400);
    if (body.date) body.date = String(body.date).slice(0, 10);
    const args = cols.map(k => body[k]);
    args.push(id);
    await turso(env).execute({ sql: `UPDATE shoots SET ${cols.map(k => k+'=?').join(',')} WHERE id=?`, args });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('patchShoot:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function archiveShoot(env, id) {
  try {
    await turso(env).execute({ sql: `UPDATE shoots SET status='archived' WHERE id=?`, args: [id] });
    return json({ ok: true });
  } catch (err) {
    console.error('archiveShoot:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function putSettings(request, env) {
  try {
    const body = await request.json();
    const db = turso(env);
    for (const [key, value] of Object.entries(body)) {
      await db.execute({ sql: 'INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', args: [key, String(value)] });
    }
    return json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('putSettings:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function postCommission(request, env) {
  try {
    const body = await request.json();
    const { name, shoot_type, contact, deadline, refs, notes } = body;
    if (!name || !contact) return json({ error: 'name and contact required' }, 400);
    if (name.length > 120) return json({ error: 'name too long' }, 400);
    if (contact.length > 200) return json({ error: 'contact too long' }, 400);
    if (notes && notes.length > 2000) return json({ error: 'notes too long' }, 400);
    if (refs && refs.length > 500) return json({ error: 'refs too long' }, 400);
    const id = crypto.randomUUID();
    await turso(env).execute({
      sql: 'INSERT INTO commissions (id,name,shoot_type,contact,deadline,refs,notes) VALUES (?,?,?,?,?,?,?)',
      args: [id, name, shoot_type || null, contact, deadline || null, refs || null, notes || null]
    });
    return json({ id }, 201);
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('postCommission:', err);
    return json({ error: 'internal server error' }, 500);
  }
}
