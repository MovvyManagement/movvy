'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Button, ErrorNote } from './ui';

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export const paymentsInTestMode = publishableKey.startsWith('pk_test_');

// Declared once. The live page re-renders every few seconds, and passing Stripe
// a new options object each time would disturb the card fields mid-typing.
const PAYMENT_ELEMENT_OPTIONS = {
  defaultValues: { billingDetails: { address: { country: 'CA' } } },
};

export function TestModeNote() {
  if (!paymentsInTestMode) return null;
  return (
    <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      Online payments are in test mode. Real cards can&apos;t be charged yet.
    </p>
  );
}

function PaymentForm({
  label,
  returnUrl,
  onPaid,
}: {
  label: string;
  returnUrl: string;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    });
    if (result.error) {
      setError(result.error.message ?? 'Your payment did not go through. Please try again.');
      setBusy(false);
      return;
    }
    if (result.paymentIntent?.status === 'succeeded' || result.paymentIntent?.status === 'processing') {
      onPaid();
      return;
    }
    setError('Your payment did not go through. Please try again.');
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={PAYMENT_ELEMENT_OPTIONS} />
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="green" loading={busy} disabled={!stripe} className="w-full">
        {label}
      </Button>
    </form>
  );
}

export function StripePayment(props: {
  clientSecret: string;
  label: string;
  returnUrl: string;
  onPaid: () => void;
}) {
  const options = useMemo(
    () => ({
      clientSecret: props.clientSecret,
      appearance: {
        theme: 'stripe' as const,
        variables: { colorPrimary: '#0A7A3E', borderRadius: '14px', fontFamily: 'Inter, system-ui, sans-serif' },
      },
    }),
    [props.clientSecret],
  );

  if (!stripePromise) {
    return <ErrorNote>Online payments are not available right now. Please try again later.</ErrorNote>;
  }
  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentForm label={props.label} returnUrl={props.returnUrl} onPaid={props.onPaid} />
    </Elements>
  );
}
