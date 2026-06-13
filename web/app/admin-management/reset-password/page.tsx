// =============================================================================
// /admin-management/reset-password
//
// Landing page for the magic link sent by /admin-management/forgot-password.
// Supabase appends a `code` query param (PKCE flow) or `access_token` in
// the URL fragment. We use the client-side <ResetPasswordForm> to read
// either form, exchange the code for a session, and run
// supabase.auth.updateUser({ password }) when the admin submits a new
// password.
//
// Client-side is required because the access token is in the URL fragment
// (`#`), which is never sent to the server. We could move to the explicit
// PKCE flow (?code=…) but the fragment-based flow is what Supabase's
// default email template uses out of the box.
// =============================================================================

import { ResetPasswordForm } from './ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-white px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white text-2xl font-bold">
            M
          </div>
          <h1 className="mt-4 text-2xl font-bold text-zinc-900">
            Choose a new password
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            The reset link expires after one use. You&apos;ll be signed in
            automatically once you save.
          </p>
        </div>

        <ResetPasswordForm />
      </div>
    </div>
  );
}
