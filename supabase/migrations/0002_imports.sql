-- BlendIt — stage 2: importing report files
--
-- Data enters only from files the family downloads and uploads themselves
-- (bank / credit-card Excel exports, pension and mortgage PDFs). No bank
-- credentials are ever stored.
--
-- Balance sign convention:
--   assets       → balance as-is (a bank account in overdraft is negative)
--   liabilities  → amount owed, positive

-- ---------------------------------------------------------------------------
-- Extra columns
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column is_transfer boolean not null default false, -- card payments, moves between own accounts: not income/expense
  add column import_id uuid;

-- Latest extracted report figures (fees, returns, liquidity date, mortgage tracks …)
alter table public.accounts
  add column details jsonb;

-- account_balances selects a.*, which Postgres expands when the view is created,
-- so it has to be recreated to include the new column.
drop view public.account_balances;
create view public.account_balances
with (security_invoker = true) as
select
  a.*,
  s.as_of     as balance_as_of,
  s.balance   as balance,
  case when a.is_liability then -coalesce(s.balance, 0) else coalesce(s.balance, 0) end as signed_balance
from public.accounts a
left join lateral (
  select as_of, balance from public.balance_snapshots b
  where b.account_id = a.id
  order by as_of desc
  limit 1
) s on true;

-- ---------------------------------------------------------------------------
-- Import log (also drives the monthly checklist)
-- ---------------------------------------------------------------------------

create table public.imports (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  account_id    uuid references public.accounts (id) on delete set null,
  kind          text not null check (kind in ('transactions', 'report')),
  file_name     text,
  report_type   text,           -- bank | credit_card | pension | study_fund | mortgage | …
  period_start  date,
  period_end    date,
  rows          int not null default 0,
  new_rows      int not null default 0,
  summary       jsonb,          -- what was extracted (for reports: the figures)
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index imports_household_idx on public.imports (household_id, created_at desc);

alter table public.transactions
  add constraint transactions_import_fk foreign key (import_id) references public.imports (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Categories learned per merchant (from AI, corrected by the user)
-- ---------------------------------------------------------------------------

create table public.merchant_categories (
  household_id  uuid not null references public.households (id) on delete cascade,
  merchant      text not null,  -- transaction description as it appears in the file
  category      text not null,
  is_fixed      boolean not null default false,
  is_transfer   boolean not null default false,
  source        text not null default 'ai' check (source in ('ai', 'user')),
  updated_at    timestamptz not null default now(),
  primary key (household_id, merchant)
);

alter table public.imports              enable row level security;
alter table public.merchant_categories  enable row level security;

create policy "members manage imports" on public.imports
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "members manage merchant categories" on public.merchant_categories
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- import_transactions: write one file's transactions into one account
-- ---------------------------------------------------------------------------
--
-- payload = {
--   account_id, file_name, report_type, balance (nullable), balance_as_of (nullable),
--   transactions: [{ external_id, date, processed_date, amount, original_amount,
--                    original_currency, description, memo, installments, status }]
-- }
-- external_id is computed by the app from the transaction's own fields, so
-- uploading overlapping files never creates duplicates.
-- Returns { import_id, rows, new_rows }.

create or replace function public.import_transactions(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  acc       public.accounts;
  imp_id    uuid;
  total     int;
  inserted  int;
  p_start   date;
  p_end     date;
begin
  select * into acc from public.accounts where id = (payload->>'account_id')::uuid;
  if acc.id is null then
    raise exception 'account not found';
  end if;

  select min((t->>'date')::date), max((t->>'date')::date) into p_start, p_end
  from jsonb_array_elements(coalesce(payload->'transactions', '[]'::jsonb)) t;

  insert into public.imports (household_id, account_id, kind, file_name, report_type, period_start, period_end)
  values (acc.household_id, acc.id, 'transactions', payload->>'file_name', payload->>'report_type', p_start, p_end)
  returning id into imp_id;

  with incoming as (
    select * from jsonb_to_recordset(coalesce(payload->'transactions', '[]'::jsonb)) as t(
      external_id text, date date, processed_date date, amount numeric, original_amount numeric,
      original_currency text, description text, memo text, installments jsonb, status text)
  ),
  ins as (
    insert into public.transactions (account_id, external_id, date, processed_date, amount, original_amount,
                                     original_currency, description, memo, installments, status, import_id)
    select acc.id, external_id, date, processed_date, amount, original_amount, original_currency,
           coalesce(description, ''), memo, installments, coalesce(status, 'completed'), imp_id
    from incoming
    on conflict (account_id, external_id) do nothing
    returning 1
  )
  select (select count(*) from incoming), (select count(*) from ins) into total, inserted;

  update public.imports set rows = total, new_rows = inserted where id = imp_id;

  if payload->>'balance' is not null then
    insert into public.balance_snapshots (account_id, as_of, balance)
    values (acc.id, coalesce((payload->>'balance_as_of')::date, p_end, current_date),
            case when acc.is_liability then abs((payload->>'balance')::numeric) else (payload->>'balance')::numeric end)
    on conflict (account_id, as_of) do update set balance = excluded.balance, created_at = now();
  end if;

  update public.accounts set source = 'import', updated_at = now() where id = acc.id and source = 'manual';

  perform public.apply_merchant_categories(acc.household_id);

  return jsonb_build_object('import_id', imp_id, 'rows', total, 'new_rows', inserted);
end;
$$;

-- Fill in categories for uncategorised transactions from the household's merchant rules.
-- A rule the user set (source = 'user') also overrides earlier AI guesses.
create or replace function public.apply_merchant_categories(hid uuid)
returns int
language sql
security invoker
set search_path = public
as $$
  with upd as (
    update public.transactions t
    set category = m.category, is_fixed = m.is_fixed, is_transfer = m.is_transfer
    from public.merchant_categories m, public.accounts a
    where a.id = t.account_id
      and a.household_id = hid
      and m.household_id = hid
      and m.merchant = t.description
      and (t.category is null or (m.source = 'user' and t.category is distinct from m.category))
    returning 1
  )
  select count(*)::int from upd;
$$;

revoke all on function public.import_transactions(jsonb) from public, anon;
revoke all on function public.apply_merchant_categories(uuid) from public, anon;
grant execute on function public.import_transactions(jsonb) to authenticated;
grant execute on function public.apply_merchant_categories(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Monthly analytics (income / expenses / by category), transfers excluded
-- ---------------------------------------------------------------------------

create view public.monthly_category_totals
with (security_invoker = true) as
select
  a.household_id,
  date_trunc('month', t.date)::date as month,
  coalesce(t.category, 'לא מסווג')  as category,
  bool_or(coalesce(t.is_fixed, false)) as is_fixed,
  sum(t.amount) filter (where t.amount > 0)  as income,
  -sum(t.amount) filter (where t.amount < 0) as expenses,
  sum(t.amount) as net,                        -- refunds net out against their category
  count(*) as transactions
from public.transactions t
join public.accounts a on a.id = t.account_id
where not t.is_transfer and t.status = 'completed'
group by a.household_id, date_trunc('month', t.date), coalesce(t.category, 'לא מסווג');
