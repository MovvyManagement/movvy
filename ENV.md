# Environments

Movvy runs three logical environments. **Never seed against prod.**

| Env | Supabase project | EAS profile | Sentry env | Branch |
|---|---|---|---|---|
| `development` | local (`supabase start`) or shared dev project | `development` | `development` | feature branches |
| `staging` | dedicated `movvy-staging` project | `staging` | `staging` | `main` |
| `production` | `movvy-prod` project | `production` | `production` | git tags `v*` |

The mobile app picks up the right backend from `EXPO_PUBLIC_SUPABASE_URL` +
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, which `eas.json` rewrites per profile from
GitHub Actions secrets (`STAGING_SUPABASE_*`, `PROD_SUPABASE_*`).

---

## Setting up a staging Supabase project

1. **Create the project**
   - Supabase dashboard → New project
   - Name: `movvy-staging`
   - Region: same as prod (`ca-central-1`)
   - Save the DB password somewhere safe (1Password / Bitwarden)

2. **Link your CLI**

   ```bash
   supabase link --project-ref STAGING_REF
   ```

3. **Push the schema**

   ```bash
   supabase db push
   ```

4. **Deploy edge functions**

   ```bash
   ./scripts/deploy-functions.sh
   ```

5. **Set secrets** (per-environment)

   ```bash
   supabase secrets set --project-ref STAGING_REF \
     SUPABASE_URL=https://STAGING_REF.supabase.co \
     SUPABASE_ANON_KEY=eyJ... \
     SUPABASE_SERVICE_ROLE_KEY=eyJ...
   # Add optional paid-API keys ONLY if you want them active in staging
   # (most should stay disabled via feature_flags — same posture as prod).
   ```

6. **Seed demo data — STAGING ONLY**

   ```bash
   APP_ENV=staging node scripts/seed-demo.mjs
   ```

   The seed script must refuse to run when `APP_ENV=production` — defence
   against running it against the wrong project by accident.

7. **Add the URLs + keys to GitHub Actions secrets**

   Repo → Settings → Secrets and variables → Actions → New repository secret

   | Name | Value |
   |---|---|
   | `STAGING_SUPABASE_URL` | `https://STAGING_REF.supabase.co` |
   | `STAGING_SUPABASE_ANON_KEY` | anon publishable key |
   | `STAGING_SUPABASE_SERVICE_ROLE_KEY` | service role (for nightly backups + cron jobs) |
   | `PROD_SUPABASE_URL` | `https://PROD_REF.supabase.co` |
   | `PROD_SUPABASE_ANON_KEY` | anon publishable key |
   | `PROD_SUPABASE_SERVICE_ROLE_KEY` | service role |
   | `PROD_DB_URL` | `postgresql://postgres:<pwd>@db.PROD_REF.supabase.co:5432/postgres` (for `pg_dump`) |
   | `BACKUP_S3_BUCKET` | `s3://movvy-backups` |
   | `BACKUP_AWS_KEY_ID` / `_SECRET` | nightly backup credentials |
   | `EXPO_TOKEN` | `eas account:create-token` |
   | `APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_ASC_APP_ID` | App Store submit |
   | `GOOGLE_PLAY_KEY_B64` | base64 of `play-service-account.json` |

---

## Branch protection + promote-to-prod recipe

- `feature/*` branches → open PR → CI runs typecheck + Maestro on staging
  Supabase → merge to `main` triggers a staging build through `eas-build.yml`
- Cut a release: `git tag v0.2.0 && git push --tags` → tag push triggers
  production build + auto-submit (TestFlight + Play internal track first)
- Promote to public store from EAS dashboard or `eas submit --latest`

## Local override

If you want to point your local Expo session at the staging backend without
editing `.env.local`, run:

```bash
EXPO_PUBLIC_SUPABASE_URL=$STAGING_SUPABASE_URL \
EXPO_PUBLIC_SUPABASE_ANON_KEY=$STAGING_SUPABASE_ANON_KEY \
npx expo start --clear
```
