// =============================================================================
// /admin-management/security — per-account security (optional 2FA enrolment).
// Available to any signed-in admin (management or staff).
// =============================================================================

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { MfaManager } from './MfaManager';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const supabase = await supabaseServer();
  if (!(await getAdminAccess(supabase))) redirect('/admin-management/login');

  return (
    <div className="p-6 sm:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-900 mb-1">Security</h1>
      <p className="text-sm text-zinc-500 mb-6">Protect your admin account with a second factor.</p>
      <MfaManager />
    </div>
  );
}
