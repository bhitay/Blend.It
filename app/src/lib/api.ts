import { supabase } from './supabase';
import { KINDS, type AccountKind } from './accountKinds';
import { todayISO } from './format';

export type Household = { id: string; name: string; invite_code: string };
export type Member = { user_id: string; display_name: string; role: 'owner' | 'member' };

export type Account = {
  id: string;
  household_id: string;
  owner_user_id: string | null;
  kind: AccountKind;
  institution: string | null;
  name: string;
  currency: string;
  source: 'manual' | 'scraper' | 'import';
  is_liability: boolean;
  archived: boolean;
  notes: string | null;
  balance: number | null;
  balance_as_of: string | null;
  signed_balance: number;
};

export type Snapshot = { as_of: string; balance: number };

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// --- household --------------------------------------------------------------

/** The user's household (first one, if several), or null if they haven't joined one. */
export async function fetchHousehold(userId: string): Promise<Household | null> {
  const rows = check(
    await supabase
      .from('household_members')
      .select('households(id, name, invite_code)')
      .eq('user_id', userId)
      .order('joined_at')
      .limit(1),
  ) as unknown as { households: Household }[];
  return rows[0]?.households ?? null;
}

export async function fetchMembers(householdId: string): Promise<Member[]> {
  return check(
    await supabase
      .from('household_members')
      .select('user_id, display_name, role')
      .eq('household_id', householdId)
      .order('joined_at'),
  ) as Member[];
}

export async function createHousehold(name: string, memberName: string): Promise<void> {
  check(await supabase.rpc('create_household', { household_name: name, member_name: memberName }));
}

export async function joinHousehold(code: string, memberName: string): Promise<void> {
  const res = await supabase.rpc('join_household', { code, member_name: memberName });
  if (res.error?.message.includes('invalid invite code')) throw new Error('קוד ההזמנה לא נמצא');
  check(res);
}

// --- accounts ---------------------------------------------------------------

export async function fetchAccounts(householdId: string, includeArchived = false): Promise<Account[]> {
  let q = supabase.from('account_balances').select('*').eq('household_id', householdId).order('created_at');
  if (!includeArchived) q = q.eq('archived', false);
  return (check(await q) as Account[]).map(normalize);
}

export async function fetchAccount(id: string): Promise<Account | null> {
  const row = check(await supabase.from('account_balances').select('*').eq('id', id).maybeSingle()) as Account | null;
  return row ? normalize(row) : null;
}

export async function fetchHistory(accountId: string): Promise<Snapshot[]> {
  const rows = check(
    await supabase
      .from('balance_snapshots')
      .select('as_of, balance')
      .eq('account_id', accountId)
      .order('as_of', { ascending: false })
      .limit(60),
  ) as Snapshot[];
  return rows.map((r) => ({ ...r, balance: Number(r.balance) }));
}

export type NewAccount = {
  householdId: string;
  kind: AccountKind;
  name: string;
  institution: string | null;
  ownerUserId: string | null;
  balance: number | null;
};

export async function createAccount(a: NewAccount): Promise<string> {
  const row = check(
    await supabase
      .from('accounts')
      .insert({
        household_id: a.householdId,
        kind: a.kind,
        name: a.name.trim(),
        institution: a.institution,
        owner_user_id: a.ownerUserId,
        is_liability: KINDS[a.kind].liability,
      })
      .select('id')
      .single(),
  ) as { id: string };
  if (a.balance != null) await setBalance(row.id, a.balance);
  return row.id;
}

/** Records today's balance (overwrites an earlier entry from the same day). */
export async function setBalance(accountId: string, balance: number, asOf = todayISO()): Promise<void> {
  check(
    await supabase
      .from('balance_snapshots')
      .upsert({ account_id: accountId, as_of: asOf, balance: Math.abs(balance) }, { onConflict: 'account_id,as_of' }),
  );
}

export async function setArchived(accountId: string, archived: boolean): Promise<void> {
  check(await supabase.from('accounts').update({ archived }).eq('id', accountId));
}

export async function deleteAccount(accountId: string): Promise<void> {
  check(await supabase.from('accounts').delete().eq('id', accountId));
}

function normalize(a: Account): Account {
  return {
    ...a,
    balance: a.balance == null ? null : Number(a.balance),
    signed_balance: Number(a.signed_balance ?? 0),
  };
}
