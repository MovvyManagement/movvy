// Hand-written DB types matching the migrations.
// In production, regenerate this from the live DB with:
//   supabase gen types typescript --project-id YOUR_REF > src/lib/supabase/types.ts

import type { MoveType, BookingStatus, UserRole } from '@/types';

export interface DbProfile {
  id: string;
  role: UserRole;
  full_name: string | null;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  home_city_id: string | null;
  preferred_language: string | null;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  is_suspended: boolean;
  /** Emergency contact (migration 0028) — surfaced on SOS. */
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbCity {
  id: string;
  slug: string;
  name: string;
  country_code: string;
  region: string;
  timezone: string;
  center_lat: number;
  center_lng: number;
  bounds_n: number;
  bounds_s: number;
  bounds_e: number;
  bounds_w: number;
  is_active: boolean;
  is_accepting_partners: boolean;
  currency: string;
  commission_rate: number;
  tax_rate: number;
  rate_hourly_commercial: number;
  rate_hourly_labor: number;
  rate_per_km: number;
  rate_home_base: number;
  rate_home_per_bedroom: number;
  rate_home_per_living: number;
  rate_items_base: number;
  rate_items_per_item: number;
  booking_lead_days: number;
  launched_at: string | null;
}

export interface DbBooking {
  id: string;
  short_code: string;
  customer_id: string;
  city_id: string;
  move_type: MoveType;
  status: BookingStatus;

  pickup_line1: string;
  pickup_line2: string | null;
  pickup_city: string;
  pickup_region: string;
  pickup_postal: string | null;
  pickup_country_code: string;
  pickup_lat: number;
  pickup_lng: number;

  dropoff_line1: string | null;
  dropoff_line2: string | null;
  dropoff_city: string | null;
  dropoff_region: string | null;
  dropoff_postal: string | null;
  dropoff_country_code: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;

  distance_km: number | null;
  duration_min: number | null;

  schedule_mode: 'asap' | 'scheduled';
  scheduled_for_date: string;
  scheduled_for_window: string | null;
  scheduled_for_window_starts_at: string | null;
  scheduled_for_window_ends_at: string | null;

  details: Record<string, any>;
  customer_notes: string | null;

  price_base_cents: number;
  price_rooms_cents: number;
  price_distance_cents: number;
  price_addons_cents: number;
  price_subtotal_cents: number;
  price_service_fee_cents: number;
  price_tax_cents: number;
  price_total_cents: number;
  price_commission_cents: number;
  pricing_model: 'fixed' | 'hourly';

  assigned_team_id: string | null;
  assigned_company_id: string | null;
  assigned_driver_profile_id: string | null;
  assigned_at: string | null;

  stripe_payment_intent_id: string | null;
  payment_status: string;

  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface DbSavedAddress {
  id: string;
  profile_id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city_id: string;
  city_name: string;
  region: string;
  country_code: string;
  postal: string | null;
  lat: number;
  lng: number;
  is_default: boolean;
}
