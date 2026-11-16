// =============================================================================
// /delete-account — how to delete a Movvy account, with or without the app.
//
// Google Play requires a web page where people can ask for their account and
// data to be deleted without reinstalling the app, and the Data safety form
// links here. Google also wants it to say what is deleted, what is kept, and
// for how long.
//
// The "deleted" list mirrors exactly what account-delete and
// request_account_deletion() do: name, phone and email cleared, saved
// addresses and notification devices removed, sessions revoked, the account
// banned, and the email and phone released for a new sign-up. Keep the two in
// step: if that function changes, change this page.
// =============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Delete your account',
  description: 'How to delete your Movvy account and what happens to your data.',
};

const SUPPORT_EMAIL = 'support@movvy.ca';

export default function DeleteAccount() {
  return (
    <article className="bg-white py-16">
      <div className="mx-auto max-w-3xl px-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Your account</p>
        <h1 className="mt-2 text-4xl font-bold text-ink-900">Delete your Movvy account</h1>
        <p className="mt-4 text-base leading-7 text-silver-600">
          You can delete your account yourself in the Movvy app, or ask us to do it by email. This works the
          same for customers, movers and moving companies.
        </p>

        <section className="mt-10">
          <h2 className="text-xl font-bold text-ink-900">In the app</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-silver-600">
            <li>Open Movvy and sign in.</li>
            <li>Go to the <span className="font-semibold text-ink-900">Profile</span> tab.</li>
            <li>Scroll to the bottom and tap <span className="font-semibold text-ink-900">Delete my account</span>.</li>
            <li>Type the email or phone number on your account to confirm, then tap <span className="font-semibold text-ink-900">Delete my account</span>.</li>
          </ol>
          <p className="mt-3 text-sm leading-6 text-silver-600">
            You&apos;re signed out straight away. If you have a move booked or in progress, finish or cancel it
            first. Movers still assigned to an active move need their crew admin to reassign it.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold text-ink-900">By email</h2>
          <p className="mt-3 text-sm leading-6 text-silver-600">
            If you no longer have the app, email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`} className="font-semibold text-brand-700 underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>{' '}
            with the subject &ldquo;Delete my account&rdquo;. Send it from the email address on your account, or include
            the phone number on your account. We&apos;ll confirm it&apos;s really you before deleting anything, and
            reply once it&apos;s done.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold text-ink-900">What gets deleted</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-silver-600">
            <li>Your name, phone number and email address on your account</li>
            <li>Your saved addresses</li>
            <li>The devices registered to get Movvy notifications</li>
            <li>Your access: you&apos;re signed out everywhere and the account can&apos;t be used again</li>
          </ul>
          <p className="mt-3 text-sm leading-6 text-silver-600">
            Your email and phone number are released, so you can sign up again later with a new account if you
            want to.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold text-ink-900">What we keep, and for how long</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-silver-600">
            <li>
              Records of past moves, payments, receipts and ratings, including the messages exchanged on a move.
              Canadian tax and accounting rules require us to keep business records, generally for six years.
              They&apos;re no longer linked to your name, phone or email.
            </li>
            <li>For movers and companies: verification and payout records, kept with the same business records.</li>
            <li>A security record that the deletion was requested and when.</li>
          </ul>
          <p className="mt-3 text-sm leading-6 text-silver-600">
            Saved payment cards are held by Stripe, our payment processor, not by Movvy. Email us if you&apos;d like
            them removed as well.
          </p>
        </section>

        <p className="mt-12 text-sm leading-6 text-silver-500">
          Questions? See <Link href="/support" className="underline underline-offset-2">Support</Link> or our{' '}
          <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
        </p>
      </div>
    </article>
  );
}
