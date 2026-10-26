# Independent recomputation from the credit report. Nothing here reads the app.
from decimal import Decimal as D

REVOLVING = [("Capital One",2688,89),("Avant LLC Web Bank",1609,97),("Merrick Bank Corp",1410,55),
 ("TBOM CCI MC",1088,54),("CB Indigo CCI",1064,53),("Capital One",969,32),("Capital One",729,25),
 ("TBOM Milestone",726,40),("Credit One Bank NA",698,35),("Webbank Onemain FIS",643,25),
 ("TBOM ATLS Aspire",501,81),("Capital One",469,28),("Capital One",457,25),("Petal 1 Rise",296,25)]
MORT_BAL, MORT_PAY = 58395, 1115
STUDENT_BAL, STUDENT_PAY = 82517, 0          # excluded by instruction
LOAN, RATE, TERM = 100000, D("0.0699"), 360
ESCROW_YR, COSTS, RES_MONTHS, PREPAID_DAYS = 8200, 5000, 3, 15
VALUE = 326000

fail = []
def check(label, got, want, tol=0):
    ok = abs(got-want) <= tol
    if not ok: fail.append(f"{label}: got {got} want {want}")
    print(f"{'OK ' if ok else 'XX '} {label:<34} {got:>12,.2f}   expected {want:>12,.2f}")

rev_bal = sum(x[1] for x in REVOLVING); rev_pay = sum(x[2] for x in REVOLVING)
check("revolving balances (14)", rev_bal, 13347)
check("revolving payments (14)", rev_pay, 664)
check("credit summary REVOLVING row", rev_bal, 13347)

payoff = MORT_BAL + rev_bal
check("payoffs = mortgage + cards", payoff, 71742)
today = MORT_PAY + rev_pay
check("today's payment total", today, 1779)
check("student loan excluded from today", today, 1779)

r = RATE/12
pi = D(LOAN) * r / (1 - (1+r)**-TERM)
check("P&I 100,000 @ 6.99% / 30yr", float(pi), 664.63, 0.01)
esc_mo = D(ESCROW_YR)/12
check("escrow per month", float(esc_mo), 683.333, 0.01)
new_pay = pi + esc_mo
check("new monthly payment", float(new_pay), 1347.96, 0.01)
check("new payment, rounded", round(float(new_pay)), 1348)

ltv = LOAN/VALUE*100
check("LTV %", ltv, 30.67, 0.01)
print(f"    -> LTV {ltv:.1f}% is well under 80%, so no PMI. Correct to show $0.")

esc_res = round(float(esc_mo) * RES_MONTHS)
check("escrow reserve (3 mo)", esc_res, 2050)
daily = D(LOAN)*RATE/365
check("per-diem interest", float(daily), 19.1507, 0.001)
prepaid_int = round(float(daily) * PREPAID_DAYS)
check(f"prepaid interest ({PREPAID_DAYS} days)", prepaid_int, 287)
res = esc_res + prepaid_int
check("escrow + prepaids line", res, 2337)
cash = LOAN - payoff - COSTS - res
check("cash back", cash, 20921)
check("loan reconciles", payoff + COSTS + res + cash, LOAN)

# APR: amount financed = loan less prepaid finance charges (costs + prepaid interest).
# Escrow reserves are NOT a finance charge, so they stay out.
fin_chg = COSTS + prepaid_int
check("prepaid finance charges", fin_chg, 5287)
af = LOAN - fin_chg
check("amount financed", af, 94713)
lo, hi = 1e-12, 1.0
for _ in range(300):
    mid = (lo+hi)/2
    pv = float(pi)*(1-(1+mid)**-TERM)/mid
    lo, hi = (mid, hi) if pv > af else (lo, mid)
apr = (lo+hi)/2*12*100
check("APR (solved on amount financed)", apr, 7.5367, 0.001)
print(f"    -> APR {apr:.3f}% vs note rate 6.990%; spread {apr-6.99:.3f} pt. "
      "Conservative: it treats the whole $5,000 as a finance charge.")

delta = today - float(new_pay)
check("monthly saving", delta, 431.04, 0.01)
check("monthly saving, rounded", round(delta), 431)
check("first-year saving", delta*12, 5172.5, 0.1)
check("first-year, rounded", round(delta*12), 5172)

check("accounts closed (ex mortgage)", len(REVOLVING), 14)
check("debt cleared (ex mortgage)", rev_bal, 13347)
check("liabilities paid off", len(REVOLVING)+1, 15)
check("after table balance", LOAN, 100000)
check("after table payment", round(float(new_pay)), 1348)

print(f"\n    Per-diem is ${daily:.2f}/day: ${daily*15:,.0f} at 15 days (on the sheet), "
      f"${daily*30:,.0f} at a full month.")
print("\n" + ("ALL CHECKS PASSED" if not fail else "FAILURES:\n  " + "\n  ".join(fail)))
