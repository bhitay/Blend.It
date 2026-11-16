import {
  accountPayload,
  AUTH_ERRORS,
  credentialsFingerprint,
  ERROR_MESSAGES,
  isCard,
  sourceKey,
  startDateFor,
  toIsraelDate,
} from './transform.mjs';

/**
 * One sync pass over every configured source.
 *
 * deps:
 *   scrape(options, credentials) → israeli-bank-scrapers result
 *   db: { household(), startRun(src), finishRun(runId, fields), ingest(payload) }
 *   state: { sources: { [key]: { lastSuccessAt, pausedFingerprint, pausedReason } } }  (mutated)
 *   log(msg)
 */
export async function runSync({ config, state, scrape, db, log, now = new Date(), force = false }) {
  const { household, members } = await db.household();
  const today = toIsraelDate(now.toISOString());
  const summary = [];
  state.sources ??= {};

  for (const src of config.sources) {
    const key = sourceKey(src);
    const st = (state.sources[key] ??= {});
    const fingerprint = credentialsFingerprint(src.credentials);

    // Wrong password last time and the credentials haven't changed: don't try again,
    // banks lock the account after a few failed logins.
    if (st.pausedFingerprint) {
      if (st.pausedFingerprint === fingerprint) {
        log(`⏸  ${src.label}: מושהה (${st.pausedReason}). עדכנו את הפרטים ב-config.json כדי לחדש.`);
        summary.push({ label: src.label, status: 'paused' });
        continue;
      }
      delete st.pausedFingerprint;
      delete st.pausedReason;
    }

    if (!force && st.lastSuccessAt) {
      const hours = (now - new Date(st.lastSuccessAt)) / 3_600_000;
      if (hours < config.minHoursBetweenRuns) {
        log(`✓  ${src.label}: סונכרן לפני ${hours.toFixed(1)} שעות, מדלג.`);
        summary.push({ label: src.label, status: 'skipped' });
        continue;
      }
    }

    const ownerUserId = resolveOwner(src.owner, members, log, src.label);
    const startDate = startDateFor({ lastSuccessAt: st.lastSuccessAt, initialMonths: config.initialMonths, now });
    log(`→  ${src.label}: מושך נתונים מ-${toIsraelDate(startDate.toISOString())}…`);

    const runId = await db.startRun({ household_id: household.id, institution: src.company, label: src.label });
    try {
      const result = await scrape(
        {
          companyId: src.company,
          startDate,
          combineInstallments: false,
          futureMonthsToScrape: isCard(src.company) ? 1 : undefined,
          showBrowser: config.showBrowser,
          executablePath: config.browserPath,
          defaultTimeout: 60_000,
        },
        src.credentials,
      );

      if (!result.success) {
        const type = result.errorType ?? 'GENERIC';
        const message = ERROR_MESSAGES[type] ?? result.errorMessage ?? type;
        if (AUTH_ERRORS.has(type)) {
          st.pausedFingerprint = fingerprint;
          st.pausedReason = type;
        }
        await db.finishRun(runId, { status: 'error', error_type: type, error_message: message });
        log(`✗  ${src.label}: ${message}${result.errorMessage ? ` (${result.errorMessage})` : ''}`);
        summary.push({ label: src.label, status: 'error', error: type });
        continue;
      }

      let txCount = 0;
      let newCount = 0;
      const accounts = result.accounts ?? [];
      for (const account of accounts) {
        const payload = accountPayload({ householdId: household.id, company: src.company, ownerUserId, account, today });
        const res = await db.ingest(payload);
        txCount += res.transactions;
        newCount += res.new_transactions;
        log(`   ${payload.name}: ${res.transactions} תנועות (${res.new_transactions} חדשות)`);
      }

      await db.finishRun(runId, {
        status: 'success',
        accounts: accounts.length,
        transactions: txCount,
        new_transactions: newCount,
      });
      st.lastSuccessAt = now.toISOString();
      log(`✓  ${src.label}: ${accounts.length} חשבונות, ${newCount} תנועות חדשות`);
      summary.push({ label: src.label, status: 'success', accounts: accounts.length, newTransactions: newCount });
    } catch (e) {
      const message = String(e?.message ?? e).slice(0, 500);
      await db.finishRun(runId, { status: 'error', error_type: 'EXCEPTION', error_message: message }).catch(() => {});
      log(`✗  ${src.label}: ${message}`);
      summary.push({ label: src.label, status: 'error', error: 'EXCEPTION' });
    }
  }
  return summary;
}

/** "owner" in config is a member's display name in the app, or "משותף"/empty for joint. */
export function resolveOwner(owner, members, log, label) {
  const name = owner?.trim();
  if (!name || name === 'משותף' || name.toLowerCase() === 'joint') return null;
  const m = members.find((x) => x.display_name.trim() === name);
  if (!m) {
    log(`!  ${label}: owner "${name}" לא נמצא במשק הבית (${members.map((x) => x.display_name).join(', ')}). נשמר כמשותף.`);
    return null;
  }
  return m.user_id;
}
