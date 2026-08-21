// =============================================================================
// ReviewPromptHost
//
// Mounted once at the customer layout level. Listens for any of the user's
// bookings flipping into `completed` status (driver flagged drop-off) and
// pops a modal with:
//   • 1–5 star overall rating
//   • free-form comments
//   • optional tip ($, percentage chips of total)
//
// Submission flow:
//   useSubmitRating  → writes a row in `ratings` (party = customer_to_partner)
//                       → DB trigger refresh_partner_team_rating() updates the
//                         partner's rating_avg / rating_count so drivers + admin
//                         see the new average instantly.
//   useSubmitTip     → routes optional tip via tips-submit edge function.
//
// De-duplication:
//   • a Set ref tracks bookings already prompted in this session
//   • we query existing `ratings` rows for the signed-in customer so a booking
//     that's already been reviewed (e.g. on another device) never re-prompts
//
// Demo mode (no supabase):
//   • no-ops — review collection requires a real backend
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabase, useAuth, supabaseConfigured } from '@/lib/supabase';
import { useBookings, useSubmitRating, useSubmitTip } from '@/lib/data';
import { RatingStars } from './RatingStars';
import { haptic } from '@/lib/haptics';

type PromptTarget = {
  bookingId: string;
  shortCode: string;
  totalDollars: number;
};

export function ReviewPromptHost() {
  const { user } = useAuth();
  const { data: bookings } = useBookings();

  // Pull every rating this customer has already submitted so we never prompt
  // twice for the same booking — even across devices / sessions.
  const ratedQuery = useQuery({
    queryKey: ['my-ratings-given', user?.id],
    enabled: !!user?.id && supabaseConfigured,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('ratings')
        .select('booking_id')
        .eq('from_profile_id', user!.id)
        .eq('party', 'customer_to_partner');
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.booking_id as string));
    },
  });

  // Bookings we saw as in-flight earlier in this session — we only pop the
  // review for genuine transitions (so opening the app to an already-completed
  // booking the user has dismissed before doesn't re-prompt them).
  const seenInFlight = useRef<Set<string>>(new Set());
  const promptedThisSession = useRef<Set<string>>(new Set());

  const [target, setTarget] = useState<PromptTarget | null>(null);

  useEffect(() => {
    if (!bookings || !supabaseConfigured) return;
    const alreadyRated = ratedQuery.data ?? new Set<string>();

    for (const b of bookings) {
      if (b.status !== 'completed') {
        if (
          (['on_the_way', 'arrived', 'loading', 'in_transit', 'unloading'] as string[]).includes(b.status)
        ) {
          seenInFlight.current.add(b.id);
        }
        continue;
      }
      // status === 'completed'
      if (alreadyRated.has(b.id)) continue;
      if (promptedThisSession.current.has(b.id)) continue;
      if (!seenInFlight.current.has(b.id)) {
        // We never saw this booking in-flight in THIS session, so it likely
        // completed before the app opened. Skip — user can rate from the
        // bookings list if they want.
        // (To prompt for ALL unrated completed bookings, drop this guard.)
        continue;
      }
      promptedThisSession.current.add(b.id);
      setTarget({
        bookingId: b.id,
        shortCode: b.short_code,
        totalDollars: tipBaseDollars(b),
      });
      haptic.success();
      break; // one prompt at a time
    }
  }, [bookings, ratedQuery.data]);

  // Persistent banner — surfaces any unrated completed booking from the last
  // 7 days. Catches cases where the auto-popping modal was dismissed,
  // skipped, or the customer wasn't in the app when the move completed.
  // Hides while the modal is already open so we don't double-render.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const alreadyRated = ratedQuery.data ?? new Set<string>();
  const bannerBooking = !target
    ? (bookings ?? []).find((b) => {
        if (b.status !== 'completed') return false;
        if (alreadyRated.has(b.id)) return false;
        // updated_at proxies completion time well enough; fall back to created_at
        const completedAt = new Date((b as any).updated_at ?? b.created_at).getTime();
        return Date.now() - completedAt <= SEVEN_DAYS_MS;
      })
    : null;

  return (
    <>
      {target ? (
        <ReviewModal
          target={target}
          onClose={() => setTarget(null)}
          onSubmitted={() => {
            // refetch the rated-set so the next reconciliation pass skips this booking
            ratedQuery.refetch();
            setTarget(null);
          }}
        />
      ) : null}

      {bannerBooking ? (
        <RateMoveBanner
          shortCode={bannerBooking.short_code}
          onTap={() =>
            setTarget({
              bookingId: bannerBooking.id,
              shortCode: bannerBooking.short_code,
              totalDollars: tipBaseDollars(bannerBooking),
            })
          }
        />
      ) : null}
    </>
  );
}

/**
 * What the tip percentage should be a share of.
 *
 * The ESTIMATE is the wrong base and was the one being used. A move quoted at
 * $2,586 that actually billed $110 offered a "20%" chip of $517 — five times
 * the entire move, and rejected by the tip endpoint for exactly that reason.
 * Tip on what the customer actually paid.
 */
function tipBaseDollars(b: { actual_total_cents?: number | null; price_total_cents: number }): number {
  return (b.actual_total_cents ?? b.price_total_cents) / 100;
}

// ─── persistent banner ─────────────────────────────────────────────────────
// Renders inline at the top of whichever screen mounts ReviewPromptHost
// (currently home.tsx). Yellow accent so it draws the eye without being
// alarmist; tappable area covers the whole row.
function RateMoveBanner({
  shortCode,
  onTap,
}: {
  shortCode: string;
  onTap: () => void;
}) {
  return (
    <Pressable
      onPress={onTap}
      className="mx-5 mt-3 mb-1 rounded-2xl bg-amber-50 border border-amber-200 p-3 flex-row items-center active:opacity-80"
    >
      <View className="h-9 w-9 rounded-full bg-amber-100 items-center justify-center">
        <Ionicons name="star-outline" size={18} color="#B45309" />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-sm font-bold text-ink-900">Rate your move</Text>
        <Text className="text-xs text-silver-600 mt-0.5">
          Booking #{shortCode} · takes 10 seconds
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#B45309" />
    </Pressable>
  );
}

// ─── modal ──────────────────────────────────────────────────────────────────

const TIP_OPTIONS: { label: string; pct: number }[] = [
  { label: '15%', pct: 15 },
  { label: '18%', pct: 18 },
  { label: '20%', pct: 20 },
  { label: '25%', pct: 25 },
];

function ReviewModal({
  target,
  onClose,
  onSubmitted,
}: {
  target: PromptTarget;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [tipPct, setTipPct] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitRating = useSubmitRating();
  const submitTip = useSubmitTip();

  const tipDollars = tipPct ? Math.round(target.totalDollars * (tipPct / 100)) : 0;

  const submit = async () => {
    if (stars < 1) {
      Alert.alert('Pick a rating', 'Tap 1–5 stars to rate your crew.');
      return;
    }
    setSubmitting(true);
    try {
      await submitRating.mutateAsync({
        booking_id: target.bookingId,
        party: 'customer_to_partner',
        overall: stars,
        comment: comment.trim() || undefined,
      });
      // The rating is saved. From here on, a tip problem must not read as
      // "your rating failed" — that's what the old catch-all did, and it sent
      // people back to re-rate a crew they'd already rated.
      if (tipDollars > 0) {
        try {
          const res = await submitTip.mutateAsync({
            booking_id: target.bookingId,
            amount_cents: tipDollars * 100,
          });
          if ((res as any)?.canceled) {
            // They backed out of the payment sheet. Not an error — the rating
            // stands and they can tip later from My Moves.
            haptic.success();
            onSubmitted();
            return;
          }
        } catch (tipErr: any) {
          haptic.success();
          onSubmitted();
          Alert.alert(
            'Rating saved — tip not charged',
            `${tipErr?.message ?? 'The tip could not be charged.'}\n\nYou can tip from My Moves any time in the next 24 hours.`,
          );
          return;
        }
      }
      haptic.success();
      onSubmitted();
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message ?? 'Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
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
            style={{ maxHeight: '92%' }}
          >
            <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 36 }}>
              <View className="items-center">
                <View className="h-16 w-16 rounded-full bg-brand-100 items-center justify-center">
                  <Ionicons name="checkmark-circle" size={32} color="#047857" />
                </View>
                <Text className="mt-4 text-2xl font-bold text-ink-900">Move complete</Text>
                <Text className="mt-1 text-sm text-silver-500">
                  Booking #{target.shortCode}
                </Text>
                <Text className="mt-3 text-base text-silver-600 text-center">
                  How was your move? Your rating helps your crew and other customers.
                </Text>
              </View>

              {/* Stars */}
              <View className="mt-6 items-center">
                <RatingStars value={stars} onChange={setStars} size={42} />
                <Text className="mt-2 text-xs text-silver-500">
                  {stars === 0 ? 'Tap to rate' : `${stars} / 5`}
                </Text>
              </View>

              {/* Comments */}
              <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
                Comments (optional)
              </Text>
              <View className="rounded-2xl border border-silver-200 bg-white p-3">
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="What stood out about your crew? Anything that could be better?"
                  placeholderTextColor="#A1A1AA"
                  multiline
                  maxLength={500}
                  className="text-base text-ink-900"
                  style={{ minHeight: 80, textAlignVertical: 'top' }}
                />
              </View>

              {/* Tip */}
              <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
                Add a tip (optional)
              </Text>
              <View className="flex-row gap-2">
                {TIP_OPTIONS.map((opt) => {
                  const selected = tipPct === opt.pct;
                  return (
                    <Pressable
                      key={opt.pct}
                      onPress={() => setTipPct(selected ? null : opt.pct)}
                      className={`flex-1 rounded-2xl py-3 items-center border ${
                        selected ? 'bg-brand-600 border-brand-600' : 'bg-white border-silver-200'
                      }`}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          selected ? 'text-white' : 'text-ink-900'
                        }`}
                      >
                        {opt.label}
                      </Text>
                      <Text
                        className={`text-[10px] ${
                          selected ? 'text-white/80' : 'text-silver-500'
                        }`}
                      >
                        ${Math.round(target.totalDollars * (opt.pct / 100))}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {tipPct ? (
                <Text className="mt-2 text-xs text-silver-500 text-center">
                  ${tipDollars} tip will be added — 100% goes to your crew.
                </Text>
              ) : (
                <Text className="mt-2 text-xs text-silver-500 text-center">
                  No tip required. Want to skip? Submit without picking one.
                </Text>
              )}

              {/* Submit */}
              <Pressable
                onPress={submit}
                disabled={submitting}
                className={`mt-7 h-14 rounded-2xl items-center justify-center ${
                  submitting ? 'bg-silver-300' : 'bg-brand-600 active:opacity-90'
                }`}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-bold text-white">
                    {tipDollars > 0 ? `Submit · $${tipDollars} tip` : 'Submit rating'}
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={onClose}
                disabled={submitting}
                className="mt-2 h-12 items-center justify-center"
              >
                <Text className="text-sm font-semibold text-silver-500">
                  Rate later
                </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
