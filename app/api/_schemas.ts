// JSON schemas for Claude's structured outputs (used by api/analyze.ts).
// Files in api/ that start with "_" are not routes on Vercel.
//
// The API allows at most 16 parameters with union types (e.g. ["number", "null"])
// per schema. To stay well under it, text fields use "" for "not in the file"
// instead of null, and emptyStringsToNull() restores null before the app sees them.
// test/schemas.test.ts enforces the limit.

import { ALL_CATEGORIES } from '../src/lib/categories';
import { maskIdentifiers } from '../src/lib/mask';

export const MAX_UNION_PARAMS = 16;

const nullableInt = { type: ['integer', 'null'] } as const;
const nullableNum = { type: ['number', 'null'] } as const;
const optStr = (description: string) => ({ type: 'string', description: `${description}. Empty string if not in the file.` }) as const;

export const tableSchema = {
  type: 'object',
  properties: {
    source_type: { type: 'string', enum: ['bank', 'credit_card', 'investments', 'insurance_list', 'unknown'] },
    institution: optStr('mizrahi | discount | otsarHahayal | max | isracard | visaCal | amex | leumi | hapoalim, or the name as written'),
    account_hint: optStr('last 4 digits of the account or card number'),
    owner_name: optStr('account / card holder name'),
    header_row: { type: 'integer', description: '0-based index of the column-header row in the given rows' },
    date_col: { type: 'integer' },
    description_col: { type: 'integer' },
    processed_date_col: nullableInt,
    amount_col: { ...nullableInt, description: 'single signed/unsigned amount column (in ILS, the charged amount)' },
    debit_col: { ...nullableInt, description: 'separate "חובה" column, if amounts are split' },
    credit_col: { ...nullableInt, description: 'separate "זכות" column, if amounts are split' },
    balance_col: { ...nullableInt, description: 'running balance column (bank)' },
    original_amount_col: nullableInt,
    original_currency_col: nullableInt,
    installments_col: { ...nullableInt, description: 'column with text like "תשלום 2 מתוך 12"' },
    memo_col: nullableInt,
    date_format: { type: 'string', enum: ['DMY', 'MDY', 'YMD'] },
    expenses_are_negative: {
      type: 'boolean',
      description: 'with a single amount column: true if money going out is shown as negative numbers',
    },
    closing_balance: { ...nullableNum, description: 'bank: current balance stated in the file; card: total of the coming charge' },
    notes: { type: 'string', description: 'short Hebrew note for the user if something is unusual, else empty' },
  },
  required: [
    'source_type', 'institution', 'account_hint', 'owner_name', 'header_row', 'date_col', 'description_col',
    'processed_date_col', 'amount_col', 'debit_col', 'credit_col', 'balance_col', 'original_amount_col',
    'original_currency_col', 'installments_col', 'memo_col', 'date_format', 'expenses_are_negative',
    'closing_balance', 'notes',
  ],
  additionalProperties: false,
} as const;

export const documentSchema = {
  type: 'object',
  properties: {
    report_type: {
      type: 'string',
      enum: [
        'pension', 'study_fund', 'provident', 'managers_insurance', 'mortgage', 'loan',
        'investments', 'insurance', 'payslip', 'bank_statement', 'other',
      ],
    },
    institution: optStr('the managing company, e.g. הראל, מגדל, מזרחי טפחות'),
    product_name: optStr('product and investment track only, e.g. "קרן השתלמות מסלול כללי" — no personal names'),
    owner_name: optStr('the member / borrower name'),
    account_hint: optStr('last 4 digits of the policy / account number'),
    as_of: optStr('YYYY-MM-DD the figures refer to (end of the report period)'),
    balance: { ...nullableNum, description: 'total accumulated savings, or outstanding debt for mortgage/loan, in ILS' },
    monthly_deposit: { ...nullableNum, description: 'savings: total monthly deposit (employee+employer)' },
    return_ytd_pct: nullableNum,
    return_12m_pct: nullableNum,
    fee_balance_pct: { ...nullableNum, description: 'management fee from balance (דמי ניהול מצבירה), % per year' },
    fee_deposit_pct: { ...nullableNum, description: 'management fee from deposits (דמי ניהול מהפקדה), %' },
    fund_avg_fee_balance_pct: {
      ...nullableNum,
      description: 'the fund\'s average management fee from balance, if the report states it (e.g. "ממוצע דמי ניהול בקופה"), %',
    },
    liquidity_date: optStr('study fund: YYYY-MM-DD when it becomes withdrawable tax-free'),
    monthly_payment: { ...nullableNum, description: 'mortgage/loan monthly payment' },
    end_date: optStr('mortgage/loan: YYYY-MM-DD of the last payment'),
    tracks: {
      type: 'array',
      description: 'mortgage/loan tracks (מסלולים); empty for other reports',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          balance: nullableNum,
          interest_rate_pct: nullableNum,
          indexation: optStr('e.g. צמוד מדד, פריים, קבועה לא צמודה'),
          end_date: optStr('YYYY-MM-DD'),
        },
        required: ['name', 'balance', 'interest_rate_pct', 'indexation', 'end_date'],
        additionalProperties: false,
      },
    },
    highlights: {
      type: 'array',
      items: { type: 'string' },
      description:
        'up to 5 short Hebrew facts about the product worth knowing (e.g. beneficiaries not set, fees vs. the fund average, ' +
        'insurance costs inside the fund). NEVER include personal details: names of people, employers or agents, ID / account / ' +
        'policy / phone numbers, addresses, or salary amounts.',
    },
  },
  required: [
    'report_type', 'institution', 'product_name', 'owner_name', 'account_hint', 'as_of', 'balance', 'monthly_deposit',
    'return_ytd_pct', 'return_12m_pct', 'fee_balance_pct', 'fee_deposit_pct', 'fund_avg_fee_balance_pct', 'liquidity_date', 'monthly_payment',
    'end_date', 'tracks', 'highlights',
  ],
  additionalProperties: false,
} as const;

export const categorizeSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          merchant: { type: 'string' },
          category: { type: 'string', enum: ALL_CATEGORIES as unknown as string[] },
          is_fixed: { type: 'boolean' },
          is_transfer: { type: 'boolean' },
        },
        required: ['merchant', 'category', 'is_fixed', 'is_transfer'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

/** Number of parameters whose type is a union (type array or anyOf/oneOf), at any depth. */
export function countUnionParams(schema: unknown): number {
  if (!schema || typeof schema !== 'object') return 0;
  const s = schema as Record<string, unknown>;
  let n = (Array.isArray(s.type) && s.type.length > 1) || s.anyOf || s.oneOf ? 1 : 0;
  for (const v of Object.values(s)) {
    if (Array.isArray(v)) n += v.reduce<number>((acc, x) => acc + countUnionParams(x), 0);
    else if (v && typeof v === 'object') n += countUnionParams(v);
  }
  return n;
}

/** "" → null at any depth, so the app keeps getting null for "not in the file". */
export function emptyStringsToNull<T>(value: T): T {
  if (value === '') return null as T;
  if (Array.isArray(value)) return value.map(emptyStringsToNull) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'notes' ? v : emptyStringsToNull(v)])) as T;
  }
  return value;
}

/** Words that mark a sentence as being about the person rather than the product. */
const PERSONAL = /שכר|משכורת|מעסיק|מעביד|סוכן|סוכנות|יועץ|ת\.?ז|תעודת זהות|טלפון|כתובת|מייל|דוא"ל|@/;

/**
 * Safety net after the model: masks long numbers in every text field and drops
 * highlight sentences about the person (salary, employer, agent, ID …), so they are
 * never shown or stored even if the model ignored the instruction.
 */
export function scrubReport<T extends Record<string, unknown>>(report: T): T {
  const scrub = (v: unknown): unknown => {
    if (typeof v === 'string') return maskIdentifiers(v);
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
    return v;
  };
  const out = scrub(report) as T & { highlights?: string[] };
  if (Array.isArray(out.highlights)) out.highlights = out.highlights.filter((h) => !PERSONAL.test(h));
  return out;
}
