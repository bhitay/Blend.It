import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qrToDataUri } from '../src/lib/qr';

test('QR from Supabase becomes a loadable base64 data URI (raw "#" would cut the URI short)', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>';
  const fromLib = qrToDataUri(`data:image/svg+xml;utf-8,${svg}`);
  assert.ok(fromLib.startsWith('data:image/svg+xml;base64,'));
  assert.equal(Buffer.from(fromLib.split(',')[1], 'base64').toString(), svg);
  assert.equal(Buffer.from(qrToDataUri(svg).split(',')[1], 'base64').toString(), svg);
  assert.equal(Buffer.from(qrToDataUri(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`).split(',')[1], 'base64').toString(), svg);
});
