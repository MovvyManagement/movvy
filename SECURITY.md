# Security posture

Living checklist for the Movvy security model. Pair with
[CLAUDE_SAFETY.md](CLAUDE_SAFETY.md) (cost-protection rules) and the
defence-in-depth chapter in [BACKEND.md](BACKEND.md).

---

## Auth (Supabase GoTrue)

Configured in [supabase/config.toml](supabase/config.toml). Verify these
match in the dashboard for every project — local config alone is not enough.

| Setting | Movvy value | Why |
|---|---|---|
| Minimum password length | 10 | Industry baseline; we also require mixed case, digits, symbols |
| HaveIBeenPwned check | on | Block known-breached passwords on signup + change |
| JWT TTL | 1 h | Short-lived access tokens |
| Refresh rotation | on (10 s reuse window) | Detect token theft |
| Email change | double-confirm | Old + new must confirm; stops stolen-session email pivots |
| `email_change_token` expiry | 10 min | Tight link-validity window |
| OTP length / TTL | 6 digits / 10 min | Password resets + email verify |
| Lockout | 6 attempts / 15 min | Brute-force throttle at the Auth layer |
| MFA (TOTP) | enroll enabled, verify enabled | Admins must enroll; drivers/customers may opt in |
| Anonymous sign-ins | disabled | Not part of our model |
| Manual user linking | disabled | Only admin-API can link identities |

### MFA enforcement

- **`movvy_admin` + `movvy_support`** — required. The shared
  `requireAuth()` helper in
  [supabase/functions/_shared/security.ts](supabase/functions/_shared/security.ts)
  inspects `app_metadata.amr` and rejects calls with no `totp` factor in the
  last 24 h for these roles.
- **`company_owner`, `company_dispatcher`, `driver`** — opt in. Profile →
  Security → "Enable 2FA". Recommended for owners + dispatchers.
- **`customer`** — opt in. Surfaced from Profile after the third completed
  booking so we're not pushing it at signup.

### Password reuse

GoTrue's `secure_password_change = true` blocks changing the password
without re-entering the current one. Combined with the HaveIBeenPwned
check it covers the OWASP A07 baseline.

### Rate limits

| Endpoint | Limit | Bucket |
|---|---|---|
| Email send (auth) | 30 / hr | per IP |
| Sign-in / sign-up | 30 / 5 min | per IP |
| Token refresh | 150 / 5 min | per IP |
| `bookings-create` | 5 / hr | per user |
| `bookings-update-status` | 60 / hr | per user |
| `tracking-ping` | 720 / hr | per user |
| `chat-send` | 60 / min | per user |
| Geocoding / Routes | 30 / min, 200 / day | per user + per IP |

Add a new limit by calling
[`checkRateLimit`](supabase/functions/_shared/security.ts) — never hand-roll.

---

## Storage

| Bucket | Size cap | Mime allow-list | RLS |
|---|---|---|---|
| `verifications` | 20 MB | jpg/png/heic/webp/pdf | owner-only + admin |
| `profile-photos` | 5 MB | jpg/png/heic/webp | owner-only |
| `move-photos` | 15 MB | jpg/png/heic/webp/mp4/mov | booking participants |
| `company-photos` | 5 MB | jpg/png/webp | company members |

Object paths are scoped by `auth.uid()` in the first folder segment —
enforced by Storage RLS in [0007_storage.sql](supabase/migrations/0007_storage.sql).

---

## Audit log

Every sensitive op writes to `audit_logs` via
[`audit()`](supabase/functions/_shared/security.ts) — append-only, indexed by
actor + entity. Read access is admin-only (no INSERT/UPDATE/DELETE policy =
service-role-only writes). Retention: 1 year via `job_prune_audit_logs` cron.

---

## CSP (admin web target)

The customer + driver mobile apps don't run a webview off-domain. The web
admin (`admin.movvy.app`, deployed via `expo export --platform web`)
serves a strict CSP:

```
default-src 'self';
script-src 'self' https://*.supabase.co https://*.expo.dev 'sha256-...';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://*.supabase.co https://*.cloudflarestorage.com;
connect-src 'self' https://*.supabase.co https://api.expo.dev wss://*.supabase.co;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

Headers are set by the static host (Cloudflare Pages / Vercel) in front of
the exported bundle. Verify on every release via:

```bash
curl -I https://admin.movvy.app | grep -i content-security-policy
```

---

## Incident response

Quick kill-switches (see also [CLAUDE_SAFETY.md](CLAUDE_SAFETY.md)):

```sql
-- Stop all paid Google calls instantly
update feature_flags set enabled = false where key like 'google_%';

-- Zero out today's budget on any service
update api_budgets set daily_cap_usd = 0 where service = 'google_places';

-- Suspend a user
update profiles set is_suspended = true, suspended_at = now() where id = '<uuid>';
```

Rotate `service_role` from Supabase dashboard → Settings → API → Rotate
if you suspect compromise. Every edge function uses the same env var so a
single rotation revokes them all.

---

## Backups

- Supabase daily snapshot retained 7 days (Pro tier).
- Movvy-managed nightly `pg_dump` to S3 / R2 via
  [.github/workflows/db-backup.yml](.github/workflows/db-backup.yml).
  Encrypted at rest with `age` so the dump is useless without the
  recipient key.
- Quarterly restore drill: `pg_restore` into a sandbox project, verify a
  recent booking + the `audit_logs` chain.
