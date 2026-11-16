-- BlendIt — stage 2: automatic bank / credit-card sync
--
-- The home sync service signs in as a regular household member and calls
-- ingest_account() once per scraped account. The function is SECURITY INVOKER,
-- so Row Level Security still applies: it can only write into households the
-- signed-in user belongs to.

-- Balance sign convention (clarified):
--   assets       → balance as-is (a bank account in overdraft is negative)
--   liabilities  → amount owed, positive
-- account_balances.signed_balance already applies this.

-- ---------------------------------------------------------------------------
-- Sync run log (shown in the app: "last synced", errors such as a changed password)
-- ---------------------------------------------------------------------------

create table public.sync_runs (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  institution       text not null,           -- scraper company id, e.g. 'mizrahi'
  label             text,                    -- free text from the sync config, e.g. 'מזרחי – איתי'
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running' check (status in ('running', 'success', 'error')),
  error_type        text,
  error_message     text,
  accounts          int not null default 0,
  transactions      int not null default 0,
  new_transactions  int not null default 0
);

create index sync_runs_household_idx on public.sync_runs (household_id, started_at desc);

alter table public.sync_runs enable row level security;

create policy "members manage sync runs" on public.sync_runs
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Latest run per institution+label, for the app.
create view public.sync_status
with (security_invoker = true) as
select distinct on (household_id, institution, coalesce(label, ''))
  household_id, institution, label, started_at, finished_at, status, error_type, error_message,
  accounts, transactions, new_transactions,
  (select max(finished_at) from public.sync_runs s2
    where s2.household_id = r.household_id and s2.institution = r.institution
      and coalesce(s2.label, '') = coalesce(r.label, '') and s2.status = 'success') as last_success_at
from public.sync_runs r
order by household_id, institution, coalesce(label, ''), started_at desc;

-- ---------------------------------------------------------------------------
-- ingest_account: upsert one scraped account with its balance and transactions
-- ---------------------------------------------------------------------------
--
-- payload = {
--   household_id, institution, external_id, kind ('bank' | 'credit_card' | …),
--   name, owner_user_id (nullable), currency,
--   balance (nullable), balance_as_of (date),
--   transactions: [{ external_id, date, processed_date, amount, original_amount,
--                    original_currency, description, memo, installments, status }]
-- }
-- Returns { account_id, transactions, new_transactions }.

create or replace function public.ingest_account(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  acc_id     uuid;
  kind_v     public.account_kind := (payload->>'kind')::public.account_kind;
  total      int;
  inserted   int;
begin
  select id into acc_id from public.accounts
  where household_id = (payload->>'household_id')::uuid
    and institution  = payload->>'institution'
    and external_id  = payload->>'external_id';

  if acc_id is null then
    insert into public.accounts (household_id, owner_user_id, kind, institution, name, currency, source, external_id, is_liability)
    values (
      (payload->>'household_id')::uuid,
      nullif(payload->>'owner_user_id', '')::uuid,
      kind_v,
      payload->>'institution',
      payload->>'name',
      coalesce(payload->>'currency', 'ILS'),
      'scraper',
      payload->>'external_id',
      kind_v in ('credit_card', 'mortgage', 'loan')
    )
    returning id into acc_id;
  else
    -- An account the user archived comes back if the bank still reports it.
    update public.accounts set source = 'scraper', archived = false where id = acc_id;
  end if;

  if payload ? 'balance' and payload->>'balance' is not null then
    insert into public.balance_snapshots (account_id, as_of, balance)
    values (acc_id, coalesce((payload->>'balance_as_of')::date, current_date), (payload->>'balance')::numeric)
    on conflict (account_id, as_of) do update set balance = excluded.balance, created_at = now();
  end if;

  -- Pending transactions are replaced on every sync: once they clear they come
  -- back as completed, often with a different description or amount.
  delete from public.transactions where account_id = acc_id and status = 'pending';

  with incoming as (
    select * from jsonb_to_recordset(coalesce(payload->'transactions', '[]'::jsonb)) as t(
      external_id text, date date, processed_date date, amount numeric, original_amount numeric,
      original_currency text, description text, memo text, installments jsonb, status text)
  ),
  upserted as (
    insert into public.transactions as tx (account_id, external_id, date, processed_date, amount, original_amount,
                                           original_currency, description, memo, installments, status)
    select acc_id, external_id, date, processed_date, amount, original_amount, original_currency,
           coalesce(description, ''), memo, installments, coalesce(status, 'completed')
    from incoming
    on conflict (account_id, external_id) do update set
      -- category / is_fixed are user-editable and deliberately left alone
      processed_date    = excluded.processed_date,
      amount            = excluded.amount,
      original_amount   = excluded.original_amount,
      original_currency = excluded.original_currency,
      description       = excluded.description,
      memo              = excluded.memo,
      installments      = excluded.installments,
      status            = excluded.status
    returning (xmax = 0) as is_new
  )
  select count(*), count(*) filter (where is_new) into total, inserted from upserted;

  update public.accounts set updated_at = now() where id = acc_id;

  return jsonb_build_object('account_id', acc_id, 'transactions', total, 'new_transactions', inserted);
end;
$$;

revoke all on function public.ingest_account(jsonb) from public, anon;
grant execute on function public.ingest_account(jsonb) to authenticated;
