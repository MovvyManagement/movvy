// =============================================================================
// AppSplash — branded animated loading screen (cold start)
//
// Renders above every other surface on cold start. The native expo-splash image
// (the "movvy" wordmark on white) shows until our JS bundle is ready, then this
// component paints over it and plays the brand intro:
//   • three green speed-strips slide in from the left, staggered
//   • the lowercase "mo<vv>y" wordmark rises + settles, the "vv" in brand green
//   • the tagline fades up
//   • a progress bar fills while the QueryClient / Sentry / analytics hydrate
//   • the "ALBERTA WIDE" footer fades in last
// then the whole overlay fades out and unmounts.
//
// Type is intentionally the system black weight (SF Pro / Roboto-black). The app
// loads no custom fonts, so pulling a webfont here would flash system → webfont
// on the very first frame. Locked to the light look — the brand splash is always
// dark-on-white, matching the native splash underneath so the handoff is seamless.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Platform, StyleSheet } from 'react-native';

interface Props {
  /** Total time the splash is visible, including fade-out. Default 5000 ms. */
  durationMs?: number;
  /** Fires once the splash has finished its fade-out. The parent unmounts it. */
  onFinish: () => void;
}

const GREEN = '#0FA353';
const WORD_INK = '#161615';
const TAG_INK = 'rgba(40,43,42,0.55)';
const FOOT_INK = 'rgba(40,43,42,0.40)';
const TRACK = 'rgba(40,43,42,0.12)';
const TRACK_WIDTH = 104;
const EASE = Easing.bezier(0.2, 0.7, 0.3, 1);
const FADE_OUT = 400;

// The three cargo speed-strips, widest at the bottom (matches the mark).
const STRIPS = [
  { w: 26, delay: 50 },
  { w: 42, delay: 150 },
  { w: 58, delay: 250 },
];

const WORD_FONT = Platform.select({ ios: 'System', android: 'sans-serif-black', default: 'System' });
const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export function AppSplash({ durationMs = 5000, onFinish }: Props) {
  // One driver per animated element; each interpolates its own transform/opacity.
  const strip0 = useRef(new Animated.Value(0)).current;
  const strip1 = useRef(new Animated.Value(0)).current;
  const strip2 = useRef(new Animated.Value(0)).current;
  const stripVals = [strip0, strip1, strip2];
  const word = useRef(new Animated.Value(0)).current;
  const tag = useRef(new Animated.Value(0)).current;
  const foot = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current; // width — non-native driver
  const container = useRef(new Animated.Value(1)).current; // exit fade
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const intro = (val: Animated.Value, delay: number, duration: number) =>
      Animated.timing(val, { toValue: 1, delay, duration, easing: EASE, useNativeDriver: true });

    Animated.parallel([
      ...STRIPS.map((s, i) => intro(stripVals[i], s.delay, 500)),
      intro(word, 300, 550),
      intro(tag, 750, 500),
      intro(foot, 1100, 500),
      // Progress bar animates `width`, so it can't use the native driver. It
      // fills across the whole hold so it reaches 100% right as we exit —
      // reading as "loading complete" rather than sitting idle.
      Animated.timing(bar, {
        toValue: 1,
        delay: 900,
        duration: Math.max(600, durationMs - 900 - FADE_OUT),
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();

    const exitAt = Math.max(1200, durationMs - FADE_OUT);
    const t = setTimeout(() => {
      setExiting(true);
      Animated.timing(container, {
        toValue: 0,
        duration: FADE_OUT,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => finished && onFinish());
    }, exitAt);
    return () => clearTimeout(t);
    // Drivers are refs (stable); only the timing inputs matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, onFinish]);

  return (
    <Animated.View
      pointerEvents={exiting ? 'none' : 'auto'}
      style={[styles.fill, { opacity: container }]}
      accessibilityRole="image"
      accessibilityLabel="Movvy — your move, booked in 60 seconds"
    >
      {/* Wordmark lockup: speed-strips + "movvy", nudged just above center. */}
      <View style={styles.center}>
        <View style={styles.lockup}>
          <View style={styles.strips}>
            {STRIPS.map((s, i) => (
              <Animated.View
                key={s.w}
                style={{
                  width: s.w,
                  height: 9,
                  borderRadius: 5,
                  backgroundColor: GREEN,
                  opacity: stripVals[i].interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] }),
                  transform: [
                    { translateX: stripVals[i].interpolate({ inputRange: [0, 1], outputRange: [-38, 0] }) },
                  ],
                }}
              />
            ))}
          </View>

          <Animated.Text
            allowFontScaling={false}
            style={[
              styles.word,
              { fontFamily: WORD_FONT },
              {
                opacity: word,
                transform: [
                  { translateY: word.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                  { scale: word.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                ],
              },
            ]}
          >
            mo<Text style={{ color: GREEN }}>vv</Text>y
          </Animated.Text>
        </View>

        <Animated.Text
          allowFontScaling={false}
          style={[
            styles.tag,
            {
              opacity: tag,
              transform: [{ translateY: tag.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          Your move, booked in 60 seconds
        </Animated.Text>
      </View>

      {/* Progress bar */}
      <View style={styles.barWrap}>
        <View style={styles.track}>
          <Animated.View
            style={{
              height: '100%',
              borderRadius: 2,
              backgroundColor: GREEN,
              width: bar.interpolate({ inputRange: [0, 1], outputRange: [0, TRACK_WIDTH] }),
            }}
          />
        </View>
      </View>

      <Animated.Text
        allowFontScaling={false}
        style={[styles.foot, { fontFamily: MONO_FONT, opacity: foot }]}
      >
        ALBERTA WIDE
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
  },
  center: { alignItems: 'center', marginTop: -28 },
  lockup: { flexDirection: 'row', alignItems: 'flex-end', gap: 18 },
  strips: { alignItems: 'flex-end', gap: 9, paddingBottom: 8 },
  word: {
    color: WORD_INK,
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -2,
    lineHeight: 64,
  },
  tag: {
    marginTop: 22,
    color: TAG_INK,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  barWrap: { position: 'absolute', bottom: 104, left: 0, right: 0, alignItems: 'center' },
  track: { width: TRACK_WIDTH, height: 3, borderRadius: 2, backgroundColor: TRACK, overflow: 'hidden' },
  foot: {
    position: 'absolute',
    bottom: 56,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: FOOT_INK,
  },
});
