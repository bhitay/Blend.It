-- BlendIt — the owner can remove a member
--
-- Takes effect immediately: every query checks membership, so the removed user sees
-- no household data from their next request. Their accounts and history stay in the
-- household (they are household data), still attributed to them.

create or replace function public.remove_member(hid uuid, member_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.household_members;
begin
  if not public.is_household_owner(hid) then
    raise exception 'only the household owner can remove members';
  end if;
  if member_user_id = auth.uid() then
    raise exception 'the owner cannot remove themselves';
  end if;
  select * into target from public.household_members
  where household_id = hid and user_id = member_user_id for update;
  if target.user_id is null then
    raise exception 'not a member';
  end if;
  if target.role = 'owner' then
    raise exception 'cannot remove an owner';
  end if;
  delete from public.household_members where household_id = hid and user_id = member_user_id;
  -- Their old requests can't be replayed; any open invite stays as it was.
  update public.join_requests set status = 'cancelled', decided_at = now()
    where household_id = hid and user_id = member_user_id and status = 'pending';
end;
$$;

revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
