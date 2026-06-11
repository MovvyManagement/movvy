// =============================================================================
// /privacy — Privacy Policy.
//
// Referenced from the customer profile in the mobile app. PIPEDA-aware
// (Canadian Personal Information Protection and Electronic Documents Act)
// since the company is incorporated in Alberta.
// =============================================================================

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    "How Movvy collects, uses, stores, and shares your information. PIPEDA-compliant.",
};

const sections = [
  {
    title: '1. What we collect',
    body: [
      'Account info: your name, email, phone, and city.',
      'Move info: pickup + drop-off addresses, scheduled date, and notes you provide to your Crew.',
      "Payment info: handled by our PCI-compliant payment processor; we don't store full card numbers.",
      'Device + usage: app version, OS, device identifiers, crash logs, and basic analytics (page views, feature usage).',
      'Location: approximate location when you book; live GPS only during an active move and only if you grant permission.',
    ],
  },
  {
    title: '2. How we use it',
    body: [
      'To deliver the service: match you with a Crew, calculate pricing, process payments, and send move-status updates.',
      'To improve the product: aggregated, anonymized usage data informs roadmap decisions.',
      'To prevent fraud and abuse: rate limiting, identity verification, and audit logs.',
      'For required legal disclosures (court order, valid law-enforcement request).',
    ],
  },
  {
    title: '3. Who we share it with',
    body: [
      'The Crew assigned to your move (limited to your name, pickup, drop-off, phone via masked proxy).',
      'Service vendors who power Movvy (Supabase for data, Stripe for payments, Resend for email, Twilio for SMS) — bound by contract to only process data on our behalf.',
      'No advertising networks. We do not sell or rent your personal information.',
    ],
  },
  {
    title: '4. Where it lives',
    body: [
      'Primary data is stored in Supabase data centers in Canada (Central region).',
      'Backups are encrypted and stored in Canadian cloud regions.',
      'Email + SMS may be processed in vendor regions outside Canada but contents are limited to non-sensitive transactional notifications.',
    ],
  },
  {
    title: '5. How long we keep it',
    body: [
      'Active account data: as long as your account exists.',
      'Completed move records + invoices: 7 years (Canadian tax requirement).',
      'Audit logs: 1 year, then purged.',
      'Delete your account any time from the mobile app — Profile → Delete account. Move history is anonymized but retained for accounting; everything else is removed.',
    ],
  },
  {
    title: '6. Your rights under PIPEDA',
    body: [
      'You may request a copy of the personal data we hold on you.',
      'You may correct inaccurate data via the in-app profile editors.',
      'You may withdraw consent and delete your account at any time.',
      'You may file a complaint with the Office of the Privacy Commissioner of Canada if you believe your rights have been violated.',
    ],
  },
  {
    title: '7. Cookies + analytics',
    body: [
      'The Movvy mobile app uses minimal local storage for session tokens (iOS Keychain / Android Keystore).',
      'This website (movvy.ca) uses only essential cookies. No third-party advertising trackers.',
    ],
  },
  {
    title: '8. Contact',
    body: [
      'Privacy questions: management@movvy.ca.',
      'General support: support@movvy.ca.',
    ],
  },
];

export default function Privacy() {
  return (
    <article className="bg-white py-16">
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
          Legal
        </p>
        <h1 className="mt-2 text-4xl font-bold text-ink-900">Privacy Policy</h1>
        <p className="mt-3 text-sm text-silver-500">
          Last updated: {new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <p className="mt-6 text-sm leading-6 text-silver-600">
          Movvy Technologies Inc. ("Movvy") respects your privacy and complies with Canada's
          Personal Information Protection and Electronic Documents Act (PIPEDA). This policy
          explains what we collect, why, who sees it, and how to control it.
        </p>

        {sections.map((s) => (
          <section key={s.title} className="mt-10">
            <h2 className="text-xl font-bold text-ink-900">{s.title}</h2>
            <ul className="mt-3 space-y-2">
              {s.body.map((line, i) => (
                <li key={i} className="text-sm leading-6 text-silver-600">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
