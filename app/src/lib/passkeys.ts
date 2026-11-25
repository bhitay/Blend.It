// Sign-in with Face ID (option C): Supabase Auth passkeys. The WebAuthn ceremony and
// its verification run on Supabase's server; the app only starts it. Requires
// Authentication → Passkeys to be configured in the Supabase dashboard (see SECURITY.md).
//
// If the passkey session still needs the second step (two-step verification is on),
// the database keeps the data locked and the app asks for the code as usual.

import { supabase } from './supabase';

export type Passkey = { id: string; name: string | null; createdAt: string | null; lastUsedAt: string | null };

function friendly(message: string): string {
  if (/not.*enabled|disabled|passkey.*config/i.test(message)) return 'כניסה עם Face ID לא מוגדרת עדיין ב-Supabase (Authentication ← Passkeys).';
  if (/abort|cancel|NotAllowed/i.test(message)) return 'הפעולה בוטלה.';
  if (/origin|rp.?id|relying/i.test(message)) return 'הכתובת של האפליקציה לא מוגדרת ב-Supabase (Authentication ← Passkeys ← Relying Party).';
  return message;
}

/** Adds a passkey for the signed-in user (shows Face ID once). Must be called from a tap. */
export async function registerPasskey(): Promise<void> {
  const { error } = await supabase.auth.registerPasskey();
  if (error) throw new Error(friendly(error.message));
}

/** Signs in with a passkey (Face ID). Must be called from a tap. */
export async function signInWithPasskey(): Promise<void> {
  const { error } = await supabase.auth.signInWithPasskey();
  if (error) throw new Error(friendly(error.message));
}

/**
 * Offers the passkey in the keyboard's suggestion bar (iOS) / the autofill list when the
 * email field is focused. Picking it goes straight to Face ID, without the extra sheet.
 * Resolves true on sign-in, false if unavailable, cancelled or aborted.
 */
export async function offerPasskeyAutofill(signal: AbortSignal): Promise<boolean> {
  try {
    const PKC = (globalThis as { PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> } })
      .PublicKeyCredential;
    if (!PKC?.isConditionalMediationAvailable || !(await PKC.isConditionalMediationAvailable())) return false;
    const { data, error } = await supabase.auth.signInWithPasskey({ options: { mediation: 'conditional', signal } });
    return !error && Boolean(data?.session);
  } catch {
    return false;
  }
}

export async function listPasskeys(): Promise<Passkey[]> {
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw new Error(friendly(error.message));
  const rows = (Array.isArray(data) ? data : ((data as { passkeys?: unknown[] } | null)?.passkeys ?? [])) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: (r.friendly_name ?? r.name ?? null) as string | null,
    createdAt: (r.created_at ?? null) as string | null,
    lastUsedAt: (r.last_used_at ?? null) as string | null,
  }));
}

export async function deletePasskey(passkeyId: string): Promise<void> {
  const { error } = await supabase.auth.passkey.delete({ passkeyId });
  if (error) throw new Error(friendly(error.message));
}
