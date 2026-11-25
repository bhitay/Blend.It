// Face ID on this device, for the app lock.
//
// This is a local check: the browser asks the phone to verify the user (Face ID,
// Touch ID or the device passcode) with a passkey for this site, and we accept only
// an answer that says the user was verified. Nothing is sent to a server; it guards
// the screen against someone holding the unlocked phone. Data access itself is
// protected by sign-in, two-step verification and the database rules.
//
// Any passkey for this site works: the sign-in passkey (option C) if one exists,
// otherwise a small device-only one created when the feature is turned on.

import { Platform } from 'react-native';
import { fromBase64Url, toBase64Url, userVerified } from './uv';

const KEY_SETTINGS = 'blendit.deviceAuth';
const KEY_CREDENTIAL = 'blendit.deviceAuth.credential';

export type DeviceAuthSettings = { appLock: boolean };

const DEFAULTS: DeviceAuthSettings = { appLock: false };

function storage(): Storage | null {
  try {
    return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getSettings(): DeviceAuthSettings {
  try {
    const raw = storage()?.getItem(KEY_SETTINGS);
    return raw ? { appLock: Boolean(JSON.parse(raw).appLock) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: DeviceAuthSettings): void {
  try {
    storage()?.setItem(KEY_SETTINGS, JSON.stringify(s));
  } catch {
    /* private mode etc.: the setting just won't persist */
  }
}

/** True when this browser can verify the user with a built-in authenticator (Face ID / Touch ID). */
export async function isAvailable(): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * Creates the device-only passkey used when no sign-in passkey exists. Must be called
 * from a tap (browsers require a user gesture). Shows Face ID once.
 */
export async function createDeviceCredential(userLabel: string): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rp: { name: 'BlendIt', id: location.hostname },
      user: { id: randomBytes(16) as BufferSource, name: `${userLabel} (נעילת מסך)`, displayName: `BlendIt – נעילת מסך` },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('ההגדרה בוטלה');
  try {
    storage()?.setItem(KEY_CREDENTIAL, toBase64Url(cred.rawId));
  } catch {
    /* discoverable credentials still work without the stored id */
  }
}

/**
 * Asks the phone to verify the user. Resolves true only if the user was verified
 * (not just present). Must be called from a tap.
 */
export async function verifyUser(): Promise<boolean> {
  let stored: string | null = null;
  try {
    stored = storage()?.getItem(KEY_CREDENTIAL) ?? null;
  } catch {
    stored = null;
  }
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        rpId: location.hostname,
        userVerification: 'required',
        timeout: 60_000,
        // Without a stored id, any passkey for this site (e.g. the sign-in passkey) is offered.
        allowCredentials: stored ? [{ type: 'public-key', id: fromBase64Url(stored) as BufferSource }] : [],
      },
    })) as PublicKeyCredential | null;
    if (!assertion) return false;
    const response = assertion.response as AuthenticatorAssertionResponse;
    return userVerified(response.authenticatorData);
  } catch {
    return false; // cancelled, failed, or no passkey on this device
  }
}

/** Forget the device-only passkey id (the passkey itself is removed from the phone's Passwords app). */
export function clearDeviceCredential(): void {
  try {
    storage()?.removeItem(KEY_CREDENTIAL);
  } catch {
    /* ignore */
  }
}

export function hasDeviceCredential(): boolean {
  try {
    return Boolean(storage()?.getItem(KEY_CREDENTIAL));
  } catch {
    return false;
  }
}
