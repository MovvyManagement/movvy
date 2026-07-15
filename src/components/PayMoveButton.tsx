// =============================================================================
// PayMoveButton — the customer-facing "Pay for your move" CTA.
//
// Self-contained: hand it a bookingId + the display amount and it runs the
// whole Stripe Payment Sheet flow (see usePayForMove). Shows a paid state once
// the charge succeeds. The real source of truth is the stripe-webhook, which
// flips the booking's payment_status server-side moments later.
// =============================================================================

import { useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { usePayForMove, type PayKind } from '@/lib/data/usePayForMove';
import { haptic } from '@/lib/haptics';

export function PayMoveButton({
  bookingId,
  amountDollars,
  tipCents = 0,
  kind = 'final',
  alreadyPaid = false,
  onPaid,
}: {
  bookingId: string;
  /** Total to display on the button (move + tip, or the deposit). */
  amountDollars: number;
  /** Gratuity to add to the charge, in cents (final payment only). */
  tipCents?: number;
  /** 'deposit' = the 20% booking deposit; 'final' = the post-move bill. */
  kind?: PayKind;
  alreadyPaid?: boolean;
  onPaid?: () => void;
}) {
  const { pay, isPaying } = usePayForMove();
  const toast = useToast();
  const [paid, setPaid] = useState(alreadyPaid);

  if (paid) {
    return (
      <View className="flex-row items-center justify-center gap-2 rounded-2xl bg-brand-50 border border-brand-100 py-3">
        <Ionicons name="checkmark-circle" size={18} color="#059669" />
        <Text className="text-sm font-bold text-brand-700">
          {kind === 'deposit' ? 'Deposit paid · you’re locked in!' : 'Paid · thank you!'}
        </Text>
      </View>
    );
  }

  const handlePay = async () => {
    const result = await pay(bookingId, tipCents, kind);
    if (result.status === 'paid' || result.status === 'settled') {
      haptic.success();
      setPaid(true);
      toast.success(
        result.status === 'settled'
          ? 'All settled — your deposit covered it!'
          : kind === 'deposit'
            ? 'Deposit paid — your move is locked in!'
            : 'Payment successful — thank you!',
      );
      onPaid?.();
    } else if (result.status === 'error') {
      toast.error(result.message);
    }
    // 'canceled' → user dismissed the sheet; stay silent.
  };

  const label = isPaying
    ? 'Processing…'
    : kind === 'deposit'
      ? `Pay $${amountDollars.toFixed(2)} deposit`
      : `Pay $${amountDollars.toFixed(2)}`;

  return (
    <Button
      label={label}
      onPress={handlePay}
      loading={isPaying}
      disabled={isPaying}
      accessibilityLabel={
        kind === 'deposit'
          ? `Pay ${amountDollars.toFixed(2)} dollar deposit to confirm your move`
          : `Pay ${amountDollars.toFixed(2)} dollars for your move`
      }
    />
  );
}
