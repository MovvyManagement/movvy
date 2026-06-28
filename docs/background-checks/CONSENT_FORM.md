# Background check consent form (template)

Copy-paste this into an email to the partner OR upload to DocuSign/HelloSign
for a digital-signature workflow. PIPEDA-compliant under Section 7 (consent
for collection, use, and disclosure of personal information).

---

## Email subject

`Movvy: Please review + sign — background check consent`

---

## Email body

```
Hi [PARTNER_FULL_NAME],

Before we can approve your application to drive with Movvy, we need your
written consent to run two standard background checks:

  1. Canadian criminal record check (CPIC) — through an authorized
     provider or your local police station.
  2. Alberta driver's abstract — through Alberta Registries.

Both checks are standard for any moving-marketplace gig in Alberta. We
need them to keep customers safe and to comply with our $2M insurance
policy.

────────────────────────────────────────────────────────────────────────
WHAT WE DO WITH THE RESULTS
────────────────────────────────────────────────────────────────────────

  • Stored encrypted in Supabase Storage, accessible only to Movvy
    admins and you (via the Movvy app)
  • Used solely to decide whether to approve your application and to
    re-verify every 12 months
  • Never shared with customers, insurance, or any third party (except
    when legally compelled by a court order or by law enforcement
    pursuing a specific investigation)
  • Purged from our systems 24 months after you leave the platform

────────────────────────────────────────────────────────────────────────
YOUR RIGHTS UNDER PIPEDA
────────────────────────────────────────────────────────────────────────

  • You can withdraw consent at any time by emailing
    support@movvy.ca — but withdrawing means we can't keep you on the
    platform.
  • You can request a copy of any check we've run on you.
  • You can challenge the accuracy of any result we hold and ask us to
    correct it.
  • Full privacy policy at https://movvy.ca/privacy

────────────────────────────────────────────────────────────────────────
TO CONSENT
────────────────────────────────────────────────────────────────────────

Reply to this email with the following four lines, exactly as written
below — typed (or a digital signature):

----- COPY BELOW THIS LINE -----

  I, [YOUR FULL NAME], consent to Movvy Technologies Inc. obtaining
  a Canadian criminal record check (CPIC) and Alberta driver's abstract
  on me, for the purposes of evaluating my application to the Movvy
  platform.

  Date: [TODAY'S DATE]
  Signature: [YOUR FULL NAME, TYPED]

----- COPY ABOVE THIS LINE -----

Once we receive your consent, we'll send instructions for how to obtain
each report. Most partners complete both within 5-7 business days.

If you have any questions before consenting, just reply to this email —
a human will respond within a business day.

Thanks,
The Movvy Partner Onboarding team
partner@movvy.ca
```

---

## What the admin does with the reply

1. Save the email reply (or signed PDF) to Supabase Storage:
   - Bucket: `partner-docs`
   - Path: `consent/<team_or_company_id>.pdf`
   (You can convert an email to PDF via Print → Save as PDF.)

2. Open admin approvals → applicant detail → Background Check panel.

3. Click **"Mark consent received"**. This logs the consent timestamp +
   IP into `background_checks.consent_signed_at` for the audit trail.

4. Proceed with running the actual checks per the runbook.

---

## Storing consent in a regulator-defensible way

The minimum we need to defend against a future complaint:

- **What** they consented to (the exact text above)
- **When** they consented (timestamp, captured by the system)
- **How** they consented (typed name in reply email — not a checkbox)
- **Who** received it (Movvy support — `consent_received_at` audit log)

PIPEDA Compliance Officer for Movvy is the founder (until we hire a
DPO). Complaints can be escalated to the **Office of the Privacy
Commissioner of Canada** at <https://priv.gc.ca>.
