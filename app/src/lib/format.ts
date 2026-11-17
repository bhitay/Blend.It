const formatters = new Map<string, Intl.NumberFormat>();

/** Whole units by default; `exact` shows agorot/cents when the amount has them (transactions). */
export function formatMoney(value: number, currency = 'ILS', exact = false): string {
  const decimals = exact && Math.round(value * 100) % 100 !== 0 ? 2 : 0;
  const cacheKey = `${currency}:${decimals}`;
  let f = formatters.get(cacheKey);
  if (!f) {
    f = new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(cacheKey, f);
  }
  return f.format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Days between an ISO date and today. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso.slice(0, 10) + 'T00:00:00');
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

/** Parses user input like "12,500" or "‎-3000.5" into a number, or null. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
