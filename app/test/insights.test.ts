import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountInsights, buildInsights, previousMonths, summarizeMonth } from '../src/lib/insights';
import type { CategorizedTransaction, MonthlyCategoryTotal } from '../src/lib/imports';

const row = (month: string, category: string, net: number, is_fixed = false, transactions = 1): MonthlyCategoryTotal => ({
  month, category, is_fixed, net, income: net > 0 ? net : 0, expenses: net < 0 ? -net : 0, transactions,
});

test('previous months wrap the year', () => {
  assert.deepEqual(previousMonths('2026-02-01', 3), ['2026-01-01', '2025-12-01', '2025-11-01']);
});

test('month summary: income, fixed vs variable, refunds net out, uncategorized money-in counts as income', () => {
  const s = summarizeMonth([
    row('2026-11-01', 'משכורת', 20000),
    row('2026-11-01', 'לא מסווג', 3000), // e.g. a transfer in, not yet classified
    row('2026-11-01', 'משכנתא והלוואות', -5200, true),
    row('2026-11-01', 'מזון וסופר', -3100),
    row('2026-11-01', 'ביגוד והנעלה', 150), // refund larger than purchases
    row('2026-10-01', 'מזון וסופר', -9999),
  ], '2026-11-01');
  assert.equal(s.income, 23000);
  assert.equal(s.fixed, 5200);
  assert.equal(s.variable, 3100);
  assert.equal(s.net, 14700);
  assert.equal(s.categories[0].category, 'משכנתא והלוואות');
  assert.equal(s.uncategorized, 1);
});

const tx = (date: string, description: string, amount: number): CategorizedTransaction => ({
  id: date + description, date, description, amount, category: null, is_fixed: null, is_transfer: false,
});

test('insights: overspending, spike, recurring charges, bank fees, pension fees, study-fund liquidity', () => {
  const totals = [
    ...['2026-08-01', '2026-09-01', '2026-10-01'].flatMap((m) => [row(m, 'משכורת', 15000), row(m, 'מסעדות ובתי קפה', -800)]),
    row('2026-11-01', 'משכורת', 15000),
    row('2026-11-01', 'מסעדות ובתי קפה', -2000),
    row('2026-11-01', 'דיור ושכירות', -14000, true),
    row('2026-11-01', 'עמלות בנק', -45),
  ];
  const transactions = [
    tx('2026-11-05', 'נטפליקס', -54.9), tx('2026-10-05', 'נטפליקס', -54.9), tx('2026-09-05', 'נטפליקס', -54.9),
    tx('2026-11-07', 'שופרסל', -900), tx('2026-10-07', 'שופרסל', -400), tx('2026-09-07', 'שופרסל', -650), // varies: not "recurring"
  ];
  const ins = buildInsights({
    month: '2026-11-01', totals, transactions, today: '2026-11-16',
    accounts: [
      { name: 'פנסיה – איתי', kind: 'pension', details: { fee_balance_pct: 0.4, fee_deposit_pct: 2 } },
      { name: 'פנסיה – נועה', kind: 'pension', details: { fee_balance_pct: 0.1, fee_deposit_pct: 1 } },
      { name: 'השתלמות – איתי', kind: 'study_fund', details: { fee_balance_pct: 0.7, liquidity_date: '2027-03-01' } },
    ],
  });
  const titles = ins.map((i) => i.title).join(' | ');
  assert.match(titles, /יצא יותר ממה שנכנס/);
  assert.match(titles, /מסעדות ובתי קפה: עלייה של 150%/);
  assert.match(titles, /1 חיובים חוזרים/);
  assert.doesNotMatch(ins.find((i) => i.title.includes('חוזרים'))!.body, /שופרסל/);
  assert.match(titles, /עמלות בנק/);
  assert.match(titles, /דמי ניהול גבוהים: פנסיה – איתי/);
  assert.doesNotMatch(titles, /פנסיה – נועה/);
  assert.match(titles, /דמי ניהול גבוהים: השתלמות – איתי/);
  assert.match(titles, /תהיה נזילה בעוד 4 חודשים/);
});

test('insights: good savings month, no spike without history', () => {
  const ins = buildInsights({
    month: '2026-11-01', today: '2026-11-16', transactions: [], accounts: [],
    totals: [row('2026-11-01', 'משכורת', 20000), row('2026-11-01', 'מזון וסופר', -4000)],
  });
  assert.equal(ins.length, 1);
  assert.equal(ins[0].level, 'good');
  assert.match(ins[0].title, /80%/);
});

test('account page: fee verdicts, negative return, missing report', () => {
  const t = (a: Parameters<typeof accountInsights>[0]) => accountInsights(a, '2026-11-16').map((i) => `${i.level}:${i.title}`);
  assert.deepEqual(t({ name: 'השתלמות הראל', kind: 'study_fund', details: { fee_balance_pct: 0.55, return_12m_pct: 9.1 } }), ['good:דמי ניהול סבירים']);
  assert.match(t({ name: 'השתלמות הראל', kind: 'study_fund', details: { fee_balance_pct: 0.8 } })[0], /^warn:דמי ניהול גבוהים/);
  assert.match(t({ name: 'פנסיה', kind: 'pension', details: { fee_balance_pct: 0.1, fee_deposit_pct: 2 } })[0], /^warn/);
  assert.ok(t({ name: 'גמל', kind: 'provident', details: { fee_balance_pct: 0.4, return_12m_pct: -3 } }).some((x) => x.startsWith('info:תשואה שלילית')));
  assert.deepEqual(t({ name: 'פנסיה', kind: 'pension', details: null }), ['info:אין עדיין נתונים מדוח']);
  assert.deepEqual(t({ name: 'עו"ש', kind: 'bank', details: null }), []);
});

test('insights page does not list savings accounts that have no report yet', () => {
  const ins = buildInsights({
    month: '2026-11-01', today: '2026-11-16', transactions: [], totals: [],
    accounts: [{ name: 'פנסיה', kind: 'pension', details: null }],
  });
  assert.equal(ins.length, 0);
});

test('account page: paying more than the fund average (as stated in the report) is flagged', () => {
  const [i] = accountInsights({ name: 'השתלמות הראל', kind: 'study_fund', details: { fee_balance_pct: 0.6, fund_avg_fee_balance_pct: 0.55 } }, '2026-11-16');
  assert.equal(i.level, 'warn');
  assert.match(i.title, /יותר מהממוצע בקופה/);
  const [ok] = accountInsights({ name: 'x', kind: 'study_fund', details: { fee_balance_pct: 0.5, fund_avg_fee_balance_pct: 0.55 } }, '2026-11-16');
  assert.equal(ok.level, 'good');
});
