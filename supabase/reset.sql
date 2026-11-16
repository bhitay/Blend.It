-- Removes everything 0001_init.sql creates, so it can be run again from scratch.
-- WARNING: deletes all BlendIt data. Only for setup / development.
drop view if exists public.account_balances;
drop table if exists public.transactions, public.balance_snapshots, public.accounts, public.household_members, public.households cascade;
drop function if exists public.create_household(text, text), public.join_household(text, text), public.is_household_member(uuid), public.touch_updated_at() cascade;
drop type if exists public.account_kind, public.account_source cascade;
