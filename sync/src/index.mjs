#!/usr/bin/env node
// BlendIt home sync. Usage:
//   npm run sync          normal run (skips sources synced in the last ~20h)
//   npm run sync:force    sync everything now
//   npm run check         validate config.json and the Supabase login, without scraping

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { ConfigError, loadConfig } from './config.mjs';
import { runSync } from './run.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'config.json');
const STATE = join(ROOT, 'state.json');
const LOCK = join(ROOT, 'sync.lock');
const LOGS = join(ROOT, 'logs');

const args = new Set(process.argv.slice(2));

function log(msg) {
  const line = `[${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(LOGS, { recursive: true });
    appendFileSync(join(LOGS, `sync-${new Date().toISOString().slice(0, 7)}.log`), line + '\n');
  } catch {
    /* logging must never break a sync */
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return { sources: {} };
  }
}

/** Single-instance lock; a lock older than 2 hours is assumed stale (crash, reboot). */
function acquireLock() {
  if (existsSync(LOCK)) {
    const age = Date.now() - Number(readFileSync(LOCK, 'utf8'));
    if (age < 2 * 3_600_000) return false;
  }
  writeFileSync(LOCK, String(Date.now()));
  return true;
}

async function connect(cfg) {
  const supabase = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: true } });
  const { data, error } = await supabase.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
  if (error) throw new Error(`התחברות ל-BlendIt נכשלה (${cfg.email}): ${error.message}`);
  const userId = data.user.id;

  const must = (res) => {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };

  return {
    async household() {
      const rows = must(
        await supabase.from('household_members').select('households(id, name)').eq('user_id', userId).limit(1),
      );
      const household = rows[0]?.households;
      if (!household) throw new Error('המשתמש עוד לא חבר במשק בית. היכנסו לאפליקציה וצרו/הצטרפו למשק בית.');
      const members = must(
        await supabase.from('household_members').select('user_id, display_name').eq('household_id', household.id),
      );
      return { household, members };
    },
    async startRun(row) {
      return must(await supabase.from('sync_runs').insert(row).select('id').single()).id;
    },
    async finishRun(id, fields) {
      must(await supabase.from('sync_runs').update({ ...fields, finished_at: new Date().toISOString() }).eq('id', id));
    },
    async ingest(payload) {
      return must(await supabase.rpc('ingest_account', { payload }));
    },
    signOut: () => supabase.auth.signOut(),
  };
}

async function main() {
  const config = loadConfig(CONFIG);
  const db = await connect(config.supabase);
  const { household, members } = await db.household();

  if (args.has('--check')) {
    log(`✓ config.json תקין. מחובר למשק הבית "${household.name}" (${members.map((m) => m.display_name).join(', ')}).`);
    log(`  מקורות: ${config.sources.map((s) => `${s.label} [${s.owner || 'משותף'}]`).join(', ')}`);
    await db.signOut();
    return 0;
  }

  if (!acquireLock()) {
    log('סנכרון אחר כבר רץ. יוצא.');
    return 0;
  }
  try {
    // Imported lazily: it pulls in puppeteer, which --check doesn't need.
    const { createScraper } = await import('israeli-bank-scrapers');
    const scrape = (options, credentials) => createScraper(options).scrape(credentials);
    const state = readState();
    const summary = await runSync({
      config,
      state,
      scrape,
      db: { ...db, household: async () => ({ household, members }) },
      log,
      force: args.has('--force'),
    });
    writeFileSync(STATE, JSON.stringify(state, null, 2));
    const failed = summary.filter((s) => s.status === 'error').length;
    log(failed ? `סיום עם ${failed} שגיאות.` : 'סיום.');
    return failed ? 2 : 0;
  } finally {
    rmSync(LOCK, { force: true });
    await db.signOut().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log(e instanceof ConfigError ? e.message : `שגיאה: ${e?.stack ?? e}`);
    process.exit(1);
  });
