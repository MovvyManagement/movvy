import { Stack } from 'expo-router';

// Legal documents — Terms, Privacy, etc. All public (no auth gate) so a
// user can review them BEFORE accepting at signup. Each screen renders
// its own ScreenHeader so the native header stays off.
export default function LegalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#FFFFFF' },
        animation: 'slide_from_right',
      }}
    />
  );
}
