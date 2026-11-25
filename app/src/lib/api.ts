import { supabase } from './supabase';
import { KINDS, type AccountKind } from './accountKinds';
import { todayISO } from './format';

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  invite_open: boolean;
  invite_expires_at: string | null;
  max_members: number;
};
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
  external_id: string | null;
  is_liability: boolean;
  archived: boolean;
  notes: string | null;
  details: AccountDetails | null;
  balance: number | null;
  balance_as_of: string | null;
  signed_balance: number;
};

/** Latest figures extracted from an uploaded report (pension, study fund, mortgage …). */
export type AccountDetails = {
  product_name?: string | null;
  monthly_deposit?: number | null;
  return_ytd_pct?: number | null;
  return_12m_pct?: number | null;
  fee_balance_pct?: number | null;
  fee_deposit_pct?: number | null;
  fund_avg_fee_balance_pct?: number | null;
  liquidity_date?: string | null;
  monthly_payment?: number | null;
  end_date?: string | null;
  tracks?: { name: string; balance: number | null; interest_rate_pct: number | null; indexation: string | null; end_date: string | null }[];
  highlights?: string[];
  as_of?: string;
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
      .select('households(id, name, invite_code, invite_open, invite_expires_at, max_members)')
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

/** Owner only: a new one-time invite code, valid for 15 minutes (replaces any earlier one). */
export async function createInvite(householdId: string): Promise<void> {
  const res = await supabase.rpc('create_invite', { hid: householdId });
  if (res.error?.message.includes('household is full')) throw new Error('משק הבית מלא');
  check(res);
}

/** Owner only: removes a member. Their access ends immediately; their accounts stay in the household. */
export async function removeMember(householdId: string, memberUserId: string): Promise<void> {
  check(await supabase.rpc('remove_member', { hid: householdId, member_user_id: memberUserId }));
}

/** Owner only: withdraw the current invite code. */
export async function revokeInvite(householdId: string): Promise<void> {
  check(await supabase.rpc('revoke_invite', { hid: householdId }));
}

/**
 * Asks to join with an invite code. The owner must approve before any data is visible.
 * Returns 'pending' (waiting for approval) or 'member' (already a member).
 */
export async function requestJoin(code: string, memberName: string): Promise<'pending' | 'member'> {
  const res = await supabase.rpc('request_join', { code, member_name: memberName });
  if (res.error?.message.includes('invalid invite code')) throw new Error('הקוד לא תקין, פג תוקפו, או שכבר השתמשו בו. בקשו קוד חדש.');
  return check(res) as 'pending' | 'member';
}

export type MyJoinRequest = { id: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; created_at: string };

/** The current user's latest join request, if any (only their own rows are visible). */
export async function fetchMyJoinRequest(): Promise<MyJoinRequest | null> {
  const rows = check(
    await supabase.from('join_requests').select('id, status, created_at').order('created_at', { ascending: false }).limit(1),
  ) as MyJoinRequest[];
  return rows[0] ?? null;
}

export async function cancelJoinRequest(): Promise<void> {
  check(await supabase.rpc('cancel_join_request'));
}

export type JoinRequest = { id: string; display_name: string; email: string | null; created_at: string };

/** Owner only: pending requests to the household, with the requester's email. */
export async function fetchJoinRequests(householdId: string): Promise<JoinRequest[]> {
  return check(await supabase.rpc('list_join_requests', { hid: householdId })) as JoinRequest[];
}

/** Owner only. */
export async function decideJoinRequest(requestId: string, approve: boolean): Promise<void> {
  const res = await supabase.rpc('decide_join_request', { request_id: requestId, approve });
  if (res.error?.message.includes('household is full')) throw new Error('משק הבית מלא');
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
  /** e.g. the last 4 digits of a card, used to match later uploads to this account */
  externalId?: string | null;
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
        external_id: a.externalId ?? null,
      })
      .select('id')
      .single(),
  ) as { id: string };
  if (a.balance != null) await setBalance(row.id, a.balance, KINDS[a.kind].liability);
  return row.id;
}

/**
 * Records today's balance (overwrites an earlier entry from the same day).
 * Liabilities are stored as the positive amount owed; assets keep their sign
 * (a bank account in overdraft is negative).
 */
export async function setBalance(accountId: string, balance: number, isLiability: boolean, asOf = todayISO()): Promise<void> {
  const value = isLiability ? Math.abs(balance) : balance;
  check(
    await supabase
      .from('balance_snapshots')
      .upsert({ account_id: accountId, as_of: asOf, balance: value }, { onConflict: 'account_id,as_of' }),
  );
}

export type AccountUpdate = Partial<{
  name: string;
  kind: AccountKind;
  institution: string | null;
  owner_user_id: string | null;
  notes: string | null;
  details: AccountDetails | null;
}>;

/** Edits an account. Changing the kind also updates whether it counts as a debt. */
export async function updateAccount(id: string, changes: AccountUpdate): Promise<void> {
  const row: Record<string, unknown> = { ...changes };
  if (changes.kind) row.is_liability = KINDS[changes.kind].liability;
  check(await supabase.from('accounts').update(row).eq('id', id));
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

// --- transactions & sync ----------------------------------------------------

export type Transaction = {
  id: string;
  date: string;
  processed_date: string | null;
  amount: number;
  original_amount: number | null;
  original_currency: string | null;
  description: string;
  memo: string | null;
  category: string | null;
  installments: { number: number; total: number } | null;
  status: 'completed' | 'pending';
};

export async function fetchTransactions(accountId: string, limit = 100): Promise<Transaction[]> {
  const rows = check(
    await supabase
      .from('transactions')
      .select('id, date, processed_date, amount, original_amount, original_currency, description, memo, category, installments, status')
      .eq('account_id', accountId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as Transaction[];
  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    original_amount: r.original_amount == null ? null : Number(r.original_amount),
  }));
}

export type SyncStatus = {
  institution: string;
  label: string | null;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  error_type: string | null;
  error_message: string | null;
  new_transactions: number;
  last_success_at: string | null;
};

export async function fetchSyncStatus(householdId: string): Promise<SyncStatus[]> {
  return check(
    await supabase.from('sync_status').select('*').eq('household_id', householdId).order('institution'),
  ) as SyncStatus[];
}
