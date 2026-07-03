import React, { useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '@/components/Button';
import { haptic } from '@/lib/haptics';

/**
 * 3-screen swipe-through tour shown after first signup. Sets a flag in
 * AsyncStorage so it never shows twice. Skip / next / finish at the bottom.
 *
 * The customer home calls `markTourSeen()` if they got here via a different
 * path; that way we never re-prompt.
 */

const TOUR_SEEN_KEY = '@movvy/tour-seen-v1';

export async function isTourSeen() {
  try { return (await AsyncStorage.getItem(TOUR_SEEN_KEY)) === '1'; } catch { return true; }
}
export async function markTourSeen() {
  try { await AsyncStorage.setItem(TOUR_SEEN_KEY, '1'); } catch {}
}

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  highlights: string[];
}

const SLIDES: Slide[] = [
  {
    icon: 'cube',
    title: 'Book in 60 seconds',
    body: 'Two addresses, a date — that\'s it. Movvy picks the right crew and truck size based on your move type.',
    highlights: [
      'No phone calls, no quotes-by-email',
      'Flat $175/hr rate · Alberta-wide',
      '20% deposit at booking · balance after the move',
    ],
  },
  {
    icon: 'navigate',
    title: 'Watch every step in real time',
    body: 'Your driver flags 5 stages — left HQ, arrived, loaded, drop-off, done — and you see the live map update each time.',
    highlights: [
      'Driver pin moves smoothly on the map',
      // Push (APNs/FCM) is still deferred — promise only the in-app
      // status + ETA updates that actually ship today. Restore the push
      // wording once notifications land.
      'Live status + ETA updates at every step',
      '"Driver arriving in 5 min" full-screen alert',
    ],
  },
  {
    icon: 'shield-checkmark',
    title: 'Safe, private, fair',
    body: 'Every Movvy crew is background-checked and verified. Calls and texts route through a Movvy line so your real number stays private.',
    highlights: [
      'Photo-ID + criminal record check',
      'Damage protection up to $2,500',
      'Tip your crew 90% goes straight to them',
    ],
  },
];

export default function WelcomeTour() {
  const [idx, setIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const { width } = Dimensions.get('window');

  const goTo = (i: number) => {
    haptic.light();
    setIdx(i);
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
  };

  const finish = async () => {
    haptic.success();
    await markTourSeen();
    router.replace('/(customer)/home');
  };

  return (
    <View className="flex-1 bg-white">
      <LinearGradient
        colors={['#ECFDF5', '#FFFFFF']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%' }}
      />
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <View className="px-6 pt-4 flex-row items-center justify-between">
          <View className="flex-row gap-1.5">
            {SLIDES.map((_, i) => (
              <View
                key={i}
                className={`h-1.5 rounded-full ${i === idx ? 'bg-brand-600 w-8' : 'bg-silver-200 w-4'}`}
              />
            ))}
          </View>
          <Pressable onPress={finish} hitSlop={10}>
            <Text className="text-sm font-semibold text-silver-500">Skip</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
          className="flex-1"
        >
          {SLIDES.map((s) => (
            <View key={s.title} style={{ width }} className="flex-1 px-8 justify-center">
              <View className="h-24 w-24 rounded-3xl bg-brand-600 items-center justify-center self-center">
                <Ionicons name={s.icon} size={48} color="#fff" />
              </View>
              <Text className="mt-8 text-3xl font-bold text-ink-900 text-center leading-9">
                {s.title}
              </Text>
              <Text className="mt-3 text-base text-silver-500 text-center leading-6">{s.body}</Text>

              <View className="mt-8 gap-3">
                {s.highlights.map((h) => (
                  <View key={h} className="flex-row items-start">
                    <Ionicons name="checkmark-circle" size={18} color="#047857" />
                    <Text className="ml-2 flex-1 text-sm text-ink-900 leading-5">{h}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>

        <View className="px-6 pb-2">
          {idx < SLIDES.length - 1 ? (
            <Button label="Next" size="lg" fullWidth onPress={() => goTo(idx + 1)} />
          ) : (
            <Button label="Start booking" size="lg" fullWidth onPress={finish} />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
