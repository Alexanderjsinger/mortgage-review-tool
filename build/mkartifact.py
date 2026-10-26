# Builds the hosted test page from worker/app.html. Kept in the package rather
# than in scratch, because a recycled container takes scratch with it.
import re, sys, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'build', 'mortgage-review-artifact.html')
src = open(os.path.join(ROOT, 'worker', 'app.html')).read()
css_body = re.search(r'<style>(.*?)</style>', src, re.S).group(1)
body = re.search(r'<body>(.*?)<script>', src, re.S).group(1)
script = re.search(r'<script>(.*?)</script>\s*</body>', src, re.S).group(1)

LIB_TAGS = re.findall(r'<script src="https://cdnjs\.cloudflare\.com/[^"]+"></script>', src)
assert len(LIB_TAGS) == 2, f"expected 2 library tags, found {len(LIB_TAGS)}"

def sub(s, o, n, label):
    assert s.count(o) == 1, f"{label}: {s.count(o)}"
    print("  ok", label)
    return s.replace(o, n)

# No worker behind the hosted page, so no house photo in its preview.
script = sub(script, 'if (val("propertyAddress")) $("sheet").insertAdjacentHTML(',
  'if (false) $("sheet").insertAdjacentHTML(', 'drop house photo')
body = sub(body, '<div class="share-strip">', '<div class="share-strip" hidden>', 'hide share strip')

script = sub(script,
  '''    const blob = await buildPdfBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = pdfName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    btn.textContent = "Saved";''',
  '''    const blob = await buildPdfBlob();
    const api = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
    if (api) {
      await api.save({ filename: pdfName(), data: new Uint8Array(await blob.arrayBuffer()),
                       mimeType: "application/pdf" });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = pdfName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    btn.textContent = "Saved";''',
  'PDF save -> downloads capability')

page = f'''<title>Mortgage Review Builder</title>
<style>
{css_body}
</style>
{"".join(LIB_TAGS)}
{body}
<script>
{script}
</script>
'''
assert 'html2canvas.min.js' in page and 'jspdf.umd.min.js' in page, 'PDF libraries missing'
assert 'buildPdfBlob' in page and 'directEscrow' in page, 'page content missing'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w').write(page)
print("artifact page:", round(len(page)/1024), "KB ->", OUT)
