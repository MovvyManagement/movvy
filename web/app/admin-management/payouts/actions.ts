'use server';

// =============================================================================
// Payout request decisions.
//
// There is no automated payout rail — someone sends the e-Transfer by hand and
// records it here. So these actions do not move money; they record that money
// moved (or that it won't). The reference field exists so a payment can be
// traced back to a confirmation number months later.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

type Decision = 'paid' | 'rejected';

export async function decidePayout(
  id: string,
  decision: Decision,
  detail: string,
): Promise<{ error?: string; ok?: boolean }> {
  if (!id) return { error: 'Missing request.' };

  const note = detail.trim();
  // A rejection with no reason is a dead end for the crew — they have no way to
  // know what to fix. A payment with no reference can't be traced later.
  if (decision === 'rejected' && note.length < 3) {
    return { error: 'Say why, so the crew knows what to do next.' };
  }
  if (decision === 'paid' && note.length < 3) {
    return { error: 'Record the e-Transfer confirmation or wire reference.' };
  }

  const supabase = await supabaseServer();
  // Money movement is management-only — support staff can read the queue but
  // must not be able to mark a withdrawal paid.
  const access = await getAdminAccess(supabase);
  if (access !== 'management') return { error: 'Not authorized.' };

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('payout_requests')
    .update({
      status: decision,
      reference: decision === 'paid' ? note : null,
      admin_note: decision === 'rejected' ? note : null,
      processed_by: user?.id ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending'); // never re-decide something already settled

  if (error) return { error: error.message };

  revalidatePath('/admin-management/payouts');
  return { ok: true };
}
