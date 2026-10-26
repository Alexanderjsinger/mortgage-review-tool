/* Mortgage Review — standalone worker core.
   Pure app factory: templates injected so this file is unit-testable in Node. */

const DAY = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 30;
const MAX_HTML_BYTES = 500_000;
const MAX_ADDRESS_CHARS = 200;
const STREET_VIEW = "https://maps.googleapis.com/maps/api/streetview";

/* ---------------- sessions (HMAC-signed cookie) ---------------- */
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function makeSession(env) {
  const exp = Date.now() + SESSION_DAYS * DAY;
  const sig = await hmac(env.SESSION_SECRET, String(exp));
  return `${exp}.${sig}`;
}
async function validSession(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)mr_session=([^;]+)/);
  if (!match) return false;
  const [expStr, sig] = match[1].split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  const expected = await hmac(env.SESSION_SECRET, String(exp));
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
function sessionCookie(value, maxAgeSeconds) {
  return `mr_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/* ---------------- helpers ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shared_reviews (
    token TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    client_name TEXT,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`).run();
}

/* ---------------- home photo (Google Street View, fetched server-side) ----------------
   The key stays in the worker: the share page points at /r/<token>/home.jpg on our own
   domain and never sees it. The metadata call is free and comes first, so an address
   with no coverage gets a 404 (the page drops the banner) rather than Google's grey
   "no imagery" tile, and only real photos are billed. */
async function streetViewPhoto(address, key) {
  const params = new URLSearchParams({ location: address, source: "outdoor", key });
  let meta = null;
  try { meta = await (await fetch(`${STREET_VIEW}/metadata?${params}`)).json(); } catch { /* treat as no imagery */ }
  if (!meta || meta.status !== "OK") return null;
  params.set("size", "640x320");
  params.set("fov", "80");
  params.set("return_error_code", "true");
  const res = await fetch(`${STREET_VIEW}?${params}`).catch(() => null);
  if (!res || !res.ok) return null;
  return res;
}

function homeBanner(photoUrl, address) {
  return `<figure class="home-banner">
    <img src="${esc(photoUrl)}" alt="Street view of ${esc(address)}" onerror="this.parentNode.remove()">
    <figcaption>${esc(address)}</figcaption>
  </figure>`;
}

/* ---------------- pages ---------------- */
function loginPage(error = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mortgage Review · Sign in</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f6f3ec; font-family:Arial,Helvetica,sans-serif; }
  form { width:min(340px, 90vw); padding:26px 24px; background:#fff; border:1px solid #e3e0d6; border-radius:14px; box-shadow:0 14px 40px rgba(20,38,52,.08); }
  h1 { margin:0 0 4px; color:#102a43; font-size:18px; }
  p { margin:0 0 16px; color:#63717d; font-size:11px; }
  input { width:100%; height:42px; padding:0 12px; border:1px solid #d3d0c5; border-radius:9px; font-size:14px; box-sizing:border-box; }
  button { width:100%; height:42px; margin-top:12px; border:0; border-radius:9px; background:#39766f; color:#fff; font-size:14px; font-weight:800; cursor:pointer; }
  .err { margin:10px 0 0; color:#9c3a25; font-size:11px; }
</style></head><body>
<form method="POST" action="/login">
  <h1>Mortgage Review Builder</h1>
  <p>Advisor sign-in</p>
  <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Sign in</button>
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
</form></body></html>`;
}

function notFoundPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Review unavailable</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ec;font-family:Arial,Helvetica,sans-serif;color:#102a43;}div{text-align:center;padding:20px;}h1{font-size:20px;margin:0 0 8px;}p{color:#63717d;font-size:12px;margin:0;}</style>
</head><body><div><h1>This review link isn't available.</h1><p>It may have expired or been replaced. Contact your advisor for a fresh review.</p></div></body></html>`;
}

function shareShell({ reviewCss, sheetHtml, payload, expiresAt, advisorPhone, advisorName, bookingUrl, photoUrl }) {
  const expires = new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const tel = String(advisorPhone || "").replace(/\D/g, "");
  const first = esc((advisorName || "your advisor").split(" ")[0]);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Mortgage Review</title>
<meta name="robots" content="noindex">
<style>
  * { box-sizing: border-box; }
  html, body { margin:0; overscroll-behavior:none; }
  body { background:#f4f3f5; color:#1f2d38; font-family:Arial,Helvetica,sans-serif; -webkit-font-smoothing:antialiased; }
  button { font:inherit; cursor:pointer; }
${reviewCss}
  .client-review-page { background: #f4f3f5; }
  .home-banner { position: relative; margin: 0; height: 240px; background: var(--navy); overflow: hidden; }
  .home-banner img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .home-banner figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 40px 42px 14px; background: linear-gradient(to top, rgba(16,42,67,.9), rgba(16,42,67,0)); color: #fff; font-size: 13px; font-weight: 700; letter-spacing: .01em; }
  .contactbar { display: none; }
  @media (max-width: 720px) {
    body { padding-bottom: 72px; }
    .contactbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; display: flex; gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid #e7e5e4; background: #fff; }
    .contactbar a { flex: 1; display: flex; align-items: center; justify-content: center; height: 44px; border: 1px solid #d6d3d1; border-radius: 8px; color: #171717; font: 500 14px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; text-decoration: none; }
    .contactbar a.go { border-color: #1c1c1c; background: #1c1c1c; color: #fff; }
  }
  @media (max-width: 640px) {
    .client-review-page { padding: 12px 10px 24px; }
    .client-review-sheet > header { flex-direction: column; align-items: flex-start; gap: 10px; }
    .advisor { text-align: left; }
  }
  @media print { .client-review-toolbar, .contactbar, .home-banner { display: none !important; } body { background: #fff; padding: 0; } .client-review-page { padding: 0; background: #fff; } .client-review-sheet { box-shadow: none; } }
</style></head><body>
<main class="client-review-page">
  <div class="client-review-toolbar"><span>Private link · expires ${expires}</span><strong>Your Mortgage Review</strong><button class="client-print" onclick="window.print()">Print / Save PDF</button></div>
  <article class="client-review-sheet">
    ${photoUrl ? homeBanner(photoUrl, payload.propertyAddress) : ""}
    ${sheetHtml}
  </article>
</main>
<nav class="contactbar" aria-label="Contact ${first}">
  <a${bookingUrl ? "" : ' class="go"'} href="tel:${tel}">Call</a>
  <a href="sms:${tel}">Text</a>
  ${bookingUrl ? `<a class="go" href="${esc(bookingUrl)}" target="_blank" rel="noopener">Schedule</a>` : ""}
</nav>
</body></html>`;
}

/* ---------------- app factory ---------------- */
export function createApp({ appHtml, reviewCss, advisor = { name: "Alex Singer", phone: "248-942-4743" } }) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (path === "/health") return json({ ok: true });

      // every browser asks for this; answering keeps a stray 404 out of the
      // console on the app and on the client's share page
      if (path === "/favicon.ico") {
        return new Response(null, { status: 204, headers: { "cache-control": "public, max-age=86400" } });
      }

      /* ---- public share pages ---- */
      // Only a live link (not revoked, not expired) serves anything, photo included.
      const liveShare = async token => {
        if (!env.DB) return null;
        let row = null;
        try {
          row = await env.DB.prepare(
            "SELECT payload, expires_at FROM shared_reviews WHERE token = ? AND revoked_at IS NULL AND expires_at > ?",
          ).bind(token, Date.now()).first();
        } catch { /* table missing → treat as not found */ }
        if (!row) return null;
        let payload;
        try { payload = JSON.parse(row.payload); } catch { return null; }
        if (!payload || typeof payload.sheetHtml !== "string") return null;
        return { payload, expiresAt: row.expires_at };
      };

      const photoMatch = path.match(/^\/r\/([a-zA-Z0-9]+)\/home\.jpg$/);
      if (photoMatch && method === "GET") {
        const share = await liveShare(photoMatch[1]);
        const address = share && share.payload.propertyAddress;
        const photo = address && env.MAPS_API_KEY ? await streetViewPhoto(address, env.MAPS_API_KEY) : null;
        if (!photo) return new Response(null, { status: 404 });
        return new Response(photo.body, {
          headers: { "content-type": photo.headers.get("content-type") || "image/jpeg", "cache-control": "private, max-age=3600" },
        });
      }

      const shareMatch = path.match(/^\/r\/([a-zA-Z0-9]+)$/);
      if (shareMatch && method === "GET") {
        const share = await liveShare(shareMatch[1]);
        if (!share) return html(notFoundPage(), 404);
        const { payload } = share;
        return html(shareShell({
          reviewCss, 
          sheetHtml: payload.sheetHtml, 
          payload: payload,
          expiresAt: share.expiresAt,
          advisorPhone: advisor.phone, 
          advisorName: advisor.name,
          bookingUrl: advisor.bookingUrl,
          photoUrl: payload.propertyAddress && env.MAPS_API_KEY ? `/r/${shareMatch[1]}/home.jpg` : "",
        }));
      }

      /* ---- auth ---- */
      if (path === "/login" && method === "POST") {
        let password = "";
        const ct = request.headers.get("content-type") || "";
        if (ct.includes("application/json")) password = ((await request.json().catch(() => ({}))).password) || "";
        else password = (await request.formData().catch(() => null))?.get("password") || "";
        if (!env.ADVISOR_PASSWORD || password !== env.ADVISOR_PASSWORD) {
          return html(loginPage("That password isn't right."), 401);
        }
        const session = await makeSession(env);
        return new Response(null, { status: 303, headers: { location: "/", "set-cookie": sessionCookie(session, SESSION_DAYS * 86400) } });
      }
      if (path === "/logout") {
        return new Response(null, { status: 303, headers: { location: "/", "set-cookie": sessionCookie("", 0) } });
      }

      const authed = await validSession(request, env);

      if (path === "/" && method === "GET") {
        return authed ? html(appHtml) : html(loginPage());
      }

      /* ---- advisor API (auth required) ---- */
      if (path.startsWith("/api/")) {
        if (!authed) return json({ error: "Sign in required" }, 401);

        // The builder's preview has no link yet, so it asks for the photo by address.
        if (path === "/api/home-photo" && method === "GET") {
          const address = (url.searchParams.get("address") || "").replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS_CHARS);
          const photo = address && env.MAPS_API_KEY ? await streetViewPhoto(address, env.MAPS_API_KEY) : null;
          if (!photo) return new Response(null, { status: 404 });
          return new Response(photo.body, {
            headers: { "content-type": photo.headers.get("content-type") || "image/jpeg", "cache-control": "private, max-age=3600" },
          });
        }
        if (!env.DB) {
          return json({ error: "No database is connected yet. In the Cloudflare dashboard open this Worker, then Settings, Bindings, Add, D1 database — pick your database and name the binding DB." }, 503);
        }

        if (path === "/api/reviews" && method === "POST") {
          const body = await request.json().catch(() => null);
          if (!body || typeof body !== "object") return json({ error: "Invalid request" }, 400);
          const clientName = String(body.clientName || "").trim().slice(0, 120);
          const sheetHtml = typeof body.sheetHtml === "string" ? body.sheetHtml : "";
          const propertyAddress = String(body.propertyAddress || "").replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS_CHARS);
          if (!clientName) return json({ error: "Add the client name before creating a link." }, 400);
          if (!sheetHtml || sheetHtml.length > MAX_HTML_BYTES) return json({ error: "Review content missing or too large." }, 400);
          const requested = Number(body.expiresInDays);
          const days = Number.isFinite(requested) ? Math.min(30, Math.max(1, Math.round(requested))) : 7;
          await ensureTable(env);
          const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
          const createdAt = Date.now();
          const expiresAt = createdAt + days * DAY;
          
          await env.DB.prepare(
            "INSERT INTO shared_reviews (token, owner_email, client_name, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(token, "advisor", clientName, JSON.stringify({ ...body, propertyAddress, sheetHtml }), createdAt, expiresAt).run();
          return json({ token, url: new URL(`/r/${token}`, request.url).toString(), expiresAt, durationDays: days });
        }

        if (path === "/api/reviews" && method === "GET") {
          await ensureTable(env);
          const rows = await env.DB.prepare(
            "SELECT token, client_name, created_at, expires_at, revoked_at FROM shared_reviews ORDER BY created_at DESC LIMIT 50",
          ).all();
          return json({ reviews: rows?.results || [] });
        }

        const tokenMatch = path.match(/^\/api\/reviews\/([a-zA-Z0-9]+)$/);
        if (tokenMatch && method === "DELETE") {
          await env.DB.prepare("UPDATE shared_reviews SET revoked_at = ? WHERE token = ?")
            .bind(Date.now(), tokenMatch[1]).run();
          return json({ ok: true });
        }

        return json({ error: "Not found" }, 404);
      }

      return html(notFoundPage(), 404);
    },
  };
}
