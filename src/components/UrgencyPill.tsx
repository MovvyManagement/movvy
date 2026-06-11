import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { JobUrgency } from '@/lib/partnerJobs';

// =============================================================================
// UrgencyPill — the red/amber "Starts in 45m" badge a dispatcher uses to spot
// which unassigned job is on fire. Shared by the company Jobs tab and the
// dashboard's incoming list so both surfaces look identical and stay in sync
// with the jobUrgency() logic. Renders nothing when the job isn't urgent.
// =============================================================================

export function UrgencyPill({ urgency }: { urgency: JobUrgency }) {
  if (urgency.tone === 'critical') {
    return (
      <View className="px-2 py-0.5 rounded-full bg-danger flex-row items-center">
        <Ionicons name="alert-circle" size={12} color="#fff" />
        <Text className="ml-1 text-[10px] font-bold uppercase tracking-wider text-white">
          {urgency.label}
        </Text>
      </View>
    );
  }
  if (urgency.tone === 'warn') {
    return (
      <View className="px-2 py-0.5 rounded-full bg-amber-200 flex-row items-center">
        <Ionicons name="time-outline" size={12} color="#92400E" />
        <Text className="ml-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">
          {urgency.label}
        </Text>
      </View>
    );
  }
  return null;
}
