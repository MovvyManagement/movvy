-- =============================================================================
-- Movvy — Migration 0007: Storage buckets + RLS for file uploads
-- =============================================================================
-- All file uploads go through Supabase Storage. Each bucket has its own
-- RLS policies that match the data model.
--
-- Path conventions (enforced by RLS so the uploader can ONLY write to their slot):
--   verifications/<profile_id>/<doc_kind>-<uuid>.<ext>
--   profile-photos/<profile_id>/avatar.<ext>
--   move-photos/<booking_id>/<uuid>.<ext>
--   company-photos/<company_id>/<uuid>.<ext>
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BUCKETS
-- -----------------------------------------------------------------------------

-- verifications: private, RLS-protected. Only owner + admins can read; only owner can upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verifications', 'verifications', false,
  20 * 1024 * 1024,  -- 20MB cap on ID/insurance/license scans
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
) on conflict (id) do nothing;

-- profile-photos: avatars. Owner-only read at first; we'll flip to public when needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos', 'profile-photos', false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp']
) on conflict (id) do nothing;

-- move-photos: photos attached to a booking (pre-move walkthrough, damage report)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'move-photos', 'move-photos', false,
  15 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'video/mp4', 'video/quicktime']
) on conflict (id) do nothing;

-- company-photos: company logo, fleet, team photos for public profile
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-photos', 'company-photos', false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- VERIFICATIONS BUCKET POLICIES
-- Path must start with the uploader's profile_id (UUID) so files are scoped.
-- -----------------------------------------------------------------------------

create policy "verifications_owner_select"
  on storage.objects for select
  using (
    bucket_id = 'verifications'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or is_admin()
    )
  );

create policy "verifications_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'verifications'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "verifications_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'verifications'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "verifications_admin_all"
  on storage.objects for all
  using (bucket_id = 'verifications' and is_admin())
  with check (bucket_id = 'verifications' and is_admin());

-- -----------------------------------------------------------------------------
-- PROFILE PHOTOS POLICIES
-- -----------------------------------------------------------------------------

create policy "profile_photos_owner_all"
  on storage.objects for all
  using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile_photos_admin_select"
  on storage.objects for select
  using (bucket_id = 'profile-photos' and is_admin());

-- -----------------------------------------------------------------------------
-- MOVE PHOTOS POLICIES
-- Only the customer of the booking, the assigned crew, or admins can access.
-- Path: move-photos/<booking_id>/...
-- -----------------------------------------------------------------------------

create policy "move_photos_participant_select"
  on storage.objects for select
  using (
    bucket_id = 'move-photos'
    and (
      is_admin()
      or exists (
        select 1 from bookings b
        where b.id::text = (storage.foldername(name))[1]
          and (b.customer_id = auth.uid() or is_assigned_to_booking(b.id))
      )
    )
  );

create policy "move_photos_participant_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'move-photos'
    and exists (
      select 1 from bookings b
      where b.id::text = (storage.foldername(name))[1]
        and (b.customer_id = auth.uid() or is_assigned_to_booking(b.id))
    )
  );

create policy "move_photos_admin_all"
  on storage.objects for all
  using (bucket_id = 'move-photos' and is_admin())
  with check (bucket_id = 'move-photos' and is_admin());

-- -----------------------------------------------------------------------------
-- COMPANY PHOTOS POLICIES
-- -----------------------------------------------------------------------------

create policy "company_photos_member_select"
  on storage.objects for select
  using (
    bucket_id = 'company-photos'
    and (
      is_admin()
      or is_company_member((storage.foldername(name))[1]::uuid)
    )
  );

create policy "company_photos_admin_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'company-photos'
    and is_company_admin((storage.foldername(name))[1]::uuid)
  );

create policy "company_photos_admin_delete"
  on storage.objects for delete
  using (
    bucket_id = 'company-photos'
    and is_company_admin((storage.foldername(name))[1]::uuid)
  );

-- -----------------------------------------------------------------------------
-- REALTIME — enable subscriptions on the tables clients listen to
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table booking_tracking;
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table notifications;
