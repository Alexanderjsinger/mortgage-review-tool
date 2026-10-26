# Mortgage Review — Standalone

Your Mortgage Review Builder as a self-owned Cloudflare Worker. No platform lock-in:
one worker, one D1 (SQLite) database, password sign-in. Free tier covers this comfortably.

## What's inside

- `worker/app.html` — the advisor app (intake → generated review, drafts autosave in the browser, markup tools, client-link sharing)
- `worker/lib.js` — sessions, review API, public share pages
- `worker/review.css` — the client review design (used by share pages)
- `schema.sql` — the `shared_reviews` table (same shape as the original app)
- `test/worker.test.mjs` — worker unit tests (`npm test`)

## Deploy (one time, ~10 minutes)

Requirements: a free Cloudflare account and Node 18+.

1. `npm install`
2. `npx wrangler login` — opens a browser to authorize your Cloudflare account.
3. `npx wrangler d1 create mortgage-reviews` — copy the printed `database_id`
   into `wrangler.jsonc` (replace `REPLACE_WITH_YOUR_DATABASE_ID`).
4. `npm run db:init` — creates the table in your database.
5. Set your secrets (you'll be prompted for each value):
   - `npx wrangler secret put ADVISOR_PASSWORD` — the password you'll sign in with.
   - `npx wrangler secret put SESSION_SECRET` — any long random string
     (e.g. run `openssl rand -hex 32` and paste the output).
   - Optional — home photo on client links: `npx wrangler secret put MAPS_API_KEY`
     (a Google Maps Platform key with the **Street View Static API** enabled; restrict
     it to that API). Fill in **Property address** in the builder and the client link
     opens with a street-level photo of the home. The worker fetches the photo itself,
     so the key never appears in the page. No coverage or no key means no banner.
     Self-hosted: set `MAPS_API_KEY` in the environment.
6. `npm run deploy` — prints your live URL, e.g. `https://mortgage-review.<you>.workers.dev`.

Optional: attach a custom domain (e.g. `reviews.yourdomain.com`) in the Cloudflare
dashboard under Workers → your worker → Domains & Routes.

## Daily use

- Open your URL → sign in → build a review → **Generate Review** →
  **Create client link** (3/7/14/30-day expiry, 3 days by default) → copy/text it
  to the client.
- **Your client links** below the strip lists every link you've issued, with its
  expiry and whether it's still live, and revokes any of them. The list comes from
  the database, so it survives reloads and new sessions — you can kill a link days
  after you sent it.
- A revoked or expired link stops serving the review from the server, not just in
  the browser: the client gets a plain "not available" page with no figures in it.
- Drafts autosave in your browser as you type. Sample buttons load test scenarios.
- "Print or save PDF" uses the browser's print-to-PDF on both the preview and the
  client's share page.

## Customize

- Your identity and the compliance footer: edit the `ADVISOR` constant near the top
  of the `<script>` in `worker/app.html` (paste broker/state disclosure language
  into `disclosure`). The call-bar name/number on share pages: `worker/index.js`.
- Scheduling link: set `bookingUrl` on `ADVISOR` in `worker/app.html` (the sheet's
  "Schedule a 10-minute review" button) and on `advisor` in `worker/index.js` (the
  Schedule button on the client's phone). Blank shows Text and Call instead.
- Pricing assumptions (closing-cost points, FHA MIP rates) live in the same script,
  clearly labeled.

## Client links carry no third-party branding

A share link is `https://<your worker>/r/<token>` — your own domain once you attach
one under Workers -> Domains & Routes. The page it serves is your sheet, your name
and your NMLS numbers, with nothing identifying the tools used to build it.

## Local development

No Cloudflare account needed — everything runs off a local SQLite file.

```
./start-local.sh
```

Then open http://127.0.0.1:8787. See `LOCAL-LAUNCH.md` for details, the manual
equivalent of these steps, and what does and doesn't work locally.

## Notes on the migration

- This replaces the ChatGPT-hosted Next.js app. Sign-in is now your own password
  (HMAC-signed 30-day session cookie) instead of ChatGPT identity.
- Share links work the same way (tokenized, expiring, revocable) and use the same
  D1 table schema. Links created on the old platform do not carry over.
- The custom jsPDF export was replaced by print-to-PDF of the (nicer) share layout.

## Running the tests

```bash
npm install            # playwright plus the two PDF libraries
npm run test:all       # units, the independent math audit, browser checks, server end to end
```

Individually:

| command | what it covers |
| --- | --- |
| `npm test` | 113 unit tests over the pure calculation and import functions |
| `npm run test:audit` | every scenario recomputed from scratch in `test/browser/audit.py` and compared with the app |
| `npm run test:browser` | page fitting, markup, free and clear, escrow waiver, shortfall, a 31-liability file, reset, phone width, disclosures, the offline build and PDF export |
| `npm run test:server` | signs in to the self-hosted build, issues a client link, opens it as the client and revokes it |

`test/browser/audit.py` deliberately implements the mortgage maths a second
time. It must never import or read the app's JavaScript: that independence is
the point, and it is what has caught the real errors.

Scenarios live in `test/browser/scenarios.mjs` and are shared by the audit and
the browser checks, so a new case is added in one place.

## Rebuilding the distributables

```bash
python3 build/mkworker.py      # mortgage-review-worker.js  (paste into Cloudflare)
python3 build/mkserver.py      # mortgage-review-server.js  (node mortgage-review-server.js)
python3 build-mobile.py worker/app.html mortgage-review-mobile.html v29
python3 build/mkartifact.py    # hosted test page
```

`worker/app.html`, `worker/review.css` and `worker/lib.js` are the only sources;
everything else in the repo root is generated from them.
