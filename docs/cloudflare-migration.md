# Cloudflare Migration Guide

This project is migrating the frontend from Vercel to Cloudflare Pages. The backend API already runs as a separate Cloudflare Worker and must remain independently deployable.

## Architecture

- Frontend: Cloudflare Pages project `katie-monroe-portfolio`
- Backend API: existing Cloudflare Worker `katie-portfolio-worker`
- Frontend build command: `npm run build`
- Frontend output directory: `dist`
- Frontend runtime configuration: `VITE_WORKER_URL`
- Backend directory: `worker/`

Do not merge the frontend into the backend Worker. Do not rename or redeploy the backend Worker as part of the frontend cutover.

## Wrangler Authentication

Install dependencies and authenticate Wrangler:

```sh
npm install --no-audit --no-fund
npx wrangler login
```

Confirm access:

```sh
npx wrangler whoami
```

## Create the Frontend Pages Project

Create a Cloudflare Pages project named `katie-monroe-portfolio`.

Dashboard path:

1. Open Cloudflare dashboard.
2. Go to Workers & Pages.
3. Select Create application.
4. Select Pages.
5. Import the Git repository.
6. Use the repository root as the project root.
7. Set build command to `npm run build`.
8. Set build output directory to `dist`.
9. Set Node version to `24`.

Wrangler direct-upload alternative:

```sh
npm run build
npx wrangler pages project create katie-monroe-portfolio --production-branch=master
npx wrangler pages deploy dist --project-name katie-monroe-portfolio --branch=preview
```

Use Git integration for normal continuous deployments when possible. Direct Upload is useful for local previews or one-off validation.

## Environment Variables

Set these on the Cloudflare Pages frontend project.

| Name | Environment | Secret | Purpose |
| --- | --- | --- | --- |
| `VITE_WORKER_URL` | Preview | No | Backend Worker URL used by preview frontend builds |
| `VITE_WORKER_URL` | Production | No | Backend Worker URL used by production frontend builds |
| `NODE_VERSION` | Preview and production | No | Pin Pages build Node.js to `24` |

`VITE_WORKER_URL` is public because it is bundled into browser JavaScript. Do not put secrets in any `VITE_` variable.

The backend Worker secrets remain configured only on the existing Worker:

- `TURSO_URL`
- `TURSO_TOKEN`
- `JWT_SECRET`
- `ADMIN_PASSWORD`

Do not copy these secrets into the frontend Pages project.

## Backend Worker CORS

The existing backend Worker supports `ALLOWED_ORIGINS`. After validating the frontend Cloudflare URL and custom domain, manually configure the backend Worker variable:

```text
ALLOWED_ORIGINS=https://katie-monroe-portfolio.pages.dev,https://katiemonroe.mroot.co
```

Adjust preview branch URLs as needed. This is a backend Worker setting and should be changed manually after the Pages deployment is verified.

## Local Development

Frontend Vite dev server:

```sh
npm run dev:frontend
```

Backend Worker dev server, for reference only:

```sh
npm run dev:backend
```

Cloudflare Pages local preview:

```sh
npm run preview:frontend
```

## Preview Deployment

Deploy a preview build:

```sh
npm run deploy:frontend:preview
```

Then test the preview URL before touching production DNS:

- Homepage `/`
- Admin page `/admin/`
- Story route `/stories/<known-slug>`
- Direct refresh on `/stories/<known-slug>`
- Gallery thumbnails and full-resolution images
- Contact form submission
- Admin login and authenticated API requests
- Upload flow
- Settings updates
- Mobile layout
- `robots.txt`
- `sitemap.xml`
- Open Graph image URL
- Security headers and CSP

## Production Deployment

Deploy the frontend to the production Pages project:

```sh
npm run deploy:frontend
```

The direct-upload production command pins `--branch=master` because the Pages project production branch is `master`; otherwise Wrangler treats uploads from feature branches as preview deployments.

This command deploys only the frontend Pages project. The backend reference command is:

```sh
npm run deploy:backend
```

Do not run the backend deploy command during the frontend migration unless you intentionally need to redeploy the existing backend Worker.

## Custom Domain Cutover

Do not perform the domain cutover until the Cloudflare Pages preview URL has been tested.

Manual cutover steps:

1. Keep the existing Vercel deployment live.
2. In Cloudflare Pages, open the `katie-monroe-portfolio` project.
3. Add custom domain `katiemonroe.mroot.co`.
4. Follow Cloudflare's DNS prompt for the required CNAME or proxied DNS record.
5. Wait for SSL certificate provisioning to complete.
6. Visit `https://katiemonroe.mroot.co/` and confirm the Pages deployment responds.
7. Verify the backend Worker requests still succeed through `VITE_WORKER_URL`.
8. Verify `robots.txt`, `sitemap.xml`, canonical URL, JSON-LD URL, Open Graph URL, and Twitter image URL.
9. Verify `/stories/<known-slug>` refreshes directly.
10. Confirm `_headers` are present on frontend responses.
11. Confirm contact form and admin flows work.
12. Set backend Worker `ALLOWED_ORIGINS` to include the final Pages/custom-domain origins.

## Rollback

If a production issue appears after cutover:

1. Leave `vercel.json` and the Vercel project intact.
2. Move the custom-domain DNS record back to the existing Vercel deployment.
3. Confirm `https://katiemonroe.mroot.co/` is served by Vercel again.
4. If backend `ALLOWED_ORIGINS` was tightened, add the Vercel origin back temporarily.
5. Keep the Cloudflare Pages deployment available for investigation.

Do not remove Vercel configuration until the Cloudflare deployment has been stable and fully verified.

## Verification Commands

Run these before production deployment:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run preview:frontend
```

Inspect generated output:

```sh
Get-ChildItem dist -Force
Get-ChildItem dist\images -Force
Select-String -Path dist\**\* -Pattern "TURSO_URL","TURSO_TOKEN","JWT_SECRET","ADMIN_PASSWORD" -SimpleMatch
```

The secret scan should return no matches in generated frontend assets.

## Vercel Compatibility Notes

- `vercel.json` is intentionally retained for rollback.
- Vercel's `/stories/:slug` rewrite is replaced by `public/_redirects` for Cloudflare Pages. The rule targets `/` so Pages serves the app shell without canonicalizing `/index.html` to `/`.
- Existing security headers are retained in `public/_headers`.
- There are no Vercel Functions, Vercel Analytics, Speed Insights, Blob, KV, Postgres, Edge Config, or Cron jobs to migrate.
- Image behavior is preserved: local static WebP assets and R2 URLs returned by the backend Worker.
