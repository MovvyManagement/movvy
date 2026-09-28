// =============================================================================
// /(customer)/payment-methods — saved cards, backed by Stripe
//
// Adding a card opens Stripe's native Payment Sheet (SetupIntent), which
// tokenizes and stores the card on the customer's Stripe customer object. The
// app never sees or stores a raw card number — only the brand / last4 / expiry
// Stripe returns. These saved cards are what power one-tap checkout (the
// Payment Sheet at checkout pre-selects the default; see usePayForMove).
// =============================================================================

import React from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import {
  usePaymentMethods,
  useAddCard,
  useSetDefaultPaymentMethod,
  useDeletePaymentMethod,
  type PaymentMethodRow,
} from '@/lib/data';

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

function brandLabel(brand: string): string {
  return BRAND_LABEL[brand] ?? 'Card';
}

function expIsExpired(month: number, year: number): boolean {
  const now = new Date();
  const cmYear = now.getFullYear();
  const cmMonth = now.getMonth() + 1;
  if (year < cmYear) return true;
  if (year === cmYear && month < cmMonth) return true;
  return false;
}

export default function PaymentMethodsScreen() {
  const { data: cards, isLoading } = usePaymentMethods();
  const addCard = useAddCard();
  const setDefault = useSetDefaultPaymentMethod();
  const remove = useDeletePaymentMethod();
  const toast = useToast();

  const onAdd = async () => {
    try {
      const result = await addCard.mutateAsync();
      if (result === 'added') toast.success('Card saved');
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add your card.");
    }
  };

  const onMakeDefault = async (id: string) => {
    try {
      await setDefault.mutateAsync(id);
      toast.success('Default card updated');
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update default.");
    }
  };

  const onRemove = (row: PaymentMethodRow) => {
    Alert.alert(
      'Remove card?',
      `${brandLabel(row.brand)} •••• ${row.last4} will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await remove.mutateAsync(row.id);
              toast.success('Card removed');
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't remove card.");
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50" edges={['top']}>
      <View className="bg-white">
        <ScreenHeader title="Payment Methods" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Trust banner — cards are handled by Stripe, never seen by the app. */}
        <View className="mb-4 rounded-2xl bg-brand-50 border border-brand-100 p-3 flex-row items-start">
          <Ionicons name="shield-checkmark" size={16} color="#047857" />
          <Text className="ml-2 flex-1 text-[11px] text-ink-700 leading-4">
            Cards are stored securely by Stripe. Movvy never sees or stores your
            full card number — only the brand, last 4 digits, and expiry. Your
            default card is charged in one tap at checkout.
          </Text>
        </View>

        {isLoading && !cards ? (
          <CardSkeleton count={2} />
        ) : !cards || cards.length === 0 ? (
          <EmptyState
            icon="card-outline"
            title="No saved cards"
            body="Add a card so booking checkout is one tap. Your card is entered and stored securely by Stripe — Movvy never sees your full card number."
          />
        ) : (
          cards.map((c) => {
            const expired = expIsExpired(c.exp_month, c.exp_year);
            return (
              <View key={c.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center">
                    <View className="h-10 w-10 rounded-2xl bg-ink-900 items-center justify-center">
                      <Ionicons name="card" size={18} color="#fff" />
                    </View>
                    <View className="ml-3 flex-1">
                      <View className="flex-row items-center">
                        <Text className="text-sm font-bold text-ink-900">
                          {brandLabel(c.brand)} •••• {c.last4}
                        </Text>
                        {c.is_default ? (
                          <View className="ml-2 px-2 py-0.5 rounded-full bg-brand-50 border border-brand-100">
                            <Text className="text-[10px] font-bold text-brand-700 uppercase">
                              Default
                            </Text>
                          </View>
                        ) : null}
                        {expired ? (
                          <View className="ml-2 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100">
                            <Text className="text-[10px] font-bold text-amber-700 uppercase">
                              Expired
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text className="text-xs text-silver-500 mt-0.5">
                        Exp {String(c.exp_month).padStart(2, '0')}/
                        {String(c.exp_year).slice(-2)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => onRemove(c)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${brandLabel(c.brand)} ending in ${c.last4}`}
                      className="h-9 w-9 rounded-full items-center justify-center"
                    >
                      <Ionicons name="trash-outline" size={18} color="#71717A" />
                    </Pressable>
                  </View>
                  {!c.is_default && !expired ? (
                    <Pressable
                      onPress={() => onMakeDefault(c.id)}
                      disabled={setDefault.isPending}
                      className="mt-3 rounded-xl bg-silver-100 py-2 items-center active:opacity-80"
                    >
                      <Text className="text-xs font-bold text-ink-900">Set as default</Text>
                    </Pressable>
                  ) : null}
                </Card>
              </View>
            );
          })
        )}

        <Pressable
          onPress={onAdd}
          disabled={addCard.isPending}
          className="mt-2 flex-row items-center justify-center py-4 rounded-2xl border border-dashed border-silver-300 active:opacity-70"
        >
          <Ionicons name="add" size={18} color="#047857" />
          <Text className="ml-2 text-sm font-bold text-brand-700">
            {addCard.isPending ? 'Opening…' : 'Add a card'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
