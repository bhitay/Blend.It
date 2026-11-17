import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  categorizeSchema, countUnionParams, documentSchema, emptyStringsToNull, MAX_UNION_PARAMS, tableSchema,
} from '../api/_schemas';

test('every schema stays under the API limit for union-typed parameters', () => {
  for (const [name, schema] of Object.entries({ tableSchema, documentSchema, categorizeSchema })) {
    const n = countUnionParams(schema);
    assert.ok(n <= MAX_UNION_PARAMS, `${name} has ${n} union parameters (limit ${MAX_UNION_PARAMS})`);
  }
});

test('union counter counts nested type arrays (the old document schema had 18)', () => {
  const nullable = { type: ['number', 'null'] };
  const old = { type: 'object', properties: { ...Object.fromEntries([...Array(14)].map((_, i) => [`f${i}`, nullable])), tracks: { type: 'array', items: { type: 'object', properties: { a: nullable, b: nullable, c: nullable, d: nullable } } } } };
  assert.equal(countUnionParams(old), 18);
});

test('empty strings become null, notes and numbers are untouched', () => {
  assert.deepEqual(
    emptyStringsToNull({ institution: '', as_of: '2026-09-30', balance: 0, notes: '', tracks: [{ name: 'פריים', end_date: '' }], highlights: ['x'] }),
    { institution: null, as_of: '2026-09-30', balance: 0, notes: '', tracks: [{ name: 'פריים', end_date: null }], highlights: ['x'] },
  );
});
