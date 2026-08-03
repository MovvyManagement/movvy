'use server';

// =============================================================================
// Document review — approve a partner's uploaded document, or send it back with
// a comment explaining what to fix.
//
// This is a real gate, not paperwork: org_can_take_booking() only unlocks job
// acceptance once the TRUCK REGISTRATION is 'approved'. A rejection must carry a
// note — the partner sees it in their profile and re-uploads. Writes go through
// the admin's own session so RLS + the audit trail attribute the decision.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export async function reviewDocument(
  docId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
): Promise<{ error?: string; ok?: boolean }> {
  if (!docId) return { error: 'Missing document.' };
  if (decision === 'rejected' && (!note || note.trim().length < 3)) {
    return { error: 'Tell them what to fix so they can re-upload.' };
  }

  const supabase = await supabaseServer();
  const access = await getAdminAccess(supabase);
  if (!access) return { error: 'Not authorized.' };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('verification_documents')
    .update({
      status: decision,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
      // Clear the old note on approval so a previously-rejected doc doesn't
      // keep showing stale "changes requested" copy in the partner's app.
      rejection_reason: decision === 'rejected' ? note!.trim() : null,
    })
    .eq('id', docId);

  if (error) return { error: error.message };

  revalidatePath('/admin-management/approvals');
  return { ok: true };
}
