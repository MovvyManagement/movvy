'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

// Server Action: triggers supabase.auth.resetPasswordForEmail, which
// emails a magic link landing on /admin-management/reset-password with
// a one-time access token. We DO NOT reveal whether the email exists —
// any success-looking response always shows "check your inbox" so the
// form can't be used to enumerate admin emails.
export async function requestReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    redirect(
      `/admin-management/forgot-password?error=${encodeURIComponent(
        'Enter a valid email.',
      )}`,
    );
  }

  // Build the absolute reset URL from the request host. This auto-adapts
  // between localhost (dev), the Vercel preview deployments, and movvy.ca
  // in production without us having to maintain a env var.
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? 'movvy.ca';
  const redirectTo = `${proto}://${host}/admin-management/reset-password`;

  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  // Always show the success screen — even if the email doesn't match
  // any account — to avoid leaking which addresses have admin access.
  redirect('/admin-management/forgot-password?sent=1');
}
