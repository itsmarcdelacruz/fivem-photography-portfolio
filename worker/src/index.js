import { createClient } from '@libsql/client/web';
import { SignJWT, jwtVerify } from 'jose';

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

    if (method === 'POST' && path === '/api/login')        return login(request, env);
    if (method === 'GET'  && path === '/api/photos')      return getPhotos(env);
    if (method === 'GET'  && path === '/api/settings')    return getSettings(env);
    if (method === 'POST' && path === '/api/commissions') return postCommission(request, env);

    if (method === 'POST'   && path === '/api/upload')               return gated(request, env, upload);
    if (method === 'POST'   && path === '/api/photos')               return gated(request, env, createPhoto);
    if (method === 'PATCH'  && path.startsWith('/api/photos/'))      return gated(request, env, (r,e) => patchPhoto(r, e, path.split('/')[3]));
    if (method === 'DELETE' && path.startsWith('/api/photos/'))      return gated(request, env, (r,e) => deletePhoto(e, path.split('/')[3]));
    if (method === 'GET'    && path === '/api/commissions')          return gated(request, env, getCommissions);
    if (method === 'PATCH'  && path.startsWith('/api/commissions/')) return gated(request, env, (r,e) => patchCommission(r, e, path.split('/')[3]));
    if (method === 'PUT'    && path === '/api/settings')             return gated(request, env, putSettings);

    return json({ error: 'not found' }, 404);
  }
};

async function getPhotos(env) {
  try {
    const { rows } = await turso(env).execute(
      'SELECT id,title,category,meta,thumb_url,full_url,aspect_ratio,sort_order FROM photos ORDER BY sort_order ASC, created_at DESC'
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

async function getCommissions(env) {
  try {
    const { rows } = await turso(env).execute('SELECT * FROM commissions ORDER BY created_at DESC');
    return json({ commissions: rows });
  } catch (err) {
    console.error('getCommissions:', err);
    return json({ error: 'internal server error' }, 500);
  }
}

async function patchCommission(request, env, id) {
  try {
    const { status } = await request.json();
    if (!['new','seen','booked','done'].includes(status)) return json({ error: 'invalid status' }, 400);
    await turso(env).execute({ sql: 'UPDATE commissions SET status=? WHERE id=?', args: [status, id] });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('patchCommission:', err);
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
