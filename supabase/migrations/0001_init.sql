-- BlendIt — initial schema (stage 1)
-- Household-shared finance data. Every row hangs off a household; a user sees
-- only households they are a member of (enforced by Row Level Security).

-- gen_random_uuid() is core Postgres (13+); no extension needed.

-- ---------------------------------------------------------------------------
-- Households & membership
-- ---------------------------------------------------------------------------

create table public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  invite_code  text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by   uuid not null default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now()
);

create table public.household_members (
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text not null,
  role          text not null default 'member' check (role in ('owner', 'member')),
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);

-- Membership check used by every policy. SECURITY DEFINER so it can read
-- household_members without recursing into that table's own policy.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Accounts (anything with a balance: bank, card, pension, property, mortgage…)
-- ---------------------------------------------------------------------------

create type public.account_kind as enum (
  'bank',          -- עו"ש
  'credit_card',   -- כרטיס אשראי
  'savings',       -- פיקדון / חיסכון
  'pension',       -- קרן פנסיה
  'study_fund',    -- קרן השתלמות
  'provident',     -- קופת גמל / גמל להשקעה
  'insurance',     -- ביטוח מנהלים / חיסכון בביטוח
  'investment',    -- תיק ני"ע
  'real_estate',   -- נדל"ן
  'mortgage',      -- משכנתא
  'loan',          -- הלוואה
  'other'
);

create type public.account_source as enum ('manual', 'scraper', 'import');

create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  owner_user_id   uuid references auth.users (id) on delete set null, -- null = joint
  kind            public.account_kind not null,
  institution     text,                 -- e.g. 'mizrahi', 'discount', 'otsarHahayal', 'מגדל'
  name            text not null check (length(trim(name)) > 0),
  currency        text not null default 'ILS',
  source          public.account_source not null default 'manual',
  external_id     text,                 -- account number as seen by the scraper/importer
  is_liability    boolean not null default false,
  archived        boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (household_id, institution, external_id)
);

create index accounts_household_idx on public.accounts (household_id);

-- One balance per account per day. History drives the net-worth chart.
create table public.balance_snapshots (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  as_of       date not null default current_date,
  balance     numeric(14, 2) not null,  -- always positive for liabilities; sign comes from accounts.is_liability
  created_at  timestamptz not null default now(),
  primary key (account_id, as_of)
);

-- ---------------------------------------------------------------------------
-- Transactions (filled from stage 2 by the home sync service)
-- ---------------------------------------------------------------------------

create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  external_id     text,                     -- scraper identifier, for de-duplication
  date            date not null,
  processed_date  date,
  amount          numeric(14, 2) not null,  -- negative = money out
  original_amount numeric(14, 2),
  original_currency text,
  description     text not null,
  memo            text,
  category        text,
  is_fixed        boolean,                  -- fixed vs variable expense; null = not classified yet
  installments    jsonb,                    -- {number, total} for תשלומים
  status          text not null default 'completed' check (status in ('completed', 'pending')),
  created_at      timestamptz not null default now(),
  unique (account_id, external_id)
);

create index transactions_account_date_idx on public.transactions (account_id, date desc);

-- ---------------------------------------------------------------------------
-- Convenience views
-- ---------------------------------------------------------------------------

-- Latest balance per account, signed (liabilities negative).
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
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.accounts           enable row level security;
alter table public.balance_snapshots  enable row level security;
alter table public.transactions       enable row level security;

create policy "members read household" on public.households
  for select using (public.is_household_member(id));
create policy "members rename household" on public.households
  for update using (public.is_household_member(id));

create policy "members see co-members" on public.household_members
  for select using (public.is_household_member(household_id));
create policy "member edits own row" on public.household_members
  for update using (user_id = auth.uid());

create policy "members manage accounts" on public.accounts
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "members manage balances" on public.balance_snapshots
  for all using (exists (select 1 from public.accounts a where a.id = account_id and public.is_household_member(a.household_id)))
  with check (exists (select 1 from public.accounts a where a.id = account_id and public.is_household_member(a.household_id)));

create policy "members manage transactions" on public.transactions
  for all using (exists (select 1 from public.accounts a where a.id = account_id and public.is_household_member(a.household_id)))
  with check (exists (select 1 from public.accounts a where a.id = account_id and public.is_household_member(a.household_id)));

-- ---------------------------------------------------------------------------
-- RPCs: create / join a household (inserts into households go only through these)
-- ---------------------------------------------------------------------------

create or replace function public.create_household(household_name text, member_name text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.households (name, created_by) values (household_name, auth.uid()) returning * into h;
  insert into public.household_members (household_id, user_id, display_name, role)
    values (h.id, auth.uid(), member_name, 'owner');
  return h;
end;
$$;

create or replace function public.join_household(code text, member_name text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into h from public.households where invite_code = upper(trim(code));
  if h.id is null then
    raise exception 'invalid invite code';
  end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, auth.uid(), member_name)
    on conflict (household_id, user_id) do nothing;
  return h;
end;
$$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;

-- Keep accounts.updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger accounts_touch before update on public.accounts
  for each row execute function public.touch_updated_at();
