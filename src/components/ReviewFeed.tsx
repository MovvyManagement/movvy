// =============================================================================
// ReviewFeed
//
// Compact, embeddable list of public reviews for a partner team or company.
// Pass `teamId` OR `companyId`; the component picks the right RPC.
//
// Use cases:
//   • booking-confirm screen → preview crew before committing
//   • mover/company profile → see what customers say about you
//   • (future) public partner pages
// =============================================================================

import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTeamReviews, useCompanyReviews, type PublicReview } from '@/lib/data';

interface Props {
  teamId?: string | null;
  companyId?: string | null;
  /** Max reviews to show. Defaults to 5 (preview); use 20+ on dedicated screens. */
  limit?: number;
  /** Show a heading row above the list. */
  showHeader?: boolean;
}

export function ReviewFeed({ teamId, companyId, limit = 5, showHeader = true }: Props) {
  const team = useTeamReviews(teamId, limit);
  const company = useCompanyReviews(companyId, limit);
  const reviews = teamId ? team.data : company.data;
  const loading = teamId ? team.isLoading : company.isLoading;

  if (loading && !reviews) {
    return (
      <View className="py-6 items-center">
        <ActivityIndicator color="#16A34A" />
      </View>
    );
  }

  if (!reviews || reviews.length === 0) {
    return (
      <View className="rounded-2xl border border-dashed border-silver-300 px-4 py-5 items-center">
        <Ionicons name="star-outline" size={20} color="#A1A1AA" />
        <Text className="mt-2 text-xs text-silver-500">
          No reviews yet — be the first.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {showHeader ? (
        <View className="flex-row items-center mb-3">
          <Ionicons name="star" size={14} color="#16A34A" />
          <Text className="ml-1.5 text-xs font-bold uppercase tracking-wider text-silver-500">
            Recent reviews
          </Text>
        </View>
      ) : null}
      {reviews.map((r) => (
        <ReviewRow key={r.rating_id} review={r} />
      ))}
    </View>
  );
}

function ReviewRow({ review }: { review: PublicReview }) {
  return (
    <View className="mb-3 rounded-2xl bg-white border border-silver-200 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-ink-900">
          {review.reviewer_display}
        </Text>
        <View className="flex-row items-center">
          {[1, 2, 3, 4, 5].map((i) => (
            <Ionicons
              key={i}
              name={i <= review.overall ? 'star' : 'star-outline'}
              size={12}
              color={i <= review.overall ? '#16A34A' : '#A1A1AA'}
            />
          ))}
        </View>
      </View>
      {review.comment ? (
        <Text className="mt-2 text-sm text-ink-700 leading-5">{review.comment}</Text>
      ) : null}
      {review.tags && review.tags.length > 0 ? (
        <View className="mt-2 flex-row flex-wrap gap-1.5">
          {review.tags.slice(0, 5).map((t) => (
            <View key={t} className="rounded-full bg-brand-50 px-2 py-0.5">
              <Text className="text-[10px] font-semibold text-brand-700">{t}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text className="mt-2 text-[10px] text-silver-400">
        {new Date(review.created_at).toLocaleDateString('en-CA')}
      </Text>
    </View>
  );
}
