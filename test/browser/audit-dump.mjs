// Drives every scenario through the real app and writes what it computed and
// what it rendered to JSON. audit.py then recomputes the same figures from the
// scenario inputs alone and compares. The two must never share code.
import { writeFileSync } from 'fs';
import { launch, openApp, readSheet } from './harness.mjs';
import { SCENARIOS, buildScenario } from './scenarios.mjs';

const OUT = process.argv[2] || '/tmp/audit.json';
const browser = await launch();
const out = [];

for (const s of SCENARIOS) {
  const pg = await openApp(browser);
  await buildScenario(pg, s);
  const computed = await pg.evaluate(() => {
    const x = compute();
    return {
      payoffNeed: x.payoffNeed, todayTotal: x.todayTotal, keptPay: x.keptPay, newLoan: x.newLoan,
      upfrontMip: x.upfrontMip, notePrincipal: x.notePrincipal, newPI: x.newPI, newTaxes: x.newTaxes,
      newIns: x.newIns, newMI: x.newMI, newTotal: x.newTotal, afterTotal: x.afterTotal, delta: x.delta,
      baseCosts: x.baseCosts, titleWork: x.titleWork, costs: x.costs, escrowReserve: x.escrowReserve,
      prepaidInterest: x.prepaidInterest, reserves: x.reserves, cash: x.cash, newLtv: x.newLtv,
      financeCharges: x.financeCharges, amountFinanced: x.amountFinanced, apr: x.apr,
      mipYears: x.mipYears, loanShort: x.loanShort, armMaxPayment: x.armMaxPayment,
      armFirstPayment: x.armFirstPayment, freeClear: x.freeClear, currentEscrow: x.currentEscrow,
      escrowWaived: x.escrowWaived, lenderPayment: x.lenderPayment, directEscrow: x.directEscrow,
      escrowMode: x.escrowMode, waiveTaxes: x.waiveTaxes, waiveIns: x.waiveIns,
      escrowedMonthly: x.escrowedMonthly, isVa: x.isVa, vaFundingFee: x.vaFundingFee, vaFeeRate: x.vaFeeRate,
      isSecond: x.isSecond, retainedFirst: x.retainedFirst, cltv: x.cltv, quotedLtv: x.quotedLtv,
    };
  });
  const sheet = await readSheet(pg);
  out.push({ n: s.n, computed, sheet, errors: pg.collectedErrors });
  await pg.close();
}

await browser.close();
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`dumped ${out.length} scenarios -> ${OUT}`);
const noisy = out.filter(o => o.errors.length);
if (noisy.length) {
  console.log('console errors:');
  noisy.forEach(o => console.log(`   ${o.n}: ${o.errors.join(' | ')}`));
  process.exit(1);
}
