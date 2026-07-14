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
    title: '1. Acceptance & eligibility',
    body: [
      'By creating an account on, or using, the Movvy application or website, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree, do not use the Services.',
      'You must be at least 18 years old and able to enter a binding contract.',
      'The Services are for moves that both begin and end within the Province of Alberta, Canada.',
    ],
  },
  {
    title: '2. What Movvy is — and is not',
    body: [
      'Movvy is a technology marketplace connecting customers with independent moving providers (the "Crew") in Alberta. We provide booking, scheduling, communication, tracking, payment facilitation, and support tools.',
      'Movvy does NOT provide moving, transportation, or storage services. We are not a moving company, carrier, or employer of any Crew, and we do not handle your goods.',
      'Crews are independent contractors who operate their own businesses. Any screening or ratings we provide are a limited convenience, not a warranty about any Crew.',
    ],
  },
  {
    title: '3. User accounts',
    body: [
      'You must provide accurate, current, and complete information and keep it up to date.',
      'You are responsible for your login credentials and all activity under your account. Notify us immediately at support@movvy.ca if you suspect unauthorized access.',
      'We may suspend or terminate accounts that violate these Terms or raise safety, fraud, or legal concerns.',
    ],
  },
  {
    title: '4. Customer responsibilities',
    body: [
      'Provide accurate addresses, access details (stairs, elevators, parking), item lists, and scheduling info.',
      'Be present, or have an authorized adult present, for the move and provide safe, lawful access to both locations.',
      'Only present items you own or are authorized to move, and never present prohibited or hazardous items (section 9).',
    ],
  },
  {
    title: '5. Crew (Partner) responsibilities',
    body: [
      'Complete onboarding with accurate identity, vehicle, insurance, and document information, and pass any required checks.',
      'Hold and maintain all licences, registrations, and commercial liability insurance required to lawfully provide moving services in Alberta.',
      'Act as an independent contractor responsible for your own taxes and compliance, and perform services with reasonable skill, care, and professionalism.',
    ],
  },
  {
    title: '6. Honest hourly pricing & payment',
    body: [
      'Pricing is hourly, based on the actual time the Crew spends, plus any clearly disclosed travel/materials fees and applicable GST/HST. No deposit is required to book, and there are no hidden or surprise upcharges.',
      'Estimates shown before or during a booking are non-binding; the final amount reflects actual time. Movvy calculates pricing on the server.',
      'Payment is due on completion and is processed through the App by a third-party PCI-DSS-compliant payment processor, or another method disclosed at booking. Movvy does not store full card numbers. Tips are optional and go fully to the Crew.',
    ],
  },
  {
    title: '7. Cancellations',
    body: [
      'Customer cancellations more than 48 hours before the scheduled start are free. Cancellations within 48 hours may incur a reasonable fee disclosed at booking.',
      'If you are not present or cannot provide access at the scheduled time, a reasonable wait, trip, or cancellation fee may apply.',
      'Movvy may cancel a booking for safety, legal, fraud, weather, or operational reasons; you are not charged for services not performed.',
    ],
  },
  {
    title: '8. Insurance, damage & claims',
    body: [
      'The Crew that performs a move is primarily responsible for loss or damage it causes. Movvy does not handle your goods and is not the mover, carrier, or insurer.',
      'Movvy requires Crews to represent that they carry commercial liability insurance meeting our minimum standards; coverage and outcomes are determined by the Crew and its insurer.',
      'Inspect your items at completion. To use the in-app claims process, open a claim through support within 7 days of the move with reasonable evidence. Cash, jewellery, documents, and undisclosed high-value items may be excluded or limited.',
    ],
  },
  {
    title: '9. Prohibited items & conduct',
    body: [
      'You may not present, and a Crew may refuse, any illegal, unsafe, or hazardous item (e.g., firearms, explosives, flammable or corrosive materials, contraband, live animals, perishables).',
      'You agree not to use the Services unlawfully, harass or harm any user, post false reviews, or circumvent the App to arrange or pay for services off-platform to avoid fees.',
      'Movvy may remove any user for violations and report unlawful activity to authorities.',
    ],
  },
  {
    title: '10. Communications & AI-assisted support',
    body: [
      'By creating an account you consent to receive essential service messages (one-time passcodes, move updates, receipts). Message and data rates may apply. You may opt out of optional marketing at any time.',
      'Calls and texts between customers and Crews are connected through a number-masking provider, so real numbers are not shared; metadata may be logged for safety and disputes.',
      'Support may first be handled by an automated assistant that can escalate to a human. Support messages may be processed by a third-party AI service and reviewed by staff. Do not send card numbers in support chat.',
    ],
  },
  {
    title: '11. Disclaimers & limitation of liability',
    body: [
      'The Services are provided "as is" and "as available" without warranties of any kind, to the maximum extent permitted by law.',
      'Movvy is not liable for indirect, incidental, special, consequential, or punitive damages. Our total aggregate liability for any claim is limited to the greater of the platform fees you paid Movvy in the 90 days before the claim, or CAD $100.',
      'Nothing limits rights that cannot be waived under Alberta consumer-protection or privacy law, or liability for gross negligence, willful misconduct, or personal injury caused by our negligence where such limits are prohibited.',
    ],
  },
  {
    title: '12. Indemnification, changes & termination',
    body: [
      'You agree to indemnify Movvy from claims arising out of your use of the Services, your violation of these Terms, your content, or your interactions with other users.',
      'We may update these Terms; for material changes we will provide notice, and continued use after the effective date constitutes acceptance.',
      'You may delete your account at any time. We may suspend or terminate access for violations, safety, fraud, or legal reasons; sections that should survive termination do.',
    ],
  },
  {
    title: '13. Governing law & contact',
    body: [
      'These Terms are governed by the laws of Alberta and the federal laws of Canada applicable there. Before any legal proceeding, contact management@movvy.ca and attempt to resolve the dispute in good faith for 30 days; the courts of Calgary, Alberta have exclusive jurisdiction, subject to non-waivable rights.',
      'Questions about these Terms? Email support@movvy.ca. For legal, privacy, or law-enforcement matters, email management@movvy.ca.',
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
