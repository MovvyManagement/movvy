// =============================================================================
// Maps deep-link helper
//
// Opens turn-by-turn navigation in the native maps app:
//   • iOS  → Apple Maps via maps:// URL (Google Maps if installed)
//   • Android → geo: URL handled by whichever map app the user picks
//   • web  → google.com/maps as the universal fallback
//
// Pass either coordinates (preferred — no geocode ambiguity) or a free-text
// address as a fallback.
// =============================================================================

import { Linking, Platform } from 'react-native';

export interface MapsTarget {
  lat?: number | null;
  lng?: number | null;
  /** Human label shown as the marker title (and used if coords are missing). */
  label?: string;
}

export async function openInMaps(target: MapsTarget): Promise<boolean> {
  const { lat, lng, label } = target;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';

  // Build URLs in priority order: native scheme → web fallback.
  const urls: string[] = [];

  if (Platform.OS === 'ios') {
    if (hasCoords) {
      const q = encodeURIComponent(label ?? `${lat},${lng}`);
      urls.push(`maps://?daddr=${lat},${lng}&q=${q}`);
    } else if (label) {
      urls.push(`maps://?daddr=${encodeURIComponent(label)}`);
    }
  } else if (Platform.OS === 'android') {
    if (hasCoords) {
      const q = encodeURIComponent(label ?? `${lat},${lng}`);
      urls.push(`geo:${lat},${lng}?q=${lat},${lng}(${q})`);
    } else if (label) {
      urls.push(`geo:0,0?q=${encodeURIComponent(label)}`);
    }
  }

  // Universal web fallback — always reachable, opens in browser → Google Maps app
  if (hasCoords) {
    urls.push(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  } else if (label) {
    urls.push(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(label)}`,
    );
  }

  for (const url of urls) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}
