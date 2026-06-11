#!/usr/bin/env bash
# Deploy every edge function in one shot.
# Prereq: `supabase login` + `supabase link --project-ref aabenjobueqawtyebirt`

set -euo pipefail

FUNCS=(
  bookings-create
  bookings-update-status
  bookings-cancel
  bookings-accept
  ratings-submit
  tracking-ping
  documents-upload-url
  geocoding-search
  tips-submit
  proxy-session-create
  admin-verify-partner
  admin-suspend-user
  admin-reassign-booking
  admin-resolve-dispute
  admin-create-promo
  promo-validate
  disputes-open
  chat-send
  device-tokens-register
  partners-broadcast
  account-delete
  notifications-send
)

for fn in "${FUNCS[@]}"; do
  echo "▶ Deploying $fn"
  supabase functions deploy "$fn"
done

echo
echo "✓ All ${#FUNCS[@]} functions deployed."
echo "  Don't forget secrets if you haven't already:"
echo "    supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_..."
