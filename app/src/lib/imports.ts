import type { AccountKind } from './accountKinds';
import { supabase } from './supabase';
import { findHeaderRow, localAccountHint, maskIdentifiers, maskRows, type ParsedTransaction, type TableMapping } from './importer';

// Same origin on web (Vercel serves the app and /api). A native build sets EXPO_PUBLIC_API_URL.
const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

export type DocumentReport = {
  report_type:
    | 'pension' | 'study_fund' | 'provident' | 'managers_insurance' | 'mortgage' | 'loan'
    | 'investments' | 'insurance' | 'payslip' | 'bank_statement' | 'other';
  institution: string | null;
  product_name: string | null;
  owner_name: string | null;
  account_hint: string | null;
  as_of: string | null;
  balance: number | null;
  monthly_deposit: number | null;
  return_ytd_pct: number | null;
  return_12m_pct: number | null;
  fee_balance_pct: number | null;
  fee_deposit_pct: number | null;
  liquidity_date: string | null;
  monthly_payment: number | null;
  end_date: string | null;
  tracks: { name: string; balance: number | null; interest_rate_pct: number | null; indexation: string | null; end_date: string | null }[];
  highlights: string[];
};

export const REPORT_LABELS: Record<DocumentReport['report_type'], string> = {
  pension: 'קרן פנסיה',
  study_fund: 'קרן השתלמות',
  provident: 'קופת גמל',
  managers_insurance: 'ביטוח מנהלים',
  mortgage: 'משכנתא',
  loan: 'הלוואה',
  investments: 'תיק השקעות',
  insurance: 'ביטוח',
  payslip: 'תלוש שכר',
  bank_statement: 'דוח בנק',
  other: 'מסמך אחר',
};

/** Report types that represent an account with a balance. */
export const REPORT_ACCOUNT_KIND: Partial<Record<DocumentReport['report_type'], AccountKind>> = {
  pension: 'pension',
  study_fund: 'study_fund',
  provident: 'provident',
  managers_insurance: 'insurance',
  mortgage: 'mortgage',
  loan: 'loan',
  investments: 'investment',
};

async function analyze<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('צריך להתחבר מחדש');
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `שגיאת שרת (${res.status})`);
  return payload as T;
}

/**
 * Learns the column layout. Sent: up to 40 rows starting at the table's header row
 * (the title lines above it, with name, ID and address, stay on the device), with
 * long numbers masked. Row indexes in the answer are shifted back to the full sheet.
 */
export async function analyzeTable(fileName: string, rows: string[][]): Promise<TableMapping> {
  const start = Math.max(0, findHeaderRow(rows));
  const mapping = await analyze<TableMapping>({ task: 'table', fileName, rows: maskRows(rows.slice(start, start + 40)) });
  return {
    ...mapping,
    header_row: mapping.header_row + start,
    account_hint: mapping.account_hint ?? localAccountHint(rows, start),
  };
}

export const analyzeDocument = (fileName: string, pdfBase64: string) =>
  analyze<DocumentReport>({ task: 'document', fileName, pdfBase64 });

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// --- saving ------------------------------------------------------------------

export async function saveTransactions(input: {
  accountId: string;
  fileName: string;
  reportType: string;
  transactions: ParsedTransaction[];
  balance: number | null;
  balanceAsOf: string | null;
}): Promise<{ import_id: string; rows: number; new_rows: number }> {
  return check(
    await supabase.rpc('import_transactions', {
      payload: {
        account_id: input.accountId,
        file_name: input.fileName,
        report_type: input.reportType,
        balance: input.balance,
        balance_as_of: input.balanceAsOf,
        transactions: input.transactions,
      },
    }),
  ) as { import_id: string; rows: number; new_rows: number };
}

/** Stores a PDF report: balance snapshot + latest figures on the account + an import record. */
export async function saveReport(input: {
  householdId: string;
  accountId: string | null;
  fileName: string;
  report: DocumentReport;
}): Promise<void> {
  const { report } = input;
  const asOf = report.as_of ?? new Date().toISOString().slice(0, 10);
  if (input.accountId) {
    const details = {
      product_name: report.product_name,
      monthly_deposit: report.monthly_deposit,
      return_ytd_pct: report.return_ytd_pct,
      return_12m_pct: report.return_12m_pct,
      fee_balance_pct: report.fee_balance_pct,
      fee_deposit_pct: report.fee_deposit_pct,
      liquidity_date: report.liquidity_date,
      monthly_payment: report.monthly_payment,
      end_date: report.end_date,
      tracks: report.tracks,
      highlights: report.highlights,
      as_of: asOf,
    };
    check(await supabase.from('accounts').update({ details, source: 'import' }).eq('id', input.accountId));
    if (report.balance != null) {
      check(
        await supabase
          .from('balance_snapshots')
          .upsert({ account_id: input.accountId, as_of: asOf, balance: Math.abs(report.balance) }, { onConflict: 'account_id,as_of' }),
      );
    }
  }
  check(
    await supabase.from('imports').insert({
      household_id: input.householdId,
      account_id: input.accountId,
      kind: 'report',
      file_name: input.fileName,
      report_type: report.report_type,
      period_end: asOf,
      // The figures are kept; the person's name is not (the account already says whose it is).
      summary: { ...report, owner_name: null },
    }),
  );
}

// --- categorization -------------------------------------------------------------

/**
 * Sends merchant names that have no category rule yet to the server (names only,
 * no amounts or account numbers), stores the answers as household rules, and
 * applies them to all matching transactions.
 */
export async function categorizePending(householdId: string): Promise<number> {
  const rows = check(
    await supabase
      .from('transactions')
      .select('description, accounts!inner(kind, household_id)')
      .is('category', null)
      .eq('accounts.household_id', householdId)
      .limit(3000),
  ) as unknown as { description: string; accounts: { kind: string } }[];

  const known = new Set(
    (check(await supabase.from('merchant_categories').select('merchant').eq('household_id', householdId)) as { merchant: string }[]).map(
      (r) => r.merchant,
    ),
  );
  const pending = new Map<string, string>();
  for (const r of rows) {
    if (!known.has(r.description) && !pending.has(r.description)) {
      pending.set(r.description, r.accounts.kind === 'credit_card' ? 'card' : 'bank');
    }
  }

  // Names go out masked (older imports may still hold full numbers in their descriptions);
  // each answer is mapped back to the exact stored description(s) for the rule.
  const byMasked = new Map<string, { source: string; originals: string[] }>();
  for (const [name, source] of pending) {
    const masked = maskIdentifiers(name);
    const entry = byMasked.get(masked) ?? { source, originals: [] };
    entry.originals.push(name);
    byMasked.set(masked, entry);
  }
  const merchants = [...byMasked].map(([name, e]) => ({ name, source: e.source }));
  for (let i = 0; i < merchants.length; i += 150) {
    const chunk = merchants.slice(i, i + 150);
    const { items } = await analyze<{ items: { merchant: string; category: string; is_fixed: boolean; is_transfer: boolean }[] }>({
      task: 'categorize',
      merchants: chunk,
    });
    const rules = items.flatMap((it) =>
      (byMasked.get(it.merchant)?.originals ?? []).map((original) => ({
        household_id: householdId,
        merchant: original,
        category: it.category,
        is_fixed: it.is_fixed,
        is_transfer: it.is_transfer,
        source: 'ai',
      })),
    );
    if (rules.length) {
      check(await supabase.from('merchant_categories').upsert(rules, { onConflict: 'household_id,merchant', ignoreDuplicates: true }));
    }
  }
  return check(await supabase.rpc('apply_merchant_categories', { hid: householdId })) as number;
}

/** User correction: becomes the household rule for this merchant and re-applies everywhere. */
export async function setMerchantCategory(input: {
  householdId: string;
  merchant: string;
  category: string;
  isFixed: boolean;
  isTransfer: boolean;
}): Promise<void> {
  check(
    await supabase.from('merchant_categories').upsert(
      {
        household_id: input.householdId,
        merchant: input.merchant,
        category: input.category,
        is_fixed: input.isFixed,
        is_transfer: input.isTransfer,
        source: 'user',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'household_id,merchant' },
    ),
  );
  check(await supabase.rpc('apply_merchant_categories', { hid: input.householdId }));
}

// --- reading ------------------------------------------------------------------------

export type ImportRow = {
  id: string;
  account_id: string | null;
  kind: 'transactions' | 'report';
  file_name: string | null;
  report_type: string | null;
  period_start: string | null;
  period_end: string | null;
  rows: number;
  new_rows: number;
  created_at: string;
};

export async function fetchImports(householdId: string, limit = 200): Promise<ImportRow[]> {
  return check(
    await supabase
      .from('imports')
      .select('id, account_id, kind, file_name, report_type, period_start, period_end, rows, new_rows, created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as ImportRow[];
}

export type MonthlyCategoryTotal = {
  month: string;
  category: string;
  is_fixed: boolean;
  income: number;
  expenses: number;
  net: number;
  transactions: number;
};

export async function fetchMonthlyTotals(householdId: string, fromMonth: string): Promise<MonthlyCategoryTotal[]> {
  const rows = check(
    await supabase.from('monthly_category_totals').select('*').eq('household_id', householdId).gte('month', fromMonth),
  ) as MonthlyCategoryTotal[];
  return rows.map((r) => ({
    ...r,
    income: Number(r.income ?? 0),
    expenses: Number(r.expenses ?? 0),
    net: Number(r.net ?? 0),
  }));
}

export type CategorizedTransaction = {
  id: string;
  date: string;
  amount: number;
  description: string;
  category: string | null;
  is_fixed: boolean | null;
  is_transfer: boolean;
};

export async function fetchTransactionsSince(householdId: string, fromDate: string): Promise<CategorizedTransaction[]> {
  const rows = check(
    await supabase
      .from('transactions')
      .select('id, date, amount, description, category, is_fixed, is_transfer, accounts!inner(household_id)')
      .eq('accounts.household_id', householdId)
      .gte('date', fromDate)
      .eq('status', 'completed')
      .order('date', { ascending: false })
      .limit(5000),
  ) as unknown as CategorizedTransaction[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}
