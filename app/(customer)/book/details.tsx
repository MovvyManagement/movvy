// =============================================================================
// /(customer)/book/details — step 2 of 3
//
// Residential: 6 preset cards (1/2/3-BR apt, 2/3/4-BR house). Each preset
// pre-computes its hours + price + crew using the pricing engine so the
// customer sees the exact same number on this screen and on confirm.
// Each preset INCLUDES packing + disassembly — no add-on toggles here.
// Tapping a preset advances straight to /book/confirm.
//
// Commercial: same selectors as before (kind + crew + hours). The hourly
// model needs them and there's no way to preset it cleanly.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StepIndicator } from '@/components/StepIndicator';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Counter } from '@/components/Counter';
import { useBookingStore } from '@/store/bookingStore';
import type { HomeDwelling, CommercialKind, MoveDetails } from '@/types';

// Six residential presets, in the exact order + hours the spec calls out.
// Hours INCLUDE packing + disassembly; the pricing engine already returns
// the correct on-site hours for each (dwelling, bedrooms) pair via
// lookupResidential(). Keeping the labels here is the single source of
// truth — the price chip is computed live so it never drifts.
interface ResidentialPreset {
  key: string;
  dwelling: HomeDwelling;
  bedrooms: number;
  title: string;
  hours: number;
  crew: number;
  icon: keyof typeof Ionicons.glyphMap;
}
// Commercial job kinds. Single items and labour-only live here rather than
// being their own move types — same hourly commercial rate, same 4-hour
// minimum. Ordered so the two "smaller job" options read last.
const COMMERCIAL_KIND_LABELS: Record<CommercialKind, string> = {
  office: 'Office',
  retail: 'Retail',
  warehouse: 'Warehouse',
  restaurant: 'Restaurant',
  single_items: 'Single items',
  labor_only: 'Labour only',
};

const RESIDENTIAL_PRESETS: ResidentialPreset[] = [
  { key: 'apt-1', dwelling: 'apartment', bedrooms: 1, title: '1-bedroom apartment', hours: 6,  crew: 2, icon: 'business-outline' },
  { key: 'apt-2', dwelling: 'apartment', bedrooms: 2, title: '2-bedroom apartment', hours: 8,  crew: 2, icon: 'business-outline' },
  { key: 'apt-3', dwelling: 'apartment', bedrooms: 3, title: '3-bedroom apartment', hours: 10, crew: 3, icon: 'business-outline' },
  { key: 'house-2', dwelling: 'house', bedrooms: 2, title: '2-bedroom house', hours: 8,  crew: 2, icon: 'home-outline' },
  { key: 'house-3', dwelling: 'house', bedrooms: 3, title: '3-bedroom house', hours: 10, crew: 3, icon: 'home-outline' },
  { key: 'house-4', dwelling: 'house', bedrooms: 4, title: '4-bedroom house', hours: 12, crew: 3, icon: 'home-outline' },
];

export default function DetailsStep() {
  const draft = useBookingStore((s) => s.draft);
  const setDetails = useBookingStore((s) => s.setDetails);
  const type = draft.moveType ?? 'home_move';

  const pickPreset = (p: ResidentialPreset) => {
    const details: MoveDetails = {
      dwelling: p.dwelling,
      bedrooms: p.bedrooms,
      // Counters in the matrix carry these but we don't ask the customer —
      // they're fine at sensible defaults for the pricing math.
      livingRooms: 1,
      bathrooms: 1,
      floor: 1,
      hasElevator: false,
      // Packing + disassembly are INCLUDED in every residential preset per
      // spec, so flag them on the booking record for the crew to plan for.
      packingNeeded: true,
      assemblyNeeded: true,
      heavyItems: false,
      fragileItems: false,
    };
    setDetails(details);
    router.push('/(customer)/book/confirm');
  };

  // ═══ COMMERCIAL ════════════════════════════════════════════════════════
  // Same model as before — kind + crew + hours. Auto-advances on Continue
  // (no preset path because commercial sizes vary too much to enumerate).
  const [commercialKind, setCommercialKind] = useState<CommercialKind>(
    draft.details?.commercialKind ?? 'office',
  );
  const [workstations, setWorkstations] = useState(draft.details?.workstations ?? 10);
  const [crewSize, setCrewSize] = useState(draft.details?.crewSize ?? 3);
  const [estimatedHours, setEstimatedHours] = useState(draft.details?.estimatedHours ?? 4);
  const [notes, setNotes] = useState(draft.details?.notes ?? '');

  const submitCommercial = () => {
    setDetails({
      commercialKind,
      workstations,
      crewSize,
      estimatedHours,
      notes,
    });
    router.push('/(customer)/book/confirm');
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <ScreenHeader />
      <StepIndicator step={2} total={3} label="Move details" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
        {type === 'home_move' ? (
          <>
            <Text className="text-2xl font-bold text-ink-900 mt-2">
              Which one's yours?
            </Text>
            <Text className="mt-1 text-sm text-silver-500 leading-5">
              Each option includes packing + disassembly. Pick the closest fit —
              the crew adapts to what you actually have on the day.
            </Text>

            {/* Prices are intentionally NOT shown here — the customer
                sees the full breakdown (hourly rate, travel, materials,
                deposit) on the confirm screen, so they make the home-size
                choice without anchoring on a number first. */}
            <View className="mt-5 gap-3">
              {RESIDENTIAL_PRESETS.map((p) => (
                <Pressable
                  key={p.key}
                  onPress={() => pickPreset(p)}
                  className="rounded-3xl border border-silver-200 bg-white p-5 active:opacity-80 active:border-brand-300"
                >
                  <View className="flex-row items-start">
                    <View className="h-12 w-12 rounded-2xl bg-brand-50 items-center justify-center">
                      <Ionicons name={p.icon} size={22} color="#047857" />
                    </View>
                    <View className="ml-4 flex-1">
                      <Text className="text-base font-bold text-ink-900">{p.title}</Text>
                      <View className="mt-1 flex-row flex-wrap gap-x-3 gap-y-0.5">
                        <Text className="text-xs text-silver-600">
                          <Text className="font-semibold text-ink-900">{p.hours}h</Text> estimated
                        </Text>
                        <Text className="text-xs text-silver-600">
                          <Text className="font-semibold text-ink-900">{p.crew}-person</Text> crew
                        </Text>
                        <Text className="text-xs text-silver-600">truck included</Text>
                      </View>
                      <Text className="text-[11px] text-silver-500 mt-1 leading-4">
                        Packing + disassembly included
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color="#A1A1AA"
                      style={{ marginTop: 4, marginLeft: 4 }}
                    />
                  </View>
                </Pressable>
              ))}
            </View>

            <View className="mt-5 rounded-2xl bg-silver-50 p-4 flex-row items-start">
              <Ionicons name="information-circle-outline" size={16} color="#71717A" />
              <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
                The number you see is an estimate. The crew bills for actual
                time on site — if the move runs short, you pay less; if it
                runs over, the difference is added at the end.
              </Text>
            </View>
          </>
        ) : (
          /* ═══ COMMERCIAL ═══════════════════════════════════════════════ */
          <>
            <Text className="text-2xl font-bold text-ink-900 mt-2">
              Tell us about the space
            </Text>
            <Text className="mt-1 text-sm text-silver-500">
              Crew size and estimated hours drive your hourly estimate.
            </Text>

            <SectionLabel>Type of job</SectionLabel>
            <View className="flex-row flex-wrap gap-2">
              {(Object.keys(COMMERCIAL_KIND_LABELS) as CommercialKind[]).map((d) => (
                <Chip
                  key={d}
                  label={COMMERCIAL_KIND_LABELS[d]}
                  selected={commercialKind === d}
                  onPress={() => setCommercialKind(d)}
                />
              ))}
            </View>

            <SectionLabel>Scope</SectionLabel>
            <View className="rounded-3xl border border-silver-200 px-5">
              <Counter
                label="Workstations / desks"
                sub="Approximate count"
                value={workstations}
                onChange={setWorkstations}
                min={0}
                max={500}
              />
            </View>

            <SectionLabel>Crew & time</SectionLabel>
            <View className="rounded-3xl border border-silver-200 px-5">
              <Counter
                label="Crew size"
                sub="2 crew = $200/hr · 3 crew = $250/hr · 4+ crew = 2 trucks"
                value={crewSize}
                onChange={setCrewSize}
                min={2}
                max={12}
              />
              {/* 4 hours, matching MIN_BILLABLE_HOURS in the pricing engine.
                  This said "2 hour minimum" and let the counter go to 2, so a
                  customer picked 2 and was quoted — and billed — for 4. */}
              <Counter
                label="Estimated hours"
                sub="4 hour minimum"
                value={estimatedHours}
                onChange={setEstimatedHours}
                min={4}
                max={16}
              />
            </View>

            <SectionLabel>Notes for the crew</SectionLabel>
            <View className="rounded-2xl border border-silver-200 bg-white p-4">
              <TextInput
                multiline
                numberOfLines={4}
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. loading dock at rear, freight elevator, parking validated"
                placeholderTextColor="#A1A1AA"
                className="text-base text-ink-900"
                style={{ minHeight: 80, textAlignVertical: 'top' }}
              />
            </View>

            <View className="mt-5 rounded-2xl bg-silver-50 p-4 flex-row items-start">
              <Ionicons name="information-circle-outline" size={16} color="#71717A" />
              <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
                Commercial moves are billed hourly. The estimate is based on
                the hours you enter; the final invoice reflects actual time
                on site.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Bottom CTA — residential auto-advances via card tap, so it's
          commercial-only. Removes a "tap card → nothing happens → tap
          Continue" friction step. */}
      {type === 'commercial' ? (
        <View className="px-5 pt-3 pb-4 border-t border-silver-100 bg-white">
          <Button label="Continue to confirm" size="lg" fullWidth onPress={submitCommercial} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2">
      {children}
    </Text>
  );
}
