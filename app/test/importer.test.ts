import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import {
  applyMapping, findHeaderRow, hash, localAccountHint, maskIdentifiers, maskRows, parseDate, parseNumber, readSpreadsheet, toBase64, upcomingCardCharges, validateMapping,
  type TableMapping,
} from '../src/lib/importer';

function xlsx(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const base: TableMapping = {
  source_type: 'bank', institution: 'mizrahi', account_hint: '1234', owner_name: null, header_row: 0, date_col: 0,
  description_col: 1, processed_date_col: null, amount_col: null, debit_col: null, credit_col: null, balance_col: null,
  original_amount_col: null, original_currency_col: null, installments_col: null, memo_col: null, date_format: 'DMY',
  expenses_are_negative: true, closing_balance: null, notes: '',
};

test('numbers in Israeli export formats', () => {
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber('‏-1,234.50 ₪'), -1234.5);
  assert.equal(parseNumber('1,234.50-'), -1234.5);
  assert.equal(parseNumber('(80)'), -80);
  assert.equal(parseNumber('$19.99'), 19.99);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('סה"כ'), null);
});

test('dates: DMY, two-digit years, ISO and Excel serials', () => {
  assert.equal(parseDate('05/11/2026', 'DMY'), '2026-11-05');
  assert.equal(parseDate('5.11.26', 'DMY'), '2026-11-05');
  assert.equal(parseDate('2026-11-05', 'DMY'), '2026-11-05');
  assert.equal(parseDate('11/05/2026', 'MDY'), '2026-11-05');
  assert.equal(parseDate('46331', 'DMY'), '2026-11-05');
  assert.equal(parseDate('תאריך', 'DMY'), null);
});

test('bank statement: title rows, debit/credit columns, running balance, totals row skipped', () => {
  const buf = xlsx({
    'תנועות': [
      ['בנק מזרחי טפחות'], ['חשבון 123-456789'], [],
      ['תאריך', 'סוג תנועה', 'זכות', 'חובה', 'יתרה'],
      ['01/11/2026', 'משכורת', '18,500.00', '', '20,100.00'],
      ['03/11/2026', 'ישראכרט', '', '6,240.30', '13,859.70'],
      ['03/11/2026', 'ארנונה', '', '512.00', '13,347.70'],
      ['', 'סה"כ', '18,500.00', '6,752.30', ''],
    ],
  });
  const [sheet] = readSpreadsheet(buf);
  const m = { ...base, header_row: sheet.rows.findIndex((r) => r[0] === 'תאריך'), debit_col: 3, credit_col: 2, balance_col: 4 };
  assert.equal(validateMapping(m, sheet.rows), null);
  const r = applyMapping(sheet.rows, m);
  assert.deepEqual(r.transactions.map((t) => t.amount), [18500, -6240.3, -512]);
  assert.equal(r.lastRunningBalance, 13347.7);
  assert.equal(r.skipped, 1);
});

test('credit card: positive charges become expenses, installments, foreign currency, Excel date cells', () => {
  const buf = xlsx({
    'עסקאות במועד החיוב': [
      ['כרטיס 4321'],
      ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'מטבע', 'סכום חיוב', 'פירוט נוסף', 'תאריך חיוב'],
      [new Date(Date.UTC(2026, 10, 2)), 'שופרסל דיל', '312.40', '₪', '312.40', '', '02/12/2026'],
      ['10/11/2026', 'איקאה', '1,500', '₪', '150', 'תשלום 3 מתוך 10', '02/12/2026'],
      ['08/11/2026', 'SPOTIFY', '19.99', '$', '71.50', '', '02/12/2026'],
      ['05/11/2026', 'זיכוי - רמי לוי', '-40', '₪', '-40', '', '02/12/2026'],
      ['', 'סך הכל לחיוב', '', '', '493.90', '', ''],
    ],
    'ריק': [['']],
  });
  const sheets = readSpreadsheet(buf);
  assert.equal(sheets.length, 1, 'empty sheet ignored');
  const m: TableMapping = {
    ...base, source_type: 'credit_card', institution: 'max', header_row: 1, date_col: 0, description_col: 1,
    amount_col: 4, original_amount_col: 2, original_currency_col: 3, installments_col: 5, memo_col: 5,
    processed_date_col: 6, expenses_are_negative: false,
  };
  const r = applyMapping(sheets[0].rows, m);
  const byDesc = Object.fromEntries(r.transactions.map((t) => [t.description, t]));
  assert.equal(r.transactions.length, 4);
  assert.equal(byDesc['שופרסל דיל'].amount, -312.4);
  assert.equal(byDesc['שופרסל דיל'].date, '2026-11-02');
  assert.deepEqual(byDesc['איקאה'].installments, { number: 3, total: 10 });
  assert.equal(byDesc['SPOTIFY'].original_currency, 'USD');
  assert.equal(byDesc['SPOTIFY'].original_amount, -19.99);
  assert.equal(byDesc['זיכוי - רמי לוי'].amount, 40);
  assert.equal(upcomingCardCharges(r.transactions, '2026-11-16'), 493.9);
});

test('identical lines are both kept and ids are stable across uploads', () => {
  const rows = [['תאריך', 'תיאור', 'סכום'], ['01/11/2026', 'קפה', '-12'], ['01/11/2026', 'קפה', '-12'], ['02/11/2026', 'קפה', '-12']];
  const m = { ...base, amount_col: 2 };
  const a = applyMapping(rows, m).transactions.map((t) => t.external_id);
  const b = applyMapping(rows, m).transactions.map((t) => t.external_id);
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(a, b);
  assert.notEqual(hash('a'), hash('b'));
});

test('mapping validation rejects columns that do not exist', () => {
  const rows = [['a', 'b'], ['1', '2']];
  assert.match(validateMapping({ ...base, amount_col: 7 }, rows)!, /amount_col/);
  assert.match(validateMapping({ ...base }, rows)!, /סכום/);
  assert.match(validateMapping({ ...base, header_row: 9, amount_col: 1 }, rows)!, /כותרות/);
});

test('base64 of binary data', () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 255, 0]);
  assert.equal(toBase64(bytes.buffer), Buffer.from(bytes).toString('base64'));
});

test('identifiers are masked before leaving the device; amounts and dates are not', () => {
  assert.equal(maskIdentifiers('ת.ז. 034567891'), 'ת.ז. •••7891');
  assert.equal(maskIdentifiers('חשבון 123-456789'), 'חשבון •••6789');
  assert.equal(maskIdentifiers('כרטיס 4580 1234 5678 9012'), 'כרטיס •••9012');
  assert.equal(maskIdentifiers('טלפון 050-1234567'), 'טלפון •••4567');
  assert.equal(maskIdentifiers('1,234,567.89'), '1,234,567.89');
  assert.equal(maskIdentifiers('2350000.00'), '2350000.00');
  assert.equal(maskIdentifiers('13,347.70'), '13,347.70');
  assert.equal(maskIdentifiers('05/11/2026'), '05/11/2026');
  assert.equal(maskIdentifiers('2026-11-05'), '2026-11-05');
  assert.equal(maskIdentifiers('05-11-2026'), '05-11-2026');
  assert.equal(maskIdentifiers('4321'), '4321');
  assert.equal(maskIdentifiers('שופרסל דיל'), 'שופרסל דיל');
  const rows = [['חשבון 123-456789'], ['01/11/2026', 'משכורת', '18,500.00']];
  assert.deepEqual(maskRows(rows), [['חשבון •••6789'], ['01/11/2026', 'משכורת', '18,500.00']]);
  assert.equal(rows[0][0], 'חשבון 123-456789', 'originals untouched');
});


test('title lines with personal details are found and kept on the device', () => {
  const rows = [
    ['בנק מזרחי טפחות - תנועות בחשבון'],
    ['שם: ישראל ישראלי    ת.ז. 034567891'],
    ['חשבון: 20-418-123456789    סניף 418'],
    ['תאריך', 'תיאור', 'זכות', 'חובה', 'יתרה'],
    ['01/11/2026', 'משכורת', '18,500.00', '', '20,100.00'],
  ];
  assert.equal(findHeaderRow(rows), 3);
  assert.equal(localAccountHint(rows, 3), '6789', 'the account line, not the ID line above it');
  assert.equal(localAccountHint([['ת.ז. 034567891 חשבון 12-345-678901'], ['תאריך', 'a', 'b']], 1), '8901');
  assert.equal(localAccountHint([['כרטיס מספר 4580-1234-5678-4321'], ['תאריך', 'a', 'b']], 1), '4321');
  assert.equal(localAccountHint([['ת.ז. 034567891'], ['תאריך', 'a', 'b']], 1), null, 'never the ID');
  assert.equal(findHeaderRow([['a', 'b'], ['1', '2']]), -1);
});

test('descriptions are stored masked; re-uploading the same file still de-duplicates', () => {
  const rows = [['תאריך', 'תיאור', 'סכום'], ['02/11/2026', 'העברה לדנה כהן ח-ן 12-345-678901', '-1200']];
  const m = { ...base, amount_col: 2 };
  const [t] = applyMapping(rows, m).transactions;
  assert.equal(t.description, 'העברה לדנה כהן ח-ן •••8901');
  assert.equal(t.external_id, applyMapping(rows, m).transactions[0].external_id);
  assert.equal(t.external_id, hash('2026-11-02|-1200|העברה לדנה כהן ח-ן 12-345-678901|1'), 'id from the original text, as before');
});
