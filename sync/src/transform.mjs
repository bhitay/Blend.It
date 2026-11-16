// Pure functions that turn israeli-bank-scrapers output into BlendIt rows.
// No I/O here, so everything is unit-tested in test/transform.test.mjs.

import { createHash } from 'node:crypto';

export const BANKS = {
  mizrahi: 'מזרחי טפחות',
  discount: 'דיסקונט',
  otsarHahayal: 'אוצר החייל',
  hapoalim: 'הפועלים',
  leumi: 'לאומי',
  mercantile: 'מרכנתיל',
  beinleumi: 'הבינלאומי',
  union: 'איגוד',
  massad: 'מסד',
  yahav: 'יהב',
};

export const CARDS = {
  max: 'מקס',
  isracard: 'ישראכרט',
  amex: 'אמריקן אקספרס',
  visaCal: 'כאל',
};

export const COMPANY_LABELS = { ...BANKS, ...CARDS };

export function isCard(company) {
  return company in CARDS;
}

const israelDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Scrapers return ISO timestamps that are usually Israeli midnight expressed in UTC
 * (e.g. 2026-11-14T22:00:00.000Z means 15 Nov in Israel). Returns YYYY-MM-DD in Israel time.
 */
export function toIsraelDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return israelDate.format(d);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Maps scraped transactions to rows with a stable external_id.
 *
 * The id hashes the fields that identify a transaction. Genuinely identical
 * transactions (two coffees, same day, same price) get an occurrence suffix so
 * both are kept, and they get the same ids again on the next sync.
 */
export function mapTransactions(txns) {
  const seen = new Map();
  return (txns ?? []).map((t) => {
    const date = toIsraelDate(t.date);
    const processed = toIsraelDate(t.processedDate) ?? date;
    const amount = round2(t.chargedAmount ?? t.originalAmount ?? 0);
    const description = (t.description ?? '').trim();
    const identifier = t.identifier == null ? '' : String(t.identifier);
    const status = t.status === 'pending' ? 'pending' : 'completed';

    const base = [status === 'pending' ? 'p' : 'c', date, amount, description, identifier].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const external_id = createHash('sha256').update(`${base}|${n}`).digest('hex').slice(0, 32);

    return {
      external_id,
      date,
      processed_date: processed,
      amount,
      original_amount: t.originalAmount == null ? null : round2(t.originalAmount),
      original_currency: t.originalCurrency ?? null,
      description,
      memo: t.memo?.trim() || null,
      installments: t.installments ? { number: t.installments.number, total: t.installments.total } : null,
      status,
    };
  });
}

/**
 * Credit cards report no balance. What the family owes on a card is everything
 * not yet charged to the bank: transactions processed today or later (charges are
 * negative, refunds positive). Returned as a positive amount owed.
 */
export function cardBalance(rows, today) {
  const owed = -rows.filter((r) => r.processed_date >= today).reduce((s, r) => s + r.amount, 0);
  return Math.max(0, round2(owed));
}

function lastDigits(accountNumber) {
  const digits = String(accountNumber).replace(/\D/g, '');
  return digits.slice(-4) || String(accountNumber);
}

/** Builds the ingest_account() payload for one scraped account. */
export function accountPayload({ householdId, company, ownerUserId, account, today }) {
  const transactions = mapTransactions(account.txns);
  const card = isCard(company);
  const kind = card ? 'credit_card' : account.savingsAccount ? 'savings' : 'bank';
  const label = COMPANY_LABELS[company] ?? company;

  let balance = null;
  if (card) balance = cardBalance(transactions, today);
  else if (typeof account.balance === 'number' && Number.isFinite(account.balance)) balance = round2(account.balance);

  return {
    household_id: householdId,
    institution: company,
    external_id: String(account.accountNumber),
    kind,
    name: `${label} ${lastDigits(account.accountNumber)}`,
    owner_user_id: ownerUserId ?? null,
    currency: 'ILS',
    balance,
    balance_as_of: today,
    transactions,
  };
}

/** Where to start scraping: a week before the last success, or N months back on first run. */
export function startDateFor({ lastSuccessAt, initialMonths, now = new Date() }) {
  if (lastSuccessAt) {
    const d = new Date(lastSuccessAt);
    d.setDate(d.getDate() - 7);
    return d;
  }
  const d = new Date(now);
  d.setMonth(d.getMonth() - initialMonths);
  return d;
}

/** Errors that mean "the credentials are wrong" — retrying risks locking the account. */
export const AUTH_ERRORS = new Set(['INVALID_PASSWORD', 'CHANGE_PASSWORD', 'ACCOUNT_BLOCKED']);

export const ERROR_MESSAGES = {
  INVALID_PASSWORD: 'שם משתמש או סיסמה שגויים. הסנכרון של מקור זה הושהה עד שתעדכנו את config.json.',
  CHANGE_PASSWORD: 'האתר מבקש להחליף סיסמה. החליפו באתר, עדכנו את config.json.',
  ACCOUNT_BLOCKED: 'החשבון באתר חסום. שחררו אותו מול הבנק/חברת האשראי ועדכנו את config.json.',
  TIMEOUT: 'האתר לא הגיב בזמן. ננסה שוב בהרצה הבאה.',
  GENERIC: 'שגיאה כללית באתר. ננסה שוב בהרצה הבאה.',
  GENERAL_ERROR: 'שגיאה כללית באתר. ננסה שוב בהרצה הבאה.',
};

/** Stable fingerprint of a source's credentials, so a paused source resumes once they change. */
export function credentialsFingerprint(credentials) {
  const sorted = Object.keys(credentials ?? {})
    .sort()
    .map((k) => `${k}=${credentials[k]}`)
    .join('\n');
  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

export function sourceKey(source) {
  return `${source.company}:${source.label ?? ''}`;
}
