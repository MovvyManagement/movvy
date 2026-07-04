'use server';

// =============================================================================
// Settings actions — feature-flag toggle + promo-code creation.
// Flags go through admin-console (service role); promos reuse admin-create-promo.
// All management-gated.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export type PromoState = { error?: string; ok?: string };

async function requireManagement() {
  const supabase = await supabaseServer();
  const ok = (await getAdminAccess(supabase)) === 'management';
  return { supabase, ok };
}

export async function toggleFlag(formData: FormData): Promise<void> {
  const key = String(formData.get('key') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  const { supabase, ok } = await requireManagement();
  if (!ok || !key) return;
  await supabase.functions.invoke('admin-console', { body: { action: 'set_flag', key, enabled } });
  revalidatePath('/admin-management/settings');
}

export async function createPromo(_prev: PromoState, formData: FormData): Promise<PromoState> {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const kind = String(formData.get('kind') ?? '');
  const rawValue = Number(formData.get('value') ?? '0');
  const citySlug = String(formData.get('city_slug') ?? '').trim().toLowerCase();

  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return { error: 'Code must be 3–30 chars: A–Z 0–9 _ -' };
  if (!['percent_off', 'amount_off_cents', 'free_service_fee'].includes(kind)) return { error: 'Pick a discount type.' };
  if (!Number.isFinite(rawValue) || rawValue < 0) return { error: 'Enter a valid value.' };

  // percent_off -> whole percent; amount_off_cents -> dollars entered, store cents.
  const value = kind === 'amount_off_cents' ? Math.round(rawValue * 100) : Math.round(rawValue);
  if (kind === 'percent_off' && (value < 1 || value > 100)) return { error: 'Percent must be 1–100.' };

  const { supabase, ok } = await requireManagement();
  if (!ok) return { error: 'Management-only.' };

  const body: Record<string, unknown> = { code, kind, value };
  if (citySlug) body.city_slug = citySlug;

  const { data, error } = await supabase.functions.invoke('admin-create-promo', { body });
  if (error || data?.error) return { error: data?.error ?? 'Could not create promo. Try again.' };
  revalidatePath('/admin-management/settings');
  return { ok: `Promo ${code} created.` };
}
