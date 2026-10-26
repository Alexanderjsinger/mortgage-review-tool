import os, re, sys
src, dst, ver = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src).read(); o = s

tag = f'<b style="color:#2b615b;">standalone {ver}</b>'
assert s.count(tag) == 1, f"version tag {ver} not found in source"
s = s.replace(tag, f'<b style="color:#2b615b;">mobile {ver} (offline)</b>')
blurb = "Files and option sets save in this browser; client links save to your database."
assert s.count(blurb) == 1, "header blurb not found"
s = s.replace(blurb, "Builds and prints reviews on this device; client links need the deployed app.")
s = s.replace('        <a href="/logout" style="color:#8b95a0;font-size:10px;text-decoration:none;margin-left:6px;">Sign out</a>\n', '')

def replace_handler(text, start_marker, replacement):
    """Cut exactly one handler: from its start to its own closing `});`.
    The old build cut to the next section header, which silently ate whatever
    had been added in between."""
    a = text.index(start_marker)
    end = text.index("\n});\n", a) + len("\n});\n")
    return text[:a] + replacement + text[end:]

s = replace_handler(s, '$("shareCreate").addEventListener("click", async () => {',
 '$("shareCreate").addEventListener("click", () => {\n  $("shareMsg").textContent = "Client links need the deployed app — this offline copy builds and prints reviews only.";\n});\n')
s = replace_handler(s, '$("shareRevoke").addEventListener("click", async () => {',
 '$("shareRevoke").addEventListener("click", () => { resetShareStrip(); });\n')

def replace_function(text, start_marker, replacement):
    """Same idea as replace_handler, for a top-level `function name() {...}`,
    which closes on a bare `}` at column 0 rather than on `});`."""
    a = text.index(start_marker)
    end = text.index("\n}\n", a) + len("\n}\n")
    return text[:a] + replacement + text[end:]

# The links panel reads and writes the backend; the offline copy has none, so
# both request sites are removed rather than left guarded.
s = replace_function(s, 'async function loadLinks() {',
 'function loadLinks() { $("linksPanel").hidden = true; }\n')
s = replace_handler(s, '$("linksBody").addEventListener("click", async e => {',
 '$("linksBody").addEventListener("click", () => {});\n')

# The preview's house photo comes from the worker's /api/home-photo, which an
# offline copy does not have; left in, it would be a failed request per review.
photo = 'if (val("propertyAddress")) $("sheet").insertAdjacentHTML('
assert s.count(photo) == 1, "photo banner not found"
s = s.replace(photo, 'if (false) $("sheet").insertAdjacentHTML(')

# Guarantees about the app's own code are checked before the vendor libraries
# go in, so a library's internals can never satisfy or break them.
assert s != o, "no change"
assert "fetch(" not in s, "network call survived"
for must in ("function runImport", "function inferHeader", "function updateDebtSum", "lastShare",
             "resetShareStrip", "function splitLoan", "prepaidDays", "companyNmls",
             "function solveAnnualRate", "function loadLinks", "titleWork",
             "function detailSections", "function buildPdfBlob", "dlPdf",
             "markupToggle", "function setMarkup", "markup-off", "markupCanvas",
             "freeClear", "currentEscrow", "function countable",
             "escrowMode", "lenderPayment", "function escrowWaiverIssues",
             "directEscrow", "escrowedMonthly", "vaFundingFee", "function purposeRules",
             "loanPosition", "function buildOptions", "function computeWith", "cltv"):
    assert must in s, f"build dropped {must}"

# The offline copy cannot reach a CDN, so the PDF libraries are inlined rather
# than left as script tags that fail silently on a plane.
# Resolved from the package so the build works wherever the repo is checked out.
VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "node_modules")
LIBS = (
    ('<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>',
     f"{VENDOR}/html2canvas/dist/html2canvas.min.js"),
    ('<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>',
     f"{VENDOR}/jspdf/dist/jspdf.umd.min.js"),
)
TAGS = [t for t, _ in LIBS]
for tag, path in LIBS:
    assert s.count(tag) == 1, f"script tag not found: {tag[:60]}"
    body = open(path).read()
    assert "</script" not in body, f"{path} would close the script tag early"
    s = s.replace(tag, "<script>" + body + "\n</script>")

# Checked by exact tag: the libraries' own code contains script-tag and CDN
# strings for code paths this app never calls, so a substring test misfires.
for tag in TAGS:
    assert tag not in s, f"external script tag survived: {tag[:60]}"
assert "html2canvas" in s and "jspdf" in s, "PDF libraries missing from offline build"
open(dst, "w").write(s)
print("mobile built, all required blocks present")
