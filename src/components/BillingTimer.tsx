// =============================================================================
// BillingTimer — running clock + running dollar amount for an in-progress
// move. Driver-facing copy.
//
// States:
//   1. Not started (status before 'arrived')   → "Timer starts at Begin Move"
//   2. Started + not completed                  → live HH:MM:SS + live $
//   3. Completed                                → final hours + final payout
//
// The dollar amount is just hours × rate, ticking forward every second.
// This is a preview — the authoritative number is what the server computes
// in bookings-update-status when Finish Move is pressed.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 4-hour labor minimum — mirrors MIN_BILLABLE_HOURS in the server's
// computeActualBill so the live meter matches the final invoice.
const MIN_BILLABLE_HOURS = 4;

interface BillingTimerProps {
  startedAt?: string | null;
  completedAt?: string | null;
  hourlyRateCustomerCents?: number | null;
  /** When provided, we surface the driver's take (= total × 0.80) rather
   *  than the customer-facing total. Customer view passes the total. */
  showDriverPayout?: boolean;
  /** Pre-computed actual_total_cents from DB when the move is complete. */
  actualTotalCents?: number | null;
  /** Pre-computed actual_driver_payout_cents from DB when complete. */
  actualDriverPayoutCents?: number | null;
  /** Hourly crew are paid a wage, not per move — they must never see any
   *  dollar figure. When true we keep the running/elapsed CLOCK but drop every
   *  money amount. */
  hideMoney?: boolean;

  // ── Long-haul ────────────────────────────────────────────────────────────
  /** True when transit is charged per km instead of by the clock. */
  isLongHaul?: boolean;
  /** The fixed transit charge, added to the running figure from the start. */
  transitCents?: number | null;
  /** When the crew pressed "in transit" — the highway stops the meter. */
  inTransitAt?: string | null;
  /** When they pressed "unloading" — the meter starts again. */
  unloadingAt?: string | null;
}

export function BillingTimer({
  startedAt,
  completedAt,
  hourlyRateCustomerCents,
  showDriverPayout,
  actualTotalCents,
  actualDriverPayoutCents,
  hideMoney,
  isLongHaul,
  transitCents,
  inTransitAt,
  unloadingAt,
}: BillingTimerProps) {
  // 1Hz tick — only when the move is actively running. We stop the
  // interval the moment completedAt lands so finished cards don't waste
  // a render every second.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt || completedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt, completedAt]);

  // ── State 1: not started ────────────────────────────────────────────
  if (!startedAt) {
    return (
      <View className="mt-3 rounded-3xl bg-silver-50 border border-silver-200 p-5 flex-row items-center">
        <View className="h-11 w-11 rounded-2xl bg-white border border-silver-200 items-center justify-center">
          <Ionicons name="timer-outline" size={20} color="#71717A" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-sm font-bold text-ink-900">Billing timer paused</Text>
          <Text className="text-xs text-silver-500 mt-0.5">
            Press <Text className="font-bold">Begin Move</Text> when you arrive at the pickup to start the timer.
          </Text>
        </View>
      </View>
    );
  }

  // Hours elapsed — used by both running + finished states.
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const elapsedMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  // Running cost — service only (materials + fuel + GST are added at
  // completion by the server). For the driver this is a "billing so far"
  // hero; precise final math happens on Finish Move.
  const rateCents = hourlyRateCustomerCents ?? 17500;

  // On a long haul the highway is paid for by the kilometre, so the meter has
  // to STOP for the drive — otherwise the customer watches their bill climb
  // through three hours of QE2 they've already paid a fixed price for. Deduct
  // the transit span (still open while they're driving) and add the fixed
  // transit charge, which is known from the moment the move is booked.
  const transitStart = inTransitAt ? new Date(inTransitAt).getTime() : null;
  const transitEnd = unloadingAt ? new Date(unloadingAt).getTime() : null;
  const transitMs = isLongHaul && transitStart
    ? Math.max(0, (transitEnd ?? end) - transitStart)
    : 0;
  const billableMs = Math.max(0, elapsedMs - transitMs);
  // 4-hour labor minimum: a short job still bills for at least 4 hours of
  // on-site work — matches the server's computeActualBill and the estimate.
  // Long-haul transit is billed per km and is never floored.
  const workedHours = billableMs / 3_600_000;
  const billedHours = Math.max(MIN_BILLABLE_HOURS, workedHours);
  const minimumApplied = workedHours < MIN_BILLABLE_HOURS;
  const liveServiceCents =
    Math.round(billedHours * rateCents) + (isLongHaul ? (transitCents ?? 0) : 0);
  const onTheHighway = isLongHaul && !!transitStart && !transitEnd && !completedAt;
  // Approximate live driver take — 80% of running service cost. The real
  // 80% is computed on the FINAL total (after GST/materials/fuel) so this
  // undershoots a tiny bit on cross-city moves.
  const liveDriverCents = Math.round(liveServiceCents * 0.8);

  // ── State 3: completed ──────────────────────────────────────────────
  if (completedAt) {
    // Use the server-computed actuals when present (preferred). Fall back
    // to running math if for some reason the columns aren't filled yet.
    const totalCents = actualTotalCents ?? liveServiceCents;
    const driverCents = actualDriverPayoutCents ?? liveDriverCents;
    const displayCents = showDriverPayout ? driverCents : totalCents;
    const displayLabel = showDriverPayout ? 'Your payout' : 'Customer billed';
    return (
      <View className="mt-3 rounded-3xl bg-brand-50 border border-brand-200 p-5">
        <View className="flex-row items-center">
          <View className="h-11 w-11 rounded-2xl bg-brand-600 items-center justify-center">
            <Ionicons name="checkmark-done" size={22} color="#fff" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
              Move complete · worked {clock}
            </Text>
            {hideMoney ? (
              <Text className="text-2xl font-bold text-ink-900 mt-1">Done</Text>
            ) : (
              <>
                <Text className="text-2xl font-bold text-ink-900 mt-1">
                  ${(displayCents / 100).toFixed(2)}
                </Text>
                <Text className="text-xs text-silver-600 mt-0.5">
                  {displayLabel}
                  {minimumApplied ? ' · 4-hour minimum' : ''}
                </Text>
              </>
            )}
          </View>
        </View>
      </View>
    );
  }

  // ── State 2: running ────────────────────────────────────────────────
  const displayCents = showDriverPayout ? liveDriverCents : liveServiceCents;
  const displayLabel = showDriverPayout ? 'Your running payout' : 'Customer running total';
  return (
    <View className="mt-3 rounded-3xl bg-ink-900 p-5">
      <View className="flex-row items-center">
        <View className="h-11 w-11 rounded-2xl bg-brand-600 items-center justify-center">
          <View className="h-2 w-2 rounded-full bg-white" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-xs font-semibold uppercase tracking-wider text-brand-300">
            {onTheHighway ? 'On the road · meter paused' : 'Move in progress · billing live'}
          </Text>
          <Text
            className="text-3xl font-bold text-white mt-1"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {clock}
          </Text>
        </View>
        {hideMoney ? null : (
          <View className="items-end">
            <Text className="text-xs font-semibold uppercase tracking-wider text-brand-300">
              {displayLabel}
            </Text>
            <Text
              className="text-2xl font-bold text-white mt-1"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              ${(displayCents / 100).toFixed(2)}
            </Text>
            {minimumApplied ? (
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-brand-300 mt-0.5">
                4-hr minimum
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
