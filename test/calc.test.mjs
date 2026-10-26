/**
 * Tests for the calculation engine.
 *
 * The engine lives inside worker/app.html between the @calc:start and @calc:end
 * markers. Rather than copying it here (which would drift the moment you edit
 * one and not the other), this file extracts that region from app.html and
 * evaluates it. app.html stays the single source of truth.
 *
 * If this file fails with "could not find the @calc markers", someone removed
 * or renamed them in app.html.
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "worker", "app.html"), "utf8");

const startMark = html.indexOf("/* @calc:start");
const endMark = html.indexOf("/* @calc:end */");
assert.ok(
  startMark !== -1 && endMark !== -1 && endMark > startMark,
  "could not find the @calc markers in worker/app.html"
);
const source = html.slice(html.indexOf("*/", startMark) + 2, endMark);

// No DOM, no globals beyond the standard library. If the calc region ever
// reaches for `document` or `localStorage`, this throws — which is the point.
const calc = vm.createContext({ Math, Number, String, Intl, Date, RegExp });
vm.runInContext(source, calc);
const {
  monthlyPI, monthlyPIForMonths, remainingLoanMonths, solveAnnualRate,
  solveRemainingMonthsCalc, estimatedFhaMipRate, estimateEscrow, termYears, COST_PTS,
  defaultLoanAmount, splitLoan, escrowOutliers,
  armSchedule, remainingBalance, fhaUpfrontMip, fhaAnnualMip, solveAprStream,
  purposeRules, purposeWarnings, findDuplicates, creditorKey, reconcileMortgage, monthsBetween,
} = vm.runInContext("({ monthlyPI, monthlyPIForMonths, remainingLoanMonths, solveAnnualRate, solveRemainingMonthsCalc, estimatedFhaMipRate, estimateEscrow, termYears, COST_PTS, defaultLoanAmount, splitLoan , escrowOutliers, armSchedule, remainingBalance, fhaUpfrontMip, fhaAnnualMip, solveAprStream, purposeRules, purposeWarnings, findDuplicates, creditorKey, reconcileMortgage, monthsBetween })", calc);

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""} expected ~${expected}, got ${actual}`);

/* ---------------------------------------------------------------
   Amortization — checked against independently known values
   --------------------------------------------------------------- */

test("monthlyPI matches known amortization values", () => {
  // $300,000 / 30yr / 6.5% => $1,896.20
  near(monthlyPI(300000, 6.5, 30), 1896.20, 0.05, "300k 30yr 6.5%");
  // $200,000 / 15yr / 5.0% => $1,581.59
  near(monthlyPI(200000, 5.0, 15), 1581.59, 0.05, "200k 15yr 5%");
  // $450,000 / 30yr / 7.25% => $3,069.79
  near(monthlyPI(450000, 7.25, 30), 3069.79, 0.05, "450k 30yr 7.25%");
});

test("monthlyPI handles the degenerate cases instead of returning NaN", () => {
  assert.equal(monthlyPI(0, 6.5, 30), 0, "no balance");
  assert.equal(monthlyPI(300000, 6.5, 0), 0, "no term");
  // Zero rate is straight division, not a divide-by-zero.
  assert.equal(monthlyPI(360000, 0, 30), 1000, "0% rate");
  assert.ok(Number.isFinite(monthlyPI(300000, 6.5, 30)), "finite");
});

test("monthlyPIForMonths agrees with monthlyPI on the same span", () => {
  near(monthlyPIForMonths(300000, 6.5, 360), monthlyPI(300000, 6.5, 30), 0.01);
  near(monthlyPIForMonths(200000, 5.0, 180), monthlyPI(200000, 5.0, 15), 0.01);
  // Odd remaining term — the case that matters when you quote against
  // remaining term instead of a fresh 30.
  near(monthlyPIForMonths(247000, 5.875, 283), 1614.60, 0.05, "seasoned remaining term");
});

/* ---------------------------------------------------------------
   Solvers — round-trip, which is the strongest available check
   --------------------------------------------------------------- */

test("solveAnnualRate round-trips against monthlyPIForMonths", () => {
  for (const [bal, rate, months] of [
    [300000, 6.5, 360], [180000, 4.25, 240], [520000, 7.875, 360], [95000, 3.5, 120],
  ]) {
    const pay = monthlyPIForMonths(bal, rate, months);
    near(solveAnnualRate(bal, pay, months), rate, 0.001, `${bal}@${rate}%/${months}mo`);
  }
});

test("solveAnnualRate refuses impossible inputs rather than guessing", () => {
  // A payment at or below principal-only implies a rate of zero or less.
  assert.equal(solveAnnualRate(300000, 300000 / 360, 360), 0, "principal-only payment");
  assert.equal(solveAnnualRate(300000, 500, 360), 0, "payment below principal-only");
  assert.equal(solveAnnualRate(0, 1800, 360), 0, "no balance");
  assert.equal(solveAnnualRate(300000, 0, 360), 0, "no payment");
});

test("solveRemainingMonthsCalc round-trips and detects negative amortization", () => {
  for (const [bal, rate, months] of [[300000, 6.5, 360], [150000, 4.0, 180]]) {
    const pay = monthlyPIForMonths(bal, rate, months);
    near(solveRemainingMonthsCalc(bal, rate, pay), months, 1, `${bal}@${rate}%`);
  }
  // Payment below the monthly interest never pays off — must not return a
  // number that would render as a real payoff date.
  const interestOnly = 300000 * (6.5 / 1200);
  assert.equal(solveRemainingMonthsCalc(300000, 6.5, interestOnly), 0, "interest-only");
  assert.equal(solveRemainingMonthsCalc(300000, 6.5, interestOnly - 50), 0, "negative am");
  // Extra principal shortens the term.
  const base = monthlyPIForMonths(300000, 6.5, 360);
  assert.ok(solveRemainingMonthsCalc(300000, 6.5, base + 300) < 360, "extra principal");
});

/* ---------------------------------------------------------------
   Term and seasoning
   --------------------------------------------------------------- */

test("termYears parses the term strings the form produces", () => {
  assert.equal(termYears("30 years"), 30);
  assert.equal(termYears("15 years"), 15);
  assert.equal(termYears(""), 30, "defaults to 30");
  assert.equal(termYears(null), 30, "defaults to 30");
});

test("remainingLoanMonths counts down from the origination date", () => {
  const now = new Date();
  const ym = (backMonths) => {
    const d = new Date(now.getFullYear(), now.getMonth() - backMonths, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  assert.equal(remainingLoanMonths("30 years", ""), 360, "no date = full term");
  assert.equal(remainingLoanMonths("30 years", "garbage"), 360, "unparseable = full term");
  assert.equal(remainingLoanMonths("30 years", ym(0)), 360, "originated this month");
  assert.equal(remainingLoanMonths("30 years", ym(48)), 312, "4 years in");
  assert.equal(remainingLoanMonths("15 years", ym(60)), 120, "5 years into a 15");
  // Past maturity must clamp, not go negative — a negative term would flip
  // the sign of every downstream payment.
  assert.equal(remainingLoanMonths("30 years", ym(400)), 1, "past maturity clamps");
  // A future date must not manufacture extra term.
  assert.equal(remainingLoanMonths("30 years", ym(-12)), 360, "future date clamps");
});

/* ---------------------------------------------------------------
   FHA MIP — the boundary that drives your best scenario
   --------------------------------------------------------------- */

test("estimatedFhaMipRate splits on the March 2023 MIP cut", () => {
  assert.equal(estimatedFhaMipRate("2022-06"), 0.85, "well before");
  assert.equal(estimatedFhaMipRate("2023-01"), 0.85, "Jan 2023");
  assert.equal(estimatedFhaMipRate("2023-03"), 0.85, "March 2023 — boundary month");
  assert.equal(estimatedFhaMipRate("2023-04"), 0.55, "April 2023");
  assert.equal(estimatedFhaMipRate("2025-09"), 0.55, "well after");
  assert.equal(estimatedFhaMipRate(""), 0.55, "unknown defaults to the lower rate");
  assert.equal(estimatedFhaMipRate("nonsense"), 0.55, "unparseable defaults low");
});

test("MIP rates translate to the monthly figures the pitch relies on", () => {
  // Per $100k: 0.85% => $70.83/mo, 0.55% => $45.83/mo
  near(100000 * 0.0085 / 12, 70.83, 0.01);
  near(100000 * 0.0055 / 12, 45.83, 0.01);
  // On $300k, dropping 0.85% MIP frees $212.50/mo of rate headroom.
  near(300000 * 0.0085 / 12, 212.50, 0.01);
});

/* ---------------------------------------------------------------
   Escrow estimates
   --------------------------------------------------------------- */

test("estimateEscrow uses state rates when known and flags when it doesn't", () => {
  const mi = estimateEscrow("MI", 400000, 300000);
  assert.equal(mi.specific, true, "MI is a known state");
  assert.equal(mi.taxes, Math.round(400000 * 0.0135 / 12));
  assert.equal(mi.ins, Math.round(400000 * 0.0060 / 12));

  // Lowercase input must resolve the same way.
  const lower = estimateEscrow("mi", 400000, 300000);
  assert.equal(lower.taxes, mi.taxes, "case-insensitive");
  assert.equal(lower.ins, mi.ins, "case-insensitive");

  // Unknown state falls back AND reports that it fell back, so the review can
  // say so rather than presenting a national average as a local number.
  const unknown = estimateEscrow("ZZ", 400000, 300000);
  assert.equal(unknown.specific, false);
  assert.equal(unknown.taxes, Math.round(400000 * 0.0090 / 12));

  // No value: infers from balance at 1.25x rather than returning zero.
  const inferred = estimateEscrow("MI", 0, 300000);
  assert.equal(inferred.taxes, Math.round(375000 * 0.0135 / 12), "infers value from balance");

  // Nothing to work with: zeros, not NaN.
  const empty = estimateEscrow("MI", 0, 0);
  assert.equal(empty.taxes, 0);
  assert.equal(empty.ins, 0);
  assert.equal(empty.specific, false);
});

/* ---------------------------------------------------------------
   Financed closing costs
   --------------------------------------------------------------- */

test("COST_PTS grosses up correctly when costs are financed", () => {
  assert.equal(COST_PTS, 0.03, "default is 3 points");
  // Financing costs into the loan means solving base/(1-pts), not base*pts —
  // the costs are a share of the *final* loan, which includes them.
  const gross = (base) => Math.round(base * COST_PTS / (1 - COST_PTS));
  assert.equal(gross(300000), 9278);
  assert.equal(gross(150000), 4639);
  // The financed amount really is COST_PTS of the resulting loan.
  const base = 300000, costs = gross(base);
  near(costs / (base + costs), COST_PTS, 0.0001, "share of final loan");
});

/* ---------------------------------------------------------------
   A break-even scenario end to end
   --------------------------------------------------------------- */

test("a full refi scenario produces defensible numbers", () => {
  // 2022 FHA: $300k at 6.25%, 0.85% MIP, 30yr. Refi to conventional 6.75%,
  // no MI, 3 points financed. Higher rate, still a win because MIP dies.
  const balance = 300000;
  const currentPI = monthlyPI(balance, 6.25, 30);
  const currentMIP = balance * 0.0085 / 12;
  const currentTotal = currentPI + currentMIP;

  const costs = Math.round(balance * COST_PTS / (1 - COST_PTS));
  const newLoan = balance + costs;
  const newTotal = monthlyPI(newLoan, 6.75, 30);

  assert.ok(newTotal < currentTotal, "MIP drop beats the rate increase");
  const saved = currentTotal - newTotal;
  near(saved, 60, 25, "monthly savings in a believable band");

  // Break-even against out-of-pocket is immediate here (costs financed), but
  // the honest measure is months to recover the financed cost from savings.
  const monthsToRecover = costs / saved;
  assert.ok(monthsToRecover > 0 && monthsToRecover < 360, "recoverable within term");
});

/* ---------------------------------------------------------------
   Loan amount <-> cash out
   The form now takes the loan amount and derives cash, rather than
   taking cash and building the loan up. These are the sums the LO
   reads out loud on the call, so they get the most coverage.
   --------------------------------------------------------------- */

test("defaultLoanAmount covers the payoffs with costs included", () => {
  // Costs must end up as COST_PTS of the loan itself, not of the payoff.
  const loan = defaultLoanAmount(253000, 0.03);
  const costs = loan - 253000;
  near(costs / loan, 0.03, 0.0001, "costs are 3% of the final loan");
  assert.ok(loan > 253000, "loan exceeds the payoff");
  assert.equal(defaultLoanAmount(0, 0.03), 0, "nothing to cover");
  assert.equal(defaultLoanAmount(-5000, 0.03), 0, "negative payoff");
  assert.equal(defaultLoanAmount(200000, 0), 200000, "no points");
});

test("splitLoan reproduces the worked example", () => {
  // $300,000 loan, $253,000 mortgage payoff, 3 points => $9,000 costs.
  // $253,000 + $9,000 = $262,000 out. $38,000 is the client's cash.
  const r = splitLoan(300000, 253000, 0, 0.03);
  assert.equal(r.costs, 9000);
  assert.equal(r.cash, 38000);
  assert.equal(r.short, 0);
});

test("splitLoan folds debts into the payoff before cash", () => {
  const debts = 32400;
  const r = splitLoan(300000, 253000 + debts, 0, 0.03);
  assert.equal(r.costs, 9000);
  assert.equal(r.cash, 300000 - 253000 - debts - 9000);
  // Cash is what's left, never the headline number when debts eat the loan.
  assert.ok(r.cash < 38000, "debts reduce cash");
});

test("splitLoan reports a shortfall instead of clamping to zero", () => {
  // A loan below the payoffs is a real error on a call — the client would
  // have to bring money to closing. It must surface, not round to $0 cash.
  const r = splitLoan(200000, 285400, 0, 0.03);
  assert.equal(r.cash, 0, "no cash when short");
  assert.ok(r.short > 0, "shortfall is reported");
  assert.equal(r.short, 285400 + 6000 - 200000, "shortfall includes costs");
});

test("splitLoan honors entered closing costs over the estimate", () => {
  const r = splitLoan(300000, 253000, 4200, 0.03);
  assert.equal(r.costs, 4200, "entered costs win");
  assert.equal(r.cash, 300000 - 253000 - 4200, "cash reflects the real costs");
});

test("splitLoan handles the no-loan case without producing NaN", () => {
  const r = splitLoan(0, 253000, 0, 0.03);
  assert.equal(r.costs, 0);
  assert.equal(r.cash, 0);
  assert.equal(r.short, 0);
});

test("default loan then split round-trips to zero cash", () => {
  // Leaving the loan amount blank must mean exactly "cover the payoffs" —
  // no accidental cash out, no accidental shortfall.
  for (const payoff of [150000, 253000, 285400, 512000]) {
    const loan = defaultLoanAmount(payoff, 0.03);
    const r = splitLoan(loan, payoff, 0, 0.03);
    assert.ok(r.cash <= 1, `no stray cash at ${payoff} (got ${r.cash})`);
    assert.ok(r.short <= 1, `no stray shortfall at ${payoff} (got ${r.short})`);
  }
});

/* ---------------------------------------------------------------
   Escrow sanity
   These figures are typed by hand. A slipped digit used to flow straight
   into the payment with nothing said about it.
   --------------------------------------------------------------- */

test("implausible escrow is flagged against the property value", () => {
  // $82,000 of annual tax on a $326,000 home: a typo, not a tax bill.
  const o = escrowOutliers(82000, 0, 326000, 0, 0);
  assert.equal(o.length, 1);
  assert.equal(o[0].kind, "taxes");
  assert.equal(o[0].limit, Math.round(326000 * 0.05));

  const ins = escrowOutliers(4000, 20000, 326000, 0, 0);
  assert.equal(ins.length, 1);
  assert.equal(ins[0].kind, "insurance");
});

test("a new payment far above today's is flagged", () => {
  const o = escrowOutliers(0, 0, 0, 7499, 1779);
  assert.equal(o.length, 1);
  assert.equal(o[0].kind, "payment");
});

test("ordinary figures raise nothing", () => {
  // $5,740 tax and $2,550 insurance on a $425,000 home, payment up modestly.
  assert.deepEqual([...escrowOutliers(5740, 2550, 425000, 2412, 2142)], []);
  assert.deepEqual([...escrowOutliers(0, 0, 0, 0, 0)], [], "an empty form is not an outlier");
});

test("outliers need a property value before they can judge escrow", () => {
  // Nothing to measure against: say nothing rather than guess.
  assert.deepEqual([...escrowOutliers(82000, 0, 0, 0, 0)], []);
});

/* ---------------------------------------------------------------
   Closing costs: points, dollars, or nothing
   The old build invented 3 points whenever the field was blank, which put a
   number on a client's sheet that nobody had entered.
   --------------------------------------------------------------- */

test("points are charged against the loan, not the payoff", () => {
  // 2.5 points on a $71,742 payoff: the loan grosses up so the points land at
  // 2.5% of the loan itself.
  const loan = defaultLoanAmount(71742, 0.025);
  const r = splitLoan(loan, 71742, 0, 0.025);
  near(r.costs / loan, 0.025, 0.0002, "costs are 2.5% of the loan");
  assert.ok(r.cash <= 1 && r.short <= 1, "covers the payoff exactly");
});

test("a dollar figure is used as given, whatever the loan size", () => {
  const r = splitLoan(78242, 71742, 6500, 0);
  assert.equal(r.costs, 6500);
  assert.equal(r.cash, 0);
  assert.equal(r.short, 0);
});

test("no points and no dollars means no costs are invented", () => {
  const loan = defaultLoanAmount(71742, 0);
  assert.equal(loan, 71742, "the loan is exactly the payoff");
  const r = splitLoan(loan, 71742, 0, 0);
  assert.equal(r.costs, 0, "nothing added");
  assert.equal(r.cash, 0);
});

test("costs still come out of a loan raised for cash", () => {
  // $100,000 against a $71,742 payoff at 2 points: costs first, cash is the rest.
  const r = splitLoan(100000, 71742, 0, 0.02);
  assert.equal(r.costs, 2000);
  assert.equal(r.cash, 100000 - 71742 - 2000);
});

/* ---------------------------------------------------------------
   PREPAID INTEREST
   Per-diem interest from closing to month end. It rides on the escrow line
   but, unlike escrow reserves, it IS a prepaid finance charge for APR.
   --------------------------------------------------------------- */

test("per-diem interest is the loan times the rate over 365", () => {
  const daily = 100000 * (6.99 / 100) / 365;
  near(daily, 19.1507, 0.0001, "$/day on $100,000 at 6.99%");
  assert.equal(Math.round(daily * 15), 287, "15 days");
  assert.equal(Math.round(daily * 30), 575, "a full month");
  assert.equal(Math.round(daily * 0), 0, "a month-end close prepays nothing");
});

test("reserves carry both escrow and prepaid interest out of the loan", () => {
  // Jen: $100,000 loan, $71,742 of payoffs, $5,000 costs,
  // 3 months of $683.33 escrow plus 15 days of interest.
  const escrowReserve = Math.round(3 * (8200 / 12));
  const prepaidInterest = Math.round(15 * (100000 * 0.0699 / 365));
  assert.equal(escrowReserve, 2050);
  assert.equal(prepaidInterest, 287);
  const r = splitLoan(100000, 71742, 5000, 0, escrowReserve + prepaidInterest);
  assert.equal(r.reserves, 2337, "the escrow and prepaids line");
  assert.equal(r.costs, 5000);
  assert.equal(r.cash, 20921, "cash back after costs and reserves");
  assert.equal(r.short, 0);
  assert.equal(71742 + r.costs + r.reserves + r.cash, 100000, "the loan reconciles");
});

test("reserves can push a thin loan into a shortfall", () => {
  const r = splitLoan(75000, 71742, 2000, 0, 2337);
  assert.equal(r.cash, 0, "no phantom cash back");
  assert.equal(r.short, 71742 + 2000 + 2337 - 75000);
});

test("omitting reserves leaves splitLoan where it was", () => {
  const withNone = splitLoan(100000, 71742, 5000, 0, 0);
  const withUndef = splitLoan(100000, 71742, 5000, 0);
  assert.deepEqual([withNone.reserves, withNone.cash], [0, 23258]);
  assert.deepEqual([withUndef.reserves, withUndef.cash], [0, 23258]);
});


/* ---------------------------------------------------------------
   ADJUSTABLE RATE
   A start rate is not the rate. Every figure after the first adjustment has to
   come from re-amortizing what is left over the term that is left.
   --------------------------------------------------------------- */

test("remainingBalance matches a hand-rolled amortization", () => {
  let bal = 242165;
  const i = 5.75 / 100 / 12, pay = monthlyPI(242165, 5.75, 30);
  for (let m = 0; m < 36; m++) bal = bal + bal * i - pay;
  near(remainingBalance(242165, 5.75, 360, 36), bal, 0.02, "36 payments in");
});

test("a 3/1 walks up one point a year and stops at the lifetime cap", () => {
  const s = armSchedule(242165, 5.75, 3, 30, 1, 5);
  assert.deepEqual([...s].map(x => x.year), [3, 4, 5, 6, 7], "one step a year after the fixed period");
  assert.deepEqual([...s].map(x => Number(x.rate.toFixed(2))), [6.75, 7.75, 8.75, 9.75, 10.75]);
  assert.equal(s.at(-1).rate, 10.75, "5 points over the start rate, then it stops");
});

test("each step re-amortizes rather than holding the old payment", () => {
  const s = armSchedule(242165, 5.75, 3, 30, 1, 5);
  const start = monthlyPI(242165, 5.75, 30);
  near(start, 1413.21, 0.01, "start P&I");
  near(s[0].pi, 1559.84, 0.01, "first adjustment, 27 years left on a smaller balance");
  near(s.at(-1).pi, 2166.23, 0.01, "at the ceiling");
  assert.ok(s.every((x, k) => k === 0 || x.pi > s[k - 1].pi), "each step costs more");
  assert.ok(s.every(x => x.balance < 242165), "balance only falls");
});

test("a 5/1 holds its start rate two years longer than a 3/1", () => {
  const three = armSchedule(242165, 5.75, 3, 30, 1, 5);
  const five = armSchedule(242165, 5.75, 5, 30, 1, 5);
  assert.equal(three[0].year, 3);
  assert.equal(five[0].year, 5);
  assert.equal(three.at(-1).rate, five.at(-1).rate, "same ceiling either way");
});

test("a 2% annual cap reaches the ceiling in fewer steps", () => {
  const slow = armSchedule(242165, 5.75, 7, 30, 2, 6);
  assert.deepEqual([...slow].map(x => Number(x.rate.toFixed(2))), [7.75, 9.75, 11.75]);
});

test("a fixed rate has no schedule at all", () => {
  assert.equal([...armSchedule(242165, 5.75, 0, 30, 1, 5)].length, 0);
  assert.equal([...armSchedule(0, 5.75, 3, 30, 1, 5)].length, 0);
});

/* ---------------------------------------------------------------
   FHA MORTGAGE INSURANCE
   --------------------------------------------------------------- */

test("upfront MIP is 1.75% of the base loan", () => {
  assert.equal(fhaUpfrontMip(238000), 4165);
  assert.equal(fhaUpfrontMip(0), 0);
});

test("annual MIP runs eleven years at or under 90% LTV, life of loan above", () => {
  const m = ltv => { const r = fhaAnnualMip(ltv); return [r.rate, r.years]; };
  assert.deepEqual(m(79), [0.50, 11]);
  assert.deepEqual(m(90), [0.50, 11]);
  assert.deepEqual(m(92), [0.50, 30]);
  assert.deepEqual(m(96), [0.55, 30]);
});

test("the worked FHA ARM file", () => {
  // $238,000 base, UFMIP financed, 5.75% start, tax 5,300 + ins 1,800.
  const base = 238000, up = fhaUpfrontMip(base), total = base + up;
  assert.equal(total, 242165);
  const esc = (5300 + 1800) / 12;
  const mip = total * fhaAnnualMip(79).rate / 100 / 12;
  near(monthlyPI(total, 5.75, 30) + esc + mip, 2105.78, 0.01, "payment at the start rate");
  const s = armSchedule(total, 5.75, 3, 30, 1, 5);
  near(s.at(-1).pi + esc + mip, 2858.80, 0.01, "payment at the ceiling");
  assert.ok(s.at(-1).pi + esc + mip > 2525, "the ceiling costs more than they pay today");
});


test("with no mortgage insurance the stream solver matches the level solver", () => {
  const pi = monthlyPI(100000, 6.99, 30);
  near(solveAprStream(94713, pi, 0, 0, 360), solveAnnualRate(94713, pi, 360), 0.0005);
});

test("monthly mortgage insurance lifts the APR", () => {
  const pi = monthlyPI(242165, 5.75, 30);
  const without = solveAprStream(227000, pi, 0, 0, 360);
  const with11 = solveAprStream(227000, pi, 100.90, 132, 360);
  assert.ok(with11 > without + 0.3, `${with11} should clear ${without} by a real margin`);
  // insurance for the whole term costs more than insurance for eleven years
  assert.ok(solveAprStream(227000, pi, 100.90, 360, 360) > with11);
});

test("the stream solver refuses an impossible stream rather than guessing", () => {
  assert.equal(solveAprStream(0, 1413, 100, 132, 360), 0);
  assert.equal(solveAprStream(227000, 0, 100, 132, 360), 0);
  assert.equal(solveAprStream(500000, 100, 0, 0, 360), 0, "payments never repay the balance");
});


/* ---------------------------------------------------------------
   LOAN PURPOSE
   Cash limits and LTV ceilings differ by purpose. A sheet that ignores them
   describes a loan nobody can write.
   --------------------------------------------------------------- */

test("each purpose carries its own cash limit and LTV ceiling", () => {
  const rt = purposeRules("Rate and term", "FHA");
  assert.equal(rt.cashLimit, 500);
  assert.equal(rt.maxLtv, 97.75);
  const co = purposeRules("Cash out", "FHA");
  assert.equal(co.cashLimit, Infinity);
  assert.equal(co.maxLtv, 80);
  assert.equal(purposeRules("Rate and term", "Conventional").maxLtv, 95);
  assert.equal(purposeRules("Streamline", "FHA").cashLimit, 500);
});

test("rate and term flags cash over $500 and says what the loan should be", () => {
  const w = [...purposeWarnings("Rate and term", "FHA", 6971, 78, 220029, 11000)];
  assert.equal(w.length, 1);
  assert.match(w[0], /at most \$500/);
  assert.match(w[0], /\$6,971 going back/);
  assert.match(w[0], /\$231,529/, "payoff + costs + the $500 allowance");
});

test("rate and term is silent when the cash is inside the allowance", () => {
  assert.equal([...purposeWarnings("Rate and term", "FHA", 400, 78, 220029, 11000)].length, 0);
  assert.equal([...purposeWarnings("Rate and term", "FHA", 0, 97, 220029, 11000)].length, 0);
});

test("cash out is silent on cash but catches the 80% ceiling", () => {
  assert.equal([...purposeWarnings("Cash out", "FHA", 6971, 78, 220029, 11000)].length, 0);
  const over = [...purposeWarnings("Cash out", "FHA", 6971, 84, 220029, 11000)];
  assert.equal(over.length, 1);
  assert.match(over[0], /caps at 80%/);
  assert.match(over[0], /84\.0%/);
});

test("a streamline on a programme that has none is flagged", () => {
  const w = [...purposeWarnings("Streamline", "Conventional", 0, 70, 220029, 11000)];
  assert.equal(w.length, 1);
  assert.match(w[0], /Only FHA and VA have a streamline/);
});

test("VA has a streamline of its own and it is not flagged", () => {
  // An IRRRL is the VA streamline; flagging it as impossible was wrong.
  assert.equal([...purposeWarnings("Streamline", "VA", 0, 70, 220029, 11000)].length, 0);
  assert.match(purposeRules("Streamline", "VA").label, /IRRRL/);
  assert.match(purposeRules("Streamline", "VA").note, /existing VA loan/);
  assert.equal(purposeRules("Streamline", "FHA").wrongProgram, false);
  assert.equal(purposeRules("Streamline", "Conventional").wrongProgram, true);
});

test("VA cash-out reaches past the conventional ceiling", () => {
  assert.equal(purposeRules("Cash out", "VA").maxLtv, 90);
  assert.equal(purposeRules("Cash out", "Conventional").maxLtv, 80);
  assert.equal(purposeRules("Cash out", "FHA").maxLtv, 80);
  // 85% is fine on VA and over the line on conventional.
  assert.equal([...purposeWarnings("Cash out", "VA", 20000, 85, 200000, 9000)].length, 0);
  assert.equal([...purposeWarnings("Cash out", "Conventional", 20000, 85, 200000, 9000)].length, 1);
});

test("no purpose chosen means no rules applied", () => {
  assert.equal([...purposeWarnings("", "FHA", 50000, 99, 220029, 11000)].length, 0);
});


test("prepaid interest accrues on the whole note, financed MIP included", () => {
  // $290,000 base + $5,075 upfront MIP = a $295,075 note at 6.25%.
  const base = 290000, note = base + fhaUpfrontMip(base);
  assert.equal(note, 295075);
  const perDiemBase = base * 6.25 / 100 / 365;
  const perDiemNote = note * 6.25 / 100 / 365;
  near(perDiemNote, 50.5266, 0.0001);
  assert.equal(Math.round(perDiemNote * 15), 758);
  assert.equal(Math.round(perDiemBase * 15), 745, "the base-loan figure the sheet used to show");
});


/* ---------------------------------------------------------------
   DUPLICATE TRADELINES
   --------------------------------------------------------------- */

test("the same joint mortgage reported twice is found", () => {
  const rows = [
    { name: "CENTRAL LOAN ADMIN &am/1811002", bal: 232204, pay: 2144 },
    { name: "CENTRAL LOAN ADMIN &am/1811002", bal: 232204, pay: 2144 },
    { name: "CAPITAL ONE/1270246", bal: 7894, pay: 299 },
  ];
  const d = [...findDuplicates(rows)];
  assert.equal(d.length, 1);
  assert.equal(d[0].count, 2);
  assert.equal(d[0].keep, 0);
  assert.deepEqual([...d[0].drop], [1]);
  assert.equal(d[0].bal, 232204);
});

test("the same account under slightly different spellings still matches", () => {
  const d = [...findDuplicates([
    { name: "CENTRAL LOAN ADMIN &am/1811002", bal: 232204, pay: 2144 },
    { name: "Central Loan Administration LLC", bal: 232204, pay: 2144 },
  ])];
  assert.equal(d.length, 1, "account number and suffixes should not defeat the match");
});

test("two different cards at the same balance are left alone", () => {
  const d = [...findDuplicates([
    { name: "CAPITAL ONE/1270246", bal: 500, pay: 25 },
    { name: "PETAL 1 RISE/2947980", bal: 500, pay: 25 },
  ])];
  assert.equal(d.length, 0, "same numbers, different creditor");
});

test("the two Capital One cards on a real file are not merged", () => {
  const d = [...findDuplicates([
    { name: "CAPITAL ONE/1270246", bal: 7894, pay: 299 },
    { name: "CAPITAL ONE/1270246", bal: 6980, pay: 262 },
  ])];
  assert.equal(d.length, 0, "same creditor, different balances");
});

test("empty rows are ignored", () => {
  assert.equal([...findDuplicates([{ name: "", bal: 0, pay: 0 }, { name: "", bal: 0, pay: 0 }])].length, 0);
});

/* ---------------------------------------------------------------
   CURRENT MORTGAGE RECONCILIATION
   --------------------------------------------------------------- */

test("months between two reported dates", () => {
  assert.equal(monthsBetween("2025-06", "2026-10"), 16);
  assert.equal(monthsBetween("2026-10", "2026-10"), 0);
  assert.equal(monthsBetween("", "2026-10"), 0);
});

test("a consistent mortgage reconciles quietly", () => {
  // $225,172 at 7% over 360: P&I $1,498.07, and after 16 payments $222,086.
  const pi = monthlyPI(225172, 7, 30);
  const bal = remainingBalance(225172, 7, 360, 16);
  const r = reconcileMortgage({ balance: bal, payment: pi + 592, escrowMonthly: 592,
    origBalance: 225172, opened: "2025-06", asOf: "2026-10", termMonths: 360 });
  near(r.rateFromPayment, 7, 0.02);
  near(r.rateFromPaydown, 7, 0.02);
  assert.ok(r.gap < 0.1, `gap ${r.gap}`);
  assert.equal([...r.issues].length, 0);
});

test("the file whose payment and paydown disagreed is caught", () => {
  // The real one: $2,525 payment, $592 escrow, $225,172 original, $220,029 now.
  const r = reconcileMortgage({ balance: 220029, payment: 2525, escrowMonthly: 592,
    origBalance: 225172, opened: "2025-06", asOf: "2026-10", termMonths: 360 });
  near(r.impliedPI, 1933, 1);
  assert.ok(r.rateFromPayment > 9, `payment implies ${r.rateFromPayment}`);
  assert.ok(r.rateFromPaydown < 5, `paydown implies ${r.rateFromPaydown}`);
  assert.ok(r.gap > 4);
  assert.equal([...r.issues].length, 1);
  assert.match(r.issues[0], /unaccounted for/);
});

test("an escrow bigger than the payment is called out", () => {
  const r = reconcileMortgage({ balance: 220029, payment: 900, escrowMonthly: 1000,
    origBalance: 225172, opened: "2025-06", asOf: "2026-10" });
  assert.equal([...r.issues].length, 1);
  assert.match(r.issues[0], /leaves nothing for principal and interest/);
});

test("without an original balance it still reads the payment, and stays quiet", () => {
  const r = reconcileMortgage({ balance: 220029, payment: 2525, escrowMonthly: 592 });
  assert.ok(r.rateFromPayment > 0, "payment side still works");
  assert.equal(r.rateFromPaydown, 0, "nothing to compare against");
  assert.equal([...r.issues].length, 0, "no claim without a second reading");
});

/* ---------------------------------------------------------------
   TITLE WORK
   Separately quoted third-party items ride as their own line. They come out of
   the loan like any cost, but they are NOT finance charges (Reg Z 1026.4(c)(7)),
   so they must never reach the APR.
   --------------------------------------------------------------- */

test("title work is its own line and still comes out of the loan", () => {
  const r = splitLoan(100000, 71742, 5000, 0, 2337, 1350);
  assert.equal(r.baseCosts, 5000, "lender costs");
  assert.equal(r.extraCosts, 1350, "title shown separately");
  assert.equal(r.costs, 6350, "both are charged");
  assert.equal(r.cash, 19571, "cash back drops by the title figure");
  assert.equal(71742 + r.costs + r.reserves + r.cash, 100000, "the loan reconciles");
});

test("title work rides on top of points, not inside them", () => {
  const r = splitLoan(100000, 71742, 0, 0.02, 0, 1350);
  assert.equal(r.baseCosts, 2000, "2 points of the loan");
  assert.equal(r.extraCosts, 1350);
  assert.equal(r.costs, 3350);
});

test("omitting title work leaves splitLoan exactly where it was", () => {
  const a = splitLoan(100000, 71742, 5000, 0, 2337, 0);
  const b = splitLoan(100000, 71742, 5000, 0, 2337);
  assert.equal(a.costs, 5000);
  assert.deepEqual([a.costs, a.cash, a.reserves], [b.costs, b.cash, b.reserves]);
  assert.equal(a.cash, 20921, "the pre-title number is unchanged");
});

test("title work can tip a loan into a shortfall", () => {
  const r = splitLoan(74000, 71742, 1000, 0, 0, 1350);
  assert.equal(r.cash, 0);
  assert.equal(r.short, 71742 + 1000 + 1350 - 74000);
});

/* ---------------------------------------------------------------
   APR
   APR runs off prepaid finance charges only — origination, points, broker
   comp, prepaid interest. Title, appraisal, recording and escrow reserves are
   not finance charges, so folding them in overstates the rate.
   --------------------------------------------------------------- */

test("APR solves off the amount financed, not the loan amount", () => {
  // $100,000 at 6.99% / 30yr is $664.63 P&I. With $1,787 of finance charges the
  // amount financed is $98,213 and the APR is 7.169%.
  const pi = monthlyPI(100000, 6.99, 30);
  near(pi, 664.63, 0.01, "P&I");
  near(solveAnnualRate(100000 - 1787, pi, 360), 7.169, 0.002, "APR on $98,213");
  near(solveAnnualRate(100000 - 1287, pi, 360), 7.119, 0.002, "APR on $98,713");
});

test("more finance charges means a higher APR", () => {
  const pi = monthlyPI(100000, 6.99, 30);
  const low = solveAnnualRate(100000 - 1287, pi, 360);
  const mid = solveAnnualRate(100000 - 1787, pi, 360);
  const high = solveAnnualRate(100000 - 5000, pi, 360);
  assert.ok(low < mid && mid < high, `${low} < ${mid} < ${high}`);
  near(high, 7.506, 0.002, "treating every cost as a finance charge");
});

test("title work never reaches the APR", () => {
  // $5,000 lender costs + $287 prepaid interest = $5,287 financed. The $1,350
  // of title is a cost but not a finance charge, so the APR must not move.
  const pi = monthlyPI(100000, 6.99, 30);
  const withoutTitle = solveAnnualRate(100000 - 5287, pi, 360);
  const ifTitleCounted = solveAnnualRate(100000 - 5287 - 1350, pi, 360);
  near(withoutTitle, 7.537, 0.002, "APR as shown");
  assert.ok(ifTitleCounted > withoutTitle + 0.05,
    "sweeping title in would overstate the rate, which is why it is excluded");
});

test("prepaid interest lifts the APR, escrow reserves do not", () => {
  // Jen's sheet: $5,000 costs + $287 prepaid interest = $5,287 financed charges.
  // The $2,050 escrow reserve is not a finance charge and stays out.
  const pi = monthlyPI(100000, 6.99, 30);
  const withPrepaid = solveAnnualRate(100000 - 5287, pi, 360);
  near(withPrepaid, 7.537, 0.002, "APR on $94,713 financed");
  const ifEscrowCounted = solveAnnualRate(100000 - 5287 - 2050, pi, 360);
  assert.ok(ifEscrowCounted > withPrepaid + 0.1,
    "folding escrow in would overstate the APR, which is why it is excluded");
});

test("with no finance charges the APR equals the note rate", () => {
  const pi = monthlyPI(100000, 6.99, 30);
  near(solveAnnualRate(100000, pi, 360), 6.99, 0.002);
});

test("APR is always at or above the note rate", () => {
  for (const [loan, rate, fc] of [[100000, 6.99, 5000], [300000, 6.25, 9000], [58395, 7.5, 1200]]) {
    const pi = monthlyPI(loan, rate, 30);
    const apr = solveAnnualRate(loan - fc, pi, 360);
    assert.ok(apr >= rate, `APR ${apr} must be >= note rate ${rate}`);
  }
});
