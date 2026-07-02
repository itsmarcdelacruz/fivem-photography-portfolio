# Portfolio Collections and Management Design

**Date:** 2026-07-02  
**Project:** Katie Monroe-Navarro Photography  
**Status:** Approved design, pending implementation plan

## 1. Purpose

Phase 3 will make the portfolio richer for visitors and substantially easier to manage. The public experience will center on curated photo stories while retaining a fast, filterable gallery for visitors who want to browse individual frames.

The admin experience will follow one publishing workflow:

> Upload → organize → curate → publish

This phase establishes the content model needed for later FiveM roleplay immersion. Booking, purchasing, client delivery, and broader commission workflow changes remain a later phase.

## 2. Goals

- Turn related photographs into authored, shareable collections.
- Preserve the existing cinematic visual identity and hero experience.
- Make the complete body of work easier to browse on desktop and mobile.
- Support fast bulk uploads and batch organization.
- Let an administrator preview, order, and publish a collection without editing code.
- Improve mobile usability, keyboard behavior, accessibility, and failure states.
- Extend the current Vite, Cloudflare Worker, Turso, and R2 architecture without a framework rewrite.

## 3. Chosen Product Direction

The public experience will use the **Hybrid Dispatches** direction:

1. The existing cinematic hero remains the opening statement.
2. A featured “Latest Dispatch” introduces the first published collection in administrator-defined order.
3. A collection index gives visitors direct access to other stories.
4. An “All Frames” gallery supports broad exploration with category and collection filters.

This combines the narrative strength of editorial stories with the speed of a traditional portfolio index. Dedicated individual photo pages are not included.

### Alternatives considered

- **Editorial stories only:** strongest storytelling, but too slow for broad browsing.
- **Collection index first:** efficient and familiar, but weakens the dramatic first impression.
- **Hybrid Dispatches:** selected because it supports both discovery modes while preserving the current brand.

## 4. Public Portfolio Experience

### 4.1 Homepage structure

The homepage will contain:

1. Existing cinematic hero.
2. Featured “Latest Dispatch” with cover image, title, short introduction, date or location when present, and frame count.
3. Collection cover grid showing published collections in administrator-defined order.
4. “All Frames” gallery with category and collection filters.
5. Existing About and Commission sections.

Navigation will expose clear destinations for Stories and Frames while retaining About and Contact.
The first published collection by `sort_order` becomes the featured Latest Dispatch, so featuring a different story uses the same collection reordering control rather than a separate setting.

### 4.2 Collection pages

Each published collection receives a shareable route:

`/stories/:slug`

A collection page contains:

- Cover image.
- Title.
- Short introduction.
- Optional event date.
- Optional location.
- Ordered sequence of photographs.
- Optional per-photo captions and metadata.
- Full-screen lightbox access.
- A route back to Stories and All Frames.

The sequence is editorial: its order comes from the collection membership record rather than the photo’s global gallery order.

Unpublished collections must not appear in public lists or resolve through public detail endpoints.

### 4.3 Gallery browsing

The existing masonry gallery remains, with these upgrades:

- Filter by category.
- Filter by collection.
- Reset filters in one action.
- Display the active filter state and visible result count.
- Preserve a useful empty state when no frames match.
- Make captions and expand controls available on touch devices rather than relying on hover.
- Keep the lightbox sequence synchronized with the currently filtered results.

Search and advanced sorting are deferred until the size of the photo library demonstrates a need.

### 4.4 Lightbox

The lightbox will:

- Identify the current title, caption, collection, and position.
- Provide previous and next navigation.
- Provide an optional thumbnail filmstrip for the current collection or filtered result set.
- Support Escape and arrow keys.
- Trap keyboard focus while open.
- Restore focus to the invoking frame when closed.
- Use dialog semantics and meaningful control labels.
- Prevent background interaction while open.
- Provide persistent, touch-friendly controls on small screens.

### 4.5 Responsive and accessible behavior

This phase includes targeted corrections found during the site audit:

- Replace the cramped mobile navigation with a deliberate compact menu.
- Ensure gallery information does not depend on hover.
- Store and render meaningful alt text for portfolio images.
- Add visible keyboard focus states.
- Respect reduced-motion preferences for parallax, tilt, reveals, and lightbox transitions.
- Keep readable contrast and touch targets at least 44 CSS pixels where practical.
- Announce gallery result changes and upload/publish status without relying only on color.

## 5. Admin Publishing Experience

### 5.1 Navigation

The admin dashboard gains a first-class **Collections** view. Existing Overview, Photos, Inbox, Schedule, and Settings behavior remains unless a later implementation plan explicitly consolidates it.

### 5.2 Bulk upload

The Photos workflow will support:

- Multi-file drag and drop or file selection.
- Per-file resize, upload, and metadata status.
- Overall batch progress.
- Retry for individual failed files.
- Cancel before a file begins uploading.
- Likely-duplicate warnings based on a client-computed content hash.
- Optional initial category and collection assignment for the whole batch.
- A completion summary separating successful, failed, and skipped files.

One failed item must not discard successful items or force the whole batch to restart.

### 5.3 Collection management

Administrators can:

- Create a collection.
- Edit title, slug, introduction, date, and location.
- Choose or replace a cover photo.
- Add existing photos.
- Remove photos without deleting the underlying photo.
- Drag photos into editorial order.
- Preview the public collection.
- Toggle published or unpublished.
- Reorder collection covers on the public homepage.
- Delete a collection without deleting its photos.

Slugs are generated from titles but remain editable. The admin must reject duplicate or invalid slugs before saving.

### 5.4 Photo management

The Photos view will support:

- Multi-select.
- Batch category changes.
- Batch collection assignment or removal.
- Batch visibility changes.
- Batch deletion with explicit confirmation.
- Inline editing for title, caption, alt text, and camera or stylistic metadata.
- Global gallery reordering.
- Clear saved, saving, failed, and unsaved states.

Photo deletion must warn when the photo is used as a collection cover or belongs to one or more collections.

### 5.5 Publishing model

Collections use a simple `published` boolean. Scheduling is explicitly excluded.

Preview is available to an authenticated administrator even when a collection is unpublished. Public endpoints never return unpublished collections.

## 6. Data Model

### 6.1 Collections

```sql
CREATE TABLE collections (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  introduction    TEXT NOT NULL DEFAULT '',
  location        TEXT,
  event_date      TEXT,
  cover_photo_id  TEXT,
  is_published    INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL
);
```

### 6.2 Collection membership

```sql
CREATE TABLE collection_photos (
  collection_id  TEXT NOT NULL,
  photo_id       TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  caption        TEXT,
  PRIMARY KEY (collection_id, photo_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);
```

The join table allows a photo to appear in multiple collections with collection-specific ordering and captions.

### 6.3 Photo additions

The existing `photos` table gains:

```sql
ALTER TABLE photos ADD COLUMN alt_text TEXT NOT NULL DEFAULT '';
ALTER TABLE photos ADD COLUMN is_published INTEGER NOT NULL DEFAULT 1
  CHECK (is_published IN (0, 1));
ALTER TABLE photos ADD COLUMN content_hash TEXT;
CREATE INDEX photos_content_hash_index
  ON photos(content_hash)
  WHERE content_hash IS NOT NULL;
```

`is_published` controls visibility in the All Frames gallery. Collection endpoints include a photo only when both the collection and photo are published.
Hashes produce duplicate warnings rather than hard rejection because an administrator may intentionally upload the same source image with a different crop or treatment.

## 7. Worker API

### 7.1 Public routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/photos` | Published gallery photos and filter metadata |
| GET | `/api/collections` | Published collection summaries in `sort_order` |
| GET | `/api/collections/:slug` | One published collection with ordered published photos |

Unknown or unpublished collection slugs return `404`.

### 7.2 Protected admin routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/collections` | All collections, including unpublished |
| GET | `/api/admin/collections/:id` | Collection editor data |
| POST | `/api/admin/collections` | Create collection |
| PATCH | `/api/admin/collections/:id` | Update metadata or publishing state |
| DELETE | `/api/admin/collections/:id` | Delete collection, retaining photos |
| PUT | `/api/admin/collections/:id/photos` | Replace ordered membership atomically |
| PATCH | `/api/admin/collections/order` | Reorder collection covers |
| PATCH | `/api/admin/photos/batch` | Apply validated batch changes |
| GET | `/api/admin/photos/hash/:hash` | Check for likely duplicate content |

Existing protected photo upload, update, delete, settings, and commission routes remain.

All protected routes continue to verify the Clerk JWT. Batch endpoints validate every requested operation before applying changes and use a database transaction so partial updates do not leave inconsistent ordering.

## 8. Routing and Rendering

The public site remains a Vite application using vanilla JavaScript modules.

- `/` renders the homepage.
- `/stories/:slug` renders a collection page.
- Vercel rewrites story routes to the public entry document.
- The client router reads the current route and mounts the appropriate page module.
- Admin code remains in the separate admin bundle.

Collection links remain usable with JavaScript navigation and direct page loads. Initial social previews continue using the site-wide Open Graph metadata in this phase; collection-specific server-rendered social cards are deferred.

## 9. Image and Upload Flow

The existing client-side WebP generation and direct-to-R2 upload approach remains.

For each selected file:

1. Compute a SHA-256 content hash.
2. Check for an existing hash and warn before upload.
3. Decode and resize thumbnail and full variants.
4. Request protected upload URLs.
5. Upload each variant to R2.
6. Create the photo metadata record.
7. Apply initial category and collection membership.
8. Mark the individual queue item complete.

If metadata creation fails after an R2 upload, the Worker attempts to remove the uploaded objects. If cleanup also fails, the error is logged with the object keys so it can be reconciled later. The UI keeps the queue item in a retryable failed state.

## 10. Error and Empty States

- Public API failures show a restrained retry state rather than silently substituting demo photos in production.
- A collection with no visible photos can be previewed by administrators but cannot be published.
- Missing cover images fall back to the first visible collection photo in public responses.
- Invalid or duplicate slugs are rejected inline.
- Failed batch edits leave the previous server state visible and explain what can be retried.
- Empty collection and gallery views direct the administrator toward upload or assignment.
- Destructive actions name the affected collection or photo count before confirmation.

Static fallback data remains available only for explicit local development.

## 11. Testing and Verification

### 11.1 Worker tests

- Collection create, read, update, publish, unpublish, and delete.
- Public exclusion of unpublished collections and photos.
- Slug uniqueness and invalid slug rejection.
- Ordered membership replacement.
- Cover fallback behavior.
- Collection deletion retains photo records.
- Photo deletion removes membership and clears cover references.
- Batch updates are atomic.
- Duplicate hash behavior.
- Authentication enforcement on every admin route.
- Cleanup behavior after upload metadata failure.

### 11.2 Public application tests

- Home data mapping and featured collection selection.
- Direct loading of `/stories/:slug`.
- Category and collection filter combinations.
- Empty and failed-loading states.
- Lightbox sequencing after filters change.
- Keyboard open, navigation, close, focus trap, and focus restoration.
- Reduced-motion behavior.

### 11.3 Admin tests

- Bulk queue status transitions.
- Retry of one failed item.
- Batch selection and edits.
- Collection validation and publishing rules.
- Photo and collection ordering payloads.
- Unsaved-change protection.

### 11.4 Manual verification

- Desktop and mobile layout review.
- Touch-only gallery and lightbox use.
- Keyboard-only public and admin navigation.
- Direct-route reloads on Vercel preview.
- R2 cleanup after simulated metadata failure.
- Published/unpublished transitions reflected on the public site.

## 12. Delivery Sequence

Implementation planning should divide this phase into bounded increments:

1. Database migration and Worker collection APIs.
2. Admin collection editor.
3. Bulk upload and batch photo management.
4. Public homepage collection sections and story routing.
5. Gallery and lightbox browsing improvements.
6. Responsive, accessibility, failure-state, and regression pass.

Each increment must preserve the existing public gallery and admin photo workflow until its replacement is verified.

## 13. Out of Scope

- Scheduled publishing.
- Individual photo detail pages.
- Full-text or advanced search.
- Dynamic collection-specific Open Graph rendering.
- FiveM lore records, character dossiers, factions, in-world news, or immersive UI systems.
- Payments, packages, purchasing, contracts, proofing, downloads, and client delivery.
- Commission workflow redesign.
- Multiple administrator roles.

These exclusions preserve a focused first phase while leaving the collection model available to support later roleplay and commerce work.

## 14. Acceptance Criteria

- Administrators can upload multiple photos, retry individual failures, and assign the batch to a collection.
- Administrators can create, order, preview, publish, and unpublish collections without code changes.
- Published collections appear on the homepage and at `/stories/:slug`.
- Unpublished collections and photos never appear through public APIs.
- Visitors can browse by story or filter all frames by category and collection.
- Gallery and lightbox controls work with mouse, touch, and keyboard.
- Mobile navigation and gallery information are usable without hover.
- Public failures do not silently show demo content in production.
- Existing admin authentication and public/admin bundle separation remain intact.
- Automated tests cover critical collection, publishing, batch, routing, and accessibility behavior.
