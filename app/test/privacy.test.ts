import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeholderFor, splitMoney } from '../src/lib/moneyText';

const fmt = (n: number, currency = 'ILS', exact = false) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency, minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 }).format(n);

test('amounts are found in every format the app writes them', () => {
  for (const s of [fmt(1915750), fmt(-905000), fmt(-312.4, 'ILS', true), fmt(-19.99, 'USD', true), '₪15,100', '$19.99']) {
    const parts = splitMoney(s);
    assert.ok(parts.some((p) => p.money), s);
    assert.equal(parts.filter((p) => p.money).map((p) => p.text).join('').replace(/[^\d]/g, ''), s.replace(/[^\d]/g, ''), s);
  }
});

test('text around amounts stays readable; percentages, dates and counts are not amounts', () => {
  const parts = splitMoney('נשארו ₪15,100 החודש. נחסכו 72% מההכנסה, עד 30/09/2026, 3 חיובים חוזרים');
  assert.deepEqual(parts.filter((p) => p.money).map((p) => p.text), ['₪15,100']);
  assert.equal(parts.map((p) => p.text).join(''), 'נשארו ₪15,100 החודש. נחסכו 72% מההכנסה, עד 30/09/2026, 3 חיובים חוזרים');
  assert.deepEqual(splitMoney('תשואה 12 ח׳ 9.1% · דמי ניהול 0.6%').filter((p) => p.money), []);
  assert.equal(splitMoney(`קבועות ${fmt(5200)}`).filter((p) => p.money).length, 1);
});

test('the placeholder keeps the shape but none of the real digits', () => {
  const real = fmt(1915750);
  const fake = placeholderFor(real);
  assert.equal(fake.length, real.length);
  assert.equal(fake.replace(/\d/g, '#'), real.replace(/\d/g, '#'));
  assert.notEqual(fake.replace(/\D/g, ''), real.replace(/\D/g, ''));
});
