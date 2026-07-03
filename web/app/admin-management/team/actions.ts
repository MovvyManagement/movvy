'use server';

// =============================================================================
// Team management server actions — invite / block / unblock / remove employees.
// Every write goes through the admin-console edge function (service role),
// which re-checks that the caller is management. These just relay + revalidate.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';

export type TeamState = { error?: string; ok?: string };

async function callConsole(body: Record<string, unknown>): Promise<{ error?: string; data?: any }> {
  const supabase = await supabaseServer();
  if ((await getAdminAccess(supabase)) !== 'management') return { error: 'Management-only.' };
  const { data, error } = await supabase.functions.invoke('admin-console', { body });
  if (error || data?.error) return { error: data?.error ?? 'Action failed. Try again.' };
  return { data };
}

export async function inviteMember(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const accessLevel = String(formData.get('access_level') ?? 'staff');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };

  const { error, data } = await callConsole({
    action: 'invite_member', email, full_name: fullName || undefined, access_level: accessLevel,
  });
  if (error) return { error };
  revalidatePath('/admin-management/team');
  return { ok: data?.invited ? `Invite sent to ${email}.` : `${email} added (they already have an account — they can sign in).` };
}

export async function setMemberBlocked(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const blocked = String(formData.get('blocked') ?? '') === 'true';
  await callConsole({ action: 'set_member', id, blocked });
  revalidatePath('/admin-management/team');
}

export async function setMemberLevel(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const accessLevel = String(formData.get('access_level') ?? 'staff');
  await callConsole({ action: 'set_member', id, access_level: accessLevel });
  revalidatePath('/admin-management/team');
}

export async function removeMember(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  await callConsole({ action: 'remove_member', id });
  revalidatePath('/admin-management/team');
}
