# Background check runbook (manual process)

How Movvy verifies a partner before they're allowed on the platform.
**Required before approving any team or company.**

This is the operational SOP for the founder/admin while we're pre-volume.
Once we exceed ~30 partners/month, swap the manual steps for Certn — see
`CERTN_INTEGRATION_NOTES.md` for the swap-in plan.

---

## What gets checked, and why

| Check | Why we need it | Where to get it |
|---|---|---|
| **CPIC criminal record check** | Filters out anyone with a relevant criminal history (theft, assault, fraud) — non-negotiable for someone walking through customers' homes. | Local police station (Calgary Police Service for Calgary, RCMP for rural AB), or via a CRC-authorized provider like BackCheck |
| **Driver's abstract** | Confirms a valid license + flags DUI, suspension, or repeated reckless-driving history. Required because partners drive Movvy customers' belongings. | Alberta Registries (any authorized agent, or online at <https://eservices.alberta.ca>) |
| **Vehicle registration + insurance** | Already covered by the document upload step in onboarding — admin verifies they match the partner's name + are unexpired. | Uploaded by partner during onboarding |
| **Vulnerable-sector check** | NOT required for general moving. Only needed if Movvy ever offers move-in services for assisted living / long-term care facilities. | (Not currently required) |

---

## Step-by-step process

### 1. Partner signs up + uploads their docs
**Where:** mobile app → `/(mover)/onboarding/*`
**What:** ID, driver's license, vehicle insurance, vehicle registration

This already happens. You'll see them in the admin approvals queue at
`/admin-management/approvals`.

### 2. Send the consent form
**Where:** customer support chat (in-app) OR email partner@movvy.ca
**Template:** see `CONSENT_FORM.md` in this folder

Partner replies with a signed copy (digital signature in DocuSign, HelloSign,
or even just a typed name + "I consent" reply is sufficient under PIPEDA).

**Save the signed consent** to Supabase Storage:
- Bucket: `partner-docs`
- Path: `consent/<team_or_company_id>.pdf`

Then in the admin approvals UI for that partner, hit **"Mark consent received"**.
This advances the background check status to `consent_pending`. (TODO: a future
UI improvement should let you upload the PDF straight from the panel.)

### 3. Run the CPIC check

**Option A — Local police (Calgary Police Service)**
1. Send the partner to <https://calgarypolice.ca/community/policing-services/police-information-check.html>
2. They pay $59 + book an appointment
3. Result mailed/emailed within 5-15 business days
4. They forward the result PDF to partner@movvy.ca

**Option B — Online provider (faster, costs more)**
1. Use BackCheck.net or Sterling — instant turnaround for clean records
2. Cost: ~$30-50 per check
3. Movvy pays + bills back via the first job's commission (covered by our
   onboarding cost model)

**While waiting:** hit **"Mark check in progress"** in the admin panel.

### 4. Run the driver's abstract

1. Go to <https://eservices.alberta.ca>
2. Partner self-orders ($25) and forwards the PDF to partner@movvy.ca
3. **What to look for:**
   - License status = `Valid`
   - No DUI/DWI in the last 5 years
   - No more than 3 demerit-incurring violations in the last 24 months
   - Class 5 or higher (for the vehicle they're operating)

### 5. Review the results

When both PDFs are in your inbox:

1. Save both to Supabase Storage: `bucket = partner-docs`, paths
   `cpic/<subject_id>.pdf` and `abstract/<subject_id>.pdf`.
2. Open the admin approvals page for that partner.
3. In the Background Check panel, click one of:
   - **Mark passed ✓** — both PDFs are clean, no concerns
   - **Flag for review** — there's a hit you're not sure about; promotes the
     case for a second-opinion conversation before deciding
   - **Mark failed** — disqualifying result, partner can't be approved
4. Add a short summary in the prompt that pops up — this gets logged for audit.

### 6. Approve or reject the application

Once background check is `passed`, the green Approve button in the
DecisionPanel is safe to use. The admin-verify-partner edge function
fires the `moverApproved` email automatically.

If background check is `failed`, reject the partner with a clear reason —
the `moverApplicationDeclined` email goes out automatically.

---

## Disqualifying convictions (Alberta-specific)

The partner should be **rejected** if their CPIC shows any of:

- **Violent offenses** (assault, robbery, weapons charges) — any time in
  the last 10 years
- **Theft / fraud / break-and-enter** — any time in the last 7 years
- **Sexual offenses** — at any time
- **Drug trafficking** — any time in the last 10 years (simple possession
  is fine)
- **Multiple impaired driving** — any time in the last 5 years (single
  one >5 years ago + clean since = case-by-case)

**Flag (don't auto-fail)** for: anything 7-10 years old, single property
crime with restitution paid, mental-health-related charges that have
been resolved. Use your judgment + ask the partner for context.

---

## Expiry + renewal

Checks expire **12 months after completion** (Alberta CPIC standard,
enforced by `expires_at` column + the `background-check-expiry` cron
that flips status to `expired` every Sunday).

When a partner's check expires:
- They get notified in-app: "Your background check expires in 30 days"
  (TODO: wire this notification)
- They can re-run via the same process above
- Until renewed, the admin UI will block them from accepting new jobs
  (TODO: wire this gate)

---

## Costs — to plan around

| Item | Cost | Who pays |
|---|---|---|
| CPIC via local police | $59 | Movvy covers, deducted from first 2 commissions |
| CPIC via online provider | $30-50 | Same |
| Driver's abstract | $25 | Same |
| **Total per partner** | **~$84-109** | Recoverable in 2-3 jobs at $20-30 commission each |

---

## Compliance notes

- **PIPEDA**: Consent must be explicit, written, and on file before any
  check is initiated. See `CONSENT_FORM.md` for template.
- **Retention**: Background check PDFs stay in Supabase Storage for 24
  months after the partner leaves the platform, then are purged. The
  `background_checks` row stays forever for audit trail.
- **Subject access**: A partner can request a copy of their own check
  results via the in-app support thread. The Subject RLS policy on
  `background_checks` lets them read their own row's metadata; the PDF is
  served via a 24-hour signed Storage URL.
