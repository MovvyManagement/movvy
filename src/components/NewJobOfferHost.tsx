// =============================================================================
// NewJobOfferHost
//
// Full-screen blocking modal that fires the moment a brand-new `searching`
// booking appears in the partner's queue. The driver / dispatcher MUST tap
// Accept or Reject to dismiss it — they can't navigate the app while it's
// open. Matches the Uber/Lyft "ping" pattern: high-priority interrupt that
// forces a decision before the booking gets taken by someone else.
//
// Who sees it (only the OPERATORS who earn per move — the popup shows the job
// price, so hourly laborers are excluded by design):
//   • Solo / 2-person team DRIVER → any new `searching` booking in their city
//                                    ⇒ Accept calls bookings-accept
//   • Company OWNER / dispatcher  → new_request bucket from dispatch_queue
//                                    ⇒ Accept calls bookings-dispatch-accept
//   • Company DRIVER  → nothing. They're hourly; their dispatcher does intake.
//   • Team MOVER      → nothing. They're hourly; their team's driver/operator
//                       accepts on the crew's behalf.
//
// Behaviour:
//   • On first mount, every booking already in the queue is treated as
//     "seen" — we only pop the modal for jobs that appear AFTER the user
//     opens the app. Avoids interrupting them with stale jobs.
//   • One modal at a time. If multiple new bookings appear, the queue
//     surfaces them one at a time as the user actions each.
//   • Reject just dismisses for the solo driver (no commitment yet); for
//     the company dispatcher it records the decline via bookings-dispatch-decline.
//
// Mounted on (mover)/jobs.tsx and (company)/dashboard.tsx — the primary
// landing screens for each surface, which Expo Router keeps mounted across
// tab switches so the offer can fire regardless of which tab is active.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useMyMembership,
  useAvailableJobs,
  useDispatchQueue,
  useAcceptBooking,
  useDispatcherAccept,
  useFleetReadiness,
  useDispatcherDecline,
} from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';
import { acceptBlock, requiredCrew, requiredTruckFt } from '@/lib/truckFit';
import { fmtCurrency, fmtDateShort } from '@/lib/format';

interface JobOffer {
  id: string;
  short_code: string;
  move_type: string;
  pickup_line1: string;
  pickup_city: string;
  dropoff_line1: string | null;
  dropoff_city: string | null;
  scheduled_for_date: string;
  scheduled_for_window: string | null;
  price_total_cents: number;
  /** Capacity, so the popup can refuse with a reason instead of a 400. */
  required_truck_ft?: number;
  required_crew?: number;
}

export function NewJobOfferHost() {
  const { data: membership } = useMyMembership();

  // Bail completely for users this doesn't apply to (customers, and the hourly
  // laborers — company drivers + team movers — who don't accept jobs). Only
  // the per-move operators below get the offer.
  const kind = membership?.kind;
  const role = membership?.role;
  const isSoloDriver = kind === 'team' && role === 'driver';
  const isDispatcher = kind === 'company' && (role === 'owner' || role === 'dispatcher');

  if (!isSoloDriver && !isDispatcher) return null;

  if (isSoloDriver) {
    // Each branch renders its own host; the data hooks differ. Splitting
    // by branch avoids calling hooks conditionally inside one component.
    return <SoloTeamOfferHost citySlug={membership!.city_slug ?? 'calgary'} />;
  }
  return <CompanyDispatcherOfferHost companyId={membership!.company_id!} />;
}

// ─── Solo 2-person team driver ─────────────────────────────────────────────

function SoloTeamOfferHost({ citySlug }: { citySlug: string }) {
  // City comes from useMyMembership so a team registered in Edmonton sees
  // Edmonton job pings, not Calgary's. Hardcoded fallback only matters
  // while membership is loading.
  const { data: jobs } = useAvailableJobs(citySlug);
  const accept = useAcceptBooking();
  const { data: fleet } = useFleetReadiness();
  const toast = useToast();

  const [offer, setOffer] = useState<JobOffer | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  // First load → mark every existing job as "seen" so we don't pop a stale
  // booking the second the app opens. Only NEW jobs after this point
  // trigger the popup.
  useEffect(() => {
    if (!jobs) return;
    if (!initialized.current) {
      jobs.forEach((j) => seenIds.current.add(j.id));
      initialized.current = true;
      return;
    }
    if (offer) return; // already showing one — wait for action
    const next = jobs.find((j) => !seenIds.current.has(j.id));
    if (next) {
      haptic.success();
      setOffer({
        id: next.id,
        short_code: next.short_code,
        move_type: next.move_type,
        pickup_line1: next.pickup_line1,
        pickup_city: next.pickup_city,
        dropoff_line1: next.dropoff_line1,
        dropoff_city: next.dropoff_city,
        scheduled_for_date: next.scheduled_for_date,
        scheduled_for_window: next.scheduled_for_window,
        price_total_cents: next.price_total_cents,
        required_truck_ft: requiredTruckFt(next),
        required_crew: requiredCrew(next),
      });
    }
  }, [jobs, offer]);

  const onAccept = async () => {
    if (!offer) return;
    const blocked = acceptBlock(fleet, offer);
    if (blocked) {
      haptic.warning();
      toast.error(blocked.body);
      return;
    }
    try {
      await accept.mutateAsync({ booking_id: offer.id });
      haptic.success();
      toast.success(`Accepted #${offer.short_code}. Head to pickup.`);
      seenIds.current.add(offer.id);
      setOffer(null);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not accept — try again.');
    }
  };

  const onReject = () => {
    if (!offer) return;
    seenIds.current.add(offer.id);
    setOffer(null);
  };

  return (
    <OfferModal
      offer={offer}
      busy={accept.isPending}
      acceptLabel="Accept job"
      onAccept={onAccept}
      onReject={onReject}
      kindLabel="New job available"
    />
  );
}

// ─── Company dispatcher (owner + dispatcher) ───────────────────────────────

function CompanyDispatcherOfferHost({ companyId }: { companyId: string }) {
  const { data: queue } = useDispatchQueue(companyId);
  const { data: fleet } = useFleetReadiness();
  const accept = useDispatcherAccept();
  const decline = useDispatcherDecline();
  const toast = useToast();

  const [offer, setOffer] = useState<JobOffer | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (!queue) return;
    // Only consider the "new_request" bucket — needs-driver rows are
    // already accepted and need a separate UX (the dispatch screen).
    const newRequests = queue.filter((q) => q.bucket === 'new_request');

    if (!initialized.current) {
      newRequests.forEach((j) => seenIds.current.add(j.id));
      initialized.current = true;
      return;
    }
    if (offer) return;
    const next = newRequests.find((j) => !seenIds.current.has(j.id));
    if (next) {
      haptic.success();
      setOffer({
        id: next.id,
        short_code: next.short_code,
        move_type: next.move_type,
        pickup_line1: next.pickup_line1,
        pickup_city: next.pickup_city,
        dropoff_line1: next.dropoff_line1,
        dropoff_city: next.dropoff_city,
        scheduled_for_date: next.scheduled_for_date,
        scheduled_for_window: next.scheduled_for_window,
        price_total_cents: next.price_total_cents,
      });
    }
  }, [queue, offer]);

  const onAccept = async () => {
    if (!offer) return;
    // Same gate as the Jobs board — no truck / unapproved registration / too
    // small says so plainly, and the job stays in the pool.
    const blocked = acceptBlock(fleet, offer);
    if (blocked) {
      haptic.warning();
      toast.error(blocked.body);
      return;
    }
    try {
      await accept.mutateAsync({ booking_id: offer.id, company_id: companyId });
      haptic.success();
      toast.success(`Accepted #${offer.short_code}. Assign a driver from Dispatch.`);
      seenIds.current.add(offer.id);
      setOffer(null);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not accept — try again.');
    }
  };

  const onReject = async () => {
    if (!offer) return;
    try {
      // Logs a decline signal so the matcher learns we're not interested.
      await decline.mutateAsync({ booking_id: offer.id, company_id: companyId });
    } catch {
      // Non-fatal — still dismiss the UI.
    }
    seenIds.current.add(offer.id);
    setOffer(null);
  };

  return (
    <OfferModal
      offer={offer}
      busy={accept.isPending || decline.isPending}
      acceptLabel="Accept for company"
      onAccept={onAccept}
      onReject={onReject}
      kindLabel="New booking request"
    />
  );
}

// ─── Shared modal ─────────────────────────────────────────────────────────

function OfferModal({
  offer,
  busy,
  acceptLabel,
  kindLabel,
  onAccept,
  onReject,
}: {
  offer: JobOffer | null;
  busy: boolean;
  acceptLabel: string;
  kindLabel: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  // Subtle pulse on the headline so it grabs attention without being
  // annoying. Drops in instantly on appear; ticks until the user actions.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!offer) return;
    pulse.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: false }),
      ]),
    ).start();
  }, [offer, pulse]);
  const pulseBg = pulse.interpolate({ inputRange: [0, 1], outputRange: ['#16A34A', '#047857'] });

  if (!offer) return null;

  return (
    <Modal
      visible
      transparent={false}
      animationType="slide"
      // Force a decision — system back / swipe-down should not close.
      onRequestClose={() => { /* deliberate no-op */ }}
    >
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 80 }}>
          {/* Pulsing chip */}
          <Animated.View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: pulseBg as any,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Ionicons name="notifications" size={14} color="#fff" />
            <Text className="ml-1.5 text-[11px] font-bold uppercase tracking-wider text-white">
              {kindLabel}
            </Text>
          </Animated.View>

          <Text className="mt-5 text-3xl font-bold text-ink-900">
            {fmtCurrency(offer.price_total_cents / 100)}
          </Text>
          <Text className="mt-1 text-sm text-silver-500">
            {offer.move_type.replace(/_/g, ' ')} · #{offer.short_code}
          </Text>

          {/* Route */}
          <View className="mt-7 rounded-3xl border border-silver-200 p-5">
            <View className="flex-row">
              <View className="items-center mr-3">
                <View className="h-3 w-3 rounded-full bg-ink-900" />
                <View className="w-0.5 flex-1 my-1 bg-silver-300" style={{ minHeight: 28 }} />
                <View className="h-3 w-3 rounded-full bg-brand-600" />
              </View>
              <View className="flex-1">
                <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
                  Pickup
                </Text>
                <Text className="mt-0.5 text-base font-bold text-ink-900" numberOfLines={2}>
                  {offer.pickup_line1}
                </Text>
                <Text className="text-xs text-silver-500 mb-4">{offer.pickup_city}</Text>
                <Text className="text-[10px] font-bold uppercase tracking-wider text-silver-500">
                  Drop-off
                </Text>
                <Text className="mt-0.5 text-base font-bold text-ink-900" numberOfLines={2}>
                  {offer.dropoff_line1 ?? 'In-home'}
                </Text>
                <Text className="text-xs text-silver-500">{offer.dropoff_city ?? ''}</Text>
              </View>
            </View>
          </View>

          {/* Schedule */}
          <View className="mt-3 rounded-3xl bg-silver-50 p-4 flex-row items-center">
            <Ionicons name="calendar-outline" size={20} color="#0A0A0A" />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-bold text-ink-900">
                {fmtDateShort(offer.scheduled_for_date)}
              </Text>
              {offer.scheduled_for_window ? (
                <Text className="text-xs text-silver-500">{offer.scheduled_for_window}</Text>
              ) : null}
            </View>
          </View>

          <View className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex-row items-start">
            <Ionicons name="alert-circle" size={16} color="#92400E" />
            <Text className="ml-2 flex-1 text-[11px] text-amber-800 leading-4">
              Accept or reject to keep using the app. Other crews are seeing
              this too — first to accept wins.
            </Text>
          </View>
        </ScrollView>

        {/* Action bar — sticky-feeling at the bottom of the screen */}
        <View
          className="border-t border-silver-100 px-5 pt-3 bg-white flex-row gap-3"
          style={{ paddingBottom: 28 }}
        >
          <Pressable
            onPress={onReject}
            disabled={busy}
            className="flex-1 h-14 rounded-2xl bg-silver-100 items-center justify-center active:opacity-80"
          >
            <Text className="text-base font-bold text-ink-900">Reject</Text>
          </Pressable>
          <Pressable
            onPress={onAccept}
            disabled={busy}
            className={`flex-[2] h-14 rounded-2xl items-center justify-center flex-row ${
              busy ? 'bg-silver-300' : 'bg-brand-600 active:opacity-90'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text className="ml-2 text-base font-bold text-white">{acceptLabel}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
