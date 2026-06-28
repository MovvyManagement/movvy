# Certn integration notes (future)

When to swap the manual runbook for automated Certn checks, and the
30-minute change list to make that swap clean.

## When to swap

Trigger any of these and it's time:

- **Volume:** >30 new partner applications per month — manual workflow
  becomes a real time sink for the founder
- **Speed:** A partner is dropping off because they don't want to wait
  5-15 days for a CPIC result. Certn returns clean checks in **minutes**
- **Compliance:** A real moving-industry insurer requires Certn (or
  equivalent) attestation as a condition of underwriting. Some do.

Certn pricing as of mid-2026: ~$25 per standard CPIC + driver abstract,
billed monthly. Roughly equivalent to the manual cost but ~100× faster.

## What's already in place to make the swap easy

The schema and code were designed for this. The hot-swap is:

| Manual now | Certn after |
|---|---|
| Admin types status into the UI | Certn webhook updates status automatically |
| `provider = 'manual'` on the row | `provider = 'certn'` + `provider_ref` = Certn's report ID |
| Consent collected via email reply | Consent collected via Certn's hosted consent page |
| Results stored as a PDF the admin uploads | Result PDF URL stored as the Certn report URL |

The `background_checks` table already has every column needed.
The `admin-set-background-check` endpoint stays as-is for manual overrides.

## Files to add for Certn integration

When ready, create:

1. **`supabase/functions/partner-request-background-check/index.ts`**
   Initiated by admin from the approvals UI. Calls Certn's `/applicants`
   API, creates a `background_checks` row with `status='consent_pending'`,
   stores the Certn `applicant_id` in `provider_ref`.

2. **`supabase/functions/certn-webhook/index.ts`**
   Public endpoint Certn posts to when an application is updated.
   Verifies their HMAC signature, updates the `background_checks` row's
   status + result fields. Mirrors the pattern in `resend-webhook`.

3. **Add to admin UI:** "Send Certn invite" button in the BackgroundCheckPanel
   that calls the new `partner-request-background-check` endpoint. After
   click, the panel shows "Awaiting partner consent — Certn invite sent
   to <partner email>".

4. **Set secrets:**
   ```
   supabase secrets set CERTN_API_KEY=<from Certn dashboard>
   supabase secrets set CERTN_WEBHOOK_SECRET=<from Certn dashboard>
   supabase secrets set CERTN_PACKAGE_ID=<Certn-side package config>
   ```

5. **Test:** create a sandbox partner, send invite, walk through the
   Certn consent flow, confirm the webhook updates the row, confirm
   the admin UI shows the Certn report URL.

## Why we're NOT building this now

- Pre-launch: no partners means nothing to check
- First 30 partners are friend-of-founder; manual flow is faster
  because the founder already knows them
- Certn $25 × 0 partners = $0 savings to automate vs. ~$25 × 30 = $750
  to defer
- The manual flow is the same process Certn runs under the hood
  (CPIC + driver abstract) — there's no quality difference, just speed

Add this to the founder's quarterly review checklist: "If we did >30
partner applications last quarter, prioritize the Certn swap." Until
then, manual runbook + admin UI is the right call.
