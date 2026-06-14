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
    const { pathname: path, method = request.method } = { pathname: url.pathname, method: request.method };

    if (method === 'GET'  && path === '/api/photos')      return getPhotos(env);
    if (method === 'GET'  && path === '/api/settings')    return getSettings(env);
    if (method === 'POST' && path === '/api/commissions') return postCommission(request, env);

    return json({ error: 'not found' }, 404);
  }
};

async function getPhotos(env) {
  const { rows } = await turso(env).execute(
    'SELECT id,title,category,meta,thumb_url,full_url,aspect_ratio,sort_order FROM photos ORDER BY sort_order ASC, created_at DESC'
  );
  return json({ photos: rows });
}

async function getSettings(env) {
  const { rows } = await turso(env).execute('SELECT key,value FROM settings');
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return json(out);
}

async function postCommission(request, env) {
  const body = await request.json();
  const { name, shoot_type, contact, deadline, refs, notes } = body;
  if (!name || !contact) return json({ error: 'name and contact required' }, 400);
  const id = crypto.randomUUID();
  await turso(env).execute({
    sql: 'INSERT INTO commissions (id,name,shoot_type,contact,deadline,refs,notes) VALUES (?,?,?,?,?,?,?)',
    args: [id, name, shoot_type || null, contact, deadline || null, refs || null, notes || null]
  });
  return json({ id }, 201);
}
