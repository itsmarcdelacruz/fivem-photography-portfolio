const WORKER = import.meta.env.VITE_WORKER_URL || '';

function tok() { return localStorage.getItem('admin_token'); }

export async function login(password) {
  const res = await fetch(WORKER + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json();
}

async function req(path, opts = {}) {
  const res = await fetch(WORKER + path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function authJson(path, method, body) {
  return req(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + await tok() },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

export const api = {
  photos:      { list: () => req('/api/photos'), create: b => authJson('/api/photos','POST',b), update: (id,b) => authJson('/api/photos/'+id,'PATCH',b), remove: id => authJson('/api/photos/'+id,'DELETE') },
  commissions: { list: () => authJson('/api/commissions','GET'), updateStatus: (id,s) => authJson('/api/commissions/'+id,'PATCH',{status:s}) },
  settings:    { get: () => req('/api/settings'), update: b => authJson('/api/settings','PUT',b) }
};

export async function uploadFile(blob, key) {
  const form = new FormData();
  form.append('file', blob, key.split('/').pop());
  form.append('key', key);
  const res = await fetch(WORKER + '/api/upload', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + await tok() },
    body: form
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
