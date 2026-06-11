// =============================================================================
// Terms of Service
//
// The exact text in this file is the binding agreement. Any wording change
// MUST bump TERMS_EFFECTIVE_DATE + TERMS_VERSION in src/lib/brand.ts so the
// signup write records which revision the user accepted. Section 14 of the
// text itself describes the re-prompt obligation.
//
// Sections are extracted into a TERMS array so the rendered layout stays in
// sync with the source text — nothing styled inline.
// =============================================================================

import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/brand';

interface Section {
  number: string;
  title: string;
  /** Paragraphs of plain text. Bullet lists are typed as string[] inside. */
  body: Array<string | string[]>;
}

const TERMS: Section[] = [
  {
    number: '1',
    title: 'Acceptance of Terms',
    body: [
      'By downloading, accessing, or using the Movvy mobile application ("App"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the App.',
    ],
  },
  {
    number: '2',
    title: 'About Movvy',
    body: [
      'Movvy is a technology platform that connects customers who need moving services ("Customers") with independent moving professionals and companies ("Movers"). Movvy is a marketplace intermediary — it does not itself provide moving services and is not responsible for the acts or omissions of Movers.',
    ],
  },
  {
    number: '3',
    title: 'Eligibility',
    body: [
      'You must be at least 18 years old and legally capable of entering into a binding contract to use Movvy. By using the App, you represent that you meet these requirements.',
    ],
  },
  {
    number: '4',
    title: 'User Accounts',
    body: [
      [
        'You must provide accurate, current, and complete information when creating an account.',
        'You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.',
        'You must notify us immediately at support@movvy.ca if you suspect unauthorized access.',
        'We reserve the right to suspend or terminate accounts that violate these Terms.',
      ],
    ],
  },
  {
    number: '5',
    title: 'User Types and Specific Obligations',
    body: [
      '5.1 Customers',
      [
        'You agree to provide accurate pickup/drop-off addresses, item descriptions, and scheduling information when creating a booking.',
        'You agree to be present or have an authorized representative present at the time of the move.',
        'You are responsible for ensuring items are legally owned or authorized for transport.',
        'You agree not to book services for the transport of prohibited, hazardous, or illegal items.',
      ],
      '5.2 Movers (Partner Teams and Companies)',
      [
        "You must complete Movvy's onboarding process, including providing accurate personal, vehicle, and document information.",
        'You represent that you hold all required licenses, insurance, and permits to provide moving services in your jurisdiction.',
        'You agree to pass any background checks required by Movvy as a condition of access.',
        'You are an independent contractor, not an employee, agent, or partner of Movvy. You are solely responsible for your taxes, insurance, and compliance with applicable law.',
        'You agree to treat Customers and their property with care and professionalism.',
      ],
    ],
  },
  {
    number: '6',
    title: 'Bookings and Payments',
    body: [
      [
        'Bookings are confirmed once accepted by a Mover through the App.',
        'Pricing is calculated based on the details provided at the time of booking. Final charges may reflect actual time, distance, or additional services.',
        "All payments are processed through Movvy's payment infrastructure. By making or receiving payment through the App, you agree to the terms of our payment processor.",
        'Movvy charges a platform fee on each transaction, deducted before Mover payouts.',
        'Cancellation policies and refund eligibility will be displayed at the time of booking.',
      ],
    ],
  },
  {
    number: '7',
    title: 'Ratings and Reviews',
    body: [
      'Both Customers and Movers may be rated after a completed booking. Ratings must be honest and in good faith. Movvy reserves the right to remove reviews that are fraudulent, abusive, or in violation of these Terms.',
    ],
  },
  {
    number: '8',
    title: 'Prohibited Conduct',
    body: [
      'You agree not to:',
      [
        'Use the App for any unlawful purpose.',
        'Misrepresent your identity, qualifications, or the items to be moved.',
        'Harass, threaten, or harm other users.',
        'Circumvent the App to arrange or pay for services outside the Movvy platform.',
        'Attempt to reverse-engineer, scrape, or otherwise interfere with the App.',
        'Post false reviews or manipulate ratings.',
      ],
    ],
  },
  {
    number: '9',
    title: 'Disputes Between Users',
    body: [
      "Movvy provides a disputes mechanism within the App to help resolve issues between Customers and Movers. Movvy may, at its sole discretion, mediate disputes but is under no obligation to do so and makes no guarantee of any particular outcome. Movvy's decisions in disputes are final within the platform.",
    ],
  },
  {
    number: '10',
    title: 'Limitation of Liability',
    body: [
      'To the maximum extent permitted by law:',
      [
        'Movvy is not liable for any damage to property, personal injury, or loss arising from a move arranged through the platform.',
        "Movvy's total aggregate liability to you for any claim arising under these Terms will not exceed the amount you paid to Movvy in the 30 days preceding the claim.",
        'Movvy is not liable for indirect, incidental, consequential, or punitive damages of any kind.',
      ],
    ],
  },
  {
    number: '11',
    title: 'Indemnification',
    body: [
      'You agree to indemnify and hold harmless Movvy and its officers, directors, employees, and agents from any claims, losses, or damages (including legal fees) arising from your use of the App, your violation of these Terms, or your interactions with other users.',
    ],
  },
  {
    number: '12',
    title: 'Privacy',
    body: [
      'Your use of Movvy is subject to our Privacy Policy, which is incorporated into these Terms by reference. By using the App, you consent to the collection, use, and sharing of your information as described in the Privacy Policy.',
    ],
  },
  {
    number: '13',
    title: 'Intellectual Property',
    body: [
      'All content, trademarks, and technology in the App are owned by or licensed to Movvy. You may not reproduce, distribute, or create derivative works without our express written permission.',
    ],
  },
  {
    number: '14',
    title: 'Modifications to Terms',
    body: [
      'We may update these Terms from time to time. We will notify you of material changes through the App or by email. Continued use of the App after changes take effect constitutes acceptance of the updated Terms.',
    ],
  },
  {
    number: '15',
    title: 'Termination',
    body: [
      'Movvy may suspend or terminate your access to the App at any time, with or without cause, and with or without notice. Provisions that by their nature should survive termination (including Sections 10, 11, and 13) will survive.',
    ],
  },
  {
    number: '16',
    title: 'Governing Law and Disputes',
    body: [
      'These Terms are governed by the laws of the Province of Alberta and the federal laws of Canada applicable therein. Any disputes arising under these Terms will be subject to the exclusive jurisdiction of the courts located in Calgary, Alberta.',
    ],
  },
  {
    number: '17',
    title: 'Contact',
    body: [
      'For questions about these Terms, contact us at:',
      'Movvy',
      'support@movvy.ca',
      'Calgary, Alberta, Canada',
    ],
  },
];

export default function TermsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader title="Terms of Service" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text className="text-3xl font-bold text-ink-900 mt-2">Terms of Service</Text>
        <Text className="mt-1 text-sm text-silver-500">Movvy</Text>
        <Text className="mt-3 text-xs font-semibold uppercase tracking-wider text-silver-500">
          Effective {TERMS_EFFECTIVE_DATE} · v{TERMS_VERSION}
        </Text>

        {TERMS.map((s) => (
          <View key={s.number} className="mt-6">
            <Text className="text-lg font-bold text-ink-900">
              {s.number}. {s.title}
            </Text>
            {s.body.map((chunk, idx) => {
              // Array → bullet list. String → paragraph (sub-heading detection
              // is loose: a short string ending without punctuation that starts
              // with a digit-dot is treated as a sub-heading and bolded).
              if (Array.isArray(chunk)) {
                return (
                  <View key={idx} className="mt-2 gap-2">
                    {chunk.map((item, i) => (
                      <View key={i} className="flex-row">
                        <Text className="text-sm text-ink-800 leading-6 mr-2">•</Text>
                        <Text className="flex-1 text-sm text-ink-800 leading-6">{item}</Text>
                      </View>
                    ))}
                  </View>
                );
              }
              const isSubheading = /^\d+\.\d+\s/.test(chunk);
              return (
                <Text
                  key={idx}
                  className={`mt-3 text-sm leading-6 ${
                    isSubheading ? 'font-bold text-ink-900' : 'text-ink-800'
                  }`}
                >
                  {chunk}
                </Text>
              );
            })}
          </View>
        ))}

        <View className="mt-10 pt-6 border-t border-silver-200">
          <Text className="text-xs text-silver-500 text-center">© Movvy. All rights reserved.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
