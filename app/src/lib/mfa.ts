// Two-step verification (TOTP: Google Authenticator, Microsoft Authenticator, 1Password …).
// Enforced by the database (migration 0003): once a user enables it, their data is
// only readable from a session that passed the second step.

import { qrToDataUri } from './qr';
import { supabase } from './supabase';

export type MfaState = { enabled: boolean; required: boolean };

/** enabled: the user has a verified factor. required: this session still needs the code. */
export async function getMfaState(): Promise<MfaState> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return { enabled: false, required: false };
  return {
    enabled: data.nextLevel === 'aal2',
    required: data.nextLevel === 'aal2' && data.currentLevel !== 'aal2',
  };
}

async function totpFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return data.all.filter((f) => f.factor_type === 'totp');
}

/** Starts setup. Returns a QR code (as an image URI) and the secret for manual entry. */
export async function startEnrollment(): Promise<{ factorId: string; qrUri: string; secret: string }> {
  // A setup that was started and never finished blocks a new one.
  for (const f of await totpFactors()) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'BlendIt' });
  if (error) throw new Error(error.message);
  return { factorId: data.id, qrUri: qrToDataUri(data.totp.qr_code), secret: data.totp.secret };
}

export async function verifyCode(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) throw new Error(error.message.includes('Invalid') ? 'הקוד שגוי או שפג תוקפו. נסו את הקוד הבא.' : error.message);
}

/** Second step at sign-in. */
export async function verifySignIn(code: string): Promise<void> {
  const factor = (await totpFactors()).find((f) => f.status === 'verified');
  if (!factor) throw new Error('לא נמצא אימות דו-שלבי פעיל');
  await verifyCode(factor.id, code);
}

/** Turns it off (requires a session that already passed the second step). */
export async function disableMfa(): Promise<void> {
  for (const f of await totpFactors()) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) throw new Error(error.message);
  }
  await supabase.auth.refreshSession();
}
