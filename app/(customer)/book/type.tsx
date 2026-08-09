import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { useBookingStore } from '@/store/bookingStore';
import type { MoveType } from '@/types';

interface Option {
  key: MoveType;
  title: string;
  body: string;
  examples: string;
  icon: keyof typeof Ionicons.glyphMap;
  pricing: 'Fixed' | 'Hourly';
}

// Both options are HOURLY — we give an estimate based on typical hours for
// each preset, but the final invoice always reflects actual time on site.
const options: Option[] = [
  {
    key: 'home_move',
    title: 'Residential',
    body: 'Moving everything from one home to another.',
    examples: 'Apartment, condo, townhouse, or house',
    icon: 'home-outline',
    pricing: 'Hourly',
  },
  {
    key: 'commercial',
    // Single items and labour-only jobs are booked here as commercial job
    // kinds — same hourly rate, same 4-hour minimum — so they're findable
    // instead of being advertised move types with no way to book them.
    title: 'Commercial & other',
    body: 'Business moves, single items, or labour without a truck.',
    examples: 'Office, retail, warehouse, restaurant, single items, labour only',
    icon: 'business-outline',
    pricing: 'Hourly',
  },
];

export default function MoveTypeStep() {
  const setMoveType = useBookingStore((s) => s.setMoveType);
  const current = useBookingStore((s) => s.draft.moveType);
  const [selected, setSelected] = useState<MoveType | undefined>(current);

  const next = () => {
    if (!selected) return;
    setMoveType(selected);
    // Home already collected pickup + drop-off + date, so we skip the
    // locations + schedule sub-steps and go straight to details where
    // the customer picks the right preset for their move.
    router.push('/(customer)/book/details');
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={1} total={3} label="Move type" />
      {/* Heading sits in the upper third — closer to the StepIndicator so
          the customer's eye lands on the prompt fast. Generous gap between
          the two option cards (gap-8) gives each preset real breathing room
          and makes the choice feel less cramped. */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        <View className="mt-8">
          <Text className="text-2xl font-bold text-ink-900 text-center">What kind of move?</Text>
          <Text className="mt-1 text-sm text-silver-500 text-center">
            Pick the option that fits — we'll ask the right questions next.
          </Text>
        </View>

        <View className="mt-8 gap-8">
          {options.map((o) => {
            const isSel = selected === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => setSelected(o.key)}
                className={`rounded-3xl border p-5 active:opacity-80 ${
                  isSel ? 'border-brand-600 bg-brand-50' : 'border-silver-200 bg-white'
                }`}
              >
                <View className="flex-row items-start">
                  <View
                    className={`h-12 w-12 rounded-2xl items-center justify-center ${
                      isSel ? 'bg-brand-600' : 'bg-silver-100'
                    }`}
                  >
                    <Ionicons name={o.icon} size={22} color={isSel ? '#fff' : '#0A0A0A'} />
                  </View>
                  <View className="ml-4 flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-base font-bold text-ink-900">{o.title}</Text>
                      <View
                        className={`rounded-full px-2 py-0.5 ${
                          o.pricing === 'Hourly' ? 'bg-ink-900' : 'bg-silver-100'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-bold uppercase ${
                            o.pricing === 'Hourly' ? 'text-white' : 'text-ink-700'
                          }`}
                        >
                          {o.pricing}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-sm text-ink-700 mt-1 leading-5">{o.body}</Text>
                    <Text className="text-xs text-silver-500 mt-1">{o.examples}</Text>
                  </View>
                  {isSel ? (
                    <Ionicons name="checkmark-circle" size={22} color="#047857" style={{ marginLeft: 8 }} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
        <Button label="Continue" size="lg" fullWidth disabled={!selected} onPress={next} />
      </View>
    </SafeAreaView>
  );
}
