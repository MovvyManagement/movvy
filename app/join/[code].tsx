// =============================================================================
// /join/[code] — deep-link landing route
//
// Reached when a user taps a partner-invite link from their SMS / email:
//   • movvy://join/TM-X7QJ4M   (custom scheme)
//   • https://movvy.ca/join/CO-9X4M2P  (universal link — iOS associated
//     domain + Android intent filter, both configured in app.json)
//
// The route exists purely to forward the code into the partner-join flow
// where the actual invite-acceptance UI lives. We use replace so the back
// button doesn't return them to a blank /join screen.
// =============================================================================

import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

export default function JoinDeepLinkRedirect() {
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    const normalized = (code ?? '').toUpperCase();
    router.replace(`/(auth)/partner-join?code=${encodeURIComponent(normalized)}`);
  }, [code]);

  // Blank container during the (instant) redirect.
  return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
}
