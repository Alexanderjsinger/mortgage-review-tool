// Behaviour checks that the independent math audit cannot make: layout that has
// to fit a page, controls that have to toggle, text that has to say the right
// thing, and the paths a demo actually walks.
import { readFileSync } from 'fs';
import { launch, openApp, readSheet, checker, money, APP_URL, ROOT, vendorAvailable, openCompare } from './harness.mjs';
import { SCENARIOS, buildScenario } from './scenarios.mjs';

const byName = n => SCENARIOS.find(s => s.n === n);

// Letter portrait at 96dpi less 0.4in margins: 7.7in wide, 10.24in tall.
const PRINT_W = 739, PRINT_LIMIT = 983;

export async function printFits(browser) {
  const t = checker('one-pager fits a single Letter page');
  for (const s of SCENARIOS) {
    const pg = await openApp(browser, { width: PRINT_W, height: 1400 });
    await buildScenario(pg, s, s.n.slice(0, 12));
    const d = await pg.evaluate(() => {
      const op = document.querySelector('.op');
      if (!op) return null;
      const prev = op.style.display;
      op.style.display = 'block';
      const h = Math.ceil(op.getBoundingClientRect().height);
      op.style.display = prev;
      return { h, cls: op.className, rows: op.querySelectorAll('.op-dr').length };
    });
    if (!d) { t.fail(`${s.n}: no printed page rendered`); await pg.close(); continue; }
    console.log(`   ${s.n.padEnd(24)} ${String(d.rows).padStart(2)} rows  ${d.h}px  ${d.cls}`);
    t.ok(`${s.n}: ${d.h}px exceeds the ${PRINT_LIMIT}px page`, d.h <= PRINT_LIMIT);
    await pg.close();
  }
  return t.report();
}

export async function markupToggle(browser) {
  const t = checker('markup layer toggles without losing work');
  const pg = await openApp(browser);
  await buildScenario(pg, byName('fixed conv cash-out'), 'Mark');
  const state = () => pg.evaluate(() => {
    const vis = s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; };
    const c = document.getElementById('markupCanvas');
    let ink = 0;
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    } catch {}
    return { off: document.body.classList.contains('markup-off'),
      tools: vis('.mode-toggle'), canvas: vis('#markupCanvas'), notesVisible: vis('.note'),
      notes: document.querySelectorAll('.note').length,
      count: document.getElementById('markupCount').hidden ? '' : document.getElementById('markupCount').textContent,
      ink };
  });
  t.ok('markup should start off so a fresh review looks like the client copy', (await state()).off);
  t.ok('tools should be hidden while markup is off', !(await state()).tools);

  await pg.keyboard.press('m'); await pg.waitForTimeout(250);
  t.ok('pressing m should turn markup on', !(await state()).off);

  await pg.click('#modeDraw'); await pg.waitForTimeout(150);
  const box = await pg.locator('#stage').boundingBox();
  await pg.mouse.move(box.x + 120, box.y + 300); await pg.mouse.down();
  for (let i = 0; i < 14; i++) await pg.mouse.move(box.x + 120 + i * 22, box.y + 300 + Math.sin(i) * 18);
  await pg.mouse.up(); await pg.waitForTimeout(250);
  await pg.click('#noteTool'); await pg.waitForTimeout(150);
  await pg.mouse.dblclick(box.x + 430, box.y + 430); await pg.waitForTimeout(300);
  await pg.locator('.note .note-body').last().click();
  await pg.keyboard.type('Check this with Fred');
  await pg.waitForTimeout(200);
  const drawn = await state();
  t.ok('drawing should leave ink on the canvas', drawn.ink > 100);
  t.eq('note created', drawn.notes, 1);

  await pg.click('#markupToggle'); await pg.waitForTimeout(300);
  const demo = await state();
  t.ok('demo mode should hide the canvas', !demo.canvas);
  t.ok('demo mode should hide notes', !demo.notesVisible);
  t.ok('demo mode should hide the tools', !demo.tools);
  t.eq('demo mode must not destroy the note', demo.notes, 1);
  t.ok(`hidden-mark count should report two marks, got ${demo.count}`, /2 marks hidden/.test(demo.count));
  t.ok('must leave draw mode when markup goes off',
    !(await pg.evaluate(() => document.body.classList.contains('drawing'))));

  // Markup is a working layer: it must never reach the client's copy.
  const shareHtml = await pg.evaluate(() => document.getElementById('sheet').innerHTML);
  t.ok('sheet HTML is substantial enough for the leak check to mean anything', shareHtml.length > 500);
  t.ok('markup leaked into the client sheet', !/markupCanvas|note-body|Check this with Fred/.test(shareHtml));

  await pg.keyboard.press('M'); await pg.waitForTimeout(300);
  const back = await state();
  t.eq('ink must survive the toggle', back.ink, drawn.ink);
  t.eq('note must survive the toggle', back.notes, 1);
  const txt = await pg.locator('.note .note-body').last().textContent();
  t.ok(`note text lost: ${txt}`, /Fred/.test(txt));
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function freeAndClear(browser) {
  const t = checker('free and clear');
  const pg = await openApp(browser);
  await buildScenario(pg, byName('free and clear cash-out'), 'Susie');
  const d = await readSheet(pg);
  t.eq('should reach the review with no mortgage', d.reached, true);
  t.eq('form error', d.formError, '');
  const c = await pg.evaluate(() => { const x = compute(); return { esc: Math.round(x.currentEscrow),
    today: Math.round(x.todayTotal), missing: x.mortgageMissing }; });
  t.eq('taxes and insurance become the current cost', c.esc, 550);
  t.eq('today total is that cost', c.today, 550);
  t.eq('a mortgage must no longer be demanded', c.missing, false);
  t.ok('mortgage guard fired on a free-and-clear file',
    await pg.evaluate(() => document.getElementById('mortgageGuard').hidden));
  t.ok(`legend should name the escrow, got ${d.legend.join('|')}`,
    d.legend.some(x => /Taxes and insurance today \$550/.test(x)));
  const today = d.tables[0];
  t.ok('today table should carry a taxes and insurance line',
    today.names.some(x => /Property taxes and insurance/.test(x)));
  t.eq('today table total', today.foot[2], '$550');
  t.ok(`the escrow line is a cost, not an account: ${today.foot[0]}`, !/3 accounts/.test(today.foot[0]));
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();

  // With nothing to pay off, the loan amount cannot be derived and must be asked for.
  const pg2 = await openApp(browser);
  await pg2.evaluate(() => document.querySelectorAll('.debt-row').forEach(r => r.remove()));
  await pg2.check('#freeClear'); await pg2.dispatchEvent('#freeClear', 'input');
  const set = async (id, v) => { await pg2.fill('#' + id, String(v)); await pg2.dispatchEvent('#' + id, 'input'); };
  await set('firstName', 'Susie');
  await pg2.selectOption('#program', 'Conventional'); await pg2.selectOption('#purpose', 'Cash out');
  await set('newRate', '7.25'); await set('estValue', '260000');
  await set('newTaxes', '4800'); await set('newIns', '1800');
  await pg2.waitForTimeout(300);
  await pg2.click('#generateBtn'); await pg2.waitForTimeout(400);
  const err = await pg2.evaluate(() => { const e = document.getElementById('formError');
    return e.style.display === 'none' ? '' : e.textContent; });
  t.ok(`should ask for a loan amount, said: ${err}`, /loan amount/i.test(err));
  await pg2.close();
  return t.report();
}

export async function escrowWaiver(browser) {
  const t = checker('escrow waiver');
  const pg = await openApp(browser);
  const s = byName('escrow waived cash-out');
  // Measure the same file with and without the waiver.
  const plain = { ...s, escrowWaived: false };
  await buildScenario(pg, plain, 'Waiver');
  const before = await pg.evaluate(() => { const x = compute(); return {
    newTotal: Math.round(x.newTotal), afterTotal: Math.round(x.afterTotal), delta: Math.round(x.delta),
    escrowReserve: x.escrowReserve, cash: x.cash }; });
  await pg.click('#backBtn'); await pg.waitForTimeout(250);
  await pg.selectOption('#escrowMode', 'both-waived');
  await pg.waitForTimeout(350);
  const after = await pg.evaluate(() => { const x = compute(); return {
    newTotal: Math.round(x.newTotal), afterTotal: Math.round(x.afterTotal), delta: Math.round(x.delta),
    escrowReserve: x.escrowReserve, cash: x.cash, directEscrow: Math.round(x.directEscrow) }; });

  t.eq('the payment drops by the monthly escrow', after.newTotal, before.newTotal - 650);
  t.eq('escrow moves to the borrower', after.directEscrow, 650);
  t.eq('no reserves are collected', after.escrowReserve, 0);
  t.eq('the released reserve becomes cash', after.cash, before.cash + before.escrowReserve);
  t.eq('what they owe each month must not change', after.afterTotal, before.afterTotal);
  t.eq('a waiver must not shrink the monthly change', after.delta, before.delta);

  await pg.click('#generateBtn'); await pg.waitForTimeout(800);
  const d = await readSheet(pg);
  const payRows = d.sections[1] ? d.sections[1].rows.map(r => r[0]) : [];
  t.ok(`taxes must not sit inside the payment: ${payRows.join('|')}`, !payRows.some(k => /^Taxes/.test(k)));
  t.ok(`legend must disclose the directly paid escrow: ${d.legend.join('|')}`,
    d.legend.some(x => /Taxes and insurance you pay directly \$650/.test(x)));
  t.ok('closing line should read as prepaid interest', 'Prepaid interest' in d.detRows);
  t.ok('sheet note should explain the waiver', /Escrow is waived/.test(d.note));
  t.ok('printed note should explain the waiver', /Escrow is waived/.test(d.opNote));
  t.ok('note must not still claim taxes are included',
    !/payment includes principal, interest, estimated taxes/.test(d.note));

  // Eligibility flags.
  await pg.click('#backBtn'); await pg.waitForTimeout(250);
  const guard = () => pg.evaluate(() => { const e = document.getElementById('escrowGuard');
    return e.hidden ? '' : e.textContent.trim(); });
  const setv = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };
  await setv('loanAmount', '360000'); await pg.waitForTimeout(300);
  t.ok('should flag a conventional waiver above 80% LTV', /80%/.test(await guard()));
  await setv('loanAmount', '260000');
  await pg.selectOption('#program', 'FHA'); await pg.waitForTimeout(300);
  t.ok('should say FHA cannot waive', /FHA loans require an escrow account/.test(await guard()));
  await pg.selectOption('#program', 'Conventional');
  await pg.selectOption('#escrowMode', 'both-escrowed');
  await pg.waitForTimeout(300);
  t.eq('guard must clear when the waiver is off', await guard(), '');
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function shortfall(browser) {
  const t = checker('a loan that does not cover the payoff');
  const pg = await openApp(browser);
  await buildScenario(pg, byName('loan short of payoff'), 'Short');
  const c = await pg.evaluate(() => { const x = compute(); return { short: x.loanShort, cash: x.cash }; });
  t.ok('this file should be short', c.short > 0);
  t.eq('and show no cash back', c.cash, 0);
  const d = await readSheet(pg);
  t.ok('the builder must warn that the loan does not cover the payoffs',
    !(await pg.evaluate(() => document.getElementById('loanMath').hidden)));
  t.ok('the sheet must say money is due from the client, not imply it balances',
    'Cash due from you at closing' in d.detRows);
  t.ok('the printed page must say the same',
    d.onePager.rows.some(([k]) => /Cash due from you at closing/.test(k)));
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function pdfBuilds(browser) {
  const t = checker('PDF export');
  if (!vendorAvailable()) {
    console.log('skip PDF export (run: npm install html2canvas@1.4.1 jspdf@2.5.1)');
    return true;
  }
  for (const name of ['fixed conv cash-out', 'FHA 3/1 ARM rate+term', 'escrow waived cash-out']) {
    const pg = await openApp(browser);
    await buildScenario(pg, byName(name), 'Pdf');
    const dl = pg.waitForEvent('download', { timeout: 45000 });
    await pg.click('#dlPdf');
    let bytes = null;
    try {
      const d = await dl;
      const path = `/tmp/check-${name.replace(/\W+/g, '-')}.pdf`;
      await d.saveAs(path);
      bytes = readFileSync(path);
    } catch (e) { t.fail(`${name}: no PDF was produced (${e.message.split('\n')[0]})`); }
    if (bytes) {
      t.ok(`${name}: not a PDF`, bytes.subarray(0, 5).toString() === '%PDF-');
      const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      t.eq(`${name}: page count`, pages, 1);
    }
    t.ok(`${name} console: ` + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
    await pg.close();
  }
  return t.report();
}

export async function phoneWidth(browser) {
  const t = checker('renders on a phone without horizontal overflow');
  const pg = await openApp(browser, { width: 390, height: 844 });
  // The intake, not just the finished review: the liability row used to blow
  // its grid tracks past the viewport and nothing noticed, because this check
  // only ever looked at the review screen.
  const intake = await pg.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  t.ok(`the intake scrolls sideways on a phone (${intake.scrollW} > ${intake.clientW})`,
    intake.scrollW <= intake.clientW + 1);
  // And with a saved-work menu open over it.
  await pg.evaluate(() => localStorage.setItem('mortgage-review-files-v1', JSON.stringify([
    { id: 'p1', name: 'Phone Test', savedAt: new Date().toISOString(), data: { __shape: 4, debts: [] } }])));
  await pg.reload(); await pg.waitForTimeout(500);
  await pg.click('#filesMenu summary'); await pg.waitForTimeout(300);
  const menuOpen = await pg.evaluate(() => {
    const p = document.querySelector('#filesMenu .menu-panel').getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth,
             clientW: document.documentElement.clientWidth,
             left: Math.round(p.left), right: Math.round(p.right) };
  });
  t.ok(`an open menu scrolls the page sideways (${menuOpen.scrollW} > ${menuOpen.clientW})`,
    menuOpen.scrollW <= menuOpen.clientW + 1);
  t.ok(`the menu panel sits off-screen (${menuOpen.left}..${menuOpen.right} in ${menuOpen.clientW})`,
    menuOpen.left >= -1 && menuOpen.right <= menuOpen.clientW + 1);
  await pg.evaluate(() => { try { localStorage.removeItem('mortgage-review-files-v1'); } catch {} });
  await pg.reload(); await pg.waitForTimeout(400);
  await buildScenario(pg, byName('FHA fixed cash-out'), 'Phone');
  const d = await pg.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    hero: document.querySelector('.hero-figure b')?.textContent,
  }));
  t.ok(`page scrolls sideways on a phone (${d.scrollW} > ${d.clientW})`, !d.overflow);
  t.ok('hero figure missing on a phone', !!d.hero);
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function disclosures(browser) {
  const t = checker('licensing and disclosure text is present');
  const pg = await openApp(browser);
  await buildScenario(pg, byName('FHA fixed cash-out'), 'Disc');
  const d = await readSheet(pg);
  for (const [what, re] of [['MLO NMLS', /NMLS #2726985/], ['company NMLS', /NMLS #1059364/],
                            ['phone', /248-942-4743/]])
    t.ok(`header missing ${what}`, re.test(d.advisor));
  for (const [what, re] of [['not a Loan Estimate', /not a Loan Estimate/i],
                            ['Equal Housing', /Equal Housing Opportunity/],
                            ['consolidation risk', /secures those balances against your home/],
                            ['company NMLS', /NMLS #1059364/]])
    t.ok(`footer missing ${what}`, re.test(d.footer));
  t.ok('estimate footnote missing', /\*Estimated/.test(d.note));
  t.ok('APR footnote missing', /APR is calculated/.test(d.note));
  t.ok('FHA file should disclose the upfront premium',
    /upfront mortgage insurance/i.test(d.note + d.onePager.text));
  // Nothing anywhere may hint at how the sheet was produced.
  const html = await pg.content();
  t.ok('the sheet must not mention AI or Claude', !/claude|anthropic|\bA\.?I\.?\b/i.test(html));
  await pg.close();
  return t.report();
}

export async function offlineBuild(browser) {
  // The offline copy has to work with no network at all: the PDF libraries are
  // inlined rather than fetched, and nothing may reach out.
  const t = checker('offline build works with the network cut');
  const file = ROOT + '/mortgage-review-mobile.html';
  const pg = await browser.newPage({ viewport: { width: 1040, height: 1400 }, acceptDownloads: true });
  const errs = [], blocked = [];
  pg.on('pageerror', e => errs.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.route('**/*', r => {
    if (r.request().url().startsWith('file:')) return r.continue();
    blocked.push(r.request().url());
    return r.abort();
  });
  await pg.goto('file://' + file);
  await pg.waitForTimeout(500);
  const libs = await pg.evaluate(() => ({ h2c: typeof html2canvas, jspdf: !!window.jspdf }));
  t.eq('html2canvas must be inlined', libs.h2c, 'function');
  t.eq('jspdf must be inlined', libs.jspdf, true);
  await buildScenario(pg, byName('fixed conv cash-out'), 'Offline');
  t.ok('offline build should generate a review',
    !(await pg.evaluate(() => document.getElementById('previewScreen').hidden)));
  const dl = pg.waitForEvent('download', { timeout: 45000 });
  await pg.click('#dlPdf');
  try {
    const d = await dl;
    await d.saveAs('/tmp/check-offline.pdf');
    const bytes = readFileSync('/tmp/check-offline.pdf');
    t.ok('offline PDF is not a PDF', bytes.subarray(0, 5).toString() === '%PDF-');
  } catch (e) { t.fail('offline build produced no PDF: ' + e.message.split('\n')[0]); }
  t.eq('the offline copy must not reach the network', blocked.length, 0);
  t.ok('console errors: ' + errs.join(' | '), errs.length === 0);
  await pg.close();
  return t.report();
}

export async function heavyFile(browser) {
  // A big consolidation once printed onto a second page: the density tier only
  // watched the detail list and never saw the liability table.
  const t = checker('a heavy consolidation still prints to one page');
  const pg = await openApp(browser, { width: PRINT_W, height: 1500 });
  await pg.evaluate(() => {
    document.querySelectorAll('.debt-row').forEach(r => r.remove());
    const add = (name, type, bal, pay) => {
      addDebtRow();
      const r = [...document.querySelectorAll('.debt-row')].pop();
      r.querySelector('.d-name').value = name; r.querySelector('.d-type').value = type;
      r.querySelector('.d-bal').value = bal; r.querySelector('.d-pay').value = pay;
      r.querySelector('.d-plan').value = 'payoff';
      r.querySelectorAll('input,select').forEach(e => e.dispatchEvent(new Event('input', { bubbles: true })));
    };
    add('Mortgage', 'mortgage', 210000, 1900);
    for (let i = 1; i <= 30; i++) add('Creditor ' + i, 'card', 400 + i * 37, 15 + i);
  });
  const set = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };
  await set('firstName', 'Heavy');
  await pg.selectOption('#program', 'Conventional'); await pg.selectOption('#purpose', 'Cash out');
  await set('loanAmount', '300000'); await set('newRate', '7'); await set('estValue', '450000');
  await set('newTaxes', '6000'); await set('newIns', '1800');
  await pg.waitForTimeout(500);
  await pg.click('#generateBtn'); await pg.waitForTimeout(900);

  const d = await pg.evaluate(() => {
    const n = x => Number(String(x).replace(/[^0-9.]/g, '')) || 0;
    const op = document.querySelector('.op');
    const prev = op.style.display; op.style.display = 'block';
    const h = Math.ceil(op.getBoundingClientRect().height);
    op.style.display = prev;
    const rowsOf = tbl => [...tbl.querySelectorAll('tbody tr:not(.tot)')]
      .map(r => ({ name: r.cells[0].textContent.trim(), bal: n(r.cells[1].textContent), pay: n(r.cells[2].textContent) }));
    const sheet = rowsOf(document.querySelectorAll('.cred')[0]);
    const paper = rowsOf(op.querySelectorAll('table')[0]);
    const sum = rows => rows.reduce((a, r) => [a[0] + r.bal, a[1] + r.pay], [0, 0]);
    return { h, sheetRows: sheet.length, paperRows: paper.length,
             sheetSum: sum(sheet), paperSum: sum(paper),
             last: paper[paper.length - 1]?.name || '' };
  });
  console.log(`   31 liabilities -> ${d.h}px, ${d.sheetRows} rows on screen, ${d.paperRows} on paper`);
  t.ok(`heavy file prints ${d.h}px, over the ${PRINT_LIMIT}px page`, d.h <= PRINT_LIMIT);
  t.eq('the screen must keep every liability', d.sheetRows, 31);
  t.ok('paper should roll the tail into one line', /plus \d+ more accounts/.test(d.last));
  t.eq('paper balances must still total the full list', d.paperSum[0], d.sheetSum[0]);
  t.eq('paper payments must still total the full list', d.paperSum[1], d.sheetSum[1]);
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function newReviewClears(browser) {
  // One client's review must not survive into the next one, and the toggles are
  // not part of the field list the reset loops over.
  const t = checker('New review leaves nothing of the last client behind');
  const pg = await openApp(browser);
  pg.on('dialog', d => d.accept());
  const s = { ...byName('free and clear cash-out'), escrowMode: 'both-waived' };
  await buildScenario(pg, s, 'FirstClient');
  await pg.click('#backBtn'); await pg.waitForTimeout(250);
  await pg.click('#newReview'); await pg.waitForTimeout(700);
  const d = await pg.evaluate(() => ({
    first: document.getElementById('firstName').value,
    loan: document.getElementById('loanAmount').value,
    freeClear: document.getElementById('freeClear').checked,
    waived: document.getElementById('escrowMode').value,
    sheet: document.getElementById('sheet').innerHTML.trim().length,
    rows: document.querySelectorAll('.debt-row').length,
  }));
  t.eq('name should be cleared', d.first, '');
  t.eq('loan amount should be cleared', d.loan, '');
  t.eq('free-and-clear toggle should reset', d.freeClear, false);
  t.eq('escrow mode should reset', d.waived, 'both-escrowed');
  t.eq("the previous client's rendered review must be gone", d.sheet, 0);
  t.eq('debt rows should be back to one blank row', d.rows, 1);

  // And the next file must build cleanly on top of the reset.
  await buildScenario(pg, byName('fixed conv cash-out'), 'SecondClient');
  t.ok('a second review should generate',
    !(await pg.evaluate(() => document.getElementById('previewScreen').hidden)));
  t.eq('only one printed page should exist',
    await pg.evaluate(() => document.querySelectorAll('.op').length), 1);
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function partialWaiver(browser) {
  // Taxes and insurance can be waived one at a time. Every label has to name
  // which one moved: "taxes and insurance" is wrong when only one did.
  const t = checker('taxes or insurance waived on its own');
  for (const [name, mode, direct, directWord, collectedWord] of [
    ['FHA, taxes waived only', 'taxes-waived', 500, 'Taxes', 'Insurance'],
    ['conv, insurance waived only', 'ins-waived', 175, 'Insurance', 'Taxes'],
  ]) {
    const pg = await openApp(browser);
    await buildScenario(pg, byName(name), 'Partial');
    const c = await pg.evaluate(() => { const x = compute(); return {
      mode: x.escrowMode, direct: Math.round(x.directEscrow),
      escrowed: Math.round(x.escrowedMonthly), reserve: x.escrowReserve,
      payment: Math.round(x.newTotal), after: Math.round(x.afterTotal) }; });
    t.eq(`${name}: mode`, c.mode, mode);
    t.eq(`${name}: the waived half goes to the borrower`, c.direct, direct);
    t.ok(`${name}: the other half must still be escrowed`, c.escrowed > 0);
    t.ok(`${name}: a reserve is still collected on what stays escrowed`, c.reserve > 0);
    t.eq(`${name}: payment plus the direct half is the all-in`, c.payment + c.direct, c.after);

    const d = await readSheet(pg);
    const pay = d.sections.find(s => s.title === 'What you pay monthly');
    const sum = pay.rows.reduce((a, r) => a + money(r[1]), 0);
    t.near(`${name}: payment rows must sum to the headline`, sum, money(pay.headline), 0.5);
    t.ok(`${name}: the payment must name what is collected (${pay.rows.map(r => r[0]).join('|')})`,
      pay.rows.some(r => r[0].startsWith(collectedWord)));
    t.ok(`${name}: the payment must not name the waived half`,
      !pay.rows.some(r => r[0].startsWith(directWord)));
    t.ok(`${name}: the legend must name only the waived half (${d.legend.join('|')})`,
      d.legend.some(x => x.startsWith(`${directWord} you pay directly`)));
    t.ok(`${name}: the note should say the waiver is partial`, /partly waived/.test(d.note));
    t.ok(`${name}: console ` + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
    await pg.close();
  }
  return t.report();
}

export async function programMatrix(browser) {
  // VA was being priced exactly like a conventional loan: no funding fee at
  // all, and its IRRRL was reported as impossible.
  const t = checker('programme handling across Conventional, FHA and VA');
  for (const [name, expectFee, expectNote] of [
    ['VA cash-out, first use', 6450, /VA funding fee/],
    ['VA IRRRL', 1250, /VA funding fee/],
    ['VA rate and term, exempt', 0, null],
    ['FHA fixed cash-out', 0, /Upfront mortgage insurance/],
  ]) {
    const pg = await openApp(browser);
    await buildScenario(pg, byName(name), 'Prog');
    const c = await pg.evaluate(() => { const x = compute(); return {
      fee: x.vaFundingFee, note: x.notePrincipal, loan: x.newLoan, up: x.upfrontMip,
      issues: x.purposeIssues.slice() }; });
    t.eq(`${name}: funding fee`, c.fee, expectFee);
    t.eq(`${name}: the fee rides on the note`, c.note, c.loan + c.up + c.fee);
    const d = await readSheet(pg);
    const costs = d.sections.find(s => s.title === 'What it costs');
    if (expectNote) t.ok(`${name}: the cost section must disclose it (${costs.rows.map(r => r[0]).join('|')})`,
      costs.rows.some(r => expectNote.test(r[0])));
    if (name === 'VA IRRRL') {
      t.eq('a VA IRRRL must not be flagged as impossible', c.issues.length, 0);
      t.ok('a VA IRRRL should be named as one',
        /IRRRL/.test(d.detRows['Loan purpose'] || ''));
    }
    t.ok(`${name}: console ` + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
    await pg.close();
  }
  // A conventional streamline does not exist and must say so.
  const pg = await openApp(browser);
  await buildScenario(pg, { ...byName('conv 5/1 ARM rate+term'), purpose: 'Streamline' }, 'Conv');
  const issues = await pg.evaluate(() => compute().purposeIssues.slice());
  t.ok(`a conventional streamline should be flagged, got ${JSON.stringify(issues)}`,
    issues.some(x => /Only FHA and VA have a streamline/.test(x)));
  await pg.close();
  return t.report();
}

export async function secondLien(browser) {
  // The 2026 case: a first mortgage worth keeping. The tool used to refuse the
  // file outright and tell you the right answer was wrong.
  const t = checker('second lien behind a retained first');
  const pg = await openApp(browser);
  await buildScenario(pg, byName('second lien behind a 3.25% first'), 'Dana');
  const d = await readSheet(pg);
  t.eq('it must generate at all', d.reached, true);
  t.eq('no form error', d.formError, '');
  t.ok('the pay-off-the-mortgage guard must stay quiet',
    await pg.evaluate(() => document.getElementById('mortgageGuard').hidden));

  const c = await pg.evaluate(() => { const x = compute(); return {
    retained: x.retainedFirst, cltv: +x.cltv.toFixed(1), ltv: +x.newLtv.toFixed(1),
    payment: Math.round(x.newTotal), after: Math.round(x.afterTotal),
    today: Math.round(x.todayTotal), delta: Math.round(x.delta),
    escrowed: x.escrowedMonthly, direct: x.directEscrow, reserve: x.escrowReserve }; });
  t.eq('the retained first is counted', c.retained, 310000);
  t.eq('CLTV, not the second against the house alone', c.cltv, 67.3);
  t.ok('the lien-only LTV must not be what gets quoted', c.ltv < 10);
  // The first mortgage still escrows; charging it again would double-count.
  t.eq('a second lien escrows nothing itself', c.escrowed, 0);
  t.eq('and adds no directly-paid escrow', c.direct, 0);
  t.eq('and collects no reserve', c.reserve, 0);
  t.eq('the after total is the second plus the retained first', c.after, c.payment + 1620);
  t.ok('this file should show a saving, not a cost', c.delta > 0);

  const pay = d.sections.find(s => s.title === 'What you pay monthly');
  t.eq('the payment is principal and interest alone', pay.rows.length, 1);
  t.ok('no taxes line on a second lien', !pay.rows.some(r => /^Taxes|^Insurance/.test(r[0])));
  const loan = d.sections.find(s => s.title === 'What the new loan looks like');
  const labels = loan.rows.map(r => r[0]);
  t.ok(`the sheet should name the retained first (${labels.join('|')})`,
    labels.some(x => /first mortgage, unchanged/i.test(x)));
  t.ok('and show the combined loan-to-value', labels.some(x => /Combined loan-to-value/i.test(x)));
  t.ok(`the legend should say the first is unchanged (${d.legend.join('|')})`,
    d.legend.some(x => /First mortgage .* unchanged/.test(x)));
  t.ok('the legend should name the new second lien',
    d.legend.some(x => /New second lien/.test(x)));

  // The retained first has to appear in what they owe after closing.
  const after = d.tables.find(x => /after closing/i.test(x.title));
  t.ok(`the retained first must stay in the After column (${after.names.join('|')})`,
    after.names.some(x => /First mortgage/i.test(x)));
  const sum = after.pays.reduce((a, v) => a + money(v), 0);
  t.near('after rows must sum to the footer', sum, money(after.foot[2]), 1);
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function sideBySideOptions(browser) {
  // A single scenario reads as a pitch; options read as advice. The table also
  // has to tell the truth about a shorter term, which costs more each month and
  // far less overall.
  const t = checker('side-by-side options');
  const pg = await openApp(browser, { width: PRINT_W, height: 1500 });
  await buildScenario(pg, byName('fixed conv cash-out'), 'Opts');

  // With nothing filled in, the client sees one recommendation and no table.
  t.ok('no options block when only one option exists',
    await pg.evaluate(() => !document.querySelector('.opts-table')));

  await pg.click('#backBtn'); await pg.waitForTimeout(250);
  await openCompare(pg);
  await pg.fill('#optALabel', '30-year');
  await pg.fill('#optBLabel', '15-year');
  await pg.selectOption('#optBTerm', '15 years');
  await pg.fill('#optBRate', '6.5');
  await pg.fill('#optCLabel', 'Keep the first');
  await pg.selectOption('#optCPosition', 'second');
  await pg.fill('#optCLoan', '45000');
  await pg.fill('#optCRate', '9.25');
  await pg.waitForTimeout(400);
  await pg.click('#generateBtn'); await pg.waitForTimeout(900);

  const d = await pg.evaluate(() => {
    const read = sel => {
      const tbl = document.querySelector(sel);
      if (!tbl) return null;
      return { heads: [...tbl.querySelectorAll('thead th')].map(x => x.textContent.trim()),
               rows: Object.fromEntries([...tbl.querySelectorAll('tbody tr')]
                 .map(r => [r.cells[0].textContent.trim(), [...r.cells].slice(1).map(c => c.textContent.trim())])) };
    };
    const op = document.querySelector('.op');
    const prev = op.style.display; op.style.display = 'block';
    const h = Math.ceil(op.getBoundingClientRect().height);
    op.style.display = prev;
    return { screen: read('.opts-table'), paper: read('.op-opts'), h,
             details: !!op.querySelector('.op-dl') };
  });

  t.ok('the screen should show an options table', !!d.screen);
  t.ok('the printed page should show it too', !!d.paper);
  t.eq('three options means four columns', d.screen.heads.length, 4);
  t.eq('paper agrees on the columns', d.paper.heads.length, 4);
  t.ok(`the printed page is ${d.h}px, over the ${PRINT_LIMIT}px page`, d.h <= PRINT_LIMIT);
  t.ok('paper swaps the detail list for the comparison', !d.details);

  // A shorter term must not read as simply worse.
  const pay = d.screen.rows['Monthly payment'];
  const interest = d.screen.rows['Interest over the full term'];
  t.ok('the 15-year should cost more each month', money(pay[1]) > money(pay[0]));
  t.ok('and far less over the term, or the table steers the client wrong',
    money(interest[1]) < money(interest[0]));
  t.ok('a second-lien option should be named as one',
    (d.screen.rows['Loan'] || []).some(x => /second lien/i.test(x)));
  // A second lien cannot pay off the first it sits behind.
  const everything = d.screen.rows['Everything you pay monthly'];
  t.ok('the second-lien option must carry the retained first in its monthly total',
    everything && money(everything[2]) > money(pay[2]));

  // Rows identical across every option are noise and should be dropped.
  for (const [label, vals] of Object.entries(d.screen.rows))
    t.ok(`"${label}" is the same for every option and should not be shown`,
      new Set(vals).size > 1);
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function secondLienEdges(browser) {
  // Edges around the second-lien mode that its own happy path does not reach.
  const t = checker('second lien: the cases that would mislead');
  const seed = async (pg, debts) => pg.evaluate(d => {
    document.querySelectorAll('.debt-row').forEach(r => r.remove());
    d.forEach(([n, ty, bal, pay, plan]) => {
      addDebtRow();
      const r = [...document.querySelectorAll('.debt-row')].pop();
      r.querySelector('.d-name').value = n; r.querySelector('.d-type').value = ty;
      r.querySelector('.d-bal').value = bal; r.querySelector('.d-pay').value = pay;
      r.querySelector('.d-plan').value = plan;
      r.querySelectorAll('input,select').forEach(e => e.dispatchEvent(new Event('input', { bubbles: true })));
    });
  }, debts);
  const fill = async (pg, loan, value) => {
    const set = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };
    await set('firstName', 'Second');
    await pg.selectOption('#program', 'Conventional'); await pg.selectOption('#purpose', 'Cash out');
    await set('loanAmount', loan); await set('newRate', '9.25'); await set('estValue', value);
    await set('newTaxes', '5200'); await set('newIns', '1600');
    await pg.waitForTimeout(400);
  };

  // A lien behind nothing is a first mortgage, and its CLTV would be a fiction.
  let pg = await openApp(browser);
  await seed(pg, [['Visa', 'card', 14000, 420, 'payoff']]);
  await pg.selectOption('#loanPosition', 'second');
  await fill(pg, '40000', '520000');
  t.ok('a second lien with no first must be guarded',
    !(await pg.evaluate(() => document.getElementById('mortgageGuard').hidden)));
  await pg.click('#generateBtn'); await pg.waitForTimeout(500);
  t.ok('and must not generate',
    await pg.evaluate(() => document.getElementById('previewScreen').hidden));
  await pg.close();

  // The ceiling test has to run on the combined figure, not the lien alone.
  pg = await openApp(browser);
  await seed(pg, [['First 3.25%', 'mortgage', 390000, 1900, 'keep'], ['Visa', 'card', 14000, 420, 'payoff']]);
  await pg.selectOption('#loanPosition', 'second');
  await fill(pg, '60000', '500000');
  const c = await pg.evaluate(() => { const x = compute(); return {
    ltv: +x.newLtv.toFixed(1), cltv: +x.cltv.toFixed(1), quoted: +x.quotedLtv.toFixed(1),
    issues: x.purposeIssues.slice() }; });
  t.near('the lien on its own is 12%', c.ltv, 12, 0.1);
  t.near('combined is 90%', c.cltv, 90, 0.1);
  t.eq('the quoted figure must be the combined one', c.quoted, c.cltv);
  t.ok(`an 80% cash-out ceiling must be tested against 90% combined, got ${JSON.stringify(c.issues)}`,
    c.issues.some(x => /90\.0%/.test(x)));

  // The retained first must stay in the After column and the column must tie.
  await pg.click('#generateBtn'); await pg.waitForTimeout(800);
  const d = await readSheet(pg);
  const after = d.tables[1];
  t.ok(`the After table must name the new lien (${after.names.join('|')})`,
    after.names.some(x => /second lien/i.test(x)));
  t.ok('the After table must keep the first mortgage',
    after.names.some(x => /First 3\.25/.test(x)));
  t.near('After rows must sum to the After total',
    after.pays.reduce((a, x) => a + money(x), 0), money(after.foot[2]), 1);
  t.ok('the detail must state the combined loan-to-value',
    'Combined loan-to-value' in d.detRows);
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function optionEdges(browser) {
  // The comparison has to agree with the tool pricing the same loan on its own,
  // and must not invent a column that changes nothing.
  const t = checker('options: pricing agrees and empty columns are dropped');
  const pg = await openApp(browser);
  const set = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };
  await pg.evaluate(() => {
    document.querySelectorAll('.debt-row').forEach(r => r.remove());
    addDebtRow();
    const r = document.querySelector('.debt-row');
    r.querySelector('.d-name').value = 'Mortgage'; r.querySelector('.d-type').value = 'mortgage';
    r.querySelector('.d-bal').value = '240000'; r.querySelector('.d-pay').value = '2100';
    r.querySelector('.d-plan').value = 'payoff';
    r.querySelectorAll('input,select').forEach(e => e.dispatchEvent(new Event('input', { bubbles: true })));
  });
  await set('firstName', 'Opt');
  await pg.selectOption('#program', 'Conventional'); await pg.selectOption('#purpose', 'Rate and term');
  await pg.selectOption('#newTerm', '30 years');
  await set('loanAmount', '260000'); await set('newRate', '7.25'); await set('estValue', '400000');
  await set('newTaxes', '6000'); await set('newIns', '1800'); await set('closingCosts', '5500');
  await pg.waitForTimeout(400);

  // A label with nothing changed would be a duplicate of the first column.
  await openCompare(pg);
  await set('optBLabel', 'Just a label');
  await pg.waitForTimeout(300);
  t.eq('a label that changes nothing must not add a column',
    (await pg.evaluate(() => buildOptions().length)), 1);

  await set('optBLabel', '15-year fixed');
  await pg.selectOption('#optBTerm', '15 years'); await set('optBRate', '6.45');
  await pg.waitForTimeout(300);
  const opts = await pg.evaluate(() => buildOptions().map(o => ({
    key: o.key, pay: Math.round(o.c.newTotal), apr: +o.c.apr.toFixed(3), cash: o.c.cash })));
  t.eq('a real override adds a column', opts.length, 2);

  // The same loan typed into the form directly must price identically.
  await pg.selectOption('#newTerm', '15 years'); await set('newRate', '6.45');
  await set('optBLabel', ''); await pg.selectOption('#optBTerm', ''); await set('optBRate', '');
  await pg.waitForTimeout(400);
  const alone = await pg.evaluate(() => { const x = compute(); return {
    pay: Math.round(x.newTotal), apr: +x.apr.toFixed(3), cash: x.cash }; });
  const b = opts.find(o => o.key === 'B');
  t.eq('option B payment matches the same loan priced alone', b.pay, alone.pay);
  t.eq('option B APR matches', b.apr, alone.apr);
  t.eq('option B cash matches', b.cash, alone.cash);

  // Three columns must not be described as two.
  await pg.selectOption('#newTerm', '30 years'); await set('newRate', '7.25');
  await set('optBLabel', '15-year'); await pg.selectOption('#optBTerm', '15 years'); await set('optBRate', '6.45');
  await set('optCLabel', 'Bought down'); await set('optCRate', '6.75'); await set('optCCosts', '11500');
  await pg.waitForTimeout(400);
  await pg.click('#generateBtn'); await pg.waitForTimeout(900);
  const lead = await pg.evaluate(() => document.querySelector('.opts-lead')?.textContent || '');
  t.ok(`three options must not read as two: ${lead}`, /three ways/.test(lead));
  t.ok('the printed page must carry the comparison',
    await pg.evaluate(() => !!document.querySelector('.op-opts')));
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function savedWork(browser) {
  // The strip that used to hold four canned demo files now holds the two things
  // worth keeping: client files already worked on, and reusable option columns.
  const t = checker('saved files and option sets');
  const pg = await openApp(browser, { width: 1100, height: 1000 });
  pg.on('dialog', d => d.accept('30 vs 15'));
  const set = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };
  const build = async (first, last, loan, rate) => {
    await pg.evaluate(() => {
      document.querySelectorAll('.debt-row').forEach(r => r.remove());
      addDebtRow();
      const r = document.querySelector('.debt-row');
      r.querySelector('.d-name').value = 'Mortgage'; r.querySelector('.d-type').value = 'mortgage';
      r.querySelector('.d-bal').value = '240000'; r.querySelector('.d-pay').value = '2100';
      r.querySelector('.d-plan').value = 'payoff';
      r.querySelectorAll('input,select').forEach(e => e.dispatchEvent(new Event('input', { bubbles: true })));
    });
    await set('firstName', first); await set('lastName', last);
    await pg.selectOption('#program', 'Conventional'); await pg.selectOption('#purpose', 'Cash out');
    await pg.selectOption('#newTerm', '30 years');
    await set('loanAmount', loan); await set('newRate', rate); await set('estValue', '400000');
    await set('newTaxes', '6000'); await set('newIns', '1800');
    await pg.waitForTimeout(350);
  };
  const files = () => pg.evaluate(() => [...document.querySelectorAll('#filesList .open')].map(b => b.textContent));
  const sets = () => pg.evaluate(() => [...document.querySelectorAll('#optsList .open')].map(b => b.textContent));

  t.eq('the demo samples should be gone',
    await pg.evaluate(() => document.querySelectorAll('[data-sample]').length), 0);

  await build('Jen', 'Gasparovic', '260000', '7.25');
  await pg.click('#generateBtn'); await pg.waitForTimeout(700);
  await pg.click('#backBtn'); await pg.waitForTimeout(300);
  t.eq('generating a review should save the file', (await files()).join(), 'Jen Gasparovic');

  await build('Mike', 'Cromwell', '435200', '7.625');
  await pg.click('#generateBtn'); await pg.waitForTimeout(700);
  await pg.click('#backBtn'); await pg.waitForTimeout(300);
  t.eq('a second client is a second file', (await files()).length, 2);

  // Re-quoting the same client should update that file, not add another.
  await set('newRate', '7.0'); await pg.waitForTimeout(250);
  await pg.click('#generateBtn'); await pg.waitForTimeout(700);
  await pg.click('#backBtn'); await pg.waitForTimeout(300);
  t.eq('re-quoting a client must not duplicate the file', (await files()).length, 2);

  // Reopening restores the file and clears the review rendered for the last one.
  await pg.click('#filesMenu summary'); await pg.waitForTimeout(200);
  await pg.evaluate(() => [...document.querySelectorAll('#filesList .open')]
    .find(b => /Jen/.test(b.textContent)).click());
  await pg.waitForTimeout(500);
  const reopened = await pg.evaluate(() => ({
    first: document.getElementById('firstName').value,
    loan: document.getElementById('loanAmount').value,
    rate: document.getElementById('newRate').value,
    sheet: document.getElementById('sheet').innerHTML.trim().length,
  }));
  t.eq('reopening restores the client', reopened.first, 'Jen');
  t.eq('reopening restores the loan amount', reopened.loan, '260000');
  t.eq('reopening restores the rate', reopened.rate, '7.25');
  t.eq("reopening must clear the previous client's review", reopened.sheet, 0);
  t.eq('the other file is still there', (await files()).length, 2);

  // An option set carries the B and C columns and nothing of the client.
  await openCompare(pg);
  await set('optBLabel', '15-year'); await pg.selectOption('#optBTerm', '15 years'); await set('optBRate', '6.45');
  await pg.waitForTimeout(250);
  await pg.click('#optsMenu summary'); await pg.waitForTimeout(200);
  await pg.click('#saveOptSet'); await pg.waitForTimeout(400);
  t.eq('the option set is saved', (await sets()).length, 1);

  await set('optBLabel', ''); await pg.selectOption('#optBTerm', ''); await set('optBRate', '');
  await pg.waitForTimeout(250);
  await pg.click('#optsMenu summary'); await pg.waitForTimeout(200);
  await pg.evaluate(() => document.querySelector('#optsList .open').click());
  await pg.waitForTimeout(400);
  const applied = await pg.evaluate(() => ({
    rate: document.getElementById('optBRate').value,
    label: document.getElementById('optBLabel').value,
    client: document.getElementById('firstName').value,
  }));
  t.eq('applying an option set restores the B column', applied.rate, '6.45');
  t.eq('and its label', applied.label, '15-year');
  t.eq('applying an option set must not touch the client', applied.client, 'Jen');

  // Both survive a reload, and deleting removes just the one.
  await pg.reload(); await pg.waitForTimeout(800);
  t.eq('files survive a reload', (await files()).length, 2);
  t.eq('option sets survive a reload', (await sets()).length, 1);

  await pg.click('#filesMenu summary'); await pg.waitForTimeout(200);
  await pg.evaluate(() => document.querySelector('#filesList .del').click());
  await pg.waitForTimeout(300);
  t.eq('deleting removes one file', (await files()).length, 1);

  // Starting a new review clears the form but must not clear the saved work.
  await pg.click('#newReview'); await pg.waitForTimeout(600);
  t.eq('New review must not delete saved files', (await files()).length, 1);
  t.eq('New review must not delete option sets', (await sets()).length, 1);
  t.eq('New review still clears the form',
    await pg.evaluate(() => document.getElementById('firstName').value), '');

  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}

export async function optionsFolded(browser) {
  // The comparison is the last thing to think about, and optional. It sits at
  // the end of the intake, folded shut, so it never reads as a required step.
  const t = checker('the comparison section is last and folded');
  const pg = await openApp(browser, { width: 1000, height: 900 });
  pg.on('dialog', d => d.accept('set'));
  const set = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };

  const order = await pg.evaluate(() => [...document.querySelectorAll('.intake .panel')]
    .map(p => p.querySelector('h3').textContent.trim().split(/\s+/).slice(0, 2).join(' ')));
  t.eq('the comparison must be the last panel', order[order.length - 1], 'Compare options');
  t.ok(`the loan panel must come before it (${order.join(' / ')})`,
    order.indexOf('New loan') < order.length - 1);

  const vis = () => pg.evaluate(() => {
    const f = document.getElementById('optBRate');
    return { open: document.getElementById('comparePanel').open,
             shown: typeof f.checkVisibility === 'function' ? f.checkVisibility() : null };
  });
  let v = await vis();
  t.eq('it should start closed', v.open, false);
  t.eq('and its fields should not be rendered', v.shown, false);
  t.ok('the heading should mark it optional',
    await pg.evaluate(() => /optional/i.test(document.querySelector('#comparePanel h3').textContent)));

  await pg.click('#comparePanel summary'); await pg.waitForTimeout(250);
  v = await vis();
  t.eq('clicking opens it', v.open, true);
  t.eq('and the fields render', v.shown, true);

  // Options already set must not be hidden by the fold.
  await pg.evaluate(() => {
    document.querySelectorAll('.debt-row').forEach(r => r.remove());
    addDebtRow();
    const r = document.querySelector('.debt-row');
    r.querySelector('.d-name').value = 'Mortgage'; r.querySelector('.d-type').value = 'mortgage';
    r.querySelector('.d-bal').value = '240000'; r.querySelector('.d-pay').value = '2100';
    r.querySelector('.d-plan').value = 'payoff';
    r.querySelectorAll('input,select').forEach(e => e.dispatchEvent(new Event('input', { bubbles: true })));
  });
  await set('firstName', 'Fold'); await set('lastName', 'Test');
  await pg.selectOption('#program', 'Conventional'); await pg.selectOption('#purpose', 'Cash out');
  await set('loanAmount', '260000'); await set('newRate', '7.25'); await set('estValue', '400000');
  await set('newTaxes', '6000'); await set('newIns', '1800');
  await set('optBLabel', '15-year'); await pg.selectOption('#optBTerm', '15 years'); await set('optBRate', '6.45');
  await pg.waitForTimeout(300);
  await pg.click('#generateBtn'); await pg.waitForTimeout(800);
  t.eq('a filled option still reaches the sheet',
    await pg.evaluate(() => document.querySelectorAll('.opts th').length), 3);
  await pg.click('#backBtn'); await pg.waitForTimeout(300);

  await pg.reload(); await pg.waitForTimeout(700);
  t.eq('a restored file with options must open the panel', (await vis()).open, true);
  t.eq('and keep the option', await pg.evaluate(() => document.getElementById('optBRate').value), '6.45');

  await pg.click('#newReview'); await pg.waitForTimeout(600);
  t.eq('a new review folds it again', (await vis()).open, false);
  t.ok('console errors: ' + pg.collectedErrors.join(' | '), pg.collectedErrors.length === 0);
  await pg.close();
  return t.report();
}
