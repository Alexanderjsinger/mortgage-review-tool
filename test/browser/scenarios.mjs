// Scenario definitions shared by every browser check and by the independent
// audit. Keeping them in one place is what lets the Python audit recompute the
// same cases from scratch without ever calling the app's own code.

export const SCENARIOS = [
  {
    n: 'fixed conv cash-out', program: 'Conventional', purpose: 'Cash out', term: '30 years',
    loan: 100000, rate: 7.5, value: 326000, tax: 8200, ins: 0, costs: 5500, title: 1350, res: 3, days: 15,
    debts: [['Mortgage', 58395, 1115, 'mortgage', 'payoff'], ['Card A', 2688, 89, 'card', 'payoff'],
            ['Card B', 1609, 97, 'card', 'payoff'], ['Student', 82517, 0, 'other', 'exclude']],
  },
  {
    n: 'FHA fixed cash-out', program: 'FHA', purpose: 'Cash out', term: '30 years',
    loan: 290000, rate: 6.25, value: 420000, tax: 7600, ins: 0, costs: 6500, title: 1900, res: 3, days: 15,
    debts: [['Mortgage', 232204, 2144, 'mortgage', 'payoff'], ['C1', 7894, 299, 'card', 'payoff'],
            ['C2', 6980, 262, 'card', 'payoff'], ['Happen', 3642, 190, 'other', 'payoff'],
            ['Lendmark', 2043, 170, 'other', 'payoff'], ['ACU', 1895, 57, 'card', 'payoff'],
            ['Stu1', 95524, 0, 'other', 'exclude'], ['Stu2', 33955, 0, 'other', 'exclude']],
  },
  {
    n: 'FHA 3/1 ARM rate+term', program: 'FHA', purpose: 'Rate and term', term: '30 years',
    loan: 238000, rate: 5.75, value: 305000, tax: 5300, ins: 1800, costs: 17971, title: 0, res: 3, days: 15,
    arm: 3, caps: '1 / 5',
    debts: [['Mortgage', 220029, 2525, 'mortgage', 'payoff']],
  },
  {
    n: '15 yr conv, kept debt', program: 'Conventional', purpose: 'Rate and term', term: '15 years',
    loan: 200000, rate: 6.0, value: 400000, tax: 4800, ins: 1200, costs: 4000, title: 1200, res: 2, days: 10,
    debts: [['Mortgage', 190000, 1700, 'mortgage', 'payoff'], ['Auto', 14000, 420, 'other', 'keep']],
  },
  {
    n: 'no costs, no reserves', program: 'Conventional', purpose: 'Rate and term', term: '30 years',
    loan: 150000, rate: 6.5, value: 300000, tax: 3600, ins: 900, costs: 0, title: 0, res: 0, days: 0,
    debts: [['Mortgage', 148000, 1400, 'mortgage', 'payoff']],
  },
  {
    n: 'free and clear cash-out', program: 'Conventional', purpose: 'Cash out', term: '30 years',
    freeClear: true, loan: 100000, rate: 7.25, value: 260000, tax: 4800, ins: 1800,
    costs: 4500, title: 1350, res: 3, days: 15, debts: [],
  },
  {
    n: 'escrow waived cash-out', program: 'Conventional', purpose: 'Cash out', term: '30 years',
    escrowWaived: true, loan: 260000, rate: 7.0, value: 400000, tax: 6000, ins: 1800,
    costs: 5000, title: 1350, res: 4, days: 15,
    debts: [['Mortgage', 164000, 1642, 'mortgage', 'payoff']],
  },
  {
    // The loan does not stretch to cover the payoff: the borrower brings money
    // to closing. A sheet that shows this as "cash back $0" is the bug.
    n: 'loan short of payoff', program: 'Conventional', purpose: 'Rate and term', term: '30 years',
    loan: 200000, rate: 6.75, value: 300000, tax: 4200, ins: 1100, costs: 6000, title: 1200, res: 3, days: 15,
    debts: [['Mortgage', 205000, 1900, 'mortgage', 'payoff']],
  },
  {
    // Escrow waived on a free-and-clear home: both new paths at once.
    n: 'free and clear, waived', program: 'Conventional', purpose: 'Cash out', term: '30 years',
    freeClear: true, escrowWaived: true, loan: 150000, rate: 7.125, value: 500000,
    tax: 7200, ins: 2400, costs: 5200, title: 1400, res: 4, days: 20, debts: [],
  },
  {
    // VA carries a financed funding fee in place of mortgage insurance.
    n: 'VA cash-out, first use', program: 'VA', purpose: 'Cash out', term: '30 years',
    vaFee: '2.15', loan: 300000, rate: 6.5, value: 400000, tax: 6000, ins: 1800,
    costs: 5500, title: 1350, res: 3, days: 15,
    debts: [['Mortgage', 240000, 2100, 'mortgage', 'payoff']],
  },
  {
    // An IRRRL is the VA streamline, and its fee is a tenth of a cash-out's.
    n: 'VA IRRRL', program: 'VA', purpose: 'Streamline', term: '30 years',
    vaFee: '0.5', loan: 250000, rate: 5.75, value: 400000, tax: 6000, ins: 1800,
    costs: 3200, title: 1100, res: 3, days: 15,
    debts: [['Mortgage', 246000, 2050, 'mortgage', 'payoff']],
  },
  {
    // A veteran drawing disability compensation pays no funding fee.
    n: 'VA rate and term, exempt', program: 'VA', purpose: 'Rate and term', term: '30 years',
    vaFee: '0', loan: 250000, rate: 6.25, value: 400000, tax: 6000, ins: 1800,
    costs: 4200, title: 1200, res: 3, days: 15,
    debts: [['Mortgage', 243000, 2080, 'mortgage', 'payoff']],
  },
  {
    // Only the taxes move to the borrower; insurance is still escrowed.
    n: 'FHA, taxes waived only', program: 'FHA', purpose: 'Rate and term', term: '30 years',
    escrowMode: 'taxes-waived', loan: 250000, rate: 6.5, value: 400000, tax: 6000, ins: 1800,
    costs: 5500, title: 1350, res: 3, days: 15,
    debts: [['Mortgage', 240000, 2100, 'mortgage', 'payoff']],
  },
  {
    // And the mirror image: insurance waived, taxes still escrowed.
    n: 'conv, insurance waived only', program: 'Conventional', purpose: 'Cash out', term: '30 years',
    escrowMode: 'ins-waived', loan: 300000, rate: 6.75, value: 420000, tax: 7200, ins: 2100,
    costs: 5000, title: 1350, res: 4, days: 15,
    debts: [['Mortgage', 230000, 2000, 'mortgage', 'payoff']],
  },
  {
    // The 2026 case: a low first mortgage worth keeping, consumer debt cleared
    // with a second lien behind it. The first stays in the After column.
    n: 'second lien behind a 3.25% first', program: 'Conventional', purpose: 'Cash out',
    term: '20 years', position: 'second', loan: 40000, rate: 9.25, value: 520000,
    tax: 5200, ins: 1600, costs: 1800, title: 650, res: 0, days: 15,
    debts: [['First mortgage 3.25%', 310000, 1620, 'mortgage', 'keep'],
            ['Visa', 14000, 420, 'card', 'payoff'],
            ['Auto loan', 22000, 560, 'other', 'payoff']],
  },
  {
    // A conventional 5/1 ARM: the ARM path outside FHA.
    n: 'conv 5/1 ARM rate+term', program: 'Conventional', purpose: 'Rate and term', term: '30 years',
    arm: 5, caps: '2 / 5', loan: 250000, rate: 6.0, value: 400000, tax: 5400, ins: 1500,
    costs: 4500, title: 1200, res: 3, days: 15,
    debts: [['Mortgage', 242000, 2050, 'mortgage', 'payoff']],
  },
];

// Fills the intake for one scenario and generates the review.
export async function buildScenario(pg, s, firstName = 'Audit') {
  const set = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };
  await pg.evaluate(d => {
    document.querySelectorAll('.debt-row').forEach(r => r.remove());
    d.forEach(([name, bal, pay, type, plan]) => {
      addDebtRow();
      const r = [...document.querySelectorAll('.debt-row')].pop();
      r.querySelector('.d-name').value = name; r.querySelector('.d-bal').value = bal;
      r.querySelector('.d-pay').value = pay; r.querySelector('.d-type').value = type;
      r.querySelector('.d-plan').value = plan;
      r.querySelectorAll('input,select').forEach(e => e.dispatchEvent(new Event('input', { bubbles: true })));
    });
  }, s.debts);
  if (s.freeClear) { await pg.check('#freeClear'); await pg.dispatchEvent('#freeClear', 'input'); }
  if (s.escrowMode) { await pg.selectOption('#escrowMode', s.escrowMode); }
  else if (s.escrowWaived) { await pg.selectOption('#escrowMode', 'both-waived'); }
  await set('firstName', firstName);
  await pg.selectOption('#program', s.program);
  await pg.selectOption('#purpose', s.purpose);
  await pg.selectOption('#newTerm', s.term);
  await set('loanAmount', s.loan); await set('newRate', s.rate); await set('estValue', s.value);
  await set('newTaxes', s.tax); await set('newIns', s.ins);
  await set('closingCosts', s.costs); await set('titleWork', s.title);
  await set('reserveMonths', s.res); await set('prepaidDays', s.days);
  if (s.position) await pg.selectOption('#loanPosition', s.position);
  if (s.vaFee !== undefined) await pg.selectOption('#vaFee', s.vaFee);
  if (s.arm) { await set('armYears', s.arm); await set('armCaps', s.caps); }
  await pg.waitForTimeout(350);
  await pg.click('#generateBtn');
  await pg.waitForTimeout(800);
}
