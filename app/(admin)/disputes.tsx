import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { PromptSheet } from '@/components/PromptSheet';
import { useAdminDisputes, useResolveDispute } from '@/lib/data';
import { fmtDateShort, fmtTime } from '@/lib/format';

export default function AdminDisputes() {
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const { data, isLoading } = useAdminDisputes(scope === 'open');
  const resolve = useResolveDispute();

  // Cross-platform resolve flow (was two chained Alert.prompts — iOS-only).
  const [resolveId, setResolveId] = useState<string | null>(null);

  const submitResolve = async (values: Record<string, string>) => {
    if (!resolveId) return;
    const dollars = Number(values.refund ?? '0');
    const refundCents = Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 0;
    await resolve.mutateAsync({
      dispute_id: resolveId,
      resolution: refundCents > 0 ? 'resolved_customer' : 'closed',
      refund_cents: refundCents,
      notes: (values.notes ?? '').trim(),
    });
    Alert.alert('Resolved', `Dispute closed${refundCents > 0 ? ` · refund $${dollars}` : ''}.`);
  };

  return (
    <SafeAreaView className="flex-1 bg-silver-50 dark:bg-night-900" edges={['top']}>
      <View className="bg-white dark:bg-night-100">
        <ScreenHeader title="Disputes" subtitle={`${data?.length ?? 0} ${scope}`} showBack={false} />
        <View className="px-5 pb-4 flex-row gap-2">
          {(['open', 'all'] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              className={`rounded-full px-4 py-2 ${scope === s ? 'bg-brand-600' : 'bg-silver-100'}`}
            >
              <Text className={`text-xs font-bold ${scope === s ? 'text-white' : 'text-ink-700'}`}>
                {s === 'open' ? 'Open' : 'All'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#16A34A" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {(!data || data.length === 0) ? (
            <EmptyState icon="checkmark-circle" title="Nothing to triage" body="No open disputes right now." />
          ) : (
            data.map((d) => (
              <View key={d.id} className="mb-3">
                <Card>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-bold text-ink-900">
                      #{d.id.slice(0, 8)} · {d.kind.replace('_', ' ')}
                    </Text>
                    <Badge
                      label={d.severity}
                      tone={d.severity === 'high' ? 'danger' : d.severity === 'medium' ? 'warning' : 'neutral'}
                    />
                  </View>
                  <Text className="text-sm text-ink-900 mt-2">{d.summary}</Text>
                  <Text className="text-xs text-silver-500 mt-2">
                    Opened {fmtDateShort(d.created_at)} {fmtTime(d.created_at)} · booking {d.booking_id?.slice(0, 8)}
                  </Text>
                  {d.refund_cents > 0 ? (
                    <Text className="text-xs text-brand-700 font-semibold mt-1">
                      Refund: ${(d.refund_cents / 100).toFixed(2)}
                    </Text>
                  ) : null}
                  {['open', 'in_review'].includes(d.status) ? (
                    <View className="mt-4 flex-row gap-2">
                      <Pressable
                        onPress={() => setResolveId(d.id)}
                        className="flex-1 h-11 rounded-2xl bg-brand-600 items-center justify-center flex-row"
                      >
                        <Ionicons name="checkmark" size={16} color="#fff" />
                        <Text className="ml-1 text-sm font-bold text-white">Resolve</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Badge label={d.status.replace(/_/g, ' ')} tone="success" />
                  )}
                </Card>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <PromptSheet
        visible={!!resolveId}
        title="Resolve dispute"
        message="Add resolution notes and an optional refund. Both are recorded in the audit log."
        fields={[
          { key: 'notes', label: 'Resolution notes', placeholder: 'What was decided and why', multiline: true, required: true, minLength: 5 },
          { key: 'refund', label: 'Refund (CAD, 0 for none)', placeholder: '0', keyboardType: 'decimal-pad', defaultValue: '0' },
        ]}
        confirmLabel="Resolve dispute"
        onSubmit={submitResolve}
        onClose={() => setResolveId(null)}
      />
    </SafeAreaView>
  );
}
