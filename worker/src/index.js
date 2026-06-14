import { createClient } from '@libsql/client/web';
import { SignJWT, jwtVerify } from 'jose';

let migrated = false;

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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function corsOk() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
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
    if (request.method === 'OPTIONS') return corsOk();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!migrated) { try { await runMigrations(turso(env)); migrated = true; } catch (e) { console.error('migration:', e); } }

    if (method === 'POST' && path === '/api/login')        return login(request, env);
    if (method === 'GET'  && path === '/api/photos')       return getPhotos(env);
    if (method === 'GET'  && path === '/api/settings')     return getSettings(env);
    if (method === 'POST' && path === '/api/commissions')  return postCommission(request, env);

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
};

async function getPhotos(env) {
  try {
    const { rows } = await turso(env).execute(
      'SELECT id,title,category,meta,thumb_url,full_url,aspect_ratio,sort_order,created_at FROM photos ORDER BY sort_order ASC, created_at DESC'
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
    const sort_order = rows[0].m + 1;
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
    const thumbKey = new URL(rows[0].thumb_url).pathname.slice(1);
    const fullKey  = new URL(rows[0].full_url).pathname.slice(1);
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
    await turso(env).execute({ sql: 'DELETE FROM commissions WHERE id=?', args: [id] });
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
