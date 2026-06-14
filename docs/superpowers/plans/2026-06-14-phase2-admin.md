# Phase 2 — Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Clerk-protected admin dashboard at `/admin` for photo management and commission review, backed by a Cloudflare Worker, Turso (SQLite), and Cloudflare R2.

**Architecture:** A second Vite entry point (`admin/index.html`) adds the admin app to the existing repo without touching the public site bundle. All database/storage access goes through a Cloudflare Worker — no credentials ever reach the browser. The public site gallery is updated to fetch live data from the same Worker.

**Tech Stack:** Vite 8, Vanilla JS, Cloudflare Workers + R2, Turso (libSQL), Clerk, `jose` (JWT verification), `@libsql/client`

> **Note on R2 uploads — spec deviation:** The design spec named the upload route `POST /api/upload-url` (presigned URL pattern). Cloudflare R2's Workers binding does not expose presigned URL generation, so this plan uses `POST /api/upload` instead — the Worker accepts the image body directly and calls `env.R2.put()`. The result is identical: browser uploads are gated by Clerk JWT on the Worker. The spec's acceptance criteria are fully met by this approach.

---

## File Map

**New — Worker:**
- `worker/wrangler.toml` — Worker name, R2 binding, env vars
- `worker/package.json` — `jose`, `@libsql/client` deps
- `worker/src/index.js` — All API routes

**New — Admin frontend:**
- `admin/index.html` — Admin HTML entry (Clerk CDN, loads `src/admin/main.js`)
- `src/admin/main.js` — Clerk init + auth gate
- `src/admin/app.js` — Client-side router + sidebar shell
- `src/admin/api.js` — Fetch wrapper for all Worker routes
- `src/admin/upload.js` — Canvas resize (thumb + full) + Worker upload
- `src/admin/utils.js` — Shared helpers (`escHtml`, `uuid`)
- `src/admin/styles.css` — Admin layout styles
- `src/admin/views/overview.js` — Overview screen
- `src/admin/views/photos.js` — Photos grid + upload drop zone
- `src/admin/views/inbox.js` — Commission inbox
- `src/admin/views/settings.js` — Availability settings

**Modified:**
- `vite.config.js` — Add `admin/index.html` as second Rollup entry
- `src/data.js` — Add `loadData()` async export; keep static arrays as dev fallback
- `src/app.js` — Top-level await `loadData()`; replace `setTimeout` with Worker fetch

---

## Task 1: Turso Database Setup

**Prerequisites:** `npm install -g @turso/cli` then `turso auth login`

- [ ] **Create the database**

```bash
turso db create katie-portfolio
```

- [ ] **Open shell and run schema**

```bash
turso db shell katie-portfolio
```

Paste:

```sql
CREATE TABLE photos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  meta         TEXT NOT NULL,
  thumb_url    TEXT NOT NULL,
  full_url     TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE commissions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  shoot_type TEXT,
  contact    TEXT NOT NULL,
  deadline   TEXT,
  refs       TEXT,
  notes      TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings VALUES ('availability', 'open');
INSERT INTO settings VALUES ('availability_label', 'Open for July');
```

- [ ] **Verify**

```sql
.tables
```

Expected: `commissions  photos  settings`

- [ ] **Collect credentials**

```bash
turso db show katie-portfolio --url
turso db tokens create katie-portfolio
```

Save both — needed for Worker secrets.

---

## Task 2: Cloudflare Worker Scaffold

**Prerequisites:** Cloudflare account; R2 bucket `katie-photos` created in dashboard with public access enabled; `npm install -g wrangler` then `wrangler login`

- [ ] **Create worker directory and `worker/package.json`**

```bash
mkdir worker
```

```json
{
  "name": "katie-portfolio-worker",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.js",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@libsql/client": "^0.14.0",
    "jose": "^5.9.6"
  }
}
```

```bash
cd worker && npm install
```

- [ ] **Create `worker/wrangler.toml`**

```toml
name = "katie-portfolio-worker"
main = "src/index.js"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[r2_buckets]]
binding = "R2"
bucket_name = "katie-photos"

[vars]
R2_PUBLIC_URL = "https://pub-REPLACE.r2.dev"
CLERK_JWKS_URL = "https://REPLACE.clerk.accounts.dev/.well-known/jwks.json"
```

Replace both URLs with real values from your R2 and Clerk dashboards.

- [ ] **Set Turso secrets**

```bash
cd worker
wrangler secret put TURSO_URL
wrangler secret put TURSO_TOKEN
```

- [ ] **Create `worker/src/index.js` hello route**

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Not found', { status: 404 });
  }
};
```

- [ ] **Verify**

```bash
cd worker && npm run dev
```

```bash
curl http://localhost:8787/health
```

Expected: `{"ok":true}`

- [ ] **Commit**

```bash
git add worker/
git commit -m "feat: scaffold cloudflare worker"
```

---

## Task 3: Worker — Public Read Routes + Commission Submit

- [ ] **Replace `worker/src/index.js`**

```js
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
```

- [ ] **Test each route**

```bash
curl http://localhost:8787/api/photos
# {"photos":[]}

curl http://localhost:8787/api/settings
# {"availability":"open","availability_label":"Open for July"}

curl -X POST http://localhost:8787/api/commissions \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","contact":"Katiebug515"}'
# {"id":"<uuid>"}

turso db shell katie-portfolio "SELECT * FROM commissions;"
# shows the row
```

- [ ] **Commit**

```bash
git add worker/src/index.js
git commit -m "feat: worker public read routes and commission submit"
```

---

## Task 4: Worker — Clerk JWT Auth + Admin Routes

- [ ] **Add `requireAuth` and all admin handlers to `worker/src/index.js`**

Add the import at the top:

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';
```

Add the auth helper after `corsOk`:

```js
let jwks = null;
async function requireAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { err: json({ error: 'Unauthorized' }, 401) };
  if (!jwks) jwks = createRemoteJWKSet(new URL(env.CLERK_JWKS_URL));
  try {
    const { payload } = await jwtVerify(token, jwks);
    return { userId: payload.sub };
  } catch {
    return { err: json({ error: 'Invalid token' }, 401) };
  }
}
```

Add these routes inside the `fetch` handler, after the public routes:

```js
    if (method === 'POST'   && path === '/api/upload')              return gated(request, env, upload);
    if (method === 'POST'   && path === '/api/photos')              return gated(request, env, createPhoto);
    if (method === 'PATCH'  && path.startsWith('/api/photos/'))     return gated(request, env, (r,e) => patchPhoto(r, e, path.split('/')[3]));
    if (method === 'DELETE' && path.startsWith('/api/photos/'))     return gated(request, env, (r,e) => deletePhoto(e, path.split('/')[3]));
    if (method === 'GET'    && path === '/api/commissions')         return gated(request, env, getCommissions);
    if (method === 'PATCH'  && path.startsWith('/api/commissions/')) return gated(request, env, (r,e) => patchCommission(r, e, path.split('/')[3]));
    if (method === 'PUT'    && path === '/api/settings')            return gated(request, env, putSettings);
```

Add the `gated` helper:

```js
async function gated(request, env, handler) {
  const auth = await requireAuth(request, env);
  if (auth.err) return auth.err;
  return handler(request, env);
}
```

Add the admin handler functions at the bottom:

```js
async function upload(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  const key  = form.get('key');
  if (!file || !key) return json({ error: 'file and key required' }, 400);
  await env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/webp' } });
  return json({ publicUrl: env.R2_PUBLIC_URL + '/' + key });
}

async function createPhoto(request, env) {
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
}

async function patchPhoto(request, env, id) {
  const body = await request.json();
  const cols = ['title','category','meta','aspect_ratio','sort_order'].filter(k => body[k] !== undefined);
  if (!cols.length) return json({ error: 'nothing to update' }, 400);
  const args = cols.map(k => body[k]);
  args.push(id);
  await turso(env).execute({ sql: `UPDATE photos SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`, args });
  return json({ ok: true });
}

async function deletePhoto(env, id) {
  const db = turso(env);
  const { rows } = await db.execute({ sql: 'SELECT thumb_url,full_url FROM photos WHERE id=?', args: [id] });
  if (!rows.length) return json({ error: 'not found' }, 404);
  const thumbKey = new URL(rows[0].thumb_url).pathname.slice(1);
  const fullKey  = new URL(rows[0].full_url).pathname.slice(1);
  await Promise.all([env.R2.delete(thumbKey), env.R2.delete(fullKey)]);
  await db.execute({ sql: 'DELETE FROM photos WHERE id=?', args: [id] });
  return json({ ok: true });
}

async function getCommissions(env) {
  const { rows } = await turso(env).execute('SELECT * FROM commissions ORDER BY created_at DESC');
  return json({ commissions: rows });
}

async function patchCommission(request, env, id) {
  const { status } = await request.json();
  if (!['new','seen','booked','done'].includes(status)) return json({ error: 'invalid status' }, 400);
  await turso(env).execute({ sql: 'UPDATE commissions SET status=? WHERE id=?', args: [status, id] });
  return json({ ok: true });
}

async function putSettings(request, env) {
  const body = await request.json();
  const db = turso(env);
  for (const [key, value] of Object.entries(body)) {
    await db.execute({ sql: 'INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', args: [key, String(value)] });
  }
  return json({ ok: true });
}
```

- [ ] **Test protected routes — no token should 401**

```bash
curl -X DELETE http://localhost:8787/api/photos/fake-id
# {"error":"Unauthorized"}
```

- [ ] **Commit**

```bash
git add worker/src/index.js
git commit -m "feat: worker clerk jwt auth and admin write routes"
```

---

## Task 5: Vite Second Entry + Admin HTML Scaffold

- [ ] **Update `vite.config.js`**

```js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html')
      }
    }
  }
});
```

- [ ] **Create `admin/index.html`** (replace `CLERK_PUBLISHABLE_KEY` and `CLERK_FRONTEND_API` with real values from Clerk dashboard)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin — Night City Frames</title>
  <script
    async
    crossorigin="anonymous"
    data-clerk-publishable-key="pk_test_REPLACE"
    src="https://REPLACE.clerk.accounts.dev/npm/@clerk/clerk-js@latest/dist/clerk.browser.js"
    type="text/javascript">
  </script>
  <script type="module" src="/src/admin/main.js"></script>
</head>
<body>
  <div id="sign-in-root"></div>
  <div id="admin-root" hidden></div>
</body>
</html>
```

- [ ] **Create `src/admin/utils.js`**

```js
export function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Create `src/admin/main.js`** (placeholder)

```js
import './styles.css';

async function init() {
  await window.Clerk.load();
  const signInRoot = document.getElementById('sign-in-root');
  const adminRoot  = document.getElementById('admin-root');
  if (!Clerk.user) { Clerk.mountSignIn(signInRoot); return; }
  signInRoot.hidden = true;
  adminRoot.hidden  = false;
  adminRoot.textContent = 'Authenticated as ' + Clerk.user.primaryEmailAddress?.emailAddress;
}

window.addEventListener('load', init);
```

- [ ] **Create `src/admin/styles.css`** (base only — each task adds to this file)

```css
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0a0b;
  --bg2: #111113;
  --ink: #f4f1ec;
  --ink2: rgba(244,241,236,.5);
  --accent: #ff2d55;
  --border: rgba(244,241,236,.08);
}

body {
  background: var(--bg);
  color: var(--ink);
  font-family: 'Archivo', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
}

#sign-in-root {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}
```

- [ ] **Add `.env.local`**

```
VITE_WORKER_URL=http://localhost:8787
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Verify build includes both entry points**

```bash
npm run build
```

Expected: `dist/index.html` and `dist/admin/index.html` both present.

- [ ] **Verify auth gate in browser**

```bash
npm run dev
```

Open `http://localhost:5173/admin/` — should see Clerk sign-in. Sign in — should see "Authenticated as …" text.

- [ ] **Commit**

```bash
git add vite.config.js admin/ src/admin/ .env.local
# note: src/admin/utils.js is created in this task — it is included in the commit above
git commit -m "feat: vite second entry + admin html + clerk auth gate"
```

---

## Task 6: Admin API Client + Upload Utility

- [ ] **Create `src/admin/api.js`**

```js
const WORKER = import.meta.env.VITE_WORKER_URL || '';

async function tok() { return Clerk.session.getToken(); }

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
```

- [ ] **Create `src/admin/upload.js`**

```js
import { uploadFile } from './api.js';

async function resizeTo(bitmap, w, quality) {
  const h = Math.round(bitmap.height * (w / bitmap.width));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}

export async function uploadPhoto(file, onProgress) {
  const id = crypto.randomUUID();
  const bmp = await createImageBitmap(file);
  const ar = (bmp.width / bmp.height).toFixed(4);

  onProgress && onProgress('Resizing…');
  const scale = Math.min(1, 1920 / bmp.width);
  const [thumb, full] = await Promise.all([
    resizeTo(bmp, Math.round(bmp.width * Math.min(1, 800 / bmp.width)), 0.82),
    resizeTo(bmp, Math.round(bmp.width * scale), 0.88)
  ]);
  bmp.close();

  onProgress && onProgress('Uploading thumbnail…');
  const { publicUrl: thumbUrl } = await uploadFile(thumb, 'photos/thumb/' + id + '.webp');

  onProgress && onProgress('Uploading full…');
  const { publicUrl: fullUrl } = await uploadFile(full, 'photos/full/' + id + '.webp');

  return { id, thumbUrl, fullUrl, aspectRatio: ar };
}
```

---

## Task 7: Admin Shell — Router + Sidebar

- [ ] **Create `src/admin/app.js`**

```js
import { initOverview } from './views/overview.js';
import { initPhotos }   from './views/photos.js';
import { initInbox }    from './views/inbox.js';
import { initSettings } from './views/settings.js';

const VIEWS = { overview: initOverview, photos: initPhotos, inbox: initInbox, settings: initSettings };

export function bootAdmin(root) {
  // Static shell structure — not user input // nosec
  root.innerHTML =
    '<div class="admin-layout">' +
      '<nav class="admin-nav">' +
        '<div class="admin-brand"><span class="mono-k">KM</span> Admin</div>' +
        '<ul>' +
          '<li><a href="#overview" data-view="overview">Overview</a></li>' +
          '<li><a href="#photos"   data-view="photos">Photos</a></li>' +
          '<li><a href="#inbox"    data-view="inbox">Inbox</a></li>' +
          '<li><a href="#settings" data-view="settings">Settings</a></li>' +
        '</ul>' +
        '<button id="signOutBtn" class="sign-out-btn">Sign out</button>' +
      '</nav>' +
      '<main class="admin-main" id="adminMain"></main>' +
    '</div>';

  document.getElementById('signOutBtn').addEventListener('click', () => Clerk.signOut().then(() => location.reload()));
  root.querySelectorAll('[data-view]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.dataset.view); }));
  navigate(location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'overview');
}

function navigate(view) {
  location.hash = view;
  document.querySelectorAll('.admin-nav [data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const main = document.getElementById('adminMain');
  main.textContent = 'Loading…';
  (VIEWS[view] || VIEWS.overview)(main);
}
```

- [ ] **Update `src/admin/main.js` to call `bootAdmin`**

```js
import './styles.css';
import { bootAdmin } from './app.js';

async function init() {
  await window.Clerk.load();
  const signInRoot = document.getElementById('sign-in-root');
  const adminRoot  = document.getElementById('admin-root');
  if (!Clerk.user) { Clerk.mountSignIn(signInRoot); return; }
  signInRoot.hidden = true;
  adminRoot.hidden  = false;
  bootAdmin(adminRoot);
}

window.addEventListener('load', init);
```

- [ ] **Create view placeholders**

```js
// src/admin/views/overview.js
export function initOverview(c) { c.textContent = 'Overview — loading…'; }

// src/admin/views/photos.js
export function initPhotos(c) { c.textContent = 'Photos — loading…'; }

// src/admin/views/inbox.js
export function initInbox(c) { c.textContent = 'Inbox — loading…'; }

// src/admin/views/settings.js
export function initSettings(c) { c.textContent = 'Settings — loading…'; }
```

- [ ] **Add layout styles to `src/admin/styles.css`**

```css
.admin-layout { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }

.admin-nav {
  background: var(--bg2);
  border-right: 1px solid var(--border);
  padding: 1.5rem 1rem;
  display: flex; flex-direction: column; gap: 2rem;
  position: sticky; top: 0; height: 100vh;
}

.admin-brand { font-weight: 600; font-size: 15px; letter-spacing: .03em; }
.admin-brand .mono-k { font-family: 'JetBrains Mono', monospace; color: var(--accent); margin-right: 6px; }

.admin-nav ul { list-style: none; display: flex; flex-direction: column; gap: 2px; }

.admin-nav a {
  display: block; padding: .5rem .75rem; border-radius: 6px;
  color: var(--ink2); text-decoration: none; font-size: 13px;
  transition: background .15s, color .15s;
}
.admin-nav a:hover  { background: rgba(244,241,236,.06); color: var(--ink); }
.admin-nav a.active { background: rgba(255,45,85,.12);   color: var(--accent); }

.sign-out-btn {
  margin-top: auto; background: transparent;
  border: 1px solid rgba(244,241,236,.15); color: var(--ink2);
  padding: .4rem .75rem; border-radius: 6px; cursor: pointer;
  font-size: 12px; font-family: inherit;
}
.sign-out-btn:hover { color: var(--ink); border-color: rgba(244,241,236,.3); }

.admin-main { padding: 2rem; }
.view-title  { font-size: 20px; font-weight: 500; margin-bottom: 1.5rem; }
```

- [ ] **Verify in browser:** Sidebar with four nav links, clicking each shows placeholder text.

- [ ] **Commit**

```bash
git add src/admin/
git commit -m "feat: admin shell with sidebar router and placeholder views"
```

---

## Task 8: View — Overview

- [ ] **Replace `src/admin/views/overview.js`**

```js
import { api } from '../api.js';
import { escHtml } from '../utils.js';

export async function initOverview(c) {
  c.textContent = 'Loading…';
  const [{ photos }, settings] = await Promise.all([api.photos.list(), api.settings.get()]);
  let commissions = [];
  try { commissions = (await api.commissions.list()).commissions; } catch {}
  const newCount = commissions.filter(x => x.status === 'new').length;

  // Derive last 5 activity items from photos + commissions sorted by created_at
  const activity = [
    ...photos.map(p => ({ type: 'photo', label: p.title, date: p.created_at })),
    ...commissions.map(c2 => ({ type: 'commission', label: c2.name + ' (' + (c2.shoot_type || 'request') + ')', date: c2.created_at }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  // Static template — dynamic values escaped via escHtml // nosec
  c.innerHTML =
    '<h2 class="view-title">Overview</h2>' +
    '<div class="stat-grid">' +
      stat(photos.length, 'Total photos') +
      stat(newCount,      'New commissions') +
      stat(settings.availability === 'open' ? 'Open' : 'Closed', 'Status') +
    '</div>' +
    '<label class="toggle-label"><input type="checkbox" id="availCheck"' +
    (settings.availability === 'open' ? ' checked' : '') + '><span>' +
    escHtml(settings.availability_label) + '</span></label>' +
    '<h3 class="activity-heading">Recent activity</h3>' +
    '<ul class="activity-list">' +
    (activity.length
      ? activity.map(a =>
          '<li class="activity-item">' +
            '<span class="activity-badge activity-' + escHtml(a.type) + '">' + escHtml(a.type) + '</span>' +
            '<span class="activity-label">' + escHtml(a.label) + '</span>' +
            '<span class="activity-date">' + escHtml(String(a.date).slice(0, 10)) + '</span>' +
          '</li>'
        ).join('')
      : '<li class="activity-item" style="color:var(--ink2)">No activity yet.</li>') +
    '</ul>';

  document.getElementById('availCheck').addEventListener('change', function () {
    api.settings.update({ availability: this.checked ? 'open' : 'closed' });
  });
}

function stat(v, label) {
  return '<div class="stat-card"><div class="stat-val">' + escHtml(String(v)) + '</div><div class="stat-lab">' + escHtml(label) + '</div></div>';
}
```

- [ ] **Add stat card styles to `src/admin/styles.css`**

```css
.stat-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 1rem; margin-bottom: 2rem; }
.stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem 1.5rem; }
.stat-val  { font-size: 28px; font-weight: 500; margin-bottom: 4px; }
.stat-lab  { font-size: 12px; color: var(--ink2); text-transform: uppercase; letter-spacing: .08em; }

.toggle-label { display: flex; align-items: center; gap: .75rem; cursor: pointer; font-size: 13px; }
.toggle-label input { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; }

.activity-heading { font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: .08em; color: var(--ink2); margin: 2rem 0 .75rem; }
.activity-list { list-style: none; display: flex; flex-direction: column; gap: .4rem; }
.activity-item { display: flex; align-items: center; gap: .75rem; font-size: 13px; padding: .4rem 0; border-bottom: 1px solid var(--border); }
.activity-badge { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
.activity-photo      { background: rgba(255,45,85,.15); color: var(--accent); }
.activity-commission { background: rgba(52,199,89,.12);  color: #34c759; }
.activity-label { flex: 1; color: var(--ink); }
.activity-date  { color: var(--ink2); font-size: 12px; white-space: nowrap; }
```

- [ ] **Verify in browser** — photo count, commission count, availability label, and last 5 activity items display.

- [ ] **Commit**

```bash
git add src/admin/views/overview.js src/admin/styles.css
git commit -m "feat: admin overview view"
```

---

## Task 9: View — Photos

- [ ] **Replace `src/admin/views/photos.js`**

```js
import { api } from '../api.js';
import { uploadPhoto } from '../upload.js';
import { escHtml } from '../utils.js';

export async function initPhotos(c) {
  c.textContent = 'Loading…';
  const { photos } = await api.photos.list();
  renderPhotos(c, photos);
}

function renderPhotos(c, photos) {
  // Static grid shell — nosec
  c.innerHTML =
    '<div class="photos-head">' +
      '<h2 class="view-title" style="margin:0">Photos</h2>' +
      '<label class="upload-btn">+ Upload<input type="file" id="photoInput" accept="image/*" multiple hidden></label>' +
    '</div>' +
    '<div class="upload-drop" id="uploadDrop">Drop images here to upload</div>' +
    '<p id="uploadStatus" class="upload-status" hidden></p>' +
    '<div class="photo-grid" id="photoGrid"></div>';

  const grid = c.querySelector('#photoGrid');
  photos.forEach(p => grid.appendChild(makeCard(p)));

  c.querySelector('#photoInput').addEventListener('change', function () {
    handleFiles(Array.from(this.files), c);
  });

  const drop = c.querySelector('#uploadDrop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag-over'); handleFiles(Array.from(e.dataTransfer.files), c); });

  grid.addEventListener('click', e => {
    const card = e.target.closest('[data-photo-id]');
    if (card && e.target.closest('.photo-delete')) {
      if (confirm('Delete this photo?')) {
        api.photos.remove(card.dataset.photoId).then(() => card.remove());
      }
    }
  });
}

async function handleFiles(files, c) {
  const status = c.querySelector('#uploadStatus');
  status.hidden = false;
  for (const file of files) {
    try {
      const { id, thumbUrl, fullUrl, aspectRatio } = await uploadPhoto(file, msg => { status.textContent = msg; });
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const { id: photoId } = await api.photos.create({ title: name, category: 'portraits', meta: '', thumb_url: thumbUrl, full_url: fullUrl, aspect_ratio: aspectRatio });
      c.querySelector('#photoGrid').prepend(makeCard({ id: photoId || id, title: name, category: 'portraits', thumb_url: thumbUrl }));
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  }
  status.textContent = 'Done.';
  setTimeout(() => { status.hidden = true; }, 2000);
}

function makeCard(p) {
  const div = document.createElement('div');
  div.className = 'photo-card';
  div.dataset.photoId = p.id;
  const img = document.createElement('img');
  img.src = p.thumb_url;
  img.alt = p.title;
  img.loading = 'lazy';
  const info = document.createElement('div');
  info.className = 'photo-card-info';
  const titleEl = document.createElement('span');
  titleEl.className = 'photo-title';
  titleEl.textContent = p.title;
  const catEl = document.createElement('span');
  catEl.className = 'photo-cat';
  catEl.textContent = p.category;
  const del = document.createElement('button');
  del.className = 'photo-delete';
  del.setAttribute('aria-label', 'Delete photo');
  del.textContent = '×';
  info.append(titleEl, catEl);
  div.append(img, info, del);
  return div;
}
```

- [ ] **Add photo grid styles to `src/admin/styles.css`**

```css
.photos-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
.upload-btn  { background: var(--accent); color: #fff; padding: .4rem 1rem; border-radius: 6px; font-size: 13px; cursor: pointer; font-family: inherit; }

.upload-drop {
  border: 1px dashed rgba(244,241,236,.2); border-radius: 8px;
  padding: 1.5rem; text-align: center; font-size: 13px; color: var(--ink2);
  margin-bottom: 1.5rem; transition: border-color .2s, background .2s;
}
.upload-drop.drag-over { border-color: var(--accent); background: rgba(255,45,85,.05); color: var(--accent); }

.upload-status { font-size: 12px; color: var(--ink2); margin-bottom: 1rem; }

.photo-grid { columns: 4; gap: .75rem; }
.photo-card {
  break-inside: avoid; margin-bottom: .75rem; border-radius: 8px; overflow: hidden;
  background: var(--bg2); border: 1px solid var(--border); position: relative;
}
.photo-card img { width: 100%; display: block; }
.photo-card-info { padding: .5rem .75rem; display: flex; flex-direction: column; gap: 2px; }
.photo-title { font-size: 12px; font-weight: 500; }
.photo-cat   { font-size: 11px; color: var(--ink2); }

.photo-delete {
  position: absolute; top: 6px; right: 6px; width: 24px; height: 24px;
  border-radius: 50%; background: rgba(10,10,11,.7); border: none;
  color: var(--ink); font-size: 18px; line-height: 1; cursor: pointer; display: none;
}
.photo-card:hover .photo-delete { display: flex; align-items: center; justify-content: center; }
```

- [ ] **Add drag-to-reorder to `renderPhotos`**

After the `grid.addEventListener('click', ...)` block, add:

```js
  // Drag-to-reorder: HTML5 DnD on the grid
  let dragSrc = null;

  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('[data-photo-id]');
    if (!card) return;
    dragSrc = card;
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });

  grid.addEventListener('dragend', e => {
    const card = e.target.closest('[data-photo-id]');
    if (card) card.classList.remove('dragging');
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('[data-photo-id]');
    if (!card || card === dragSrc) return;
    const cards = Array.from(grid.querySelectorAll('[data-photo-id]'));
    const srcIdx  = cards.indexOf(dragSrc);
    const destIdx = cards.indexOf(card);
    if (srcIdx < destIdx) grid.insertBefore(dragSrc, card.nextSibling);
    else                   grid.insertBefore(dragSrc, card);
  });

  grid.addEventListener('drop', async e => {
    e.preventDefault();
    const cards = Array.from(grid.querySelectorAll('[data-photo-id]'));
    // Persist new order: each card gets sort_order = its new DOM index
    await Promise.all(cards.map((card, idx) =>
      api.photos.update(card.dataset.photoId, { sort_order: idx })
    ));
    dragSrc = null;
  });
```

Also add `draggable="true"` to the `makeCard` function:

```js
// In makeCard, after `div.dataset.photoId = p.id;` add:
div.draggable = true;
```

- [ ] **Add dragging style to `src/admin/styles.css`**

```css
.photo-card.dragging { opacity: .4; }
.photo-grid { cursor: grab; }
```

- [ ] **Verify:** Photos grid loads; drag image onto drop zone → resizes → uploads → appears in grid. Drag a photo card to a new position → releases → reload the page and confirm the new order persists.

- [ ] **Commit**

```bash
git add src/admin/views/photos.js src/admin/upload.js src/admin/styles.css
# utils.js was already committed in Task 5
git commit -m "feat: admin photos view with canvas resize and r2 upload"
```

---

## Task 10: View — Inbox

- [ ] **Replace `src/admin/views/inbox.js`**

```js
import { api } from '../api.js';
import { escHtml } from '../utils.js';

const NEXT  = { new:'seen', seen:'booked', booked:'done', done:'new' };
const LABEL = { new:'New', seen:'Seen', booked:'Booked', done:'Done' };

export async function initInbox(c) {
  c.textContent = 'Loading…';
  const { commissions } = await api.commissions.list();
  renderInbox(c, commissions);
}

function renderInbox(c, list) {
  c.innerHTML = '<h2 class="view-title">Inbox</h2><div id="inboxList" class="inbox-list"></div>'; // nosec
  const ul = c.querySelector('#inboxList');

  if (!list.length) {
    ul.textContent = 'No commission requests yet.';
    return;
  }

  list.forEach(com => {
    const row = document.createElement('div');
    row.className = 'inbox-row border-' + com.status;
    row.dataset.cid = com.id;

    const summary = document.createElement('div');
    summary.className = 'inbox-summary';

    const nameEl    = document.createElement('span'); nameEl.className = 'inbox-name';    nameEl.textContent = com.name;
    const typeEl    = document.createElement('span'); typeEl.className = 'inbox-type';    typeEl.textContent = com.shoot_type || '—';
    const contactEl = document.createElement('span'); contactEl.className = 'inbox-contact'; contactEl.textContent = com.contact;
    const dateEl    = document.createElement('span'); dateEl.className = 'inbox-date';    dateEl.textContent = String(com.created_at).slice(0, 10);
    const btn       = document.createElement('button');
    btn.className = 'status-btn s-' + com.status;
    btn.dataset.status = com.status;
    btn.textContent = LABEL[com.status];

    summary.append(nameEl, typeEl, contactEl, dateEl, btn);

    const detail = document.createElement('div');
    detail.className = 'inbox-detail';

    [['Deadline', com.deadline], ['References', com.refs], ['Notes', com.notes]].forEach(([label, val]) => {
      if (!val) return;
      const p = document.createElement('p');
      const b = document.createElement('b');
      b.textContent = label + ': ';
      p.appendChild(b);
      p.appendChild(document.createTextNode(val));
      detail.appendChild(p);
    });

    row.append(summary, detail);

    summary.addEventListener('click', e => {
      if (e.target === btn) {
        const next = NEXT[btn.dataset.status];
        api.commissions.updateStatus(com.id, next).then(() => {
          btn.dataset.status = next;
          btn.textContent = LABEL[next];
          btn.className = 'status-btn s-' + next;
          row.className = 'inbox-row border-' + next;
        });
      } else {
        row.classList.toggle('expanded');
      }
    });

    ul.appendChild(row);
  });
}
```

- [ ] **Add inbox styles to `src/admin/styles.css`**

```css
.inbox-list { display: flex; flex-direction: column; gap: .5rem; }

.inbox-row {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 8px; overflow: hidden; cursor: pointer;
}
.inbox-row.border-new    { border-left: 3px solid var(--accent); }
.inbox-row.border-seen   { border-left: 3px solid rgba(244,241,236,.3); }
.inbox-row.border-booked { border-left: 3px solid #34c759; }
.inbox-row.border-done   { border-left: 3px solid rgba(244,241,236,.15); }

.inbox-summary {
  display: grid; grid-template-columns: 1fr 1fr 1fr auto auto;
  gap: .75rem; align-items: center; padding: .75rem 1rem; font-size: 13px;
}
.inbox-name    { font-weight: 500; }
.inbox-type, .inbox-contact, .inbox-date { color: var(--ink2); }

.inbox-detail { display: none; padding: 0 1rem 1rem; font-size: 13px; line-height: 1.6; color: rgba(244,241,236,.7); border-top: 1px solid var(--border); }
.inbox-detail p { margin-top: .5rem; }
.inbox-row.expanded .inbox-detail { display: block; }

.status-btn { padding: .25rem .6rem; border-radius: 4px; border: none; font-size: 11px; font-family: inherit; cursor: pointer; font-weight: 500; white-space: nowrap; }
.s-new    { background: rgba(255,45,85,.2);  color: var(--accent); }
.s-seen   { background: rgba(244,241,236,.1); color: var(--ink2); }
.s-booked { background: rgba(52,199,89,.15);  color: #34c759; }
.s-done   { background: rgba(244,241,236,.06); color: rgba(244,241,236,.3); }
```

- [ ] **Verify:** Inbox lists commissions; clicking a row expands detail; clicking the status badge cycles it.

- [ ] **Commit**

```bash
git add src/admin/views/inbox.js src/admin/styles.css
git commit -m "feat: admin inbox view with status cycling"
```

---

## Task 11: View — Settings

- [ ] **Replace `src/admin/views/settings.js`**

```js
import { api } from '../api.js';

export async function initSettings(c) {
  c.textContent = 'Loading…';
  const s = await api.settings.get();

  const h2 = document.createElement('h2');
  h2.className = 'view-title';
  h2.textContent = 'Settings';

  const card = document.createElement('div');
  card.className = 'settings-card';

  const checkRow = document.createElement('div');
  checkRow.className = 'settings-row';
  const labelInfo = document.createElement('div');
  const lbl = document.createElement('div'); lbl.className = 'settings-label'; lbl.textContent = 'Commission availability';
  const hint = document.createElement('div'); hint.className = 'settings-hint'; hint.textContent = 'Controls the badge on the public site';
  labelInfo.append(lbl, hint);

  const checkLabel = document.createElement('label');
  checkLabel.className = 'toggle-switch';
  const check = document.createElement('input');
  check.type = 'checkbox'; check.id = 'availCheck'; if (s.availability === 'open') check.checked = true;
  const track = document.createElement('span'); track.className = 'toggle-track';
  checkLabel.append(check, track);
  checkRow.append(labelInfo, checkLabel);

  const labelRow = document.createElement('div');
  labelRow.className = 'settings-row';
  const lblBadge = document.createElement('label');
  lblBadge.className = 'settings-label'; lblBadge.htmlFor = 'availLabel'; lblBadge.textContent = 'Badge text';
  const input = document.createElement('input');
  input.type = 'text'; input.id = 'availLabel'; input.className = 'settings-input';
  input.value = s.availability_label || ''; input.placeholder = 'Open for July';
  labelRow.append(lblBadge, input);

  const btn = document.createElement('button');
  btn.className = 'save-btn'; btn.textContent = 'Save';
  btn.addEventListener('click', async () => {
    btn.textContent = 'Saving…'; btn.disabled = true;
    await api.settings.update({ availability: check.checked ? 'open' : 'closed', availability_label: input.value.trim() });
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
  });

  card.append(checkRow, labelRow, btn);
  c.innerHTML = '';
  c.append(h2, card);
}
```

- [ ] **Add settings styles to `src/admin/styles.css`**

```css
.settings-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; max-width: 480px; display: flex; flex-direction: column; gap: 1.25rem; }
.settings-row  { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.settings-label { font-size: 13px; font-weight: 500; }
.settings-hint  { font-size: 12px; color: var(--ink2); margin-top: 2px; }
.settings-input { flex: 1; background: rgba(244,241,236,.05); border: 1px solid rgba(244,241,236,.12); border-radius: 6px; padding: .4rem .75rem; color: var(--ink); font-size: 13px; font-family: inherit; }
.save-btn { align-self: flex-start; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: .5rem 1.25rem; font-size: 13px; font-family: inherit; cursor: pointer; }
.save-btn:disabled { opacity: .6; cursor: default; }

.toggle-switch { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-track { position: absolute; inset: 0; background: rgba(244,241,236,.15); border-radius: 22px; transition: background .2s; cursor: pointer; }
.toggle-track::after { content: ''; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--ink); transition: transform .2s; }
.toggle-switch input:checked + .toggle-track { background: var(--accent); }
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }
```

- [ ] **Verify:** Toggle and badge text field work; Save posts to Worker and persists on reload.

- [ ] **Commit**

```bash
git add src/admin/views/settings.js src/admin/styles.css
git commit -m "feat: admin settings view"
```

---

## Task 12: Public Site — Live Gallery + Commission Form

- [ ] **Update `src/data.js`** — add `loadData()` at the bottom, keep static arrays untouched

```js
var WORKER = import.meta.env.VITE_WORKER_URL;

export async function loadData() {
  if (!WORKER) return { shots: SHOTS, cats: CATS };
  try {
    const { photos } = await (await fetch(WORKER + '/api/photos')).json();
    const shots = photos.map(p => ({
      id: p.id, cat: p.category, t: p.title, m: p.meta,
      ar: p.aspect_ratio, thumb: p.thumb_url, full: p.full_url
    }));
    return { shots, cats: CATS };
  } catch {
    return { shots: SHOTS, cats: CATS };
  }
}
```

- [ ] **Update `src/app.js` line 4 — swap static import for async data**

> **How top-level await works here:** `app.js` is an ES module (it uses `import`). Vite fully supports top-level `await` in ES modules — when the JS engine evaluates this module, it pauses at the `await` line until `loadData()` resolves, then continues executing the rest of the file (including the IIFEs below). The IIFEs run synchronously *after* the await resolves, so `SHOTS` is defined by the time any IIFE accesses it. Do NOT move the `await` inside an IIFE — `await` is only valid at the top level of a module, not inside a `(function(){})()`.

```js
// Replace:
import { CATS, SHOTS } from './data.js';

// With:
import { CATS, loadData } from './data.js';
var { shots: SHOTS } = await loadData();
```

- [ ] **Update `src/app.js` gallery builder — use R2 URL when present**

Find the `src="/images/shot-' + i + '.webp"` line inside `SHOTS.forEach` and replace:

```js
// Before:
'src="/images/shot-' + i + '.webp" placeholder="' + catLabel + '"></image-slot>' +

// After:
'src="' + (s.thumb || '/images/shot-' + i + '.webp') + '" placeholder="' + catLabel + '"></image-slot>' +
```

- [ ] **Update lightbox to use full R2 URL**

Inside `openLightbox`, after `lbImg.src = src;`, add:

```js
if (SHOTS[i] && SHOTS[i].full) lbImg.src = SHOTS[i].full;
```

- [ ] **Verify form field `name` attributes match `val()` calls**

The `val(fieldName)` helper in `app.js` reads `form.elements[fieldName].value`. Open `index.html` and confirm these `name` attributes exist exactly as spelled:

| `val()` call | Must match `name=` in `index.html` |
|---|---|
| `val('Name')` | `name="Name"` on `#cf-name` |
| `val('Shoot type')` | `name="Shoot type"` on `#shootTypeInput` |
| `val('Discord or Phone')` | `name="Discord or Phone"` on `#cf-contact` |
| `val('Deadline')` | `name="Deadline"` on `#cf-deadline` |
| `val('References')` | `name="References"` on `#cf-refs` |
| `val('Notes')` | `name="Notes"` on `#cf-notes` |

If any name differs, update the `val()` call to match the actual `name` attribute.

- [ ] **Replace the commission form `setTimeout` in `src/app.js`**

Find and replace (around line 285):

```js
// Before:
/* Backend not wired up yet — shows success after brief delay.
   Replace this with a real fetch() call in phase 2. */
setTimeout(function () { showSuccess(); }, 800);

// After:
var workerUrl = import.meta.env.VITE_WORKER_URL;
if (!workerUrl) { setTimeout(function () { showSuccess(); }, 800); return; }
fetch(workerUrl + '/api/commissions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name:       val('Name'),
    shoot_type: val('Shoot type') || null,
    contact:    val('Discord or Phone'),
    deadline:   val('Deadline')   || null,
    refs:       val('References') || null,
    notes:      val('Notes')      || null
  })
}).then(function (res) {
  if (!res.ok) throw new Error('server error');
  showSuccess();
}).catch(function () {
  btn.disabled = false; btn.classList.remove('loading'); btnLabel.textContent = 'Send the brief';
  alert('Something went wrong. Reach me on Discord: Katiebug515');
});
```

- [ ] **Test public site with Worker running**

```bash
# terminal 1
cd worker && npm run dev

# terminal 2
npm run dev
```

1. Open `http://localhost:5173` — gallery loads (static fallback if Turso is empty)
2. Upload a photo via admin, then reload public site — photo appears from Turso
3. Submit commission form → check `turso db shell katie-portfolio "SELECT name,status FROM commissions ORDER BY created_at DESC LIMIT 1;"` — row present with `status=new`

- [ ] **Commit**

```bash
git add src/data.js src/app.js
git commit -m "feat: public site loads live gallery and submits commissions to worker"
```

---

## Task 13: Deploy

- [ ] **Deploy the Worker**

```bash
cd worker && npm run deploy
```

Copy the deployed Worker URL (e.g. `https://katie-portfolio-worker.your-account.workers.dev`).

- [ ] **Update `.env.local` with production URL**

```
VITE_WORKER_URL=https://katie-portfolio-worker.your-account.workers.dev
```

- [ ] **Production build**

```bash
npm run build
```

Expected: clean build, `dist/index.html` and `dist/admin/index.html` present.

- [ ] **Preview the build**

```bash
npm run preview
```

Check `http://localhost:4173` (public) and `http://localhost:4173/admin/` (admin).

- [ ] **Deploy `dist/` to static host** (Cloudflare Pages, Netlify, or Vercel)

- [ ] **Final acceptance checklist**

- [ ] Public gallery loads photos from Turso
- [ ] Commission form submit saves to Turso + shows success state
- [ ] Admin `/admin/` requires Clerk sign-in
- [ ] Upload a photo → appears in public gallery
- [ ] Delete a photo → removed from gallery + R2
- [ ] Cycle commission status → persists on page reload
- [ ] Availability toggle → updates immediately in settings

- [ ] **Commit**

```bash
git add .env.local
git commit -m "chore: production worker url"
```
