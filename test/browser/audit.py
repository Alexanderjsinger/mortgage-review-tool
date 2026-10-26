"""Independent recomputation of every scenario.

Nothing here imports or reads the app's JavaScript. The amortisation, FHA MIP,
APR solve, reserves and cash are all worked out again from the scenario inputs,
so a mistake in the app has to be repeated here to go unnoticed.

    node test/browser/audit-dump.mjs /tmp/audit.json
    python3 test/browser/audit.py /tmp/audit.json
"""
import json, re, sys
from decimal import Decimal as D

DUMP = sys.argv[1] if len(sys.argv) > 1 else '/tmp/audit.json'
SCEN = {s['n']: s for s in json.load(open(DUMP))}

# The same cases as test/browser/scenarios.mjs, restated independently.
INPUT = {
 'fixed conv cash-out': dict(program='Conventional', loan=100000, rate=7.5, value=326000, tax=8200, ins=0,
   costs=5500, title=1350, res=3, days=15, yrs=30,
   debts=[(58395,1115,'payoff'),(2688,89,'payoff'),(1609,97,'payoff'),(82517,0,'exclude')]),
 'FHA fixed cash-out': dict(program='FHA', loan=290000, rate=6.25, value=420000, tax=7600, ins=0,
   costs=6500, title=1900, res=3, days=15, yrs=30,
   debts=[(232204,2144,'payoff'),(7894,299,'payoff'),(6980,262,'payoff'),(3642,190,'payoff'),
          (2043,170,'payoff'),(1895,57,'payoff'),(95524,0,'exclude'),(33955,0,'exclude')]),
 'FHA 3/1 ARM rate+term': dict(program='FHA', loan=238000, rate=5.75, value=305000, tax=5300, ins=1800,
   costs=17971, title=0, res=3, days=15, yrs=30, debts=[(220029,2525,'payoff')]),
 '15 yr conv, kept debt': dict(program='Conventional', loan=200000, rate=6.0, value=400000, tax=4800, ins=1200,
   costs=4000, title=1200, res=2, days=10, yrs=15, debts=[(190000,1700,'payoff'),(14000,420,'keep')]),
 'no costs, no reserves': dict(program='Conventional', loan=150000, rate=6.5, value=300000, tax=3600, ins=900,
   costs=0, title=0, res=0, days=0, yrs=30, debts=[(148000,1400,'payoff')]),
 'free and clear cash-out': dict(program='Conventional', loan=100000, rate=7.25, value=260000, tax=4800, ins=1800,
   costs=4500, title=1350, res=3, days=15, yrs=30, debts=[], free_clear=True),
 'escrow waived cash-out': dict(program='Conventional', loan=260000, rate=7.0, value=400000, tax=6000, ins=1800,
   costs=5000, title=1350, res=4, days=15, yrs=30, debts=[(164000,1642,'payoff')], escrow_waived=True),
 'loan short of payoff': dict(program='Conventional', loan=200000, rate=6.75, value=300000, tax=4200, ins=1100,
   costs=6000, title=1200, res=3, days=15, yrs=30, debts=[(205000,1900,'payoff')]),
 'free and clear, waived': dict(program='Conventional', loan=150000, rate=7.125, value=500000, tax=7200, ins=2400,
   costs=5200, title=1400, res=4, days=20, yrs=30, debts=[], free_clear=True, escrow_waived=True),
 'VA cash-out, first use': dict(program='VA', loan=300000, rate=6.5, value=400000, tax=6000, ins=1800,
   costs=5500, title=1350, res=3, days=15, yrs=30, debts=[(240000,2100,'payoff')], va_fee=2.15),
 'VA IRRRL': dict(program='VA', loan=250000, rate=5.75, value=400000, tax=6000, ins=1800,
   costs=3200, title=1100, res=3, days=15, yrs=30, debts=[(246000,2050,'payoff')], va_fee=0.5),
 'VA rate and term, exempt': dict(program='VA', loan=250000, rate=6.25, value=400000, tax=6000, ins=1800,
   costs=4200, title=1200, res=3, days=15, yrs=30, debts=[(243000,2080,'payoff')], va_fee=0.0),
 'FHA, taxes waived only': dict(program='FHA', loan=250000, rate=6.5, value=400000, tax=6000, ins=1800,
   costs=5500, title=1350, res=3, days=15, yrs=30, debts=[(240000,2100,'payoff')], waive_taxes=True),
 'conv, insurance waived only': dict(program='Conventional', loan=300000, rate=6.75, value=420000, tax=7200, ins=2100,
   costs=5000, title=1350, res=4, days=15, yrs=30, debts=[(230000,2000,'payoff')], waive_ins=True),
 'conv 5/1 ARM rate+term': dict(program='Conventional', loan=250000, rate=6.0, value=400000, tax=5400, ins=1500,
   costs=4500, title=1200, res=3, days=15, yrs=30, debts=[(242000,2050,'payoff')]),
 # A second lien escrows nothing — the retained first still collects taxes and
 # insurance — so its payment is principal and interest alone.
 'second lien behind a 3.25% first': dict(program='Conventional', loan=40000, rate=9.25, value=520000,
   tax=5200, ins=1600, costs=1800, title=650, res=0, days=15, yrs=20,
   debts=[(310000,1620,'keep'),(14000,420,'payoff'),(22000,560,'payoff')], second=True),
}


def pi(L, r, n):
    """Level monthly payment on L at annual rate r over n months."""
    if not L or not r:
        return 0.0
    i = D(str(r)) / 100 / 12
    return float(D(str(L)) * i / (1 - (1 + i) ** -n))


def apr_stream(amount_financed, payment, mi, mi_months, months):
    """APR solved against the actual payment stream, which for FHA has two
    segments: payment+MI while the MI runs, payment alone afterwards."""
    if not amount_financed or not payment:
        return 0.0
    def pv(monthly_rate):
        total = 0.0
        for k in range(1, months + 1):
            c = payment + (mi if k <= mi_months else 0)
            total += c / ((1 + monthly_rate) ** k)
        return total
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if pv(mid) > amount_financed else (lo, mid)
    return (lo + hi) / 2 * 12 * 100


def dollars(t):
    t = (t or '').replace('−', '-').replace('–', '-')
    m = re.search(r'-?[\d,]+(?:\.\d+)?', t)
    return float(m.group(0).replace(',', '')) if m else 0.0


fails = []
def ck(scen, label, got, want, tol=0.02):
    if abs(float(got) - float(want)) > tol:
        fails.append(f'{scen} | {label}: app {got} vs independent {want}')


checks = 0
for name, I in INPUT.items():
    if name not in SCEN:
        fails.append(f'{name} | missing from the dump')
        continue
    c = SCEN[name]['computed']
    sheet = SCEN[name]['sheet']
    n = I['yrs'] * 12
    second = I.get('second')
    rows = [d for d in I['debts'] if d[2] != 'exclude']
    payoff = sum(d[0] for d in I['debts'] if d[2] == 'payoff')
    today = sum(d[1] for d in rows)
    if I.get('free_clear'):
        today += (I['tax'] + I['ins']) / 12
    kept = sum(d[1] for d in rows if d[2] == 'keep')

    ck(name, 'payoffNeed', c['payoffNeed'], payoff, 0)
    ck(name, 'todayTotal', c['todayTotal'], today, 0.01)
    ck(name, 'keptPay', c['keptPay'], kept, 0.01)
    ck(name, 'newLoan', c['newLoan'], I['loan'], 0)

    # FHA finances an upfront premium on top of the base loan.
    up = round(I['loan'] * 0.0175) if I['program'] == 'FHA' else 0
    # VA charges a financed funding fee instead of mortgage insurance.
    va = round(I['loan'] * I['va_fee'] / 100) if I['program'] == 'VA' and 'va_fee' in I else 0
    note = I['loan'] + up + va
    ck(name, 'upfrontMip', c['upfrontMip'], up, 0)
    ck(name, 'vaFundingFee', c.get('vaFundingFee', 0), va, 0)
    ck(name, 'notePrincipal', c['notePrincipal'], note, 0)
    ck(name, 'newPI', c['newPI'], pi(note, I['rate'], n), 0.01)

    ltv = I['loan'] / I['value'] * 100
    ck(name, 'newLtv', c['newLtv'], ltv, 0.01)
    retained = sum(d[0] for d in I['debts'] if d[2] == 'keep') if second else 0
    ck(name, 'retainedFirst', c.get('retainedFirst', 0), retained, 0)
    ck(name, 'cltv', c.get('cltv', 0), (I['loan'] + retained) / I['value'] * 100, 0.01)
    ck(name, 'quotedLtv is the combined one on a second', c.get('quotedLtv', 0),
       (I['loan'] + retained) / I['value'] * 100 if second else ltv, 0.01)
    if I['program'] == 'FHA':
        # The rate is picked from the base-loan LTV, but the premium is charged
        # on the outstanding balance, which includes the financed UFMIP. Do not
        # "simplify" this to the base loan: the two differ by about 1.75%.
        mi_rate = 0.55 if ltv > 95 else 0.50
        ck(name, 'newMI', c['newMI'], round(note * mi_rate / 100 / 12), 0.51)
        ck(name, 'mipYears', c['mipYears'], 30 if ltv > 90 else 11, 0)
    else:
        ck(name, 'newMI (conv, none)', c['newMI'], 0, 0)

    waive_t = I.get('waive_taxes') or I.get('escrow_waived')
    waive_i = I.get('waive_ins') or I.get('escrow_waived')
    # The first mortgage keeps escrowing, so a second lien adds no escrow of
    # its own; counting it again would double-charge the client.
    esc_m = 0 if second else I['tax'] / 12 + I['ins'] / 12
    direct = 0 if second else (I['tax'] / 12 if waive_t else 0) + (I['ins'] / 12 if waive_i else 0)
    escrowed = esc_m - direct
    allin = pi(note, I['rate'], n) + esc_m + c['newMI']
    payment = allin - direct
    ck(name, 'newTotal (the payment)', c['newTotal'], payment, 0.01)
    ck(name, 'afterTotal (all-in)', c['afterTotal'], allin + kept, 0.01)
    ck(name, 'delta', c['delta'], today - (allin + kept), 0.01)
    ck(name, 'directEscrow', c.get('directEscrow', 0), direct, 0.01)
    ck(name, 'escrowedMonthly', c.get('escrowedMonthly', 0), escrowed, 0.01)
    ck(name, 'lenderPayment matches the payment', c['lenderPayment'], c['newTotal'], 1)
    ck(name, 'currentEscrow', c.get('currentEscrow', 0), esc_m if I.get('free_clear') else 0, 0.01)

    # A waiver must not make the change in monthly cost look smaller than it is.
    if direct:
        ck(name, 'waiver does not shrink the monthly change', c['delta'], today - (allin + kept), 0.01)

    # Reserves follow only what is still escrowed.
    esc_res = round(escrowed * I['res'])
    daily = note * I['rate'] / 100 / 365
    pre = round(daily * I['days'])
    ck(name, 'escrowReserve', c['escrowReserve'], esc_res, 1)
    ck(name, 'prepaidInterest', c['prepaidInterest'], pre, 1)
    ck(name, 'reserves', c['reserves'], esc_res + pre, 1)
    ck(name, 'costs', c['costs'], I['costs'] + I['title'], 1)

    cash = I['loan'] - payoff - (I['costs'] + I['title']) - (esc_res + pre)
    ck(name, 'cash', c['cash'], max(0, cash), 1)
    short = max(0, -cash)
    ck(name, 'loanShort', c.get('loanShort', 0), short, 1)
    ck(name, 'loan + what the borrower brings reconciles',
       payoff + (I['costs'] + I['title']) + (esc_res + pre) + max(0, cash), I['loan'] + short, 1)

    fc = I['costs'] + pre + up + va
    ck(name, 'financeCharges', c['financeCharges'], fc, 1)
    ck(name, 'amountFinanced', c['amountFinanced'], max(0, note - fc), 1)
    if fc > 0 and c['newPI']:
        ck(name, 'apr', c['apr'],
           apr_stream(note - fc, pi(note, I['rate'], n), c['newMI'], (c['mipYears'] or 0) * 12, n), 0.002)
    else:
        ck(name, 'apr = note rate when nothing is financed', c['apr'], I['rate'], 0.001)

    # ---- what the client actually reads has to agree with all of that -------
    srows = dict((k, v) for sec in sheet['sections'] for k, v in sec['rows'])
    heads = [s['headline'] for s in sheet['sections']]

    # Label-independent: whatever rows the payment section shows must add up to
    # the headline above them, however the escrow split is worded.
    pay_sec = next((x for x in sheet['sections'] if x['title'] == 'What you pay monthly'), None)
    if pay_sec:
        parts = sum(dollars(v) for _, v in pay_sec['rows'])
        ck(name, 'payment rows sum to the payment headline', parts, dollars(pay_sec['headline']), 0.5)

    if 'Cash in hand at closing' in srows or 'Cash due from you at closing' in srows:
        built = dollars(srows.get('New loan amount')) \
            - abs(dollars(srows.get('Less balances paid off'))) \
            - abs(dollars(srows.get('Less closing costs and prepaids')))
        shown = dollars(srows.get('Cash in hand at closing')) \
            or -abs(dollars(srows.get('Cash due from you at closing')))
        ck(name, 'cash rows sum to the cash figure', built, shown, 1)

    # Every liability table must add up on its own. A figure that exists only in
    # a footer total, with no row behind it, is the bug this catches.
    for t in sheet['tables']:
        rows_sum = sum(dollars(v) for v in t['pays'])
        if len(t['foot']) >= 3:
            ck(name, f"rows sum to the footer: {t['title']}", rows_sum, dollars(t['foot'][2]), 1)

    hx, hv, hu = sheet['heroExtra'], sheet['heroValue'], sheet['heroUnit'] or ''
    if hx and hx.get('pre') == 'for':
        ck(name, 'hero monthly equals the payment or the all-in',
           min(abs(dollars(hx['val']) - c['newTotal']), abs(dollars(hx['val']) - c['afterTotal'])), 0, 1)
        ck(name, 'hero names the cash', dollars(hv), c['cash'], 1)
        if 'cash back' not in hu:
            fails.append(f'{name} | cash-out hero unit is {hu!r}, expected "cash back"')

    # Nothing on a client-facing page may read as undefined or NaN.
    for field in ('note', 'opNote'):
        if re.search(r'undefined|NaN', sheet.get(field) or ''):
            fails.append(f'{name} | {field} contains undefined or NaN')
    if sheet.get('onePager') and re.search(r'undefined|NaN', sheet['onePager']['text']):
        fails.append(f'{name} | the printed page contains undefined or NaN')
    checks += 1

print(f'checks run across {checks} scenarios')
if fails:
    print('\n'.join(fails))
    sys.exit(1)
print('EVERY COMPUTED FIELD MATCHES INDEPENDENT MATH')
