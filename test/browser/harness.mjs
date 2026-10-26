// Shared browser harness: one place that knows how to open the app, keep the
// console clean, and read figures back off the rendered page.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const APP_URL = 'file://' + join(ROOT, 'worker', 'app.html');
export const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

// The PDF libraries come from cdnjs, which many build environments block. Serve
// them from node_modules instead, so "no console errors" keeps its meaning.
const VENDOR = {
  html2canvas: join(ROOT, 'node_modules/html2canvas/dist/html2canvas.min.js'),
  jspdf: join(ROOT, 'node_modules/jspdf/dist/jspdf.umd.min.js'),
};
export async function vendorRoute(target) {
  await target.route('**/cdnjs.cloudflare.com/**', route => {
    const url = route.request().url();
    const hit = Object.keys(VENDOR).find(k => url.includes(k));
    const f = hit && VENDOR[hit];
    if (!f || !existsSync(f)) return route.abort();
    route.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(f) });
  });
}
export const vendorAvailable = () => Object.values(VENDOR).every(existsSync);

export async function launch() {
  return chromium.launch({ executablePath: CHROMIUM, args: ['--no-proxy-server'] });
}

// A page that records anything the console complains about.
export async function openApp(browser, { width = 1100, height = 1200, url = APP_URL } = {}) {
  const pg = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
  await vendorRoute(pg);
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await pg.goto(url);
  await pg.waitForTimeout(300);
  pg.collectedErrors = errors;
  return pg;
}

export const money = t => Number(String(t == null ? '' : t)
  .replace(/−|–/g, '-').replace(/[^0-9.-]/g, '')) || 0;

// Everything a check might want off a generated review, read once.
export async function readSheet(pg) {
  return pg.evaluate(() => {
    const txt = s => { const e = document.querySelector(s); return e ? e.textContent.trim() : ''; };
    const sec = [...document.querySelectorAll('.det-sec')];
    return {
      reached: !document.getElementById('previewScreen').hidden,
      formError: (() => { const e = document.getElementById('formError');
        return e && e.style.display !== 'none' ? e.textContent.trim() : ''; })(),
      heroValue: txt('.hero-figure .hero-stat:not(.hero-stat-alt) b'),
      heroUnit: txt('.hero-figure .hero-stat:not(.hero-stat-alt) span'),
      heroExtra: (() => { const e = document.querySelector('.hero-stat-alt');
        return e ? { pre: e.querySelector('.hero-pre')?.textContent,
                     val: e.querySelector('b')?.textContent,
                     unit: e.querySelector('span')?.textContent } : null; })(),
      legend: [...document.querySelectorAll('.cmp-legend .cmp-key')].map(x => x.textContent.trim()),
      sections: sec.map(s => ({
        title: s.querySelector('.det-sec-t')?.textContent.trim(),
        headline: s.querySelector('.det-sec-h b')?.textContent.trim(),
        rows: [...s.querySelectorAll('.det-row')].map(r =>
          [r.querySelector('dt').textContent.trim(), r.querySelector('dd').textContent.trim()]),
      })),
      detRows: Object.fromEntries([...document.querySelectorAll('.det-row')].map(r =>
        [r.querySelector('dt').textContent.trim(), r.querySelector('dd').textContent.trim()])),
      tables: [...document.querySelectorAll('.cred')].map(s => ({
        title: s.querySelector('h2')?.textContent.trim(),
        names: [...s.querySelectorAll('tbody tr')].map(r => r.cells[0].textContent.trim()),
        pays: [...s.querySelectorAll('tbody tr')].map(r => r.cells[2].textContent.trim()),
        bals: [...s.querySelectorAll('tbody tr')].map(r => r.cells[1].textContent.trim()),
        foot: [...s.querySelectorAll('tfoot td')].map(td => td.textContent.trim()),
      })),
      note: txt('.det-note'), opNote: txt('.op-note'),
      advisor: txt('.advisor'), footer: txt('.sheet-footer'),
      title: txt('.client-review-sheet header h1'),
      onePager: (() => { const op = document.querySelector('.op');
        return op ? { cls: op.className,
          rows: [...op.querySelectorAll('.op-dr')].map(r =>
            [r.querySelector('span').textContent.trim(), r.querySelector('b').textContent.trim()]),
          key: [...op.querySelectorAll('.op-key em')].map(x => x.textContent.trim()),
          closed: document.querySelector('.op-closed')?.textContent.trim() || '',
          text: op.textContent } : null; })(),
    };
  });
}

// A tiny assertion collector so every check reports the same way.
export function checker(label) {
  const fails = [];
  return {
    eq(what, got, want) {
      if (String(got) !== String(want)) fails.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    },
    near(what, got, want, tol = 1) {
      if (Math.abs(Number(got) - Number(want)) > tol) fails.push(`${what}: got ${got}, want ${want} (±${tol})`);
    },
    ok(what, cond) { if (!cond) fails.push(what); },
    fail(what) { fails.push(what); },
    get fails() { return fails; },
    report() {
      if (fails.length) {
        console.log(`FAIL ${label}`);
        fails.forEach(f => console.log('   ' + f));
      } else console.log(`pass ${label}`);
      return fails.length === 0;
    },
  };
}

// The comparison panel is folded shut by default, so its fields are not
// rendered until it is opened. Checks that set option fields open it first.
export async function openCompare(pg) {
  await pg.evaluate(() => {
    const p = document.getElementById('comparePanel');
    if (p) p.open = true;
  });
  await pg.waitForTimeout(120);
}
