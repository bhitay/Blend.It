import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromBase64Url, toBase64Url, userVerified } from '../src/lib/uv';

const authData = (flags: number) => {
  const b = new Uint8Array(37);
  b[32] = flags;
  return b;
};

test('Face ID result: only "user verified" counts, not just "user present"', () => {
  assert.equal(userVerified(authData(0x05)), true, 'UP + UV');
  assert.equal(userVerified(authData(0x45)), true, 'UP + UV + attested data');
  assert.equal(userVerified(authData(0x01)), false, 'present but not verified (no Face ID / passcode)');
  assert.equal(userVerified(authData(0x04)), false, 'UV without UP is malformed');
  assert.equal(userVerified(new Uint8Array(10)), false, 'too short');
  assert.equal(userVerified(authData(0x05).buffer), true, 'ArrayBuffer input');
});

test('credential ids survive base64url round trips', () => {
  const id = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
  const s = toBase64Url(id);
  assert.doesNotMatch(s, /[+/=]/);
  assert.deepEqual([...fromBase64Url(s)], [...id]);
});
