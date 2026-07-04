// =============================================================================
// /admin-management/team — employee access management (management only).
//
// Add employees by email (they get a Supabase invite to set a password), set
// each one to management or staff, and block/unblock or remove them. Staff can
// use the console but never see revenue. management@movvy.ca is the root and
// can't be blocked or removed.
// =============================================================================

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { TeamManager } from './TeamManager';

export const dynamic = 'force-dynamic';

const ROOT_EMAIL = 'management@movvy.ca';

export default async function TeamPage() {
  const supabase = await supabaseServer();
  if ((await getAdminAccess(supabase)) !== 'management') {
    redirect('/admin-management/dashboard');
  }

  const { data: members } = await supabase
    .from('admin_members')
    .select('id, email, full_name, access_level, blocked, created_at')
    .order('created_at', { ascending: true });

  const rows = (members ?? []).map((m: any) => ({
    ...m,
    isRoot: String(m.email).toLowerCase() === ROOT_EMAIL,
  }));

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-zinc-900">Team access</h1>
      <p className="text-sm text-zinc-500 mt-0.5 mb-6">
        Who can sign into the ops console, and what they can see. Only management sees Revenue.
      </p>
      <TeamManager members={rows} />
    </div>
  );
}
