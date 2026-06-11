// =============================================================================
// useResponsiveLayout — tablet detection + sensible content widths
//
// The app ships on iPhones (320 – 480 logical px), iPads (768 – 1024+),
// and the web preview. Same RN components render on all of them; what we
// vary is the *content width* + a couple of layout decisions.
//
// Why a hook rather than baked-in styles:
//   • Dimensions change on iPad rotation + Split View
//   • We want every key surface (booking flow, support hub, profile) to
//     pin to a comfortable max width on iPad rather than stretching to
//     1024 px with absurdly wide form rows
// =============================================================================

import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

export interface ResponsiveLayout {
  /** Current logical width in dp. */
  width: number;
  /** Logical height — useful for compact-height detection on iPhone SE. */
  height: number;
  /** True for iPad, iPad-class Android tablets, or any window ≥ 720 px wide. */
  isTablet: boolean;
  /** Comfortable content max width — pinned to 560 on iPad, no cap on phones. */
  contentMaxWidth: number | undefined;
  /** Reading-comfort max width for body-text screens (Profile, FAQ). */
  readingMaxWidth: number | undefined;
  /** True for the narrowest iPhone class (SE-style ≤ 360 px wide). */
  isCompact: boolean;
}

function compute(width: number, height: number): ResponsiveLayout {
  const isTablet = width >= 720;
  return {
    width,
    height,
    isTablet,
    // 560 dp keeps a Web-style readable form width on iPad without feeling
    // claustrophobic. We deliberately don't centre at 720+ — that's bigger
    // than any iPhone, so the layout already reads natively at that size.
    contentMaxWidth: isTablet ? 560 : undefined,
    readingMaxWidth: isTablet ? 640 : undefined,
    isCompact: width <= 360,
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = useState<ResponsiveLayout>(() => {
    const { width, height } = Dimensions.get('window');
    return compute(width, height);
  });

  useEffect(() => {
    // Dimensions changes fire on rotation + Split View resize on iPad,
    // and also on keyboard show on iOS. We re-compute and re-render.
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setLayout(compute(window.width, window.height));
    });
    return () => sub.remove();
  }, []);

  return layout;
}

/** Pure helper for static use (e.g. inside StyleSheet.create). */
export function platformIsTablet(): boolean {
  if (Platform.OS === 'web') return false;
  const { width } = Dimensions.get('window');
  return width >= 720;
}
