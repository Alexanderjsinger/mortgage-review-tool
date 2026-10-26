/**
 * Tests for the credit-report import.
 *
 * The parser lives inside worker/app.html between the @import:start and
 * @import:end markers. This file extracts that region and evaluates it, so
 * app.html stays the single source of truth.
 *
 * The fixture is a real trade-account table. Its own Summary of Trade Accounts
 * block reported these totals, which the assertions check against:
 *   MORTGAGE    3 accounts   $58,395 balance   $1,115/mo
 *   INSTALLMENT 1 account    $82,517 balance       $0/mo
 *   REVOLVING  14 accounts   $13,347 balance     $664/mo
 *   TOTAL      18 accounts  $154,259 balance   $1,779/mo
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "worker", "app.html"), "utf8");

const startMark = html.indexOf("/* @import:start");
const endMark = html.indexOf("/* @import:end */");
assert.ok(
  startMark !== -1 && endMark !== -1 && endMark > startMark,
  "could not find the @import markers in worker/app.html"
);
const source = html.slice(html.indexOf("*/", startMark) + 2, endMark);

// No DOM. If the parser ever reaches for `document`, this throws — the point.
const ctx = vm.createContext({ Math, Number, String, Set, Array, JSON, RegExp, isNaN });
vm.runInContext(source, ctx);
const { parseTable, readCreditRows, defaultPlan, cleanCreditorName, moneyNum, splitDelimited, creditLoanProgram } =
  vm.runInContext(
    "({ parseTable, readCreditRows, defaultPlan, cleanCreditorName, moneyNum, splitDelimited, creditLoanProgram })",
    ctx
  );
// readSummaryRows is reached through readCreditRows; this is just a shorthand.
const readSummaryParse = text => readCreditRows(parseTable(text));

const HEADER =
  "\tTrade Accounts Name\tStatus\tAccount Balance\tMonthly Payment\tAccount Type\tCredit Loan Type\t30 days late\tAccount Status\tCredit Limit\tPast Due A...";

const ROWS = [
  ["1", "MOHELA/NAVIENT/3306739", "Satisfactory", "$82,517", "$0", "Installment", "Education Loan", "0", "Open", "", "$0"],
  ["2", "CROSSCOUNTRY/CHAMPION/1917732", "Satisfactory", "$58,395", "$1,115", "Mortgage", "Fha Real Estate Loan", "2", "Open", "", "$0"],
  ["3", "CAPITAL ONE/1270246", "Satisfactory", "$2,688", "$89", "Revolving", "Credit Card, Terms REV", "0", "Open", "$2,750", "$0"],
  ["4", "AVANT LLC/WEB BANK/1977198", "Satisfactory", "$1,609", "$97", "Revolving", "Credit Card, Terms REV", "0", "Open", "$1,500", "$0"],
  ["5", "MERRICK BANK CORP/0206610", "Satisfactory", "$1,410", "$55", "Revolving", "Credit Card, Terms REV", "0", "Open", "$1,400", "$0"],
  ["6", "TBOM/CCI MC/3907455", "Satisfactory", "$1,088", "$54", "Revolving", "Credit Card, Terms REV", "0", "Open", "$1,000", "$0"],
  ["7", "CB INDIGO/CCI/1908211", "Satisfactory", "$1,064", "$53", "Revolving", "Credit Card, Terms REV", "0", "Open", "$1,000", "$0"],
  ["8", "CAPITAL ONE/1270246", "Satisfactory", "$969", "$32", "Revolving", "Credit Card, Terms REV", "0", "Open", "$1,000", "$0"],
  ["9", "CAPITAL ONE/1270246", "Satisfactory", "$729", "$25", "Revolving", "Credit Card, Terms REV", "0", "Open", "$750", "$0"],
  ["10", "TBOM/MILESTONE/1933961", "Satisfactory", "$726", "$40", "Revolving", "Credit Card, Terms REV", "0", "Open", "$700", "$0"],
  ["11", "CREDIT ONE BANK NA/3278143", "Satisfactory", "$698", "$35", "Revolving", "Credit Card, Terms REV", "1", "Open", "$600", "$0"],
  ["12", "WEBBANK/ONEMAIN/FIS/2922594", "Satisfactory", "$643", "$25", "Revolving", "Credit Card, Terms REV", "0", "Open", "$850", "$0"],
  ["13", "TBOM/ATLS/ASPIRE/2913012", "Satisfactory", "$501", "$81", "Revolving", "Credit Card, Terms REV", "0", "Open", "$500", "$0"],
  ["14", "CAPITAL ONE/1270246", "Satisfactory", "$469", "$28", "Revolving", "Credit Card, Terms REV", "0", "Open", "$500", "$0"],
  ["15", "CAPITAL ONE/1270246", "Satisfactory", "$457", "$25", "Revolving", "Credit Card, Terms REV", "0", "Open", "$500", "$0"],
  ["16", "PETAL 1 RISE/2947980", "Satisfactory", "$296", "$25", "Revolving", "Credit Card, Terms REV", "0", "Open", "$300", "$0"],
  ["17", "CROSSCOUNTRY MTG/DOVEN/1969343", "NoDataAvailable", "$0", "$0", "Mortgage", "Fha Real Estate Loan", "0", "Closed", "", "$0"],
  ["18", "US BANK HOME MORTGAGE/4129430", "NoDataAvailable", "$0", "$0", "Mortgage", "Fha Real Estate Loan", "0", "Closed", "", "$0"],
];
const REPORT = [HEADER].concat(ROWS.map(r => r.join("\t"))).join("\n");

const sum = (list, key) => list.reduce((a, x) => a + x[key], 0);

/* ---------------------------------------------------------------
   Reading the real report
   --------------------------------------------------------------- */

test("the pasted report reconciles to the credit summary's own totals", () => {
  const r = readCreditRows(parseTable(REPORT));
  assert.equal(r.error, undefined, r.error);

  // 18 tradelines: 1 becomes the mortgage, 2 are closed, 15 are accounts.
  assert.equal(r.accounts.length, 15);
  assert.equal(r.skipped, 2);

  // The open mortgage, matching the summary's MORTGAGE row.
  assert.equal(r.mortgage.bal, 58395);
  assert.equal(r.mortgage.pay, 1115);

  // Everything else: $154,259 total less the mortgage's $58,395.
  assert.equal(sum(r.accounts, "bal"), 154259 - 58395);
  assert.equal(sum(r.accounts, "pay"), 1779 - 1115);

  // The revolving slice alone must match the summary's REVOLVING row.
  const rev = r.accounts.filter(a => a.type.includes("revolving"));
  assert.equal(rev.length, 14);
  assert.equal(sum(rev, "bal"), 13347);
  assert.equal(sum(rev, "pay"), 664);
});

test("closed and zero-balance tradelines never reach the review", () => {
  const r = readCreditRows(parseTable(REPORT));
  const names = r.accounts.map(a => a.name.toLowerCase()).join(" ");
  assert.ok(!names.includes("doven"), "closed CrossCountry mortgage excluded");
  assert.ok(!names.includes("us bank"), "closed US Bank mortgage excluded");
  assert.ok(r.accounts.every(a => a.bal > 0), "no zero balances");
});

test("accounts arrive largest balance first", () => {
  // Spread into host arrays: values from the sandbox carry its own prototypes,
  // which strict deepEqual rejects even when the contents match.
  const bals = [...readCreditRows(parseTable(REPORT)).accounts.map(a => a.bal)];
  assert.deepEqual(bals, [...bals].sort((a, b) => b - a));
});

/* ---------------------------------------------------------------
   What gets paid off, and what does not
   --------------------------------------------------------------- */

test("revolving defaults to pay off, everything else to keep", () => {
  const r = readCreditRows(parseTable(REPORT));
  const byName = Object.fromEntries(r.accounts.map(a => [a.name, defaultPlan(a)]));
  assert.equal(byName["Capital One"], "payoff");
  // A $82,517 education loan must not be rolled into a mortgage by default.
  assert.equal(byName["Mohela Navient"], "keep");
  assert.equal(r.accounts.filter(a => defaultPlan(a) === "payoff").length, 14);
});

test("the paid-off slice is what lands in the loan amount", () => {
  const r = readCreditRows(parseTable(REPORT));
  const payoff = r.accounts.filter(a => defaultPlan(a) === "payoff");
  assert.equal(sum(payoff, "bal"), 13347, "only the cards roll in");
  assert.equal(sum(payoff, "pay"), 664, "and only their payments are freed");
});

/* ---------------------------------------------------------------
   Refusing the wrong table
   --------------------------------------------------------------- */

test("the Summary of Trade Accounts imports as grouped rows", () => {
  const summary = [
    "TYPE\tCOUNT\tBALANCE\tHIGH CREDIT\tPAYMENTS\tPAST DUE",
    "MORTGAGE (REAL ESTATE)\t3\t58,395\t60,000\t1,115\t0",
    "INSTALLMENT\t1\t82,517\t52,766\t0\t0",
    "REVOLVING\t14\t13,347\t14,134\t664\t0",
    "OTHER\t0\t0\t0\t0\t0",
    "TOTAL\t18\t154,259\t126,900\t1,779\t0",
  ].join("\n");
  const r = readCreditRows(parseTable(summary));
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.mode, "summary");
  // One row per account type that carries a balance; the mortgage is lifted out
  // and the TOTAL row is a checksum, not an account.
  assert.equal(r.accounts.length, 2);
  assert.equal(r.mortgage.bal, 58395);
  assert.equal(r.mortgage.pay, 1115);
  assert.equal(r.mismatch, null, "the parts add up to TOTAL");

  const rev = r.accounts.find(a => a.type === "revolving");
  assert.equal(rev.bal, 13347);
  assert.equal(rev.pay, 664);
  assert.match(rev.name, /14/, "the count rides along in the label");
  assert.equal(defaultPlan(rev), "payoff");

  const inst = r.accounts.find(a => a.type === "installment");
  assert.equal(inst.bal, 82517);
  assert.equal(defaultPlan(inst), "keep");

  // A zero row contributes nothing.
  assert.ok(!r.accounts.some(a => a.type === "other"));
});

test("a summary whose parts do not add up to TOTAL is flagged", () => {
  // A row clipped out of the paste is the likely cause, and the figures would
  // be wrong in a way nothing downstream could catch.
  const clipped = [
    "Type\tCount\tBalance\tHigh Credit\tPayments\tPast Due",
    "Mortgage (Real Estate)\t3\t58,395\t60,000\t1,115\t0",
    "Revolving\t14\t13,347\t14,134\t664\t0",
    "TOTAL\t18\t154,259\t126,900\t1,779\t0",
  ].join("\n");
  const r = readSummaryParse(clipped);
  assert.ok(r.mismatch, "mismatch reported");
  assert.equal(r.mismatch.totalBal, 154259);
  assert.equal(r.mismatch.sumBal, 58395 + 13347, "the clipped installment row is missing");
});

test("summary and itemized tables agree on the numbers that drive the review", () => {
  // Same file, two tables. Whichever one is pasted, the comparison must match.
  const summary = [
    "Type\tCount\tBalance\tHigh Credit\tPayments\tPast Due",
    "Mortgage (Real Estate)\t3\t58,395\t60,000\t1,115\t0",
    "Installment\t1\t82,517\t52,766\t0\t0",
    "Revolving\t14\t13,347\t14,134\t664\t0",
    "Other\t0\t0\t0\t0\t0",
    "TOTAL\t18\t154,259\t126,900\t1,779\t0",
  ].join("\n");
  const a = readCreditRows(parseTable(summary));
  const b = readCreditRows(parseTable(REPORT));

  assert.equal(a.mortgage.bal, b.mortgage.bal);
  assert.equal(a.mortgage.pay, b.mortgage.pay);

  const payoff = r => r.accounts.filter(x => defaultPlan(x) === "payoff");
  assert.equal(sum(payoff(a), "bal"), sum(payoff(b), "bal"), "same amount rolls in");
  assert.equal(sum(payoff(a), "pay"), sum(payoff(b), "pay"), "same amount is freed");
  assert.equal(sum(a.accounts, "pay"), sum(b.accounts, "pay"), "same today-total");
});

test("the itemized table still takes the detail path", () => {
  assert.equal(readCreditRows(parseTable(REPORT)).mode, "detail");
});

test("empty input fails loudly; headerless input is inferred instead", () => {
  assert.match(readCreditRows(parseTable("")).error, /paste/i);
  assert.match(readCreditRows(parseTable("   \n  ")).error, /paste/i);
  // A name and two amounts is enough to work out without headings.
  const r = readCreditRows(parseTable("CAPITAL ONE\t$2,688\t$89"));
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.accounts[0].bal, 2688);
  assert.equal(r.accounts[0].pay, 89);
});

test("nonsense that has no name and no amounts is still refused", () => {
  assert.ok(readCreditRows(parseTable("x\ty\nz\tw")).error);
});

/* ---------------------------------------------------------------
   Format handling
   --------------------------------------------------------------- */

test("CSV with quoted commas parses as one field, not three", () => {
  const csv = [
    "Trade Accounts Name,Account Balance,Monthly Payment,Account Type,Account Status",
    '"CAPITAL ONE, NA/1270246","$2,688","$89",Revolving,Open',
    '"US BANK HOME MORTGAGE/4129430","$0","$0",Mortgage,Closed',
  ].join("\n");
  const r = readCreditRows(parseTable(csv));
  assert.equal(r.accounts.length, 1);
  assert.equal(r.accounts[0].bal, 2688);
  assert.equal(r.accounts[0].pay, 89);
  assert.equal(r.skipped, 1);
});

test("column order can move without breaking the mapping", () => {
  const moved = [
    "Monthly Payment\tAccount Status\tTrade Accounts Name\tAccount Type\tAccount Balance",
    "$89\tOpen\tCAPITAL ONE/1270246\tRevolving\t$2,688",
    "$1,115\tOpen\tCROSSCOUNTRY/CHAMPION/1917732\tMortgage\t$58,395",
  ].join("\n");
  const r = readCreditRows(parseTable(moved));
  assert.equal(r.mortgage.bal, 58395);
  assert.equal(r.mortgage.pay, 1115);
  assert.equal(r.accounts[0].bal, 2688);
  assert.equal(r.accounts[0].pay, 89);
});

test("a leading row-number column does not shift the fields", () => {
  const r = readCreditRows(parseTable(REPORT));
  // Row 3 of the report is Capital One at $2,688 / $89. If the unnamed
  // leading column shifted anything, these would be off by one field.
  const one = r.accounts.find(a => a.bal === 2688);
  assert.ok(one, "found the row");
  assert.equal(one.pay, 89);
  assert.equal(one.name, "Capital One");
});

test("money parsing survives the shapes a credit view emits", () => {
  assert.equal(moneyNum("$82,517"), 82517);
  assert.equal(moneyNum("$0"), 0);
  assert.equal(moneyNum(""), 0);
  assert.equal(moneyNum("1 115"), 1115);
  assert.equal(moneyNum("n/a"), 0, "unparseable is zero, never NaN");
  assert.ok(!Number.isNaN(moneyNum(undefined)));
});

test("splitDelimited handles escaped quotes inside a field", () => {
  assert.deepEqual([...splitDelimited('a,"b,c",d', ",")], ["a", "b,c", "d"]);
  assert.deepEqual([...splitDelimited('"say ""hi""",x', ",")], ['say "hi"', "x"]);
});

/* ---------------------------------------------------------------
   Creditor names on a client-facing sheet
   --------------------------------------------------------------- */

test("creditor names lose the account number and stop shouting", () => {
  assert.equal(cleanCreditorName("CAPITAL ONE/1270246"), "Capital One");
  assert.equal(cleanCreditorName("MOHELA/NAVIENT/3306739"), "Mohela Navient");
  assert.equal(cleanCreditorName("MERRICK BANK CORP/0206610"), "Merrick Bank Corp");
  assert.equal(cleanCreditorName(""), "");
});

test("real initialisms stay uppercase", () => {
  // "ONE" is a word and must not survive as "ONE"; LLC, NA and FIS must.
  assert.equal(cleanCreditorName("AVANT LLC/WEB BANK/1977198"), "Avant LLC Web Bank");
  assert.equal(cleanCreditorName("CREDIT ONE BANK NA/3278143"), "Credit One Bank NA");
  assert.equal(cleanCreditorName("WEBBANK/ONEMAIN/FIS/2922594"), "Webbank Onemain FIS");
  assert.equal(cleanCreditorName("TBOM/CCI MC/3907455"), "TBOM CCI MC");
});

test("an account number is only stripped from the end", () => {
  // A digit run that is part of the brand stays put.
  assert.equal(cleanCreditorName("PETAL 1 RISE/2947980"), "Petal 1 Rise");
});

/* ---------------------------------------------------------------
   More than one open mortgage
   --------------------------------------------------------------- */

test("with two open mortgages the larger leads and the other stays an account", () => {
  const two = [
    "Trade Accounts Name\tAccount Balance\tMonthly Payment\tAccount Type\tAccount Status",
    "FIRST LIEN/111\t$240,000\t$1,800\tMortgage\tOpen",
    "SECOND LIEN/222\t$45,000\t$410\tMortgage\tOpen",
    "CAPITAL ONE/333\t$2,000\t$60\tRevolving\tOpen",
  ].join("\n");
  const r = readCreditRows(parseTable(two));
  assert.equal(r.mortgage.bal, 240000, "largest becomes the current loan");
  const second = r.accounts.find(a => a.bal === 45000);
  assert.ok(second, "the second lien is not dropped");
  assert.equal(defaultPlan(second), "keep", "a second mortgage is not auto-consolidated");
});

test("a report with no open mortgage still imports the rest", () => {
  const none = [
    "Trade Accounts Name\tAccount Balance\tMonthly Payment\tAccount Type\tAccount Status",
    "CAPITAL ONE/333\t$2,000\t$60\tRevolving\tOpen",
  ].join("\n");
  const r = readCreditRows(parseTable(none));
  assert.equal(r.mortgage, null);
  assert.equal(r.accounts.length, 1);
});

/* ---------------------------------------------------------------
   The column mapper's contract
   When a paste has no headings, the UI collects the column choices and
   synthesizes the header row the parser wanted. The mapper itself is DOM
   work, but the invariant it rests on is testable: a synthesized header
   must reach the same answer as the real one.
   --------------------------------------------------------------- */

test("a synthesized header reproduces the real header's result", () => {
  const withHeader = readCreditRows(parseTable(REPORT));
  // Same rows, headings stripped, then rebuilt from column positions the way
  // "Use these columns" does it.
  const body = ROWS.map(r => r.join("\t"));
  const synth = new Array(ROWS[0].length).fill("");
  synth[1] = "Trade Accounts Name";
  synth[3] = "Account Balance";
  synth[4] = "Monthly Payment";
  synth[5] = "Account Type";
  synth[8] = "Account Status";
  const mapped = readCreditRows(parseTable([synth.join("\t")].concat(body).join("\n")));

  assert.equal(mapped.error, undefined, mapped.error);
  assert.equal(mapped.accounts.length, withHeader.accounts.length);
  assert.equal(mapped.mortgage.bal, withHeader.mortgage.bal);
  assert.equal(mapped.mortgage.pay, withHeader.mortgage.pay);
  assert.equal(sum(mapped.accounts, "bal"), sum(withHeader.accounts, "bal"));
  assert.equal(sum(mapped.accounts, "pay"), sum(withHeader.accounts, "pay"));
  assert.equal(mapped.skipped, withHeader.skipped);
});

test("mapping only name, balance and payment still imports, minus the extras", () => {
  // Type and status are optional. Without them nothing is skipped and the
  // mortgage is not lifted out — so the totals cover every row.
  const body = ROWS.map(r => r.join("\t"));
  const synth = new Array(ROWS[0].length).fill("");
  synth[1] = "Trade Accounts Name";
  synth[3] = "Account Balance";
  synth[4] = "Monthly Payment";
  const r = readCreditRows(parseTable([synth.join("\t")].concat(body).join("\n")));
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.mortgage, null, "no type column means no mortgage detected");
  assert.equal(sum(r.accounts, "bal"), 154259, "every open row, matching TOTAL");
  assert.equal(sum(r.accounts, "pay"), 1779);
});

/* ---------------------------------------------------------------
   The loan program, read off the report
   --------------------------------------------------------------- */

test("the reported loan type maps to a program the form understands", () => {
  // These are the strings a credit report actually prints.
  assert.equal(creditLoanProgram("Fha Real Estate Loan"), "FHA");
  assert.equal(creditLoanProgram("FHA REAL ESTATE MORTGAGE"), "FHA");
  assert.equal(creditLoanProgram("VA Real Estate Loan"), "VA");
  assert.equal(creditLoanProgram("Conventional Real Estate Mortgage"), "Conventional");
  assert.equal(creditLoanProgram("USDA Rural Housing"), "USDA");
});

test("an unrecognized loan type sets nothing rather than guessing", () => {
  // A wrong program silently changes the MI estimate, so no match means the
  // field is left for the user.
  assert.equal(creditLoanProgram("Real Estate Loan"), "");
  assert.equal(creditLoanProgram("Credit Card, Terms REV"), "");
  assert.equal(creditLoanProgram(""), "");
  assert.equal(creditLoanProgram(undefined), "");
});

test("the mortgage row carries its loan type through for the form to use", () => {
  const r = readCreditRows(parseTable(REPORT));
  assert.match(r.mortgage.loan, /fha/i, "the raw type survives the parse");
  assert.equal(creditLoanProgram(r.mortgage.loan), "FHA");
});

/* ---------------------------------------------------------------
   Finding the header row
   Vendors label these columns differently, so detection takes any two of
   balance / payment / who. The risk in loosening it is mistaking a data row
   for a header, which would silently drop the first account.
   --------------------------------------------------------------- */

test("alternate column vocabularies are recognized as headers", () => {
  const variants = [
    "Creditor,Amount Owed,Minimum Payment",
    "Lender\tPrincipal\tMonthly",
    "Company,Balance,Min Due",
  ];
  for (const head of variants) {
    const delim = head.includes("\t") ? "\t" : ",";
    const body = ["CAPITAL ONE", "2688", "89"].join(delim);
    const r = readCreditRows(parseTable(head + "\n" + body));
    assert.equal(r.error, undefined, `${head} -> ${r.error}`);
    assert.equal(r.accounts[0].bal, 2688);
    assert.equal(r.accounts[0].pay, 89);
  }
});

test("no row is eaten as a header when there is no header", () => {
  // "Mortgage" matches the who-pattern, so without the numeric guard the first
  // row would be swallowed as headings and that account silently lost.
  const noHead = [
    "CROSSCOUNTRY/CHAMPION/1917732\t58,395\t1,115\tMortgage\tOpen",
    "CAPITAL ONE/1270246\t2,688\t89\tRevolving\tOpen",
  ].join("\n");
  const r = readCreditRows(parseTable(noHead));
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.mortgage.bal, 58395, "the mortgage row survived");
  assert.equal(r.mortgage.pay, 1115);
  assert.equal(r.accounts.length, 1, "and so did the card");
  assert.equal(r.accounts[0].bal, 2688);
});

test("the real report's header is still found after loosening", () => {
  const r = readCreditRows(parseTable(REPORT));
  assert.equal(r.error, undefined);
  assert.equal(r.accounts.length, 15);
  assert.equal(r.mortgage.bal, 58395);
});

test("the summary table's header is still found after loosening", () => {
  const summary = [
    "Type\tCount\tBalance\tHigh Credit\tPayments\tPast Due",
    "Mortgage (Real Estate)\t3\t58,395\t60,000\t1,115\t0",
    "Revolving\t14\t13,347\t14,134\t664\t0",
    "TOTAL\t18\t71,742\t74,134\t1,779\t0",
  ].join("\n");
  const r = readCreditRows(parseTable(summary));
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.mode, "summary");
});

/* ---------------------------------------------------------------
   The paste that was actually failing
   Short, abbreviated headings: "Account" not "Trade Accounts Name",
   "Bal" not "Account Balance", "Acct. Status" not "Account Status".
   --------------------------------------------------------------- */

const ALEX_HEAD = "Account\tStatus\tBal\tPayment\tType\tLoan Type\tLates\tAcct. Status\tLimit\tPast";
const ALEX_BODY = "MOHELA/NAVIENT/3306739\t\t82517\t0\tInstallment\tEducation\t0\tOpen\t\t0\nCROSSCOUNTRY/CHAMPION/1917732\tSatisfactory\t58395\t1115\tMortgage\tFha Real Estate Loan\t2\tOpen\t\t0\nCAPITAL ONE/1270246\tSatisfactory\t2688\t89\tRevolving\tCredit Card, Terms REV\t0\tOpen\t2750\t0\nAVANT LLC/WEB BANK/1977198\tSatisfactory\t1609\t97\tRevolving\tCredit Card, Terms REV\t0\tOpen\t1500\t0\nMERRICK BANK CORP/0206610\tSatisfactory\t1410\t55\tRevolving\tCredit Card, Terms REV\t0\tOpen\t1400\t0\nTBOM/CCI MC/3907455\tSatisfactory\t1088\t54\tRevolving\tCredit Card, Terms REV\t0\tOpen\t1000\t0\nCB INDIGO/CCI/1908211\tSatisfactory\t1064\t53\tRevolving\tCredit Card, Terms REV\t0\tOpen\t1000\t0\nCAPITAL ONE/1270246\tSatisfactory\t969\t32\tRevolving\tCredit Card, Terms REV\t0\tOpen\t1000\t0\nCAPITAL ONE/1270246\tSatisfactory\t729\t25\tRevolving\tCredit Card, Terms REV\t0\tOpen\t750\t0\nTBOM/MILESTONE/1933961\tSatisfactory\t726\t40\tRevolving\tCredit Card, Terms REV\t0\tOpen\t700\t0\nCREDIT ONE BANK NA/3278143\tSatisfactory\t698\t35\tRevolving\tCredit Card, Terms REV\t1\tOpen\t600\t0\nWEBBANK/ONEMAIN/FIS/2922594\tSatisfactory\t643\t25\tRevolving\tCredit Card, Terms REV\t0\tOpen\t850\t0\nTBOM/ATLS/ASPIRE/2913012\tSatisfactory\t501\t81\tRevolving\tCredit Card, Terms REV\t0\tOpen\t500\t0\nCAPITAL ONE/1270246\tSatisfactory\t469\t28\tRevolving\tCredit Card, Terms REV\t0\tOpen\t500\t0\nCAPITAL ONE/1270246\tSatisfactory\t457\t25\tRevolving\tCredit Card, Terms REV\t0\tOpen\t500\t0\nPETAL 1 RISE/2947980\tSatisfactory\t296\t25\tRevolving\tCredit Card, Terms REV\t0\tOpen\t300\t0\nCROSSCOUNTRY MTG/DOVEN/1969343\tNoDataAvailable\t0\t0\tMortgage\tFha Real Estate Loan\t0\tClosed\t\t0\nUS BANK HOME MORTGAGE/4129430\tNoDataAvailable\t0\t0\tMortgage\tFha Real Estate Loan\t0\tClosed\t\t0";

test("abbreviated headings import, and reconcile to the credit summary", () => {
  const r = readCreditRows(parseTable(ALEX_HEAD + "\n" + ALEX_BODY));
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.accounts.length, 15);
  assert.equal(r.skipped, 2);
  assert.equal(r.mortgage.bal, 58395);
  assert.equal(r.mortgage.pay, 1115);
  assert.equal(creditLoanProgram(r.mortgage.loan), "FHA");
  const payoff = r.accounts.filter(a => defaultPlan(a) === "payoff");
  assert.equal(sum(payoff, "bal"), 13347, "matches the summary's REVOLVING row");
  assert.equal(sum(payoff, "pay"), 664);
});

test("\"Acct. Status\" is not mistaken for the account name column", () => {
  // Both contain the word "Account". If status wins, every creditor is "Open".
  const r = readCreditRows(parseTable(ALEX_HEAD + "\n" + ALEX_BODY));
  assert.match(r.accounts[0].name, /Mohela/i);
  assert.ok(!r.accounts.some(a => /^(Open|Closed)$/i.test(a.name)), "no row named Open");
});

test("the same paste without its headings lands on the same numbers", () => {
  const withHead = readCreditRows(parseTable(ALEX_HEAD + "\n" + ALEX_BODY));
  const noHead = readCreditRows(parseTable(ALEX_BODY));
  assert.equal(noHead.error, undefined, noHead.error);
  assert.equal(noHead.accounts.length, withHead.accounts.length);
  assert.equal(noHead.mortgage.bal, withHead.mortgage.bal);
  assert.equal(noHead.mortgage.pay, withHead.mortgage.pay);
  assert.equal(sum(noHead.accounts, "bal"), sum(withHead.accounts, "bal"));
  assert.equal(sum(noHead.accounts, "pay"), sum(withHead.accounts, "pay"));
  assert.equal(creditLoanProgram(noHead.mortgage.loan), "FHA");
});

test("a leading row-number column is not read as money", () => {
  // Numbered rows are common in a copied table. If column 1 were taken as the
  // balance, every figure would shift one column left.
  const numbered = ALEX_ROWS_NUMBERED();
  const r = readCreditRows(parseTable(numbered));
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.mortgage.bal, 58395, "balance, not the row number");
  assert.equal(r.mortgage.pay, 1115);
});
function ALEX_ROWS_NUMBERED() {
  return ALEX_BODY.split("\n").map((l, i) => (i + 1) + "\t" + l).join("\n");
}

test("balance and payment are swapped back if the file lists them backwards", () => {
  // Payment before balance: the median check must put them right, because a
  // $25 balance against a $457 payment would invert every comparison.
  const backwards = [
    "CAPITAL ONE\t89\t2688",
    "AVANT LLC\t97\t1609",
    "MERRICK BANK\t55\t1410",
  ].join("\n");
  const r = readCreditRows(parseTable(backwards));
  assert.equal(r.error, undefined, r.error);
  assert.equal(sum(r.accounts, "bal"), 2688 + 1609 + 1410);
  assert.equal(sum(r.accounts, "pay"), 89 + 97 + 55);
});

