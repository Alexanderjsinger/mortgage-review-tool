import test from "node:test";
import assert from "node:assert";
import { createApp } from "../worker/lib.js";

/* ---- minimal in-memory D1 mock ---- */
function mockD1() {
  const rows = new Map();
  return {
    _rows: rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.startsWith("INSERT")) {
                const [token, owner, name, payload, created, expires] = args;
                rows.set(token, { token, owner_email: owner, client_name: name, payload, created_at: created, expires_at: expires, revoked_at: null });
              } else if (sql.startsWith("UPDATE")) {
                const [ts, token] = args;
                const r = rows.get(token);
                if (r) r.revoked_at = ts;
              }
              return {};
            },
            async first() {
              const [token, now] = args;
              const r = rows.get(token);
              if (!r || r.revoked_at !== null || r.expires_at <= now) return null;
              return { payload: r.payload, expires_at: r.expires_at };
            },
          };
        },
        async run() { return {}; },       // CREATE TABLE
        async all() { return { results: [...rows.values()] }; },
      };
    },
  };
}

const env = { DB: mockD1(), ADVISOR_PASSWORD: "hunter2", SESSION_SECRET: "test-secret" };
const app = createApp({ appHtml: "<html>ADVISOR_APP</html>", reviewCss: ".sheet{}", advisor: { name: "Alex Singer", phone: "313-373-8355" } });
const BASE = "https://reviews.example.com";

async function login() {
  const res = await app.fetch(new Request(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "hunter2" }),
  }), env);
  assert.equal(res.status, 303);
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie.includes("mr_session="));
  return cookie.split(";")[0];
}

test("unauthenticated root serves the login page, not the app", async () => {
  const res = await app.fetch(new Request(`${BASE}/`), env);
  const body = await res.text();
  assert.ok(body.includes("Advisor sign-in"));
  assert.ok(!body.includes("ADVISOR_APP"));
});

test("wrong password is rejected", async () => {
  const res = await app.fetch(new Request(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "nope" }),
  }), env);
  assert.equal(res.status, 401);
});

test("login grants a session that unlocks the app", async () => {
  const cookie = await login();
  const res = await app.fetch(new Request(`${BASE}/`, { headers: { cookie } }), env);
  assert.ok((await res.text()).includes("ADVISOR_APP"));
});

test("API rejects without a session", async () => {
  const res = await app.fetch(new Request(`${BASE}/api/reviews`, { method: "POST", body: "{}" }), env);
  assert.equal(res.status, 401);
});

test("create link → public share page renders stored review → revoke kills it", async () => {
  const cookie = await login();
  const create = await app.fetch(new Request(`${BASE}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ clientName: "Jordan Taylor", sheetHtml: "<header>REVIEW_BODY_MARKER</header>", expiresInDays: 14 }),
  }), env);
  assert.equal(create.status, 200);
  const { token, url } = await create.json();
  assert.ok(token.length > 40);
  assert.ok(url.includes(`/r/${token}`));

  // Public — no cookie needed
  const share = await app.fetch(new Request(url), env);
  assert.equal(share.status, 200);
  const shareBody = await share.text();
  assert.ok(shareBody.includes("REVIEW_BODY_MARKER"));
  assert.ok(shareBody.includes("Print / Save PDF"));
  assert.ok(shareBody.includes('href="tel:3133738355"'));

  // Revoke
  const revoke = await app.fetch(new Request(`${BASE}/api/reviews/${token}`, { method: "DELETE", headers: { cookie } }), env);
  assert.equal(revoke.status, 200);
  const gone = await app.fetch(new Request(url), env);
  assert.equal(gone.status, 404);
});

test("missing client name is rejected; oversized html is rejected", async () => {
  const cookie = await login();
  const noName = await app.fetch(new Request(`${BASE}/api/reviews`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ sheetHtml: "<p>x</p>" }),
  }), env);
  assert.equal(noName.status, 400);
  const tooBig = await app.fetch(new Request(`${BASE}/api/reviews`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ clientName: "X", sheetHtml: "y".repeat(600000) }),
  }), env);
  assert.equal(tooBig.status, 400);
});

test("unknown token 404s politely", async () => {
  const res = await app.fetch(new Request(`${BASE}/r/deadbeefdeadbeef`), env);
  assert.equal(res.status, 404);
  assert.ok((await res.text()).includes("isn't available"));
});

/* ---- home photo: Street View fetched by the worker, key never on the page ---- */
async function createLink(cookie, envWith, extra) {
  const res = await app.fetch(new Request(`${BASE}/api/reviews`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ clientName: "Jordan Taylor", sheetHtml: "<header>X</header>", ...extra }),
  }), envWith);
  return res.json();
}
function stubGoogle(metaStatus) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    if (String(u).includes("/metadata?")) return new Response(JSON.stringify({ status: metaStatus }));
    return new Response("JPEGBYTES", { headers: { "content-type": "image/jpeg" } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("address + key → banner on the share page, photo proxied without exposing the key", async () => {
  const envKey = { ...env, MAPS_API_KEY: "SECRET_MAPS_KEY" };
  const cookie = await login();
  const { token, url } = await createLink(cookie, envKey, { propertyAddress: "  742 Evergreen   Terrace, Detroit, MI " });
  const page = await (await app.fetch(new Request(url), envKey)).text();
  assert.ok(page.includes(`/r/${token}/home.jpg`));
  assert.ok(page.includes("742 Evergreen Terrace, Detroit, MI"));
  assert.ok(!page.includes("SECRET_MAPS_KEY"));

  const g = stubGoogle("OK");
  try {
    const photo = await app.fetch(new Request(`${BASE}/r/${token}/home.jpg`), envKey);
    assert.equal(photo.status, 200);
    assert.equal(await photo.text(), "JPEGBYTES");
    assert.ok(g.calls.every(c => c.includes("key=SECRET_MAPS_KEY")));
  } finally { g.restore(); }
});

test("no Street View coverage → photo 404s and the image itself is never requested", async () => {
  const envKey = { ...env, MAPS_API_KEY: "SECRET_MAPS_KEY" };
  const cookie = await login();
  const { token } = await createLink(cookie, envKey, { propertyAddress: "1 Nowhere Rd" });
  const g = stubGoogle("ZERO_RESULTS");
  try {
    const photo = await app.fetch(new Request(`${BASE}/r/${token}/home.jpg`), envKey);
    assert.equal(photo.status, 404);
    assert.equal(g.calls.length, 1);
  } finally { g.restore(); }
});

test("no key configured or no address → no banner, photo route 404s", async () => {
  const cookie = await login();
  const withAddr = await createLink(cookie, env, { propertyAddress: "742 Evergreen Terrace" });
  assert.ok(!(await (await app.fetch(new Request(withAddr.url), env)).text()).includes("home-banner\""));
  assert.equal((await app.fetch(new Request(`${BASE}/r/${withAddr.token}/home.jpg`), env)).status, 404);
  const envKey = { ...env, MAPS_API_KEY: "K" };
  const noAddr = await createLink(cookie, envKey, {});
  assert.ok(!(await (await app.fetch(new Request(noAddr.url), envKey)).text()).includes("home.jpg"));
});

test("builder preview photo: signed-in only, proxied by address", async () => {
  const envKey = { ...env, MAPS_API_KEY: "SECRET_MAPS_KEY" };
  const photoUrl = `${BASE}/api/home-photo?address=${encodeURIComponent("742 Evergreen Terrace")}`;
  assert.equal((await app.fetch(new Request(photoUrl), envKey)).status, 401);
  const cookie = await login();
  const g = stubGoogle("OK");
  try {
    const photo = await app.fetch(new Request(photoUrl, { headers: { cookie } }), envKey);
    assert.equal(photo.status, 200);
    assert.equal(await photo.text(), "JPEGBYTES");
    assert.ok(g.calls[0].includes("location=742+Evergreen+Terrace"));
  } finally { g.restore(); }
  assert.equal((await app.fetch(new Request(photoUrl, { headers: { cookie } }), env)).status, 404);
});
