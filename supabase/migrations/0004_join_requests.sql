-- BlendIt — joining a household needs the owner's approval
--
-- Entering an invite code no longer makes someone a member. It creates a join
-- request; only the household owner can approve it (or reject it). Until then
-- the requester has no access to any household data.

create table public.join_requests (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) > 0),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users (id) on delete set null
);

-- One open request per user (to any household).
create unique index join_requests_one_pending on public.join_requests (user_id) where status = 'pending';
create index join_requests_household_idx on public.join_requests (household_id, status);

alter table public.join_requests enable row level security;

-- The requester sees their own requests; the owner sees requests to their household.
-- All changes go through the functions below (no direct insert/update/delete).
create policy "requester sees own requests" on public.join_requests
  for select using (user_id = auth.uid());

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_satisfied() and exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  );
$$;

create policy "owner sees requests to the household" on public.join_requests
  for select using (public.is_household_owner(household_id));

revoke insert, update, delete on public.join_requests from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Requester: ask to join with the invite code
-- ---------------------------------------------------------------------------

drop function if exists public.join_household(text, text);

-- Returns 'pending' (request sent / already waiting) or 'member' (already in the household).
create or replace function public.request_join(code text, member_name text)
returns text
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
  if length(trim(coalesce(member_name, ''))) = 0 then
    raise exception 'name required';
  end if;
  select * into h from public.households where invite_code = upper(trim(code));
  if h.id is null or not h.invite_open then
    raise exception 'invalid invite code';
  end if;
  if exists (select 1 from public.household_members where household_id = h.id and user_id = auth.uid()) then
    return 'member';
  end if;
  select count(*) into n from public.household_members where household_id = h.id;
  if n >= h.max_members then
    raise exception 'invalid invite code';
  end if;
  -- Replace any earlier open request (e.g. a typo in the name, or another household).
  update public.join_requests set status = 'cancelled', decided_at = now()
    where user_id = auth.uid() and status = 'pending';
  insert into public.join_requests (household_id, user_id, display_name)
    values (h.id, auth.uid(), trim(member_name));
  return 'pending';
end;
$$;

create or replace function public.cancel_join_request()
returns void
language sql
security definer
set search_path = public
as $$
  update public.join_requests set status = 'cancelled', decided_at = now()
  where user_id = auth.uid() and status = 'pending';
$$;

-- ---------------------------------------------------------------------------
-- Owner: list, approve, reject
-- ---------------------------------------------------------------------------

-- Pending requests with the requester's email, so the owner can tell who it is.
create or replace function public.list_join_requests(hid uuid)
returns table (id uuid, display_name text, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_household_owner(hid) then
    raise exception 'only the household owner can see join requests';
  end if;
  return query
    select r.id, r.display_name, u.email::text, r.created_at
    from public.join_requests r join auth.users u on u.id = r.user_id
    where r.household_id = hid and r.status = 'pending'
    order by r.created_at;
end;
$$;

create or replace function public.decide_join_request(request_id uuid, approve boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
  h public.households;
  n int;
begin
  select * into r from public.join_requests where id = request_id for update;
  if r.id is null or not public.is_household_owner(r.household_id) then
    raise exception 'only the household owner can decide on join requests';
  end if;
  if r.status <> 'pending' then
    return r.status;
  end if;
  if not approve then
    update public.join_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = r.id;
    return 'rejected';
  end if;
  select * into h from public.households where id = r.household_id for update;
  select count(*) into n from public.household_members where household_id = h.id;
  if n >= h.max_members then
    raise exception 'household is full';
  end if;
  insert into public.household_members (household_id, user_id, display_name)
    values (h.id, r.user_id, r.display_name)
    on conflict (household_id, user_id) do nothing;
  update public.join_requests set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = r.id;
  -- Household full: the code stops working and other open requests are closed.
  if n + 1 >= h.max_members then
    update public.households set invite_open = false where id = h.id;
    update public.join_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid()
      where household_id = h.id and status = 'pending';
  end if;
  return 'approved';
end;
$$;

revoke all on function public.request_join(text, text) from public, anon;
revoke all on function public.cancel_join_request() from public, anon;
revoke all on function public.list_join_requests(uuid) from public, anon;
revoke all on function public.decide_join_request(uuid, boolean) from public, anon;
grant execute on function public.request_join(text, text) to authenticated;
grant execute on function public.cancel_join_request() to authenticated;
grant execute on function public.list_join_requests(uuid) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean) to authenticated;
