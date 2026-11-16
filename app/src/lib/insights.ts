// Monthly analysis and recommendations. Pure functions over already-loaded data.

import { isIncomeCategory } from './categories';
import type { CategorizedTransaction, MonthlyCategoryTotal } from './imports';

export type Insight = { level: 'good' | 'warn' | 'info'; title: string; body: string };

export type MonthSummary = {
  month: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
  fixed: number;
  variable: number;
  categories: { category: string; amount: number; isFixed: boolean; share: number }[];
  uncategorized: number;
};

export type AccountForInsights = {
  name: string;
  kind: string;
  details: {
    fee_balance_pct?: number | null;
    fee_deposit_pct?: number | null;
    liquidity_date?: string | null;
    return_12m_pct?: number | null;
  } | null;
};

const round = (n: number) => Math.round(n);

export function monthKey(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function previousMonths(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 2 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });
}

/** Income = income categories; everything else counts as spending, net of refunds. */
export function summarizeMonth(totals: MonthlyCategoryTotal[], month: string): MonthSummary {
  const rows = totals.filter((t) => t.month === month);
  let income = 0;
  let fixed = 0;
  let variable = 0;
  let uncategorized = 0;
  const categories: MonthSummary['categories'] = [];

  for (const r of rows) {
    if (isIncomeCategory(r.category)) {
      income += r.net;
      continue;
    }
    const spent = -r.net; // refunds reduce spending
    if (r.category === 'לא מסווג') {
      uncategorized += r.transactions;
      // Unclassified money in is most likely income (salary before categorization).
      if (spent < 0) {
        income += -spent;
        continue;
      }
    }
    if (spent <= 0) continue;
    if (r.is_fixed) fixed += spent;
    else variable += spent;
    categories.push({ category: r.category, amount: spent, isFixed: r.is_fixed, share: 0 });
  }
  const expenses = fixed + variable;
  categories.sort((a, b) => b.amount - a.amount);
  for (const c of categories) c.share = expenses ? c.amount / expenses : 0;

  return {
    month,
    income,
    expenses,
    net: income - expenses,
    savingsRate: income > 0 ? (income - expenses) / income : null,
    fixed,
    variable,
    categories,
    uncategorized,
  };
}

const fmt = (n: number) => `₪${round(n).toLocaleString('he-IL')}`;

export function buildInsights(input: {
  month: string;
  totals: MonthlyCategoryTotal[];
  transactions: CategorizedTransaction[];
  accounts: AccountForInsights[];
  today: string;
}): Insight[] {
  const { month, totals, transactions, accounts, today } = input;
  const out: Insight[] = [];
  const cur = summarizeMonth(totals, month);
  const prev = previousMonths(month, 3).map((m) => summarizeMonth(totals, m));
  const prevWithData = prev.filter((p) => p.expenses > 0);

  // 1. Savings rate
  if (cur.income > 0) {
    const rate = cur.savingsRate ?? 0;
    if (cur.net < 0)
      out.push({ level: 'warn', title: 'יצא יותר ממה שנכנס', body: `ההוצאות עברו את ההכנסות ב-${fmt(-cur.net)} החודש.` });
    else if (rate < 0.1)
      out.push({ level: 'warn', title: `נחסכו רק ${Math.round(rate * 100)}% מההכנסה`, body: 'יעד מקובל הוא לפחות 10%–20%. כדאי לבדוק את ההוצאות המשתנות הגדולות למטה.' });
    else if (rate >= 0.2)
      out.push({ level: 'good', title: `נחסכו ${Math.round(rate * 100)}% מההכנסה`, body: `נשארו ${fmt(cur.net)} החודש. כדאי לוודא שהם עוברים לחיסכון או להשקעה ולא נשארים בעו"ש.` });
  }

  // 2. Category spikes vs the 3-month average
  if (prevWithData.length >= 2) {
    for (const c of cur.categories) {
      const avg = prevWithData.reduce((s, p) => s + (p.categories.find((x) => x.category === c.category)?.amount ?? 0), 0) / prevWithData.length;
      if (avg > 0 && c.amount > avg * 1.3 && c.amount - avg > 300) {
        out.push({
          level: 'warn',
          title: `${c.category}: עלייה של ${Math.round((c.amount / avg - 1) * 100)}%`,
          body: `${fmt(c.amount)} החודש לעומת ממוצע של ${fmt(avg)} בחודשים הקודמים.`,
        });
      }
    }
  }

  // 3. Recurring charges (same merchant, similar amount, each of the last 3 months)
  const months = [month, ...previousMonths(month, 2)];
  const byMerchant = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.is_transfer || t.amount >= 0) continue;
    const m = monthKey(t.date);
    if (!months.includes(m)) continue;
    const perMonth = byMerchant.get(t.description) ?? new Map<string, number>();
    perMonth.set(m, (perMonth.get(m) ?? 0) - t.amount);
    byMerchant.set(t.description, perMonth);
  }
  const recurring = [...byMerchant]
    .filter(([, pm]) => months.every((m) => pm.has(m)))
    .map(([name, pm]) => ({ name, amounts: months.map((m) => pm.get(m)!) }))
    .filter((r) => Math.max(...r.amounts) <= Math.min(...r.amounts) * 1.15)
    .sort((a, b) => b.amounts[0] - a.amounts[0]);
  if (recurring.length) {
    const monthly = recurring.reduce((s, r) => s + r.amounts[0], 0);
    out.push({
      level: 'info',
      title: `${recurring.length} חיובים חוזרים, ${fmt(monthly)} בחודש`,
      body: `${recurring.slice(0, 8).map((r) => `${r.name} (${fmt(r.amounts[0])})`).join(', ')}. שווה לעבור ולבטל מה שלא בשימוש.`,
    });
  }

  // 4. Bank fees
  const fees = cur.categories.find((c) => c.category === 'עמלות בנק');
  if (fees && fees.amount > 0) {
    out.push({
      level: 'warn',
      title: `עמלות בנק: ${fmt(fees.amount)} החודש`,
      body: `כ-${fmt(fees.amount * 12)} בשנה. אפשר לבקש מהבנק מסלול עמלות או הנחה, ולבדוק אם חלק מהפעולות אפשר לעשות בדיגיטל.`,
    });
  }

  // 5. Management fees and study-fund liquidity
  for (const a of accounts) {
    const d = a.details;
    if (!d) continue;
    const fb = d.fee_balance_pct ?? null;
    const fd = d.fee_deposit_pct ?? null;
    if (a.kind === 'pension' && ((fb != null && fb > 0.22) || (fd != null && fd > 1.5))) {
      out.push({
        level: 'warn',
        title: `דמי ניהול גבוהים: ${a.name}`,
        body: `${fb ?? '—'}% מהצבירה ו-${fd ?? '—'}% מההפקדה. בקרנות פנסיה אפשר בדרך כלל להגיע לכ-0.1%–0.22% מהצבירה ועד 1%–1.5% מההפקדה. כדאי לבקש הורדה או להשוות.`,
      });
    }
    if ((a.kind === 'study_fund' || a.kind === 'provident') && fb != null && fb > 0.6) {
      out.push({
        level: 'warn',
        title: `דמי ניהול גבוהים: ${a.name}`,
        body: `${fb}% מהצבירה בשנה. בקרנות השתלמות וגמל אפשר לרוב להשיג פחות מ-0.6%.`,
      });
    }
    if (a.kind === 'study_fund' && d.liquidity_date) {
      const months = monthsBetween(today, d.liquidity_date);
      if (months <= 0)
        out.push({ level: 'info', title: `${a.name} נזילה`, body: 'אפשר למשוך את הכסף בפטור ממס, או להמשיך לחסוך בה. היא נשארת פטורה ממס על הרווחים כל עוד לא מושכים.' });
      else if (months <= 6)
        out.push({ level: 'info', title: `${a.name} תהיה נזילה בעוד ${months} חודשים`, body: `מועד הנזילות: ${d.liquidity_date.split('-').reverse().join('/')}.` });
    }
  }

  // 6. Uncategorized
  if (cur.uncategorized > 0) {
    out.push({
      level: 'info',
      title: `${cur.uncategorized} תנועות לא מסווגות`,
      body: 'הסיווג רץ אוטומטית אחרי כל ייבוא. אפשר גם לסווג ידנית מדף החשבון, והאפליקציה תזכור.',
    });
  }
  return out;
}

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
