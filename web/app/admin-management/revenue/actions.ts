'use server';

// =============================================================================
// Revenue screen server actions — PIN unlock + PIN change.
//
// PIN verification happens in the admin-console edge function (it holds the
// salted hash). On success we mint a signed session token and drop it in an
// httpOnly cookie; the page re-validates it on every load.
// =============================================================================

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { mintRevenueToken, REVENUE_COOKIE } from '@/lib/revenueSession';

export type PinState = { error?: string; ok?: boolean };

export async function unlockRevenue(_prev: PinState, formData: FormData): Promise<PinState> {
  const pin = String(formData.get('pin') ?? '').trim();
  if (!/^\d{6}$/.test(pin)) return { error: 'Enter your 6-digit PIN.' };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired — sign in again.' };
  if ((await getAdminAccess(supabase)) !== 'management') return { error: 'Revenue is management-only.' };

  const { data, error } = await supabase.functions.invoke('admin-console', {
    body: { action: 'verify_pin', pin },
  });
  if (error) return { error: 'Too many attempts, or a server error. Wait a moment and retry.' };
  if (data?.notSet) return { error: 'No PIN is set yet. Use "Set a PIN" below.' };
  if (!data?.ok) return { error: 'Incorrect PIN.' };

  const store = await cookies();
  store.set(REVENUE_COOKIE, mintRevenueToken(user.id), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/admin-management',
    maxAge: 8 * 60 * 60,
  });
  redirect('/admin-management/revenue');
}

export async function changePin(_prev: PinState, formData: FormData): Promise<PinState> {
  const newPin = String(formData.get('new_pin') ?? '').trim();
  const currentPin = String(formData.get('current_pin') ?? '').trim();
  if (!/^\d{6}$/.test(newPin)) return { error: 'The new PIN must be exactly 6 digits.' };

  const supabase = await supabaseServer();
  if ((await getAdminAccess(supabase)) !== 'management') return { error: 'Management-only.' };

  const { data, error } = await supabase.functions.invoke('admin-console', {
    body: { action: 'set_pin', new_pin: newPin, current_pin: currentPin || undefined },
  });
  if (error || data?.error) {
    return { error: data?.error ?? 'Could not update the PIN. Check the current PIN and retry.' };
  }
  // Force a fresh unlock with the new PIN.
  const store = await cookies();
  store.delete(REVENUE_COOKIE);
  return { ok: true };
}

export async function lockRevenue(): Promise<void> {
  const store = await cookies();
  store.delete(REVENUE_COOKIE);
  redirect('/admin-management/revenue');
}
