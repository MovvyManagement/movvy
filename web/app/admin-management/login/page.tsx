// =============================================================================
// /admin-management/login — admin sign-in form.
//
// Anonymous landing page for the admin console. Middleware bounces
// already-signed-in admins to the dashboard, so this only renders for
// users who actually need to authenticate. Form submission goes through
// a Server Action that calls supabase.auth.signInWithPassword — that
// sets the session cookie, then we redirect to /admin-management/dashboard.
//
// Failed sign-ins surface the error inline. Customers/drivers who manage
// to sign in here will pass auth but get bounced from the dashboard by
// the role check in middleware.ts.
// =============================================================================

import { login } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-white px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white text-2xl font-bold">
            M
          </div>
          <h1 className="mt-4 text-2xl font-bold text-zinc-900">
            Movvy Admin
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Operations console · sign in with your admin credentials
          </p>
        </div>

        <form
          action={login}
          className="rounded-3xl bg-white border border-zinc-200 p-6 shadow-sm space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Email
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              autoFocus
              placeholder="management@movvy.ca"
              className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Password
            </label>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
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
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-400">
          Customers and drivers should use the Movvy mobile app instead.
        </p>
      </div>
    </div>
  );
}
