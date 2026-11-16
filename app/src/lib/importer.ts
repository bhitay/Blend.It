// Reading uploaded files on the device.
//
// Spreadsheets: only the first rows are sent to the server to learn the column
// layout (see api/analyze.ts → "table"); every transaction row is parsed here.
// PDFs are sent whole, since their figures must be read by the model.

import * as XLSX from 'xlsx';

export type TableMapping = {
  source_type: 'bank' | 'credit_card' | 'investments' | 'insurance_list' | 'unknown';
  institution: string | null;
  account_hint: string | null;
  owner_name: string | null;
  header_row: number;
  date_col: number;
  description_col: number;
  processed_date_col: number | null;
  amount_col: number | null;
  debit_col: number | null;
  credit_col: number | null;
  balance_col: number | null;
  original_amount_col: number | null;
  original_currency_col: number | null;
  installments_col: number | null;
  memo_col: number | null;
  date_format: 'DMY' | 'MDY' | 'YMD';
  expenses_are_negative: boolean;
  closing_balance: number | null;
  notes: string;
};

export type ParsedTransaction = {
  external_id: string;
  date: string;
  processed_date: string | null;
  amount: number;
  original_amount: number | null;
  original_currency: string | null;
  description: string;
  memo: string | null;
  installments: { number: number; total: number } | null;
  status: 'completed';
};

export type Sheet = { name: string; rows: string[][] };

// --- reading -----------------------------------------------------------------

/**
 * All non-empty sheets as rows of strings. Real date cells are written as DD/MM/YYYY
 * (Excel's own display format is often US-style), numbers as plain numbers.
 */
export function readSpreadsheet(data: ArrayBuffer): Sheet[] {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
    return { name, rows: rows.map((r) => r.map(cellToString)) };
  }).filter((s) => s.rows.filter((r) => r.some((c) => c !== '')).length >= 2);
}

function cellToString(c: unknown): string {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return '';
    return `${String(c.getDate()).padStart(2, '0')}/${String(c.getMonth() + 1).padStart(2, '0')}/${c.getFullYear()}`;
  }
  return String(c ?? '').trim();
}

export function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// --- parsing values ------------------------------------------------------------

/** "1,234.50", "‏-1,234.50 ₪", "1,234.50-", "(1,234.50)" → number; null if not a number. */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[‎‏‪-‮\s₪$€]|ש"ח|ILS|USD|EUR/g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

/** Parses a date cell in the detected format → YYYY-MM-DD, or null. Accepts Excel serials too. */
export function parseDate(raw: string | undefined | null, format: TableMapping['date_format']): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    return d ? iso(d.y, d.m, d.d) : null;
  }
  const parts = s.split(/[^\d]+/).filter(Boolean).map(Number);
  if (parts.length < 3) return null;
  let [a, b, c] = parts;
  let y: number, m: number, d: number;
  if (format === 'YMD' || a > 31) [y, m, d] = [a, b, c];
  else if (format === 'MDY') [m, d, y] = [a, b, c];
  else [d, m, y] = [a, b, c];
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return iso(y, m, d);
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseInstallments(raw: string | undefined): { number: number; total: number } | null {
  const m = String(raw ?? '').match(/(\d+)\s*(?:מתוך|מ-|\/|of)\s*(\d+)/);
  if (!m) return null;
  const [n, total] = [Number(m[1]), Number(m[2])];
  return total > 1 && n >= 1 && n <= total ? { number: n, total } : null;
}

/** Small stable string hash (cyrb53) → hex. Used for de-duplication ids, not security. */
export function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// --- applying a mapping ----------------------------------------------------------

/** Checks that a mapping returned by the server points at real columns. */
export function validateMapping(m: Partial<TableMapping>, rows: string[][]): string | null {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const inRange = (c: unknown) => c == null || (Number.isInteger(c) && (c as number) >= 0 && (c as number) < width);
  if (!Number.isInteger(m.header_row) || (m.header_row as number) < 0 || (m.header_row as number) >= rows.length)
    return 'לא זוהתה שורת כותרות';
  for (const k of ['date_col', 'description_col'] as const) if (m[k] == null || !inRange(m[k])) return `עמודה חסרה: ${k}`;
  for (const k of ['processed_date_col', 'amount_col', 'debit_col', 'credit_col', 'balance_col', 'original_amount_col', 'original_currency_col', 'installments_col', 'memo_col'] as const)
    if (!inRange(m[k])) return `עמודה לא תקינה: ${k}`;
  if (m.amount_col == null && m.debit_col == null && m.credit_col == null) return 'לא זוהתה עמודת סכום';
  return null;
}

export type TableResult = {
  transactions: ParsedTransaction[];
  /** Running balance on the latest row, for bank statements. */
  lastRunningBalance: number | null;
  skipped: number;
};

export function applyMapping(rows: string[][], m: TableMapping): TableResult {
  const out: ParsedTransaction[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  let latest: { date: string; balance: number } | null = null;

  for (const row of rows.slice(m.header_row + 1)) {
    const date = parseDate(row[m.date_col], m.date_format);
    const description = (row[m.description_col] ?? '').replace(/\s+/g, ' ').trim();

    let amount: number | null;
    if (m.amount_col != null) {
      const v = parseNumber(row[m.amount_col]);
      amount = v == null ? null : m.expenses_are_negative ? v : -v;
    } else {
      const debit = m.debit_col != null ? parseNumber(row[m.debit_col]) : null;
      const credit = m.credit_col != null ? parseNumber(row[m.credit_col]) : null;
      amount = debit == null && credit == null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
    }

    // Totals lines, sub-headers and blank lines have no date or no amount.
    if (!date || amount == null || !description || amount === 0) {
      if (row.some((c) => c !== '')) skipped++;
      continue;
    }
    amount = Math.round(amount * 100) / 100;

    const base = `${date}|${amount}|${description}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);

    const origAmount = m.original_amount_col != null ? parseNumber(row[m.original_amount_col]) : null;
    const origCurrency = m.original_currency_col != null ? normalizeCurrency(row[m.original_currency_col]) : null;

    out.push({
      external_id: hash(`${base}|${n}`),
      date,
      processed_date: m.processed_date_col != null ? parseDate(row[m.processed_date_col], m.date_format) : null,
      amount,
      original_amount: origAmount == null ? null : Math.sign(amount) * Math.abs(origAmount),
      original_currency: origCurrency,
      description,
      memo: m.memo_col != null ? row[m.memo_col] || null : null,
      installments: m.installments_col != null ? parseInstallments(row[m.installments_col]) : null,
      status: 'completed',
    });

    if (m.balance_col != null) {
      const bal = parseNumber(row[m.balance_col]);
      if (bal != null && (!latest || date >= latest.date)) latest = { date, balance: bal };
    }
  }
  return { transactions: out, lastRunningBalance: latest?.balance ?? null, skipped };
}

function normalizeCurrency(raw: string | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/₪|ש"ח|ILS|שקל/.test(s)) return 'ILS';
  if (/\$|USD|דולר/.test(s)) return 'USD';
  if (/€|EUR|יורו/.test(s)) return 'EUR';
  if (/£|GBP/.test(s)) return 'GBP';
  return s.slice(0, 3).toUpperCase();
}

/** Amount owed on a card = charges whose billing date hasn't come yet. */
export function upcomingCardCharges(txns: ParsedTransaction[], today: string): number {
  const owed = -txns.filter((t) => (t.processed_date ?? t.date) >= today).reduce((s, t) => s + t.amount, 0);
  return Math.max(0, Math.round(owed * 100) / 100);
}
