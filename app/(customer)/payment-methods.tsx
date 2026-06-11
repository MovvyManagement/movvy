// =============================================================================
// /(customer)/payment-methods — saved cards (Phase 1/2 placeholder for Stripe)
//
// Lets the customer add / remove / set-default cards. We capture the full PAN
// in the input only long enough to derive the brand + last4 — we NEVER send
// the PAN or CVV to the server. The DB row stores brand, last4, exp, cardholder
// and an optional billing postal.
//
// Phase 3 will replace this screen's "Save card" flow with Stripe Payment
// Methods (tokenize via stripe.js, store the payment_method_id only). The
// table already has a `stripe_payment_method_id` slot for that upgrade.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import {
  usePaymentMethods,
  useSavePaymentMethod,
  useSetDefaultPaymentMethod,
  useDeletePaymentMethod,
  detectCardBrand,
  formatCardNumber,
  isValidLuhn,
  expectedPanLength,
  type CardBrand,
  type PaymentMethodRow,
} from '@/lib/data';

const BRAND_LABEL: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  other: 'Card',
};

function brandIcon(brand: CardBrand): keyof typeof Ionicons.glyphMap {
  // @expo/vector-icons doesn't ship brand-specific card glyphs (visa, mc,
  // etc. would need a custom font), so we use a generic credit-card icon
  // tinted by brand. Phase 3 swap with brand SVGs from the Stripe SDK.
  return 'card';
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
  const save = useSavePaymentMethod();
  const setDefault = useSetDefaultPaymentMethod();
  const remove = useDeletePaymentMethod();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [cardholder, setCardholder] = useState('');
  const [pan, setPan] = useState('');
  const [exp, setExp] = useState(''); // "MM/YY"
  const [cvv, setCvv] = useState('');
  const [postal, setPostal] = useState('');
  const [setAsDefault, setSetAsDefault] = useState(false);

  const brand = useMemo<CardBrand>(() => detectCardBrand(pan), [pan]);
  const display = useMemo(() => formatCardNumber(pan, brand), [pan, brand]);
  const digits = pan.replace(/\D/g, '');
  const expDigits = exp.replace(/\D/g, '');
  const expMonth = expDigits.length >= 2 ? parseInt(expDigits.slice(0, 2), 10) : NaN;
  const expYearShort = expDigits.length === 4 ? parseInt(expDigits.slice(2, 4), 10) : NaN;
  const expYear = Number.isFinite(expYearShort) ? 2000 + expYearShort : NaN;
  const expValid =
    Number.isFinite(expMonth) &&
    expMonth >= 1 &&
    expMonth <= 12 &&
    Number.isFinite(expYear) &&
    !expIsExpired(expMonth, expYear);

  const canSave =
    cardholder.trim().length >= 2 &&
    digits.length === expectedPanLength(brand) &&
    isValidLuhn(digits) &&
    expValid &&
    cvv.replace(/\D/g, '').length >= 3 &&
    !save.isPending;

  const resetForm = () => {
    setCardholder('');
    setPan('');
    setExp('');
    setCvv('');
    setPostal('');
    setSetAsDefault(false);
  };

  const onSave = async () => {
    if (!canSave) return;
    try {
      await save.mutateAsync({
        brand,
        last4: digits.slice(-4),
        exp_month: expMonth,
        exp_year: expYear,
        cardholder_name: cardholder.trim(),
        billing_postal: postal,
        is_default: setAsDefault || (cards ?? []).length === 0,
      });
      toast.success('Card saved');
      resetForm();
      setAdding(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save your card.");
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
      `${BRAND_LABEL[row.brand]} •••• ${row.last4} will be removed.`,
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

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Trust banner — explains exactly what we store + what we don't. */}
        <View className="mb-4 rounded-2xl bg-brand-50 border border-brand-100 p-3 flex-row items-start">
          <Ionicons name="shield-checkmark" size={16} color="#047857" />
          <Text className="ml-2 flex-1 text-[11px] text-ink-700 leading-4">
            We only store the card brand, last 4 digits, expiry, cardholder name,
            and billing postal. The full card number and CVV never leave your
            device — they're discarded the moment we read the brand and last 4.
          </Text>
        </View>

        {adding ? (
          <Card className="mb-4">
            <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
              Add a new card
            </Text>
            <View className="gap-3">
              <Input
                label="Cardholder name"
                placeholder="Name on card"
                autoCapitalize="words"
                autoCorrect={false}
                value={cardholder}
                onChangeText={setCardholder}
                leftIcon={<Ionicons name="person-outline" size={18} color="#71717A" />}
              />
              <Input
                label="Card number"
                placeholder="1234 1234 1234 1234"
                keyboardType="number-pad"
                autoComplete={Platform.OS === 'ios' ? 'cc-number' : 'cc-number'}
                value={display}
                onChangeText={(t) => setPan(t.replace(/\D/g, ''))}
                leftIcon={<Ionicons name={brandIcon(brand)} size={18} color="#71717A" />}
                hint={
                  digits.length > 0 && digits.length === expectedPanLength(brand) && !isValidLuhn(digits)
                    ? 'That card number doesn\'t look right.'
                    : digits.length > 0
                    ? `${BRAND_LABEL[brand]} detected`
                    : undefined
                }
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label="Expiry"
                    placeholder="MM/YY"
                    keyboardType="number-pad"
                    autoComplete={Platform.OS === 'ios' ? 'cc-exp' : 'cc-exp'}
                    value={exp}
                    onChangeText={(t) => {
                      const d = t.replace(/\D/g, '').slice(0, 4);
                      setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
                    }}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="CVV"
                    placeholder={brand === 'amex' ? '4 digits' : '3 digits'}
                    keyboardType="number-pad"
                    autoComplete={Platform.OS === 'ios' ? 'cc-csc' : 'cc-csc'}
                    secureTextEntry
                    value={cvv}
                    onChangeText={(t) => setCvv(t.replace(/\D/g, '').slice(0, brand === 'amex' ? 4 : 3))}
                  />
                </View>
              </View>
              <Input
                label="Billing postal code"
                placeholder="T2P 1J9"
                autoCapitalize="characters"
                autoCorrect={false}
                value={postal}
                onChangeText={(t) => setPostal(t.toUpperCase())}
              />

              <Pressable
                onPress={() => setSetAsDefault((v) => !v)}
                className="flex-row items-center mt-1"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: setAsDefault }}
              >
                <View
                  className={`h-5 w-5 rounded-md border items-center justify-center ${
                    setAsDefault
                      ? 'bg-brand-600 border-brand-600'
                      : 'bg-white border-silver-300'
                  }`}
                >
                  {setAsDefault ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                </View>
                <Text className="ml-2 text-sm text-ink-900">Set as default</Text>
              </Pressable>

              <View className="flex-row gap-2 mt-3">
                <Pressable
                  onPress={() => {
                    setAdding(false);
                    resetForm();
                  }}
                  className="flex-1 h-12 rounded-2xl bg-silver-100 items-center justify-center active:opacity-80"
                >
                  <Text className="text-sm font-bold text-ink-900">Cancel</Text>
                </Pressable>
                <View className="flex-[2]">
                  <Button
                    label="Save card"
                    size="md"
                    fullWidth
                    loading={save.isPending}
                    disabled={!canSave}
                    onPress={onSave}
                  />
                </View>
              </View>
            </View>
          </Card>
        ) : null}

        {/* List of saved cards */}
        {isLoading && !cards ? (
          <CardSkeleton count={2} />
        ) : !cards || cards.length === 0 ? (
          <EmptyState
            icon="card-outline"
            title="No saved cards"
            body="Add a card so booking checkout is one tap. We store only the brand, last 4 digits, and expiry — never your full card number or CVV."
          />
        ) : (
          cards.map((c) => {
            const expired = expIsExpired(c.exp_month, c.exp_year);
            return (
              <View key={c.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center">
                    <View className="h-10 w-10 rounded-2xl bg-ink-900 items-center justify-center">
                      <Ionicons name={brandIcon(c.brand)} size={18} color="#fff" />
                    </View>
                    <View className="ml-3 flex-1">
                      <View className="flex-row items-center">
                        <Text className="text-sm font-bold text-ink-900">
                          {BRAND_LABEL[c.brand]} •••• {c.last4}
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
                        {c.cardholder_name} · Exp {String(c.exp_month).padStart(2, '0')}/
                        {String(c.exp_year).slice(-2)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => onRemove(c)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${BRAND_LABEL[c.brand]} ending in ${c.last4}`}
                      className="h-9 w-9 rounded-full items-center justify-center"
                    >
                      <Ionicons name="trash-outline" size={18} color="#71717A" />
                    </Pressable>
                  </View>
                  {!c.is_default && !expired ? (
                    <Pressable
                      onPress={() => onMakeDefault(c.id)}
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

        {!adding ? (
          <Pressable
            onPress={() => setAdding(true)}
            className="mt-2 flex-row items-center justify-center py-4 rounded-2xl border border-dashed border-silver-300 active:opacity-70"
          >
            <Ionicons name="add" size={18} color="#047857" />
            <Text className="ml-2 text-sm font-bold text-brand-700">Add a card</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
