'use server';

// =============================================================================
// Move-detail server actions — reassign crew, cancel (full refund), and issue
// a standalone refund. Reassign + cancel are ops actions; a standalone refund
// is MANAGEMENT-ONLY. All relay to edge functions (admin-reassign-booking,
// bookings-cancel, admin-refund-booking) through the user session; the edge
// fns enforce their own admin gates too.
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

export async function issueRefund(_prev: MoveActionState, formData: FormData): Promise<MoveActionState> {
    const bookingId = String(formData.get('booking_id') ?? '');
    const amountDollars = Number(formData.get('amount_dollars') ?? '');
    const reason = String(formData.get('reason') ?? '').trim();
    if (!bookingId) return { error: 'Missing booking.' };
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
          return { error: 'Enter a refund amount greater than $0.' };
    }
    const amountCents = Math.round(amountDollars * 100);

  const supabase = await supabaseServer();
    // Standalone refunds move money — management-only.
  if ((await getAdminAccess(supabase)) !== 'management') {
        return { error: 'Issuing a refund is management-only.' };
  }

  const { data, error } = await supabase.functions.invoke('admin-refund-booking', {
        body: { booking_id: bookingId, amount_cents: amountCents, reason: reason || 'Admin refund' },
  });
    if (error || data?.error) return { error: data?.error ?? 'Refund failed. Try again.' };
    revalidatePath(`/admin-management/moves/${bookingId}`);
    const dollars = ((data?.refunded_cents ?? amountCents) / 100).toFixed(2);
    return { ok: `Refund of $${dollars} recorded.` };
}
