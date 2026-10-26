
/* ---------------------------------------------------------------------------
   D1 shim. The app speaks Cloudflare D1's prepare().bind().first()/all()/run();
   node:sqlite speaks get()/all()/run(). This is the whole translation layer.
   --------------------------------------------------------------------------- */
const sqlite = new DatabaseSync(DB_FILE);
sqlite.exec("PRAGMA journal_mode = WAL");

function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const call = (args) => ({
        async first() { const r = stmt.get(...args); return r === undefined ? null : r; },
        async all()   { return { results: stmt.all(...args), success: true }; },
        async run()   { const r = stmt.run(...args); return { success: true, meta: r }; },
        bind(...more) { return call([...args, ...more]); },
      });
      return call([]);
    },
  };
}

const env = { DB: d1(sqlite), ADVISOR_PASSWORD: SIGN_IN_PASSWORD, SESSION_SECRET, MAPS_API_KEY: process.env.MAPS_API_KEY };
const app = createApp({ appHtml: APP_HTML, reviewCss: REVIEW_CSS, advisor: ADVISOR });

/* ---------------------------------------------------------------------------
   Node's http server speaks streams; the app speaks Request/Response.
   --------------------------------------------------------------------------- */
function requestUrl(req) {
  if (PUBLIC_URL) return new URL(req.url, PUBLIC_URL).toString();
  const host = req.headers.host || `localhost:${PORT}`;
  // Respect a reverse proxy telling us the original scheme.
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${host}${req.url}`;
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const request = new Request(requestUrl(req), {
      method: req.method,
      headers: req.headers,
      body: await readBody(req),
    });
    const out = await app.fetch(request, env, {});
    const headers = {};
    out.headers.forEach((v, k) => { if (k.toLowerCase() !== "set-cookie") headers[k] = v; });
    // Several Set-Cookie headers have to go as an array, and every header has to
    // be in place before writeHead — setHeader after it throws.
    const cookies = typeof out.headers.getSetCookie === "function" ? out.headers.getSetCookie() : [];
    if (cookies.length) headers["set-cookie"] = cookies;
    const body = Buffer.from(await out.arrayBuffer());
    res.writeHead(out.status, headers);
    res.end(body);
  } catch (e) {
    console.error("request failed:", e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Something went wrong. Check the terminal running this server.");
  }
});

server.listen(PORT, () => {
  if (SIGN_IN_PASSWORD === "change-me-before-you-start") {
    console.log("\n  !! The sign-in password is still the default. Change SIGN_IN_PASSWORD");
    console.log("     near the top of this file, or set ADVISOR_PASSWORD, before using it.\n");
  }
  console.log(`  Mortgage Review running on http://localhost:${PORT}`);
  console.log(`  Database: ${DB_FILE}`);
  if (PUBLIC_URL) console.log(`  Client links will be built as ${PUBLIC_URL}/r/...`);
  console.log("  Press Ctrl+C to stop.\n");
});
