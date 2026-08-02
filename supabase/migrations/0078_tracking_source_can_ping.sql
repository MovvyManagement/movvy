-- =============================================================================
-- 0078 — Let the chosen tracking source ping (not only the assigned driver).
--
-- Migration 0077 added bookings.tracking_profile_id so a 2-person crew can pick
-- whose phone the customer follows. But the booking_tracking insert policy
-- (bt_insert_driver) still only allowed the assigned_driver_profile_id to ping —
-- so if the crew picked the OTHER person as the source, every ping was silently
-- rejected by RLS and the customer saw no movement.
--
-- Fix: allow the insert when the caller is EITHER the assigned driver OR the
-- booking's tracking source.
-- =============================================================================

drop policy if exists bt_insert_driver on booking_tracking;

create policy bt_insert_driver on booking_tracking for insert
  with check (
    driver_profile_id = auth.uid()
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and (
          b.assigned_driver_profile_id = auth.uid()
          or b.tracking_profile_id = auth.uid()
        )
    )
  );
