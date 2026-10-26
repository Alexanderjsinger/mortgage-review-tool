"""Builds the self-hosted Node server from worker/lib.js + app.html + review.css.

The banner, imports, config, HTTP adapter and the D1-over-node:sqlite shim are
kept as fragments in build/server-head.js and build/server-tail.js; everything
between them is regenerated from the current sources.

    python3 build/mkserver.py [output path]
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "build")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "mortgage-review-server.js")

head = open(os.path.join(HERE, "server-head.js")).read()
tail = open(os.path.join(HERE, "server-tail.js")).read()
lib = open(os.path.join(ROOT, "worker", "lib.js")).read()
app_html = open(os.path.join(ROOT, "worker", "app.html")).read()
review_css = open(os.path.join(ROOT, "worker", "review.css")).read()

assert lib.count("export function createApp(") == 1, "createApp export not found"
lib_body = lib.replace("export function createApp(", "function createApp(")
assert "export " not in lib_body, "an export survived into the single-file build"

out = (head + "\n" + lib_body.rstrip() + "\n\n"
       + "const APP_HTML = " + json.dumps(app_html) + ";\n"
       + "const REVIEW_CSS = " + json.dumps(review_css) + ";\n"
       + tail)

for once in ("const DAY =", "function createApp(", "const APP_HTML =",
             "const REVIEW_CSS =", "const app = createApp"):
    n = out.count(once)
    assert n == 1, f"{once!r} appears {n} times, expected 1"
# Headers have to be collected before writeHead or Node throws ERR_HTTP_HEADERS_SENT
# and the server dies on sign-in; that bug shipped once.
assert "getSetCookie" in out, "set-cookie handling missing from the HTTP adapter"
assert "import { createServer }" in out, "server imports missing"
assert "DatabaseSync" in out, "sqlite shim missing"

open(OUT, "w").write(out)
print(f"server bytes: {len(out)} = {round(len(out)/1024)} KB -> {OUT}")
