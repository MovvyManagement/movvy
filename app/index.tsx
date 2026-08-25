import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { MovvyMark } from '@/components/MovvyMark';
import {
  COVERAGE_LABEL,
  COVERAGE_SHORT,
  TOTAL_MOVES_TAGLINE,
  AVG_RATING_TAGLINE,
} from '@/lib/brand';

export default function Welcome() {
  return (
    <View className="flex-1 bg-white">
      <LinearGradient
        colors={['#ECFDF5', '#FFFFFF']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '60%' }}
      />
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <View className="flex-1 px-6 pt-6">
          <MovvyMark size={40} />

          {/* Hero + value-props. Value props sit between subtitle and CTA so
              they're the last thing read before the user taps Get started —
              maximum recall for "vetted, upfront, tracked." Social-proof
              line above gives the brand instant credibility. */}
          <View className="flex-1 justify-start pt-10">
            <Text className="text-4xl font-bold text-ink-900 leading-[44px]">
              Moving Made Easy,{'\n'}One Click at a Time.
            </Text>
            <Text className="mt-4 text-base text-silver-500 leading-6">
              Book trusted movers in minutes. Track your move in real time.
              Pay only for what you need.
            </Text>

            {/* Three crisp value-props with brand-coloured icon chips. */}
            <View className="mt-7 gap-3">
              <ValueProp
                icon="shield-checkmark"
                title="Vetted crews"
                body={`Background-checked, insured, rated by every customer. ${COVERAGE_SHORT}.`}
              />
              <ValueProp
                icon="pricetag"
                title="Upfront price"
                body="See your total before you book. No surprise fees."
              />
              <ValueProp
                icon="navigate-circle"
                title="Live tracking"
                body="Map, ETA, and direct chat from pickup to drop-off."
              />
            </View>

            {/* Social-proof line — keep it factual; adjust the constants in
                src/lib/brand.ts as the marketplace grows. */}
            <View className="mt-5 flex-row items-center">
              <View className="flex-row -space-x-2">
                {[0, 1, 2].map((i) => (
                  <View
                    key={i}
                    className="h-6 w-6 rounded-full border-2 border-white items-center justify-center"
                    style={{ backgroundColor: ['#16A34A', '#047857', '#0A0A0A'][i] }}
                  >
                    <Ionicons name="person" size={10} color="#fff" />
                  </View>
                ))}
              </View>
              <Text className="ml-3 text-xs text-silver-600">
                <Text className="font-bold text-ink-900">{TOTAL_MOVES_TAGLINE} moves</Text> across Alberta · {AVG_RATING_TAGLINE}★ avg
              </Text>
            </View>
          </View>

          <View className="pb-2">
            <Button
              label="Get started"
              onPress={() => router.push('/(auth)/signup')}
              size="lg"
              fullWidth
            />
            <Pressable
              onPress={() => router.push('/(auth)/login')}
              className="mt-3 h-14 items-center justify-center rounded-2xl border border-silver-300 bg-white active:opacity-70"
            >
              <Text className="text-base font-semibold text-ink-900">I already have an account</Text>
            </Pressable>

            {/* Partner entry has moved off the welcome screen entirely.
                Existing partners with a code use the partner sign-in via
                a quiet text link. Brand-new partners onboard through their
                customer profile after signing up (Profile → Become a
                Movvy partner) — this keeps the welcome focused on the
                primary "book a move" goal. */}
            <View className="mt-6 flex-row items-center justify-center">
              <Text className="text-xs text-silver-500">Already a driver / company? </Text>
              <Link
                href="/(auth)/partner-signin"
                className="text-xs text-brand-700 font-semibold"
              >
                Partner sign-in
              </Link>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

// One row of the welcome hero's value-prop stack. Kept local — these copy
// lines are specific to the marketing message of the welcome screen.
function ValueProp({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View className="flex-row items-start">
      <View className="h-9 w-9 rounded-2xl bg-brand-100 items-center justify-center mt-0.5">
        <Ionicons name={icon} size={18} color="#047857" />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-sm font-bold text-ink-900">{title}</Text>
        <Text className="text-xs text-silver-500 mt-0.5 leading-5">{body}</Text>
      </View>
    </View>
  );
}
