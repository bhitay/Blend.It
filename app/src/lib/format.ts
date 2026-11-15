const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number, currency = 'ILS'): string {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 });
    formatters.set(currency, f);
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
