# Phase 2 — Admin Dashboard Design Spec
**Date:** 2026-06-14  
**Project:** Katie Monroe Photography Portfolio (Night City Frames)  
**Scope:** Admin dashboard + backend integration for photo management and commission inbox

---

## 1. Overview

Phase 1 delivered the public-facing site (Vite + Vanilla JS). Phase 2 adds:
- A Clerk-protected admin dashboard at `/admin`
- Live photo management (upload, edit, delete, reorder) backed by Cloudflare R2 + Turso
- Commission request inbox (submissions from the public contact form stored in Turso)
- Dynamic public gallery (replaces static `SHOTS` array with Turso data)
- Availability toggle that updates the "Open for July" badge on the public site

---

## 2. Stack

| Layer | Service | Free tier |
|---|---|---|
| Images | Cloudflare R2 | 10 GB storage, no egress fees |
| Presigned URLs | Cloudflare Worker | 100K requests/day |
| Database | Turso (libSQL) | 500 databases, 9 GB storage |
| Auth | Clerk | 10K MAU per app |
| Bundler | Vite (existing) | — |

---

## 3. Architecture

Admin lives as a **second Vite entry point** inside the existing repo. The public site is untouched except for `src/data.js`, which gains a fetch path for live data. All database access goes through the Cloudflare Worker — Turso credentials never reach the browser.

```
/
├── index.html                  ← public site (unchanged entry)
├── admin/
│   └── index.html              ← admin entry (Clerk-protected)
├── src/
│   ├── styles.css              ← public styles (unchanged)
│   ├── data.js                 ← updated: fetches /api/photos from Worker
│   ├── app.js                  ← public app (unchanged)
│   ├── image-slot.js           ← unchanged
│   ├── main.js                 ← unchanged
│   └── admin/
│       ├── main.js             ← admin entry: init Clerk, boot app
│       ├── app.js              ← routing, view rendering, state
│       ├── api.js              ← all Worker fetch calls (auth-gated)
│       ├── upload.js           ← client-side resize + R2 upload logic
│       └── styles.css          ← admin-specific styles (extends CSS vars)
├── worker/
│   └── index.js                ← Cloudflare Worker: all API routes
└── vite.config.js              ← updated: two entry points
```

`vite.config.js` uses `build.rollupOptions.input` to produce two separate bundles. Admin JS is never included in the public bundle.

---

## 4. Data Model

### Turso database: `katie_portfolio`

**`photos` table**
```sql
CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  meta        TEXT NOT NULL,
  thumb_url   TEXT NOT NULL,
  full_url    TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`commissions` table**
```sql
CREATE TABLE commissions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  shoot_type  TEXT,
  contact     TEXT NOT NULL,
  deadline    TEXT,
  refs        TEXT,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Status values: `new` → `seen` → `booked` → `done`

**`settings` table**
```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Seed:
INSERT INTO settings VALUES ('availability', 'open');
INSERT INTO settings VALUES ('availability_label', 'Open for July');
```

---

## 5. Cloudflare Worker

The Worker is the sole backend. It handles all API routes — public reads, admin writes, and presigned URL generation. Turso credentials exist only here, never in any browser bundle.

**Routes:**

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/api/photos` | No | Returns all photos ordered by `sort_order` |
| GET | `/api/settings` | No | Returns availability label |
| POST | `/api/commissions` | No | Saves a commission form submission |
| POST | `/api/upload-url` | Yes (Clerk JWT) | Returns presigned R2 PUT URL |
| POST | `/api/photos` | Yes (Clerk JWT) | Saves photo metadata after upload |
| PATCH | `/api/photos/:id` | Yes (Clerk JWT) | Updates title/category/meta/sort_order |
| DELETE | `/api/photos/:id` | Yes (Clerk JWT) | Deletes photo record + R2 objects |
| PATCH | `/api/commissions/:id` | Yes (Clerk JWT) | Updates commission status |
| PUT | `/api/settings` | Yes (Clerk JWT) | Updates availability label |

**Auth:** Routes marked "Yes" verify the Clerk session JWT by fetching Clerk's JWKS endpoint (`https://clerk.your-domain.com/.well-known/jwks.json`) and validating the `Authorization: Bearer <token>` header. Unauthenticated requests to protected routes receive `401`.

**Presigned URL:** `POST /api/upload-url` generates a presigned R2 PUT URL (15-minute expiry). Request body: `{ filename: string, contentType: string }`. Response: `{ uploadUrl: string, publicUrl: string }`.

R2 bucket structure:
```
photos/thumb/<uuid>.webp
photos/full/<uuid>.webp
```

Public R2 bucket URL (r2.dev subdomain or custom domain) is stored as a Worker env var.

---

## 6. Upload Flow

Client-side image processing before any network call:

1. User selects or drops image file(s) in the admin Photos view
2. `upload.js` calls `createImageBitmap(file)` to decode the image
3. Canvas API resizes to two versions:
   - **Thumb:** 800px wide, maintaining aspect ratio, exported as WebP (quality 0.82)
   - **Full:** 1920px wide, maintaining aspect ratio, exported as WebP (quality 0.88)
4. For each version, call the Cloudflare Worker (`POST /upload-url`) → get presigned URL
5. `fetch(presignedUrl, { method: 'PUT', body: blob })` uploads directly to R2
6. `api.js` writes the photo record (both URLs + metadata) to Turso
7. Admin photo grid updates immediately

---

## 7. Admin Views

All views share a sidebar nav + main content area layout from the existing prototype.

### 7a. Overview
- Total photo count
- Open commission count (status = `new`)
- Last 5 activity items (recent uploads, new commissions)
- Availability toggle (live-updates `settings` table)

### 7b. Photos
- Masonry grid matching public site aesthetic
- Each card: thumb image, title, category badge, edit/delete icons
- Drag-to-reorder updates `sort_order` in Turso
- Upload button → file picker or drag-drop zone → triggers upload flow (§6)
- Edit drawer: title, category, meta text, aspect ratio

### 7c. Inbox
- List of commission submissions, newest first
- Each row: name, shoot type, contact, deadline, status badge
- Click row → expand full detail
- Status cycle button: `new` → `seen` → `booked` → `done`

### 7d. Settings
- Availability toggle (on/off)
- Availability label text field (e.g. "Open for July")
- Save button → writes to `settings` table in Turso

---

## 8. Auth Flow

1. `admin/index.html` loads Clerk JS (CDN script tag in `<head>`)
2. `src/admin/main.js` calls `Clerk.load()` — Clerk reads session from cookie
3. If no session → Clerk renders its `<SignIn>` component (full-page, centered)
4. If session valid → admin app boots
5. All `api.js` calls include the Clerk session token in `Authorization: Bearer <token>` header — verified server-side by the Worker (§5)

The public `index.html` has **zero Clerk code**. No auth overhead on the public site.

---

## 9. Public Site Integration

`src/data.js` gains a dynamic fetch path. On page load it calls `GET /api/photos` on the Worker. No Turso credentials exist in the browser — the Worker holds them server-side. The static `SHOTS` / `CATS` arrays remain as a local dev fallback when `VITE_WORKER_URL` is not set.

```js
// src/data.js (updated)
export async function loadData() {
  const workerUrl = import.meta.env.VITE_WORKER_URL;
  if (!workerUrl) return { shots: SHOTS, cats: CATS };  // local dev fallback
  const res = await fetch(`${workerUrl}/api/photos`);
  return res.json();
}
```

Commission form submit handler in `app.js` replaces the `setTimeout` placeholder with a `POST ${workerUrl}/api/commissions` call.

No Turso or R2 credentials are ever included in the Vite build.

---

## 10. Environment Variables

**Vite (`.env.local`) — safe to bundle, no secrets:**
```
VITE_WORKER_URL=https://katie-worker.your-account.workers.dev
VITE_CLERK_PUBLISHABLE_KEY=pk_...   # publishable = safe to expose
```

**Cloudflare Worker (`wrangler.toml` + `wrangler secret put`) — server-side only, never bundled:**
```
R2_BUCKET=katie-photos
R2_PUBLIC_URL=https://photos.nightcityframes.gg
TURSO_URL=https://katie-portfolio-....turso.io
TURSO_TOKEN=...                     # secret — set via wrangler secret put
CLERK_JWKS_URL=https://...clerk.accounts.dev/.well-known/jwks.json
```

Turso credentials exist only in the Worker. They are never prefixed with `VITE_` and never appear in any browser bundle.

---

## 11. Out of Scope (Phase 2)

- Email notifications on new commission submissions
- Public-facing commission status tracker
- Multiple admin users / roles
- Image tagging / search
- Analytics
- Category management in admin (CATS remain static in `data.js`; editable via admin is phase 3)

---

## 12. Acceptance Criteria

- [ ] Admin `/admin` route requires Clerk sign-in; redirects unauthenticated users
- [ ] Uploading a photo creates two R2 objects (thumb + full) and a Turso record
- [ ] Gallery cards on the public site load from Turso, not the static array
- [ ] Reordering photos in admin updates public gallery order
- [ ] Commission form on public site writes to Turso `commissions` table
- [ ] Inbox shows all submissions; status can be cycled per row
- [ ] Availability toggle updates the badge text on the public site
- [ ] Public site has no Clerk or admin JS in its bundle
