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
import { categorizeSchema, documentSchema, emptyStringsToNull, scrubReport, tableSchema } from './_schemas';

const MODEL = 'claude-opus-5-5';
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

// --- prompts -------------------------------------------------------------------

const SYSTEM = `You help an Israeli family's personal-finance app read their own financial files.
Files come from Israeli banks, credit-card companies, pension funds and insurers, mostly in Hebrew.
Be precise with numbers and column positions; never invent values — use null when something is not in the input.`;

const TABLE_PROMPT = `Below are the first rows of a spreadsheet the user exported (each row is a JSON array of cell values; empty cells are "").
Identify what the file is and how to read every transaction row from it: the header row, which column (0-based) holds each field,
the date format, and the sign convention for amounts. For credit cards, use the charged amount in ILS (סכום חיוב) as the amount column,
and the original amount/currency columns for foreign transactions.`;

const DOCUMENT_PROMPT = `This is a financial report the user downloaded (e.g. a quarterly pension / study-fund report, a mortgage balance statement,
a loan statement or a payslip). Extract the figures. Percentages as numbers (0.22 means 0.22%). Amounts in ILS.
Privacy: the app stores what you return. Do not copy personal details into any text field — no names of people, employers or
agents, no ID / account / policy / phone numbers, no addresses, no salary amounts. Only owner_name and account_hint may hold the
holder's name and the last 4 digits of the account.`;

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

/** Calls per user per day. A month's uploads take a few dozen at most. */
const DAILY_LIMIT = 100;

/**
 * Only members of a household may use the AI, and only up to DAILY_LIMIT calls a day.
 * The check runs in the database with the caller's own token (use_api_quota, migration 0003),
 * so an invalid or expired token, a user without a household, or a session that still owes
 * the two-step code is refused.
 */
async function checkAccess(request: Request): Promise<Response | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.EXPO_PUBLIC_SUPABASE_KEY?.trim();
  if (!url || !key) return json(500, { error: 'Supabase is not configured on the server.' });
  if (!token) return json(401, { error: 'Not signed in.' });
  const supabase = createClient(new URL(url).origin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.rpc('use_api_quota', { daily_limit: DAILY_LIMIT });
  if (error) return json(401, { error: 'Not signed in.' });
  if (data === 'not_member') return json(403, { error: 'Only household members can use this.' });
  if (data === 'limit') return json(429, { error: 'הגעתם למכסת הניתוחים היומית. נסו שוב מחר.' });
  return null;
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
  return emptyStringsToNull(response.parsed_output) as T;
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
  const denied = await checkAccess(request);
  if (denied) return denied;

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
        return json(200, scrubReport(result as Record<string, unknown>));
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
