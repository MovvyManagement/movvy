'use server';

// Suspend / reinstate a user — relays to admin-suspend-user.
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export async function suspendUser(formData: FormData): Promise<void> {
  const profileId = String(formData.get('profile_id') ?? '');
  const action = String(formData.get('action') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!profileId || (action !== 'suspend' && action !== 'reinstate')) return;

  const supabase = await supabaseServer();
  if (!(await getAdminAccess(supabase))) return;

  await supabase.functions.invoke('admin-suspend-user', {
    body: { profile_id: profileId, action, reason: reason || undefined },
  });
  revalidatePath(`/admin-management/users/${profileId}`);
}
