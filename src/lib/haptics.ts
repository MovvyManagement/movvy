// Thin haptic wrapper. Safe on web (no-op) and Android (uses Light/Medium/Heavy).
// Use these on every primary CTA — small win, big perceived-quality lift.

import { Platform } from 'react-native';

let H: any = null;
try {
  // Avoid bundling on web
  if (Platform.OS !== 'web') H = require('expo-haptics');
} catch {}

export const haptic = {
  /** Light tap — confirmations like Add to list, toggle. */
  light: () => H?.impactAsync?.(H.ImpactFeedbackStyle.Light),
  /** Medium thump — primary action confirm (Book, Accept). */
  medium: () => H?.impactAsync?.(H.ImpactFeedbackStyle.Medium),
  /** Heavy thump — major commit (payment, account delete). */
  heavy: () => H?.impactAsync?.(H.ImpactFeedbackStyle.Heavy),

  /** Soft selection click — picking an option from a list. */
  select: () => H?.selectionAsync?.(),

  /** Outcome notifications — for end-of-action feedback. */
  success: () => H?.notificationAsync?.(H.NotificationFeedbackType.Success),
  warning: () => H?.notificationAsync?.(H.NotificationFeedbackType.Warning),
  error:   () => H?.notificationAsync?.(H.NotificationFeedbackType.Error),
};
