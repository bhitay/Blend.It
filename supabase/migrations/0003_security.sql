-- BlendIt — security hardening
--
-- 1. Two-step verification (TOTP) is enforced by the database: a user who has
--    turned it on gets no data until the session has passed the second step
--    (JWT claim aal = 'aal2').
-- 2. Households are closed: at most 2 members, the invite code stops working
--    once the household is full, and only the owner can issue a new one.
-- 3. The AI server function may be used only by household members, with a
--    daily cap per user.

-- ---------------------------------------------------------------------------
-- 1. Membership check now also requires the second step when the user enabled it
-- ---------------------------------------------------------------------------

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_satisfied() and exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- A member may always see their own membership row (needed to know which
-- household to ask a second step for), but nothing else before passing it.
drop policy if exists "members see co-members" on public.household_members;
create policy "members see co-members" on public.household_members
  for select using (user_id = auth.uid() or public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- 2. Closed households
-- ---------------------------------------------------------------------------

alter table public.households
  add column invite_open boolean not null default true,
  add column max_members int not null default 2 check (max_members between 1 and 10);

-- Longer codes for new households and regenerated invites (12 chars ≈ 48 bits).
alter table public.households
  alter column invite_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

-- Households that are already full stop accepting the old code.
update public.households h
set invite_open = false
where (select count(*) from public.household_members m where m.household_id = h.id) >= h.max_members;

create or replace function public.join_household(code text, member_name text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
  n int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into h from public.households where invite_code = upper(trim(code)) for update;
  if h.id is null or not h.invite_open then
    raise exception 'invalid invite code';
  end if;
  if exists (select 1 from public.household_members where household_id = h.id and user_id = auth.uid()) then
    return h;
  end if;
  select count(*) into n from public.household_members where household_id = h.id;
  if n >= h.max_members then
    update public.households set invite_open = false where id = h.id;
    raise exception 'invalid invite code';
  end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, auth.uid(), member_name);
  if n + 1 >= h.max_members then
    update public.households set invite_open = false where id = h.id returning * into h;
  end if;
  return h;
end;
$$;

-- Owner only: new invite code (also re-opens the household if there is room).
create or replace function public.regenerate_invite(hid uuid)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
begin
  if not exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  ) or not public.mfa_satisfied() then
    raise exception 'only the household owner can create an invite';
  end if;
  update public.households
  set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      invite_open = (select count(*) from public.household_members m where m.household_id = hid) < max_members
  where id = hid
  returning * into h;
  return h;
end;
$$;

revoke all on function public.regenerate_invite(uuid) from public, anon;
grant execute on function public.regenerate_invite(uuid) to authenticated;

-- Members must not be able to re-open the invite or change the limit directly.
drop policy if exists "members rename household" on public.households;
create policy "members rename household" on public.households
  for update using (public.is_household_member(id))
  with check (public.is_household_member(id));
revoke update on public.households from authenticated;
grant update (name) on public.households to authenticated;

-- ---------------------------------------------------------------------------
-- 3. AI usage: members only, daily cap
-- ---------------------------------------------------------------------------

create table public.api_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null default current_date,
  calls    int not null default 0,
  primary key (user_id, day)
);

alter table public.api_usage enable row level security; -- no policies: only the function below touches it

-- Returns 'ok', 'not_member' or 'limit'. Called by the server function with the user's own token.
create or replace function public.use_api_quota(daily_limit int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    return 'not_member';
  end if;
  if not exists (
    select 1 from public.household_members m
    where m.user_id = auth.uid() and public.is_household_member(m.household_id)
  ) then
    return 'not_member';
  end if;
  insert into public.api_usage (user_id, day, calls) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set calls = public.api_usage.calls + 1
  returning calls into n;
  return case when n > daily_limit then 'limit' else 'ok' end;
end;
$$;

revoke all on function public.use_api_quota(int) from public, anon;
grant execute on function public.use_api_quota(int) to authenticated;
