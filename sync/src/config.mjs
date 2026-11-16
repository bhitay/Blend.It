import { existsSync, readFileSync } from 'node:fs';
import { COMPANY_LABELS } from './transform.mjs';

/** Login fields each company needs (from israeli-bank-scrapers' SCRAPERS definitions). */
export const LOGIN_FIELDS = {
  mizrahi: ['username', 'password'],
  discount: ['id', 'password', 'num'],
  otsarHahayal: ['username', 'password'],
  max: ['username', 'password'],
  isracard: ['id', 'card6Digits', 'password'],
  amex: ['id', 'card6Digits', 'password'],
  visaCal: ['username', 'password'],
  hapoalim: ['userCode', 'password'],
  leumi: ['username', 'password'],
  mercantile: ['id', 'password', 'num'],
  beinleumi: ['username', 'password'],
  union: ['username', 'password'],
  massad: ['username', 'password'],
  yahav: ['username', 'nationalID', 'password'],
};

export class ConfigError extends Error {}

export function loadConfig(path) {
  if (!existsSync(path)) {
    throw new ConfigError(`לא נמצא ${path}. העתיקו את config.example.json ל-config.json ומלאו אותו (ראו SYNC.md).`);
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ConfigError(`config.json אינו JSON תקין: ${e.message}`);
  }
  return validateConfig(cfg);
}

export function validateConfig(cfg) {
  const errors = [];
  const sb = cfg.supabase ?? {};
  for (const k of ['url', 'key', 'email', 'password']) {
    if (!sb[k] || String(sb[k]).includes('YOUR')) errors.push(`supabase.${k} חסר`);
  }
  if (!Array.isArray(cfg.sources) || cfg.sources.length === 0) errors.push('sources ריק');

  const keys = new Set();
  (cfg.sources ?? []).forEach((s, i) => {
    const where = `sources[${i}] (${s.label ?? s.company})`;
    if (s.enabled === false) return;
    const fields = LOGIN_FIELDS[s.company];
    if (!fields) {
      errors.push(`${where}: company לא מוכר "${s.company}". אפשרויות: ${Object.keys(LOGIN_FIELDS).join(', ')}`);
      return;
    }
    for (const f of fields) {
      const v = s.credentials?.[f];
      if (!v || String(v).startsWith('<')) errors.push(`${where}: חסר credentials.${f}`);
    }
    const key = `${s.company}:${s.label ?? ''}`;
    if (keys.has(key)) errors.push(`${where}: יש שני מקורות עם אותו company ו-label. תנו label שונה לכל אחד.`);
    keys.add(key);
  });

  if (errors.length) throw new ConfigError('בעיות ב-config.json:\n  - ' + errors.join('\n  - '));

  return {
    supabase: { ...sb, url: new URL(String(sb.url).trim()).origin },
    initialMonths: cfg.initialMonths ?? 12,
    minHoursBetweenRuns: cfg.minHoursBetweenRuns ?? 20,
    showBrowser: Boolean(cfg.showBrowser),
    browserPath: cfg.browserPath || undefined,
    sources: cfg.sources
      .filter((s) => s.enabled !== false)
      .map((s) => ({ ...s, label: s.label ?? COMPANY_LABELS[s.company] ?? s.company })),
  };
}
