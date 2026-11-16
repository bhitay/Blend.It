import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConfig } from '../src/config.mjs';
import { runSync } from '../src/run.mjs';
import { accountPayload, cardBalance, mapTransactions, startDateFor, toIsraelDate } from '../src/transform.mjs';

const tx = (o) => ({
  type: 'normal', date: '2026-11-14T22:00:00.000Z', processedDate: '2026-11-14T22:00:00.000Z',
  originalAmount: -50, originalCurrency: 'ILS', chargedAmount: -50, description: 'קפה', status: 'completed', ...o,
});

test('dates are converted to Israel calendar days', () => {
  assert.equal(toIsraelDate('2026-11-14T22:00:00.000Z'), '2026-11-15');
  assert.equal(toIsraelDate('2026-07-10T21:00:00.000Z'), '2026-07-11'); // summer time (UTC+3)
  assert.equal(toIsraelDate('2026-11-15T10:00:00.000Z'), '2026-11-15');
  assert.equal(toIsraelDate(undefined), null);
});

test('identical transactions on the same day are both kept, with stable ids', () => {
  const a = mapTransactions([tx(), tx()]);
  assert.equal(a.length, 2);
  assert.notEqual(a[0].external_id, a[1].external_id);
  const b = mapTransactions([tx(), tx()]);
  assert.deepEqual(a.map((r) => r.external_id), b.map((r) => r.external_id));
});

test('different transactions get different ids; pending and completed differ', () => {
  const [x, y, z] = mapTransactions([tx(), tx({ chargedAmount: -51 }), tx({ status: 'pending' })]);
  assert.equal(new Set([x.external_id, y.external_id, z.external_id]).size, 3);
  assert.equal(z.status, 'pending');
});

test('installments and foreign currency are preserved', () => {
  const [r] = mapTransactions([
    tx({ installments: { number: 2, total: 12 }, originalAmount: -10, originalCurrency: 'USD', chargedAmount: -37.456 }),
  ]);
  assert.deepEqual(r.installments, { number: 2, total: 12 });
  assert.equal(r.original_currency, 'USD');
  assert.equal(r.amount, -37.46);
});

test('card balance = charges not yet billed (refunds reduce it, never negative)', () => {
  const rows = [
    { processed_date: '2026-11-02', amount: -500 }, // already charged
    { processed_date: '2026-12-02', amount: -300 },
    { processed_date: '2026-12-02', amount: -200 },
    { processed_date: '2026-12-02', amount: 50 }, // refund
  ];
  assert.equal(cardBalance(rows, '2026-11-16'), 450);
  assert.equal(cardBalance([{ processed_date: '2026-12-02', amount: 80 }], '2026-11-16'), 0);
});

test('account payloads: bank keeps a negative (overdraft) balance, card becomes a liability', () => {
  const bank = accountPayload({
    householdId: 'h', company: 'mizrahi', ownerUserId: null, today: '2026-11-16',
    account: { accountNumber: '123-456789', balance: -1500.5, txns: [tx()] },
  });
  assert.equal(bank.kind, 'bank');
  assert.equal(bank.balance, -1500.5);
  assert.equal(bank.name, 'מזרחי טפחות 6789');
  const card = accountPayload({
    householdId: 'h', company: 'isracard', ownerUserId: 'u', today: '2026-11-16',
    account: { accountNumber: '4321', txns: [tx({ processedDate: '2026-12-01T22:00:00.000Z', chargedAmount: -99 })] },
  });
  assert.equal(card.kind, 'credit_card');
  assert.equal(card.balance, 99);
  assert.equal(card.owner_user_id, 'u');
});

test('start date: a week before the last success, else N months back', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  assert.equal(startDateFor({ lastSuccessAt: '2026-11-10T03:00:00Z', initialMonths: 12, now }).toISOString().slice(0, 10), '2026-11-03');
  assert.equal(startDateFor({ initialMonths: 12, now }).toISOString().slice(0, 10), '2025-11-16');
});

test('config validation lists every missing field', () => {
  assert.throws(
    () => validateConfig({ supabase: {}, sources: [{ company: 'isracard', credentials: { id: '1' } }] }),
    (e) => /supabase\.url/.test(e.message) && /card6Digits/.test(e.message) && /password/.test(e.message),
  );
  const ok = validateConfig({
    supabase: { url: 'https://abc.supabase.co/rest/v1/', key: 'k', email: 'e', password: 'p' },
    sources: [{ company: 'max', owner: 'איתי', credentials: { username: 'u', password: 'p' } }],
  });
  assert.equal(ok.supabase.url, 'https://abc.supabase.co');
  assert.equal(ok.sources[0].label, 'מקס');
});

// --- runSync with fake scraper + db ------------------------------------------

function fakeDb() {
  const calls = { runs: [], finished: [], ingested: [] };
  return {
    calls,
    household: async () => ({ household: { id: 'h1' }, members: [{ user_id: 'u1', display_name: 'איתי' }] }),
    startRun: async (r) => (calls.runs.push(r), `run${calls.runs.length}`),
    finishRun: async (id, f) => calls.finished.push({ id, ...f }),
    ingest: async (p) => (calls.ingested.push(p), { transactions: p.transactions.length, new_transactions: p.transactions.length }),
  };
}

const baseConfig = (sources) => ({ initialMonths: 12, minHoursBetweenRuns: 20, sources });
const src = (o) => ({ company: 'max', label: 'מקס', owner: 'איתי', credentials: { username: 'u', password: 'p' }, ...o });

test('runSync ingests accounts, records success, and skips the next run within the window', async () => {
  const db = fakeDb();
  const state = {};
  const scrape = async () => ({ success: true, accounts: [{ accountNumber: '1111', txns: [tx()] }, { accountNumber: '2222', txns: [] }] });
  const now = new Date('2026-11-16T03:00:00Z');
  const s1 = await runSync({ config: baseConfig([src()]), state, scrape, db, log: () => {}, now });
  assert.equal(s1[0].status, 'success');
  assert.equal(db.calls.ingested.length, 2);
  assert.equal(db.calls.ingested[0].owner_user_id, 'u1');
  assert.equal(db.calls.finished[0].status, 'success');

  const later = new Date('2026-11-16T10:00:00Z');
  const s2 = await runSync({ config: baseConfig([src()]), state, scrape, db, log: () => {}, now: later });
  assert.equal(s2[0].status, 'skipped');
  const s3 = await runSync({ config: baseConfig([src()]), state, scrape, db, log: () => {}, now: later, force: true });
  assert.equal(s3[0].status, 'success');
});

test('wrong password pauses the source until the credentials change', async () => {
  const db = fakeDb();
  const state = {};
  let attempts = 0;
  const bad = async () => (attempts++, { success: false, errorType: 'INVALID_PASSWORD' });
  await runSync({ config: baseConfig([src()]), state, scrape: bad, db, log: () => {} });
  await runSync({ config: baseConfig([src()]), state, scrape: bad, db, log: () => {}, force: true });
  assert.equal(attempts, 1, 'must not retry a wrong password');
  assert.equal(db.calls.finished[0].error_type, 'INVALID_PASSWORD');

  const good = async () => ({ success: true, accounts: [] });
  const s = await runSync({
    config: baseConfig([src({ credentials: { username: 'u', password: 'new' } })]), state, scrape: good, db, log: () => {},
  });
  assert.equal(s[0].status, 'success');
});

test('a timeout is retried on the next run; one failing source does not stop the others', async () => {
  const db = fakeDb();
  const state = {};
  const scrape = async (o) =>
    o.companyId === 'max' ? { success: false, errorType: 'TIMEOUT' } : { success: true, accounts: [] };
  const s = await runSync({
    config: baseConfig([src(), src({ company: 'mizrahi', label: 'מזרחי' })]), state, scrape, db, log: () => {},
  });
  assert.deepEqual(s.map((x) => x.status), ['error', 'success']);
  assert.equal(state.sources['max:מקס'].pausedFingerprint, undefined);
});

test('a thrown exception is recorded and does not crash the run', async () => {
  const db = fakeDb();
  const s = await runSync({
    config: baseConfig([src()]), state: {}, scrape: async () => { throw new Error('browser crashed'); }, db, log: () => {},
  });
  assert.equal(s[0].status, 'error');
  assert.match(db.calls.finished[0].error_message, /browser crashed/);
});

test('unknown or joint owner is stored as joint', async () => {
  const db = fakeDb();
  const scrape = async () => ({ success: true, accounts: [{ accountNumber: '1', txns: [] }] });
  await runSync({ config: baseConfig([src({ owner: 'משותף' }), src({ label: 'מקס 2', owner: 'מישהו' })]), state: {}, scrape, db, log: () => {} });
  assert.deepEqual(db.calls.ingested.map((p) => p.owner_user_id), [null, null]);
});
