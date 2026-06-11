// =============================================================================
// EarningsExportSheet — pick a year, get a PDF or CSV.
//
// Mounted from both (mover)/earnings.tsx and (company)/earnings.tsx. Takes a
// recipient (driverProfileId | teamId | companyId), loads the statement on
// demand via useEarningsStatement, and offers Save-as-PDF or Download CSV
// buttons. Both share the same export sheet — no inline logic on the screens.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEarningsStatement } from '@/lib/data';
import { shareEarningsPdf, shareEarningsCsv } from '@/lib/printEarnings';
import { useToast } from './Toast';
import { fmtCurrency } from '@/lib/format';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  partnerName: string;
  driverProfileId?: string;
  teamId?: string;
  companyId?: string;
}

export function EarningsExportSheet({
  visible,
  onClose,
  partnerName,
  driverProfileId,
  teamId,
  companyId,
}: Props) {
  // Show current year + 2 prior years; bookkeepers usually need the prior
  // year for tax season.
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now, now - 1, now - 2];
  }, []);
  const [year, setYear] = useState<number>(years[0]);
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const toast = useToast();

  const { data: statement, isLoading } = useEarningsStatement({
    year,
    partnerName,
    driverProfileId,
    teamId,
    companyId,
    enabled: visible,
  });

  const onPdf = async () => {
    if (!statement) return;
    setBusy('pdf');
    try {
      await shareEarningsPdf(statement);
      haptic.success();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate the PDF.");
    } finally {
      setBusy(null);
    }
  };

  const onCsv = async () => {
    if (!statement) return;
    setBusy('csv');
    try {
      await shareEarningsCsv(statement);
      haptic.success();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate the CSV.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl bg-white"
          style={{ maxHeight: '90%' }}
        >
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 36 }}>
            <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />

            <Text className="text-xl font-bold text-ink-900">Export earnings statement</Text>
            <Text className="mt-1 text-sm text-silver-500">
              Pick a year — we'll generate a printable PDF and a spreadsheet
              CSV your accountant can drop straight into bookkeeping software.
            </Text>

            <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-silver-500">
              Period
            </Text>
            <View className="flex-row gap-2">
              {years.map((y) => {
                const sel = year === y;
                return (
                  <Pressable
                    key={y}
                    onPress={() => setYear(y)}
                    className={`flex-1 rounded-2xl border py-3 items-center ${
                      sel ? 'bg-brand-600 border-brand-600' : 'bg-white border-silver-200'
                    }`}
                  >
                    <Text
                      className={`text-base font-bold ${sel ? 'text-white' : 'text-ink-900'}`}
                    >
                      {y}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Summary card */}
            <View className="mt-5 rounded-2xl border border-silver-200 p-4">
              {isLoading || !statement ? (
                <View className="py-6 items-center">
                  <ActivityIndicator color="#16A34A" />
                </View>
              ) : statement.jobs.length === 0 ? (
                <View className="py-3">
                  <Text className="text-sm font-bold text-ink-900">No payouts in {year}</Text>
                  <Text className="mt-1 text-xs text-silver-500">
                    Nothing to export — pick another year, or come back once
                    you've completed some moves.
                  </Text>
                </View>
              ) : (
                <View>
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-xs text-silver-500 uppercase font-semibold">
                      Gross
                    </Text>
                    <Text className="text-sm font-semibold text-ink-900">
                      {fmtCurrency(statement.totalGrossCents / 100)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-xs text-silver-500 uppercase font-semibold">
                      Movvy fees
                    </Text>
                    <Text className="text-sm font-semibold text-ink-900">
                      -{fmtCurrency(statement.totalFeeCents / 100)}
                    </Text>
                  </View>
                  <View className="h-px bg-silver-200 my-2" />
                  <View className="flex-row justify-between">
                    <Text className="text-sm font-bold text-ink-900">Net payout</Text>
                    <Text className="text-base font-bold text-brand-700">
                      {fmtCurrency(statement.totalNetCents / 100)}
                    </Text>
                  </View>
                  <Text className="mt-2 text-[11px] text-silver-500">
                    Across {statement.jobs.length}{' '}
                    {statement.jobs.length === 1 ? 'job' : 'jobs'}.
                  </Text>
                </View>
              )}
            </View>

            <View className="mt-5 gap-2">
              <Pressable
                onPress={onPdf}
                disabled={busy != null || !statement || statement.jobs.length === 0}
                className={`h-14 rounded-2xl items-center justify-center flex-row ${
                  busy === 'pdf' || !statement || statement.jobs.length === 0
                    ? 'bg-silver-300'
                    : 'bg-brand-600 active:opacity-90'
                }`}
              >
                {busy === 'pdf' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="document-text" size={18} color="#fff" />
                    <Text className="ml-2 text-base font-bold text-white">
                      Save as PDF
                    </Text>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={onCsv}
                disabled={busy != null || !statement || statement.jobs.length === 0}
                className={`h-14 rounded-2xl items-center justify-center flex-row border ${
                  busy === 'csv' || !statement || statement.jobs.length === 0
                    ? 'bg-silver-100 border-silver-200'
                    : 'bg-white border-silver-300 active:opacity-80'
                }`}
              >
                {busy === 'csv' ? (
                  <ActivityIndicator color="#71717A" />
                ) : (
                  <>
                    <Ionicons name="grid-outline" size={18} color="#0A0A0A" />
                    <Text className="ml-2 text-base font-bold text-ink-900">
                      Download CSV
                    </Text>
                  </>
                )}
              </Pressable>
              <Pressable onPress={onClose} className="h-12 items-center justify-center">
                <Text className="text-sm font-semibold text-silver-500">Cancel</Text>
              </Pressable>
            </View>

            <Text className="mt-4 text-[11px] text-silver-500 text-center">
              Informational summary of platform payouts — not an official CRA
              tax slip. Drivers are independent contractors.
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
