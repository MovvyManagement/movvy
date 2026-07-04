'use server';

// =============================================================================
// Dispute resolution — relays to the admin-resolve-dispute edge fn. Refunds
// (refund_cents > 0) are enforced management/admin-only server-side; the UI
// only exposes the refund field to management to match.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export type DisputeState = { error?: string };

export async function resolveDispute(_prev: DisputeState, formData: FormData): Promise<DisputeState> {
  const disputeId = String(formData.get('dispute_id') ?? '');
  const resolution = String(formData.get('resolution') ?? '');
  const notes = String(formData.get('notes') ?? '').trim();
  const refundDollars = Number(formData.get('refund_dollars') ?? '0');

  if (!disputeId) return { error: 'Missing dispute.' };
  if (!['resolved_customer', 'resolved_partner', 'closed'].includes(resolution)) return { error: 'Pick an outcome.' };
  if (notes.length < 1) return { error: 'Add resolution notes (visible in the audit log).' };

  const supabase = await supabaseServer();
  const access = await getAdminAccess(supabase);
  if (!access) return { error: 'Not authorized.' };

  const refundCents = Math.max(0, Math.round((Number.isFinite(refundDollars) ? refundDollars : 0) * 100));
  if (refundCents > 0 && access !== 'management') {
    return { error: 'Issuing a refund is management-only.' };
  }

  const { data, error } = await supabase.functions.invoke('admin-resolve-dispute', {
    body: { dispute_id: disputeId, resolution, refund_cents: refundCents, notes },
  });
  if (error || data?.error) return { error: data?.error ?? 'Could not resolve. Try again.' };

  revalidatePath('/admin-management/disputes');
  redirect('/admin-management/disputes');
}
