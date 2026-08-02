-- =============================================================================
-- 0079 — Let booking participants CREATE their booking chat thread.
--
-- Bug: a crew member opening "Chat with customer" on a move with no thread yet
-- got nothing — the Send button looked active but did nothing. chat_threads had
-- SELECT + admin-ALL policies but NO participant INSERT policy, so
-- useEnsureBookingThread's insert was rejected by RLS, threadId stayed null, and
-- every send silently no-op'd.
--
-- Fix: allow an INSERT of a booking-scoped thread by someone who is actually on
-- that booking (the customer, the named partner, or assigned crew).
-- =============================================================================

create policy chat_threads_participant_insert on chat_threads for insert
  with check (
    kind = 'booking'
    and booking_id is not null
    and (
      customer_profile_id = auth.uid()
      or partner_profile_id = auth.uid()
      or is_assigned_to_booking(booking_id)
    )
  );
