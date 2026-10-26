// End-to-end against the self-hosted build: sign in, build a review, issue a
// client link, open it as the client would, then revoke it. This is the path a
// demo actually walks, and it exercises the worker core, the sqlite shim, the
// HTTP adapter and the client stylesheet all at once.
//
//     node test/browser/server.mjs
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { join } from 'path';
import { launch, openApp, checker, ROOT } from './harness.mjs';
import { SCENARIOS, buildScenario } from './scenarios.mjs';

const PORT = Number(process.env.PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `/tmp/review-e2e-${process.pid}.db`;
const PASSWORD = 'e2e-local-password';

const server = spawn(process.execPath, [join(ROOT, 'mortgage-review-server.js')], {
  env: { ...process.env, PORT: String(PORT), DB_FILE: DB,
         ADVISOR_PASSWORD: PASSWORD, SESSION_SECRET: 'e2e-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', d => serverLog.push(String(d)));
server.stderr.on('data', d => serverLog.push(String(d)));

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + '/', { redirect: 'manual' }); if (r.status) return true; }
    catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

const t = checker('self-hosted server, client link end to end');
let browser;
try {
  if (!await waitForServer()) {
    t.fail('server never came up: ' + serverLog.join('').slice(0, 300));
  } else {
    browser = await launch();
    const pg = await openApp(browser, { url: BASE + '/' });

    if (await pg.locator('input[type=password]').count()) {
      await pg.fill('input[type=password]', PASSWORD);
      await pg.click('button[type=submit]');
      await pg.waitForTimeout(800);
    }
    t.ok('should be signed in and on the intake', await pg.locator('#generateBtn').count() > 0);

    await buildScenario(pg, SCENARIOS.find(s => s.n === 'escrow waived cash-out'), 'Mike');
    t.ok('review should generate on the server build',
      !(await pg.evaluate(() => document.getElementById('previewScreen').hidden)));

    await pg.click('#shareCreate');
    await pg.waitForTimeout(1800);
    const link = await pg.evaluate(() => {
      const i = document.getElementById('shareUrl');
      if (i && i.value) return i.value;
      return (document.getElementById('shareMsg') || {}).textContent || '';
    });
    const url = String(link).match(/https?:\/\/\S+/)?.[0];
    t.ok(`no client link was issued: ${link}`, !!url);

    if (url) {
      // A clean context: the client has no session cookie.
      const ctx = await browser.newContext({ viewport: { width: 1040, height: 1400 } });
      const cp = await ctx.newPage();
      const cerr = [];
      cp.on('pageerror', e => cerr.push(String(e)));
      cp.on('console', m => { if (m.type() === 'error') cerr.push(m.text()); });
      await cp.goto(url.replace('http://localhost', '127.0.0.1').replace('127.0.0.1', '127.0.0.1'));
      await cp.waitForTimeout(800);
      const d = await cp.evaluate(() => {
        const html = document.documentElement.outerHTML;
        return {
          title: document.querySelector('h1')?.textContent || '',
          sections: [...document.querySelectorAll('.det-sec .det-sec-h b')].map(x => x.textContent.trim()),
          styled: getComputedStyle(document.body).backgroundColor,
          onePager: !!document.querySelector('.op'),
          canvases: document.querySelectorAll('canvas').length,
          notes: document.querySelectorAll('.note').length,
          markupBar: document.querySelectorAll('.markup-bar').length,
          mentionsAI: /claude|anthropic/i.test(html),
          mentionsMarkup: /markupCanvas|markupToggle|setMarkup/.test(html),
          hasPrint: !!document.querySelector('.client-print'),
        };
      });
      t.ok('client page has no review on it', /Review is Ready/i.test(d.title));
      t.eq('client page should carry the four detail sections', d.sections.length, 4);
      t.ok('client page rendered unstyled — review.css did not load',
        d.styled !== 'rgba(0, 0, 0, 0)' && d.styled !== 'transparent');
      t.ok('client page is missing the printable one-pager', d.onePager);
      t.ok('client page should offer printing', d.hasPrint);
      t.eq('markup canvases must never reach a client', d.canvases, 0);
      t.eq('markup notes must never reach a client', d.notes, 0);
      t.eq('the markup toolbar must never reach a client', d.markupBar, 0);
      t.ok('the client page must not mention AI or Claude', !d.mentionsAI);
      t.ok('the client page must not carry markup code', !d.mentionsMarkup);
      t.ok('client page console: ' + cerr.join(' | '), cerr.length === 0);

      // Printing the client page must still be one sheet of paper.
      await cp.setViewportSize({ width: 739, height: 1400 });
      await cp.emulateMedia({ media: 'print' });
      await cp.waitForTimeout(300);
      const h = await cp.evaluate(() => {
        const op = document.querySelector('.op');
        return op ? Math.ceil(op.getBoundingClientRect().height) : null;
      });
      t.ok(`client page prints to ${h}px, over the 983px page`, h !== null && h <= 983);
      await ctx.close();

      // Revoking must actually close the link.
      await pg.click('#shareRevoke');
      await pg.waitForTimeout(1500);
      const after = await fetch(url, { redirect: 'manual' });
      t.ok(`revoked link still answers ${after.status}`, after.status === 404 || after.status === 410);
    }
    t.ok('builder console: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
    await pg.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  try { rmSync(DB, { force: true }); } catch {}
}

process.exit(t.report() ? 0 : 1);
