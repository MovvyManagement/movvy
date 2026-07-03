// =============================================================================
// Admin console access tier — resolved from the DB so the app, RLS, and the
// admin-console edge function all agree on one answer.
//
//   'management' — full access incl. Revenue + employee management
//   'staff'      — Moves / Support / Approvals, but NO revenue anywhere
//   null         — not an admin (or blocked): redirect out of the console
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type AdminAccess = 'management' | 'staff' | null;

export async function getAdminAccess(supabase: SupabaseClient): Promise<AdminAccess> {
  const { data, error } = await supabase.rpc('movvy_admin_access');
  if (error) return null;
  return (data as AdminAccess) ?? null;
}
