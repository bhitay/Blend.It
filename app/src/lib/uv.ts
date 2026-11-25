// Pure WebAuthn helpers (no browser APIs), unit-tested.

/**
 * Whether a WebAuthn assertion's authenticatorData says the user was verified
 * (Face ID / Touch ID / device passcode), not just present. Byte 32 holds the
 * flags: 0x01 = user present (UP), 0x04 = user verified (UV).
 */
export function userVerified(authenticatorData: ArrayBuffer | Uint8Array): boolean {
  const bytes = authenticatorData instanceof Uint8Array ? authenticatorData : new Uint8Array(authenticatorData);
  if (bytes.length < 37) return false;
  const flags = bytes[32];
  return (flags & 0x01) !== 0 && (flags & 0x04) !== 0;
}

export function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
