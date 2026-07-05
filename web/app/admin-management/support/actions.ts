'use server';

// Pause / resume the AI assistant on a support thread. Resuming also clears the
// needs_human flag (the agent handled it and is handing back to the bot).
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export async function setThreadAi(formData: FormData): Promise<void> {
  const threadId = String(formData.get('thread_id') ?? '');
  const enable = String(formData.get('enable') ?? '') === 'true';
  if (!threadId) return;

  const supabase = await supabaseServer();
  if (!(await getAdminAccess(supabase))) return;

  await supabase
    .from('chat_threads')
    .update(enable ? { ai_enabled: true, needs_human: false } : { ai_enabled: false })
    .eq('id', threadId);
  revalidatePath(`/admin-management/support/${threadId}`);
}
