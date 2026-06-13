// =============================================================================
// /admin-management/forgot-password
//
// Step 1 of the reset flow. Admin enters their email → server action
// calls supabase.auth.resetPasswordForEmail() → Supabase sends a magic
// link to that email that lands on /admin-management/reset-password
// with a single-use access token. The token authorizes
// supabase.auth.updateUser({ password }) on the next screen.
//
// We don't reveal whether the email exists — for any input that looks
// like an email, we show the "check your inbox" screen. This avoids
// turning the form into an admin-email enumerator.
// =============================================================================

import { requestReset } from './actions';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-white px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white text-2xl font-bold">
            M
          </div>
          <h1 className="mt-4 text-2xl font-bold text-zinc-900">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            We&apos;ll email you a link to choose a new password.
          </p>
        </div>

        {sent === '1' ? (
          <div className="rounded-3xl bg-white border border-zinc-200 p-6 shadow-sm">
            <div className="flex items-center justify-center w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-700 mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-zinc-900 text-center">
              Check your inbox
            </h2>
            <p className="mt-2 text-sm text-zinc-600 text-center leading-6">
              If an admin account exists for that email, we just sent a reset
              link. The link expires in one hour.
            </p>
            <a
              href="/admin-management/login"
              className="mt-6 block text-center text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              ← Back to sign in
            </a>
          </div>
        ) : (
          <form
            action={requestReset}
            className="rounded-3xl bg-white border border-zinc-200 p-6 shadow-sm space-y-4"
            autoComplete="off"
          >
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Email
              </label>
              <input
                type="email"
                name="email"
                required
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            {error ? (
              <div className="rounded-2xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
                {decodeURIComponent(error)}
              </div>
            ) : null}

            <button
              type="submit"
              className="w-full h-12 rounded-2xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
            >
              Send reset link
            </button>

            <a
              href="/admin-management/login"
              className="block text-center text-sm font-semibold text-zinc-500 hover:text-zinc-700"
            >
              ← Back to sign in
            </a>
          </form>
        )}
      </div>
    </div>
  );
}
