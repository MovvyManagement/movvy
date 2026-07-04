'use server';

// =============================================================================
// Move-detail server actions — reassign crew + cancel (full refund).
// Both relay to existing edge functions (admin-reassign-booking, bookings-cancel)
// through the user session; the edge fns enforce their own admin gates.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export type MoveActionState = { error?: string; ok?: string };

export async function reassignMove(_prev: MoveActionState, formData: FormData): Promise<MoveActionState> {
  const bookingId = String(formData.get('booking_id') ?? '');
  const target = String(formData.get('target') ?? ''); // "team:<uuid>" | "company:<uuid>"
  const reason = String(formData.get('reason') ?? '').trim();
  const [kind, id] = target.split(':');
  if (!bookingId || !id || (kind !== 'team' && kind !== 'company')) {
    return { error: 'Pick a crew to reassign to.' };
  }

  const supabase = await supabaseServer();
  if (!(await getAdminAccess(supabase))) return { error: 'Not authorized.' };

  const body: Record<string, unknown> = { booking_id: bookingId, reason: reason || 'Reassigned by admin' };
  if (kind === 'team') body.team_id = id;
  else body.company_id = id;

  const { data, error } = await supabase.functions.invoke('admin-reassign-booking', { body });
  if (error || data?.error) return { error: data?.error ?? 'Reassign failed. Try again.' };
  revalidatePath(`/admin-management/moves/${bookingId}`);
  return { ok: 'Move reassigned.' };
}

export async function cancelMove(_prev: MoveActionState, formData: FormData): Promise<MoveActionState> {
  const bookingId = String(formData.get('booking_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!bookingId) return { error: 'Missing booking.' };
  if (reason.length < 3) return { error: 'Give a short reason (min 3 chars).' };

  const supabase = await supabaseServer();
  // Cancelling issues a full (admin) refund, so keep it to management.
  if ((await getAdminAccess(supabase)) !== 'management') {
    return { error: 'Cancelling a move (full refund) is management-only.' };
  }

  const { data, error } = await supabase.functions.invoke('bookings-cancel', {
    body: { booking_id: bookingId, reason: `Admin · ${reason}` },
  });
  if (error || data?.error) return { error: data?.error ?? 'Cancel failed. Try again.' };
  revalidatePath(`/admin-management/moves/${bookingId}`);
  return { ok: `Move cancelled · ${(data?.refund_percent ?? 100)}% refund queued.` };
}
