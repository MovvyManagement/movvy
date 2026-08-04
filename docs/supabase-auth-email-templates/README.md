# Supabase Auth Email Templates

These 4 HTML files get pasted **directly into the Supabase dashboard**, not
deployed as code. They use Supabase's `{{ .Var }}` template syntax (Go's
text/template), not our edge-function `_shared/email.ts` helper — Supabase
Auth renders them itself before handing off to Resend for delivery.

## How to install each one

1. Open Supabase Dashboard → your project → **Authentication** → **Email Templates**
2. Click the template you want to update (Confirm signup / Magic Link / Reset
   Password / Change Email Address)
3. Open the corresponding `.html` file in this folder
4. Copy the entire file contents
5. Paste into the **Message body** field, replacing whatever's there
6. Update the **Subject** field with the value at the top of each file's comment
7. Click **Save**

## File → Supabase template mapping

| File | Supabase template | Subject line |
|---|---|---|
| `01-confirm-signup.html` | Confirm signup | `Confirm your Movvy account` |
| `02-magic-link.html` | Magic Link | `Your Movvy sign-in link` |
| `03-reset-password.html` | Reset Password | `Reset your Movvy password` |
| `04-change-email.html` | Change Email Address | `Confirm your new Movvy email` |

## SMTP settings (configure once)

Before any of these will go out, configure SMTP under
**Authentication → Settings → SMTP Settings**:

- **Host:** `smtp.resend.com`
- **Port:** `465` (or `587` with STARTTLS)
- **Username:** `resend`
- **Password:** your Resend production API key (`re_...`)
- **Sender email:** `hello@movvy.ca`
- **Sender name:** `Movvy`

## Merge variables Supabase exposes

- `{{ .ConfirmationURL }}` — the magic link / verify URL
- `{{ .Token }}` — the 6-digit OTP code (use this for SMS-style code emails)
- `{{ .TokenHash }}` — hashed version, for the URL fallback
- `{{ .SiteURL }}` — `movvy.ca`
- `{{ .Email }}` — recipient's address
- `{{ .NewEmail }}` — used in the change-email template

## Reset password — applied 2026-08-04

The live template was still shipping `{{ .ConfirmationURL }}`, which is a PKCE
link: it can only be redeemed by the browser that requested the reset. Opening
it from webmail, a phone, or a second browser failed with "This link must be
opened in the same browser you requested the reset from."

It now links to:

    {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery

`.TokenHash` verifies server-side with no local code-verifier, so the link works
from any browser or device. `.RedirectTo` keeps one template correct for both
surfaces — the console sends its own origin (movvy.ca in prod, localhost in
dev), the mobile app sends `movvy://reset-password`.

The previous live content is kept in `03-reset-password.PREVIOUS-LIVE.html` in
case it ever needs restoring.
