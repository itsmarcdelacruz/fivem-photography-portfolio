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

async function authJson(path, method, body) {
  return req(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + await tok() },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

export const api = {
  photos: {
    list: () => req('/api/photos'),
    adminList: () => authJson('/api/admin/photos', 'GET'),
    create: body => authJson('/api/photos', 'POST', body),
    update: (id, body) => authJson('/api/photos/' + id, 'PATCH', body),
    reorder: ids => authJson('/api/admin/photos/order', 'PATCH', { ids }),
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
  },
  commissions: { list: () => authJson('/api/commissions','GET'), updateStatus: (id,s) => authJson('/api/commissions/'+id,'PATCH',{status:s}), promote: id => authJson('/api/commissions/'+id+'/promote','POST'), archive: id => authJson('/api/commissions/'+id+'/archive','POST'), remove: id => authJson('/api/commissions/'+id,'DELETE') },
  settings:    { get: () => req('/api/settings'), update: b => authJson('/api/settings','PUT',b) },
  shoots:      { list: () => authJson('/api/shoots','GET'), create: b => authJson('/api/shoots','POST',b), update: (id,b) => authJson('/api/shoots/'+id,'PATCH',b), archive: id => authJson('/api/shoots/'+id+'/archive','POST') }
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
