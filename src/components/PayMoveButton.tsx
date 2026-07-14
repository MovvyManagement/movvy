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
import { usePayForMove } from '@/lib/data/usePayForMove';
import { haptic } from '@/lib/haptics';

export function PayMoveButton({
  bookingId,
  amountDollars,
  tipCents = 0,
  alreadyPaid = false,
  onPaid,
}: {
  bookingId: string;
  /** Total to display on the button (move + tip). */
  amountDollars: number;
  /** Gratuity to add to the charge, in cents. */
  tipCents?: number;
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
        <Text className="text-sm font-bold text-brand-700">Paid · thank you!</Text>
      </View>
    );
  }

  const handlePay = async () => {
    const result = await pay(bookingId, tipCents);
    if (result.status === 'paid') {
      haptic.success();
      setPaid(true);
      toast.success('Payment successful — thank you!');
      onPaid?.();
    } else if (result.status === 'error') {
      toast.error(result.message);
    }
    // 'canceled' → user dismissed the sheet; stay silent.
  };

  return (
    <Button
      label={isPaying ? 'Processing…' : `Pay $${amountDollars.toFixed(2)}`}
      onPress={handlePay}
      loading={isPaying}
      disabled={isPaying}
      accessibilityLabel={`Pay ${amountDollars.toFixed(2)} dollars for your move`}
    />
  );
}
