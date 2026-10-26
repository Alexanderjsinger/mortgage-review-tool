"""Builds the single-file Cloudflare Worker from worker/lib.js + app.html + review.css.

Lives in the package, not in scratch: a recycled container took the previous
copy of this script with it.

    python3 build/mkworker.py [output path]
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "mortgage-review-worker.js")

lib = open(os.path.join(ROOT, "worker", "lib.js")).read()
app_html = open(os.path.join(ROOT, "worker", "app.html")).read()
review_css = open(os.path.join(ROOT, "worker", "review.css")).read()

# The library is written as a module; the single-file build has no imports.
assert lib.count("export function createApp(") == 1, "createApp export not found"
lib_body = lib.replace("export function createApp(", "function createApp(")
assert "export " not in lib_body, "an export survived into the single-file build"

HEADER = '''// ============================================================================
//  Mortgage Review  —  the complete app in one file.
//
//  1. Change the password on the line below.
//  2. Paste this whole file into a Cloudflare Worker and deploy.
//  3. In that Worker: Settings -> Bindings -> Add -> D1 database.
//     Pick your database and name the binding exactly  DB
//
//  No terminal, no build step. Until the D1 binding is added the app runs and
//  builds reviews, it just cannot save client links yet.
// ============================================================================

// ---- CHANGE THIS -----------------------------------------------------------
const SIGN_IN_PASSWORD = "change-me-before-you-deploy";
// ----------------------------------------------------------------------------

// Signs your sign-in cookie. Already random; leave it alone.
const SESSION_SECRET = "d89184a5d3d517b13a28eab659376aa378384d2653c18bcec3cb15e87dc23af1";

// Shown on the call bar of client share pages.
const ADVISOR = { name: "Alex Singer", phone: "248-942-4743" };
'''

FOOTER = '''
const app = createApp({ appHtml: APP_HTML, reviewCss: REVIEW_CSS, advisor: ADVISOR });

export default {
  fetch(request, env, ctx) {
    // Dashboard secrets win if you ever add them; otherwise the constants above
    // are used, so the app needs nothing but the D1 binding.
    const settings = { ADVISOR_PASSWORD: SIGN_IN_PASSWORD, SESSION_SECRET, ...env };
    return app.fetch(request, settings, ctx);
  },
};
'''

out = (HEADER + "\n" + lib_body.rstrip() + "\n\n\n"
       + "const APP_HTML = " + json.dumps(app_html) + ";\n"
       + "const REVIEW_CSS = " + json.dumps(review_css) + ";\n"
       + FOOTER)

# A patch-based build once duplicated the whole library into the head of the
# file and nothing noticed, so every anchor is asserted to appear exactly once.
for once in ("const DAY =", "function createApp(", "const APP_HTML =",
             "const REVIEW_CSS =", "export default {", "const SIGN_IN_PASSWORD ="):
    n = out.count(once)
    assert n == 1, f"{once!r} appears {n} times, expected 1"
assert "SIGN_IN_PASSWORD" in out and "change-me-before-you-deploy" in out, "password placeholder missing"

open(OUT, "w").write(out)
print(f"worker: {round(len(out)/1024)} KB  — no duplicate definitions -> {OUT}")
