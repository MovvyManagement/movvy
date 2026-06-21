-- =============================================================================
-- Migration 0046 — Enable Supabase Realtime for admin-watched tables
--
-- The admin web (/admin-management/*) uses Supabase Realtime postgres_changes
-- subscriptions to trigger router.refresh() on relevant inserts/updates,
-- giving the dashboard / moves / approvals / support inbox screens
-- truly live behaviour without polling.
--
-- For a table to broadcast its changes, it has to be in the
-- supabase_realtime publication. bookings, chat_threads, and chat_messages
-- are added by default. The others below have to be added explicitly.
--
-- Idempotent — the DO block skips any table that's already in the
-- publication. `alter publication add table` has no IF NOT EXISTS, hence
-- the manual guard.
-- =============================================================================

do $$
declare
  t text;
  needed text[] := array[
    'partner_teams',
    'companies',
    'disputes',
    'verification_documents',
    'api_spend_log',
    'partner_team_members',
    'company_members'
  ];
begin
  foreach t in array needed loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
      raise notice 'Added % to supabase_realtime publication', t;
    end if;
  end loop;
end $$;
