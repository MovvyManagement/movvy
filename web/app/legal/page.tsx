// =============================================================================
// /legal — Terms of Service.
//
// Referenced from every profile screen in the mobile app via
// Linking.openURL('https://movvy.ca/legal').
//
// Copy ports the same sections the in-app terms.tsx renders. Single source
// of truth lives here; the mobile screen will be updated to fetch from this
// URL in a later pass so legal updates don't require an app store release.
// =============================================================================

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: "Movvy's Terms of Service. The agreement you accepted at signup.",
};

const sections = [
  {
    title: '1. Acceptance of Terms',
    body: [
      'By creating an account or using the Movvy application, you agree to be bound by these Terms of Service and our Privacy Policy.',
      'If you do not agree to these terms, do not use the app.',
    ],
  },
  {
    title: '2. Service Description',
    body: [
      'Movvy is a marketplace connecting customers with independent moving service providers (the "Crew") in Alberta, Canada.',
      'Movvy does not directly provide moving services; we facilitate the connection and handle payment between customers and Crews.',
    ],
  },
  {
    title: '3. User Accounts',
    body: [
      'You must provide accurate, current, and complete information when creating an account.',
      'You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.',
      'You must notify us immediately at support@movvy.ca if you suspect unauthorized access.',
      'We reserve the right to suspend or terminate accounts that violate these Terms.',
    ],
  },
  {
    title: '4. Pricing & Payment',
    body: [
      'Pricing is hourly, based on actual time spent on site by the Crew, plus travel and materials fees.',
      'Estimates shown before booking are non-binding. The final invoice reflects actual hours.',
      'Payment is processed after the move completes. No deposit is required at the time of booking.',
      'Cancellations more than 48 hours before the scheduled move are free. Cancellations inside 48 hours may incur a fee.',
    ],
  },
  {
    title: '5. Insurance & Damage',
    body: [
      'Every Crew on Movvy carries minimum $2,000,000 commercial liability insurance.',
      'In the unlikely event of damage, open a claim through the in-app support flow within 7 days of the move.',
    ],
  },
  {
    title: '6. Conduct',
    body: [
      'You agree not to use Movvy for any unlawful purpose or to harass, threaten, or otherwise harm any other user.',
      'Movvy reserves the right to remove any user from the platform for violations.',
    ],
  },
  {
    title: '7. Limitation of Liability',
    body: [
      'Movvy is not liable for indirect, incidental, or consequential damages arising from your use of the service.',
      'Our maximum aggregate liability to you for any claim is limited to the total amount you paid Movvy in the 12 months preceding the claim.',
    ],
  },
  {
    title: '8. Contact',
    body: [
      'Questions about these Terms? Email support@movvy.ca. For legal or law-enforcement matters, email management@movvy.ca.',
    ],
  },
];

export default function Legal() {
  return (
    <article className="bg-white py-16">
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
          Legal
        </p>
        <h1 className="mt-2 text-4xl font-bold text-ink-900">Terms of Service</h1>
        <p className="mt-3 text-sm text-silver-500">
          Last updated: {new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <p className="mt-6 text-sm leading-6 text-silver-600">
          These Terms of Service ("Terms") govern your access to and use of the Movvy mobile
          application, website, and services (collectively, the "Services") provided by Movvy
          Technologies Inc. ("Movvy", "we", "us", or "our"), incorporated in Alberta, Canada.
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
