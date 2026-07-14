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
      'Account & identity: your name, email, phone, city, role, and a securely hashed password.',
      'Partner/Crew verification (Movers & Companies only): business, vehicle, and document info, and background-check status where applicable.',
      'Move info: pickup + drop-off addresses, dates, item lists, access notes, and messages to your Crew or support.',
      'Location: approximate location when you book; live GPS only during an active move and only if you grant permission.',
      "Payment info: if and when you pay in-app, card details are handled by a third-party PCI-DSS-compliant payment processor. We do NOT collect or store full card numbers — only non-sensitive transaction records for accounting.",
      'Communications: in-app chat, support messages, and masked call/SMS metadata (time, duration, parties connected).',
      'Device & usage: app version, OS, device identifiers, IP address, crash logs, and basic analytics.',
    ],
  },
  {
    title: '2. How we use it',
    body: [
      'To deliver the service: match you with a Crew, calculate hourly pricing, enable tracking and masked communication, process payments, and send move-status updates.',
      'To keep the platform safe: identity/eligibility checks, fraud prevention, rate limiting, and audit logging.',
      'To provide support, including an AI-assisted assistant that answers questions and escalates to a human (see section 4).',
      'To improve the product using aggregated, de-identified usage data.',
      'To meet legal and tax obligations, and to respond to lawful requests.',
    ],
  },
  {
    title: '3. Who we share it with',
    body: [
      'The Crew assigned to your move — limited to your name, pickup/drop-off, access notes, and a masked phone connection (your real number is never shared).',
      'Service providers who power Movvy, bound by contract to process data only on our behalf: Supabase (database/auth/storage, Canada), Twilio (SMS + masked calling), Google Maps (geocoding/routing), Resend (email), Anthropic (AI support), Expo/Vercel (push + web hosting), a background-check provider (Crews only, if enabled), and a payment processor (only if in-app payments are enabled).',
      'Authorities where required by law, court order, or valid law-enforcement request, or to protect the safety and rights of users, the public, or Movvy.',
      'A successor entity in a merger, financing, or sale of assets, subject to this policy.',
      'We do NOT sell or rent your personal information, and we do NOT share it with advertising networks.',
    ],
  },
  {
    title: '4. AI-assisted support',
    body: [
      'Support chats may first be answered by an automated assistant that can respond to common questions and escalate to a human when needed.',
      'The content of your support messages and limited move context may be processed by our AI provider (Anthropic) and reviewed by Movvy staff for quality and resolution. It is not used to train third-party models.',
      "Please don't include payment-card numbers or unnecessary sensitive information in support chat.",
    ],
  },
  {
    title: '5. Where it lives (cross-border)',
    body: [
      'Primary data is stored in Canada (Supabase, Central region); backups are encrypted and stored in Canadian cloud regions.',
      'Some providers (telephony, mapping, email, AI, push, hosting) may process limited information outside Canada, including in the United States, where it may be accessible to that country’s authorities under its laws.',
      'We use providers that offer appropriate contractual and security protections.',
    ],
  },
  {
    title: '6. How long we keep it',
    body: [
      'Active account data: as long as your account exists.',
      'Completed move records + invoices: about 7 years (Canadian tax requirement).',
      'Audit logs: about 1 year, then purged.',
      'Delete your account any time from the mobile app — Profile → Delete account. We remove or de-identify your data, except records we must keep for legal, tax, or fraud-prevention reasons.',
    ],
  },
  {
    title: '7. How we protect it',
    body: [
      'Row-level security on every database table, encryption in transit and at rest, secure on-device credential storage (iOS Keychain / Android Keystore), rate limiting, access controls, and audit logging.',
      'If a breach creates a real risk of significant harm, we will notify affected individuals and the Office of the Privacy Commissioner of Canada as required by PIPEDA.',
    ],
  },
  {
    title: '8. Your rights under PIPEDA',
    body: [
      'Access: request a copy of the personal data we hold about you.',
      'Correct: update inaccurate data via the in-app profile editors.',
      'Withdraw consent & delete your account at any time, subject to legal and contractual limits.',
      'Complain to our Privacy Officer, and to the Office of the Privacy Commissioner of Canada (priv.gc.ca), if you believe your rights have been violated.',
    ],
  },
  {
    title: '9. Children',
    body: [
      'The Services are intended for adults 18 and older. We do not knowingly collect personal information from children, and will delete it if we learn we have.',
    ],
  },
  {
    title: '10. Cookies & analytics',
    body: [
      'The Movvy mobile app uses minimal local storage for session tokens.',
      'This website (movvy.ca) uses only essential cookies. No third-party advertising trackers.',
    ],
  },
  {
    title: '11. Contact',
    body: [
      'Privacy Officer / privacy requests & complaints: management@movvy.ca.',
      'General support: support@movvy.ca.',
      'Office of the Privacy Commissioner of Canada: priv.gc.ca.',
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
