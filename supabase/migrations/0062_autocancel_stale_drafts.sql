-- =============================================================================
-- Auto-cancel stale draft bookings (deposit-to-confirm flow, 2026-07-14).
--
-- A 'draft' booking normally lives for seconds: the app creates it, presents
-- the deposit Payment Sheet, and either the webhook flips it to 'searching'
-- (paid) or the app cancels it (sheet dismissed/failed). The only way a draft
-- survives is the app dying mid-checkout — sweep those hourly so no invisible
-- zombie bookings accumulate. 1 hour of grace comfortably covers slow webhook
-- redeliveries for a deposit that DID get paid (the flip guard is
-- status='draft', so a paid-but-slow booking flips before the sweep, and the
-- sweep never touches non-draft rows).
-- =============================================================================

select cron.unschedule('cancel-stale-draft-bookings')
where exists (select 1 from cron.job where jobname = 'cancel-stale-draft-bookings');

select cron.schedule(
  'cancel-stale-draft-bookings',
  '17 * * * *',  -- hourly at :17 (offset to avoid top-of-hour job pileups)
  $$
    update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'Deposit payment not completed at checkout (auto-expired)'
    where status = 'draft'
      and created_at < now() - interval '1 hour';
  $$
);
