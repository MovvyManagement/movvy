// =============================================================================
// /(admin)/flags — feature flags + API budget control panel
//
// One screen for:
//   • Flipping any feature_flags row (paid-API kill switches default OFF)
//   • Editing api_budgets daily caps so the founder doesn't have to SSH
//     into the SQL editor when traffic ramps
//   • Glanceable today's spend per service so the consequence of a flip
//     is obvious (e.g. you can see google_places is at $4.20 / $5 before
//     you raise the cap)
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import {
  useFeatureFlags,
  useToggleFeatureFlag,
  useApiBudgets,
  useUpdateApiBudget,
  useAdminSpendToday,
} from '@/lib/data';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { supabaseConfigured } from '@/lib/supabase';

export default function AdminFlags() {
  const flags = useFeatureFlags();
  const toggle = useToggleFeatureFlag();
  const budgets = useApiBudgets();
  const updateBudget = useUpdateApiBudget();
  const spend = useAdminSpendToday();
  const toast = useToast();

  // Joining budgets → spend so we can show "$X / $Y" alongside the cap.
  const spendByService = (spend.data ?? {}) as Record<
    string,
    { calls: number; usd: number; cache_hits: number }
  >;

  const flipFlag = (key: string, next: boolean) => {
    Alert.alert(
      next ? `Enable ${key}?` : `Disable ${key}?`,
      next
        ? "Flipping this ON will start spending money on the linked API. Make sure the budget cap is set correctly first."
        : 'Flipping this OFF immediately stops the linked API. Calls fall back to the free path.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Enable' : 'Disable',
          style: next ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await toggle.mutateAsync({ key, enabled: next });
              haptic.success();
              toast.success(`${key} → ${next ? 'ON' : 'OFF'}`);
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't update flag.");
            }
          },
        },
      ],
    );
  };

  if (!supabaseConfigured) {
    return (
      <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
        <View className="bg-white dark:bg-night-100">
          <ScreenHeader title="Flags" showBack={false} />
        </View>
        <EmptyState
          icon="cloud-offline-outline"
          title="Backend not connected"
          body="Connect Supabase in .env.local to load feature flags + budgets."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader
          title="Feature flags"
          subtitle="Kill switches + paid-API budgets"
          showBack={false}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Emergency banner — surfaces today's total spend at the top so
            the admin always sees the consequence of any flip below. */}
        <View className="rounded-2xl bg-ink-900 p-4 mb-4 flex-row items-center">
          <View className="h-10 w-10 rounded-full bg-brand-600 items-center justify-center">
            <Ionicons name="cash" size={20} color="#fff" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-[10px] uppercase font-bold tracking-wider text-white/70">
              Today's spend
            </Text>
            <Text className="text-2xl font-bold text-white">
              ${Object.values(spendByService).reduce((s, r) => s + r.usd, 0).toFixed(2)}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-[10px] uppercase font-bold tracking-wider text-white/70">
              Calls
            </Text>
            <Text className="text-base font-bold text-white">
              {Object.values(spendByService).reduce((s, r) => s + r.calls, 0)}
            </Text>
          </View>
        </View>

        {/* Feature flags */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2 px-1">
          Kill switches
        </Text>
        {flags.isLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator color="#16A34A" />
          </View>
        ) : !flags.data || flags.data.length === 0 ? (
          <EmptyState icon="flag-outline" title="No flags configured" body="" />
        ) : (
          <Card padded={false}>
            {flags.data.map((f, i, arr) => (
              <View
                key={f.key}
                className={`px-5 py-4 ${
                  i < arr.length - 1 ? 'border-b border-silver-100' : ''
                }`}
              >
                <View className="flex-row items-center">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center">
                      <Text className="text-sm font-bold text-ink-900" numberOfLines={1}>
                        {f.key}
                      </Text>
                      <Badge
                        label={f.enabled ? 'ON' : 'OFF'}
                        tone={f.enabled ? 'success' : 'neutral'}
                      />
                    </View>
                    {f.description ? (
                      <Text className="mt-1 text-[11px] text-silver-500 leading-4">
                        {f.description}
                      </Text>
                    ) : null}
                  </View>
                  <Switch
                    value={f.enabled}
                    onValueChange={(v) => flipFlag(f.key, v)}
                    disabled={toggle.isPending}
                    trackColor={{ false: '#E4E4E7', true: '#16A34A' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* API budgets */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500 mt-6 mb-2 px-1">
          Daily budget caps
        </Text>
        {budgets.isLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator color="#16A34A" />
          </View>
        ) : !budgets.data || budgets.data.length === 0 ? (
          <EmptyState icon="wallet-outline" title="No budgets configured" body="" />
        ) : (
          <Card padded={false}>
            {budgets.data.map((b, i, arr) => (
              <BudgetRow
                key={b.service}
                budget={b}
                spentToday={spendByService[b.service]?.usd ?? 0}
                onSave={async (newCap, hardStop) => {
                  try {
                    await updateBudget.mutateAsync({
                      service: b.service,
                      daily_cap_usd: newCap,
                      hard_stop: hardStop,
                    });
                    haptic.success();
                    toast.success(`${b.service} cap → $${newCap.toFixed(2)}/day`);
                  } catch (e: any) {
                    toast.error(e?.message ?? "Couldn't update budget.");
                  }
                }}
                isLast={i === arr.length - 1}
              />
            ))}
          </Card>
        )}

        <View className="mt-6 rounded-2xl bg-silver-50 border border-silver-200 p-4 flex-row">
          <Ionicons name="information-circle-outline" size={16} color="#71717A" />
          <Text className="ml-2 flex-1 text-[11px] text-silver-600 leading-4">
            Disabling a flag is instant — the next edge-function call falls
            back to the free path (Nominatim, haversine, in-app delivery).
            Budgets only apply on the next call too. Both are safe to flip
            during an incident.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Budget row with inline editor ─────────────────────────────────────────

function BudgetRow({
  budget,
  spentToday,
  onSave,
  isLast,
}: {
  budget: { service: string; daily_cap_usd: number; hard_stop: boolean };
  spentToday: number;
  onSave: (newCap: number, hardStop: boolean) => Promise<void>;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(budget.daily_cap_usd));
  const [hardStop, setHardStop] = useState(budget.hard_stop);
  const [saving, setSaving] = useState(false);

  const pct = budget.daily_cap_usd > 0 ? Math.min(100, (spentToday / budget.daily_cap_usd) * 100) : 0;
  const barColor = pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#16A34A';

  const save = async () => {
    const parsed = Number(draft.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      Alert.alert('Invalid cap', 'Enter a dollar value ≥ 0.');
      return;
    }
    setSaving(true);
    await onSave(parsed, hardStop);
    setSaving(false);
    setEditing(false);
  };

  return (
    <View className={`px-5 py-4 ${isLast ? '' : 'border-b border-silver-100'}`}>
      <View className="flex-row items-center">
        <View className="flex-1 pr-3">
          <Text className="text-sm font-bold text-ink-900">{budget.service}</Text>
          <Text className="text-[11px] text-silver-500 mt-0.5">
            ${spentToday.toFixed(2)} of ${budget.daily_cap_usd.toFixed(2)} today
          </Text>
        </View>
        {editing ? (
          <Pressable
            onPress={() => {
              setEditing(false);
              setDraft(String(budget.daily_cap_usd));
              setHardStop(budget.hard_stop);
            }}
            hitSlop={8}
            className="h-9 px-3 rounded-full bg-silver-100 items-center justify-center"
          >
            <Text className="text-xs font-bold text-ink-900">Cancel</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setEditing(true)}
            hitSlop={8}
            className="h-9 px-3 rounded-full bg-silver-100 items-center justify-center"
          >
            <Ionicons name="create-outline" size={14} color="#0A0A0A" />
            <Text className="ml-1 text-xs font-bold text-ink-900">Edit</Text>
          </Pressable>
        )}
      </View>

      {/* Bar */}
      <View className="mt-2 h-1.5 rounded-full bg-silver-100 overflow-hidden">
        <View
          style={{ width: `${pct}%`, backgroundColor: barColor }}
          className="h-1.5 rounded-full"
        />
      </View>

      {editing ? (
        <View className="mt-3 gap-3">
          <View>
            <Text className="text-[10px] font-bold uppercase text-silver-500 mb-1">
              New daily cap (USD)
            </Text>
            <View className="rounded-2xl border border-silver-200 bg-white px-3 flex-row items-center">
              <Text className="text-base font-bold text-silver-500">$</Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                keyboardType="decimal-pad"
                className="flex-1 ml-2 text-base text-ink-900"
                style={{ paddingVertical: 10 }}
              />
            </View>
          </View>
          <View className="flex-row items-center justify-between rounded-2xl bg-silver-50 px-3 py-2">
            <View className="flex-1 pr-3">
              <Text className="text-xs font-semibold text-ink-900">Hard stop at cap</Text>
              <Text className="text-[11px] text-silver-500">
                When ON, calls past the cap fail. When OFF, they keep going
                — only useful when you trust the monthly cap to catch overspend.
              </Text>
            </View>
            <Switch
              value={hardStop}
              onValueChange={setHardStop}
              trackColor={{ false: '#E4E4E7', true: '#16A34A' }}
              thumbColor="#FFFFFF"
            />
          </View>
          <Pressable
            onPress={save}
            disabled={saving}
            className={`h-12 rounded-2xl items-center justify-center flex-row ${
              saving ? 'bg-silver-300' : 'bg-brand-600 active:opacity-90'
            }`}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text className="ml-2 text-sm font-bold text-white">Save cap</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
