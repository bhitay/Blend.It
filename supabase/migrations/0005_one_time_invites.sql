-- BlendIt — one-time invite codes
--
-- There is no standing invite code anymore. The owner taps "add member", which
-- issues a fresh random code valid for 15 minutes. The first request made with it
-- consumes it (nobody else can use it), and the request still needs the owner's
-- approval (0004).

alter table public.households
  add column invite_expires_at timestamptz;

-- New households start without an active invite; existing standing codes stop working.
alter table public.households alter column invite_open set default false;
update public.households set invite_open = false, invite_expires_at = null;

-- Owner only: issue a new code (replaces any earlier one). Returns the code and its expiry.
drop function if exists public.regenerate_invite(uuid);
create or replace function public.create_invite(hid uuid)
returns table (invite_code text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  h public.households;
begin
  if not public.is_household_owner(hid) then
    raise exception 'only the household owner can create an invite';
  end if;
  select * into h from public.households where id = hid for update;
  select count(*) into n from public.household_members where household_id = hid;
  if n >= h.max_members then
    raise exception 'household is full';
  end if;
  update public.households
  set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      invite_open = true,
      invite_expires_at = now() + interval '15 minutes'
  where id = hid
  returning households.invite_code, households.invite_expires_at into create_invite.invite_code, create_invite.invite_expires_at;
  return next;
end;
$$;

-- Owner only: withdraw the current code.
create or replace function public.revoke_invite(hid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_household_owner(hid) then
    raise exception 'only the household owner can revoke an invite';
  end if;
  update public.households set invite_open = false, invite_expires_at = null where id = hid;
end;
$$;

-- Requester: the code works once, within its 15 minutes.
create or replace function public.request_join(code text, member_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
  n int;
  clean text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if length(trim(coalesce(member_name, ''))) = 0 then
    raise exception 'name required';
  end if;
  if length(clean) < 12 then
    raise exception 'invalid invite code';
  end if;
  select * into h from public.households where invite_code = clean for update;
  if h.id is null then
    raise exception 'invalid invite code';
  end if;
  if exists (select 1 from public.household_members where household_id = h.id and user_id = auth.uid()) then
    return 'member';
  end if;
  if not h.invite_open or h.invite_expires_at is null or h.invite_expires_at < now() then
    raise exception 'invalid invite code';
  end if;
  select count(*) into n from public.household_members where household_id = h.id;
  if n >= h.max_members then
    raise exception 'invalid invite code';
  end if;
  update public.join_requests set status = 'cancelled', decided_at = now()
    where user_id = auth.uid() and status = 'pending';
  insert into public.join_requests (household_id, user_id, display_name)
    values (h.id, auth.uid(), trim(member_name));
  -- Single use: the code is spent.
  update public.households set invite_open = false, invite_expires_at = null where id = h.id;
  return 'pending';
end;
$$;

revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
