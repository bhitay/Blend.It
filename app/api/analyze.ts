// Vercel server function: POST /api/analyze
//
// The only place that talks to Claude. The Anthropic API key lives in the
// ANTHROPIC_API_KEY environment variable on Vercel and never reaches the phone.
// Callers must be signed in to BlendIt (Supabase access token in Authorization).
//
// Tasks:
//   table       – first rows of a bank / card Excel export → how to read its columns
//   document    – a PDF report (pension, study fund, mortgage …) → the figures in it
//   categorize  – merchant names → category, fixed/variable, transfer

import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { createClient } from '@supabase/supabase-js';
import { ALL_CATEGORIES } from '../src/lib/categories';

const MODEL = 'claude-opus-5-5';
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

const nullableInt = { type: ['integer', 'null'] } as const;
const nullableNum = { type: ['number', 'null'] } as const;
const nullableStr = { type: ['string', 'null'] } as const;

// --- schemas -----------------------------------------------------------------

const tableSchema = {
  type: 'object',
  properties: {
    source_type: { type: 'string', enum: ['bank', 'credit_card', 'investments', 'insurance_list', 'unknown'] },
    institution: { ...nullableStr, description: 'mizrahi | discount | otsarHahayal | max | isracard | visaCal | amex | leumi | hapoalim, or the name as written' },
    account_hint: { ...nullableStr, description: 'last 4 digits of the account or card number, if shown' },
    owner_name: nullableStr,
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

const documentSchema = {
  type: 'object',
  properties: {
    report_type: {
      type: 'string',
      enum: [
        'pension', 'study_fund', 'provident', 'managers_insurance', 'mortgage', 'loan',
        'investments', 'insurance', 'payslip', 'bank_statement', 'other',
      ],
    },
    institution: nullableStr,
    product_name: { ...nullableStr, description: 'e.g. "קרן השתלמות מסלול כללי"' },
    owner_name: nullableStr,
    account_hint: { ...nullableStr, description: 'last 4 digits of the policy / account number' },
    as_of: { ...nullableStr, description: 'YYYY-MM-DD the figures refer to' },
    balance: { ...nullableNum, description: 'total accumulated savings, or outstanding debt for mortgage/loan, in ILS' },
    monthly_deposit: { ...nullableNum, description: 'savings: total monthly deposit (employee+employer)' },
    return_ytd_pct: nullableNum,
    return_12m_pct: nullableNum,
    fee_balance_pct: { ...nullableNum, description: 'management fee from balance (דמי ניהול מצבירה), % per year' },
    fee_deposit_pct: { ...nullableNum, description: 'management fee from deposits (דמי ניהול מהפקדה), %' },
    liquidity_date: { ...nullableStr, description: 'study fund: YYYY-MM-DD when it becomes withdrawable tax-free' },
    monthly_payment: { ...nullableNum, description: 'mortgage/loan monthly payment' },
    end_date: nullableStr,
    tracks: {
      type: 'array',
      description: 'mortgage/loan tracks (מסלולים); empty for other reports',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          balance: nullableNum,
          interest_rate_pct: nullableNum,
          indexation: { ...nullableStr, description: 'e.g. צמוד מדד, פריים, קבועה לא צמודה' },
          end_date: nullableStr,
        },
        required: ['name', 'balance', 'interest_rate_pct', 'indexation', 'end_date'],
        additionalProperties: false,
      },
    },
    highlights: {
      type: 'array',
      items: { type: 'string' },
      description: 'up to 5 short Hebrew facts worth knowing (coverage, insurance costs inside the fund, anomalies)',
    },
  },
  required: [
    'report_type', 'institution', 'product_name', 'owner_name', 'account_hint', 'as_of', 'balance', 'monthly_deposit',
    'return_ytd_pct', 'return_12m_pct', 'fee_balance_pct', 'fee_deposit_pct', 'liquidity_date', 'monthly_payment',
    'end_date', 'tracks', 'highlights',
  ],
  additionalProperties: false,
} as const;

const categorizeSchema = {
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

// --- prompts -------------------------------------------------------------------

const SYSTEM = `You help an Israeli family's personal-finance app read their own financial files.
Files come from Israeli banks, credit-card companies, pension funds and insurers, mostly in Hebrew.
Be precise with numbers and column positions; never invent values — use null when something is not in the input.`;

const TABLE_PROMPT = `Below are the first rows of a spreadsheet the user exported (each row is a JSON array of cell values; empty cells are "").
Identify what the file is and how to read every transaction row from it: the header row, which column (0-based) holds each field,
the date format, and the sign convention for amounts. For credit cards, use the charged amount in ILS (סכום חיוב) as the amount column,
and the original amount/currency columns for foreign transactions.`;

const DOCUMENT_PROMPT = `This is a financial report the user downloaded (e.g. a quarterly pension / study-fund report, a mortgage balance statement,
a loan statement or a payslip). Extract the figures. Percentages as numbers (0.22 means 0.22%). Amounts in ILS.`;

const CATEGORIZE_PROMPT = `Categorize each merchant / transaction description from Israeli bank and credit-card statements.
- category: the best fit from the allowed list.
- is_fixed: true for recurring fixed costs (rent, mortgage, arnona, utilities, insurance, phone/internet, subscriptions, kindergarten, loans, standing orders).
- is_transfer: true when the line is not real spending or income — a credit-card bill paid from the bank account (ישראכרט, מקס, כאל, אמריקן אקספרס, לאומי קארד),
  a transfer between the family's own accounts, or a deposit into savings/investments. Use a transfer category for these.
Return one item per input merchant, with the merchant string copied exactly.`;

// --- handler -------------------------------------------------------------------

type Body =
  | { task: 'table'; fileName: string; rows: string[][] }
  | { task: 'document'; fileName: string; pdfBase64: string }
  | { task: 'categorize'; merchants: { name: string; source: string }[] };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function authorized(request: Request): Promise<boolean> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.EXPO_PUBLIC_SUPABASE_KEY?.trim();
  if (!token || !url || !key) return false;
  const supabase = createClient(new URL(url).origin, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  return !error && Boolean(data.user);
}

async function ask<T>(
  content: Anthropic.Beta.Messages.BetaContentBlockParam[],
  schema: Parameters<typeof betaJSONSchemaOutputFormat>[0],
  effort: 'low' | 'medium' | 'high',
): Promise<T> {
  const response = await anthropic.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: betaJSONSchemaOutputFormat(schema) },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined to process this file.');
  if (response.stop_reason === 'max_tokens') throw new HttpError(422, 'The file is too large to analyze in one go.');
  if (!response.parsed_output) throw new HttpError(502, 'Could not parse the model response.');
  return response.parsed_output as T;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY is not set on the server.' });
  if (!(await authorized(request))) return json(401, { error: 'Not signed in.' });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  try {
    switch (body.task) {
      case 'table': {
        const rows = (body.rows ?? []).slice(0, 40).map((r) => r.slice(0, 30).map((c) => String(c ?? '').slice(0, 120)));
        const result = await ask(
          [{ type: 'text', text: `${TABLE_PROMPT}\n\nFile name: ${body.fileName}\n\n${rows.map((r, i) => `${i}: ${JSON.stringify(r)}`).join('\n')}` }],
          tableSchema,
          'medium',
        );
        return json(200, result);
      }
      case 'document': {
        if (!body.pdfBase64) return json(400, { error: 'Missing PDF.' });
        const result = await ask(
          [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.pdfBase64 } },
            { type: 'text', text: `${DOCUMENT_PROMPT}\n\nFile name: ${body.fileName}` },
          ],
          documentSchema,
          'high',
        );
        return json(200, result);
      }
      case 'categorize': {
        const merchants = (body.merchants ?? []).slice(0, 300);
        if (merchants.length === 0) return json(200, { items: [] });
        const list = merchants.map((m) => `${m.source === 'bank' ? '[bank]' : '[card]'} ${m.name}`).join('\n');
        const result = await ask(
          [{ type: 'text', text: `${CATEGORIZE_PROMPT}\n\nMerchants (prefix shows where the line came from; do not include the prefix in "merchant"):\n${list}` }],
          categorizeSchema,
          'low',
        );
        return json(200, result);
      }
      default:
        return json(400, { error: 'Unknown task.' });
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'Too many requests to Claude, try again in a minute.' });
    if (e instanceof Anthropic.AuthenticationError) return json(500, { error: 'The ANTHROPIC_API_KEY on the server is invalid.' });
    if (e instanceof Anthropic.APIError) return json(502, { error: `Claude API error ${e.status}: ${e.message}` });
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
}
