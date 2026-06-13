// =============================================================================
// ResetPasswordForm — client island for the reset-password page.
//
// Two responsibilities:
//   1. On mount, look for a Supabase recovery token in the URL. Supabase
//      sends ?code=… (PKCE) or #access_token=… depending on the project
//      template. We handle both by calling exchangeCodeForSession for
//      the query-string case and detectSessionInUrl for the fragment case
//      (the SSR client does that automatically on first auth state read).
//   2. Render a password form that calls supabase.auth.updateUser. When
//      that succeeds the user is signed in with their new password and
//      we route them to the dashboard.
// =============================================================================

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export function ResetPasswordForm() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // On mount: redeem the recovery token. The Supabase browser client
  // automatically picks up #access_token from the URL fragment, but
  // for PKCE (?code=…) we have to call exchangeCodeForSession ourselves.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');

        if (code) {
          const { error: exchErr } = await supabase.auth.exchangeCodeForSession(
            code,
          );
          if (exchErr) throw exchErr;
        }

        // Whether the code path or the fragment path was used, getUser
        // confirms a session now exists. If not, the link was bad.
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) {
          throw new Error('This reset link is invalid or has expired.');
        }
        if (!cancelled) setReady(true);
      } catch (e: any) {
        if (!cancelled) setLinkError(e?.message ?? 'Reset link could not be verified.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (pw1.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (pw1 !== pw2) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({
        password: pw1,
      });
      if (updErr) throw updErr;
      // Successful update keeps the session live — go straight to dashboard.
      router.push('/admin-management/dashboard');
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the new password.');
    } finally {
      setBusy(false);
    }
  }

  if (linkError) {
    return (
      <div className="rounded-3xl bg-white border border-zinc-200 p-6 shadow-sm">
        <div className="rounded-2xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
          {linkError}
        </div>
        <a
          href="/admin-management/forgot-password"
          className="mt-4 block text-center text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          Request a new link →
        </a>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="rounded-3xl bg-white border border-zinc-200 p-6 shadow-sm text-center">
        <div className="inline-block h-6 w-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-sm text-zinc-500">Verifying reset link…</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-3xl bg-white border border-zinc-200 p-6 shadow-sm space-y-4"
      autoComplete="off"
    >
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
          New password
        </label>
        <input
          type="password"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          required
          autoFocus
          minLength={8}
          autoComplete="new-password"
          className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
        <p className="mt-2 text-xs text-zinc-500">
          Minimum 8 characters. Use a mix of letters, numbers, and a symbol.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
          Confirm new password
        </label>
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>

      {error ? (
        <div className="rounded-2xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full h-12 rounded-2xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors"
      >
        {busy ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
