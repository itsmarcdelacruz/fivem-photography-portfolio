import { createClient } from '@libsql/client/web';

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
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsOk();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET'  && path === '/api/photos')      return getPhotos(env);
    if (method === 'GET'  && path === '/api/settings')    return getSettings(env);
    if (method === 'POST' && path === '/api/commissions') return postCommission(request, env);

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
