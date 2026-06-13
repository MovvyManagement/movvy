// Server Actions for the admin login form.
// 'use server' marks this entire file as server-only — Next.js refuses
// to bundle it for the browser, so the Supabase server client (which
// touches cookies()) is safe to import here.

'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect(
      `/admin-management/login?error=${encodeURIComponent(
        'Email and password are both required.',
      )}`,
    );
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(
      `/admin-management/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Successful sign-in sets the session cookie via the SSR client.
  // Role gate happens in middleware on the next request.
  redirect('/admin-management/dashboard');
}

export async function logout() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/admin-management/login');
}
