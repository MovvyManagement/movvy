'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export type RefundState = { ok?: string; error?: string };

/**
 * Issue the deposit surplus back to a customer's card.
 *
 * The amount is NOT taken from the form. It is re-derived from
 * admin_refunds_owed() at the moment of clicking, so a stale page — one opened
 * before a bill was recomputed, or left sitting while a partial refund went out
 * another way — cannot refund a number that is no longer true. The form only
 * says WHICH move.
 */
export async function issueOwedRefund(
  _prev: RefundState,
  formData: FormData,
): Promise<RefundState> {
  const bookingId = String(formData.get('booking_id') ?? '');
  if (!bookingId) return { error: 'Missing booking.' };

  const supabase = await supabaseServer();
  // Moving money is management-only. The RLS policy on bookings admits the
  // staff tier, so this check is the control, not a convenience.
  if ((await getAdminAccess(supabase)) !== 'management') {
    return { error: 'Issuing a refund is management-only.' };
  }

  const { data: owed, error: owedErr } = await supabase.rpc('admin_refunds_owed');
  if (owedErr) return { error: 'Could not confirm what is owed. Try again.' };

  const row = (owed ?? []).find((r: any) => r.booking_id === bookingId);
  if (!row) {
    // Already refunded, or the bill changed underneath. Either way this is not
    // an error the admin caused — tell them what happened and refresh.
    revalidatePath('/admin-management/refunds');
    return { ok: 'Nothing is owed on that move any more — the list has been refreshed.' };
  }

  const amountCents = Number(row.owed_cents ?? 0);
  if (amountCents < 50) {
    revalidatePath('/admin-management/refunds');
    return { ok: 'That amount is below the minimum a card refund can carry.' };
  }

  const { data, error } = await supabase.functions.invoke('admin-refund-booking', {
    body: {
      booking_id: bookingId,
      amount_cents: amountCents,
      reason: `Deposit exceeded the final bill on ${row.short_code}`,
    },
  });
  if (error || (data as any)?.error) {
    return { error: (data as any)?.error ?? 'The payment gateway refused the refund.' };
  }

  revalidatePath('/admin-management/refunds');
  revalidatePath(`/admin-management/moves/${bookingId}`);
  const dollars = (((data as any)?.refunded_cents ?? amountCents) / 100).toFixed(2);
  return { ok: `$${dollars} refunded to ${row.customer_name ?? 'the customer'}.` };
}
