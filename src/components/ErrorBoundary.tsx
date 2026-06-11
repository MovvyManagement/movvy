// =============================================================================
// ErrorBoundary — root-level safety net
//
// Catches uncaught render errors anywhere in the tree and shows a friendly
// "Something went wrong" screen with reload + report buttons instead of a
// white screen of death.
//
// React only catches errors via class components — that's why this is a class.
// Mounted in app/_layout.tsx around the navigation tree.
// =============================================================================

import React from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureException } from '@/lib/sentry';
import { optionalRequire } from '@/lib/optionalRequire';
// expo-updates is optional — if installed we use Updates.reloadAsync() for
// a true cold-reload. If not, the Reload button just clears the boundary
// state, which is enough to recover most render errors. Run
// `npx expo install expo-updates` to opt in to the harder reload.
// Loaded via optionalRequire so Metro doesn't try to resolve it at bundle
// time when the package isn't installed.

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Always log to console — handy in dev, harmless in prod.
    console.error('[ErrorBoundary] uncaught render error', error, errorInfo);
    this.setState({ errorInfo });

    // captureException is a no-op when @sentry/react-native isn't installed
    // or EXPO_PUBLIC_SENTRY_DSN isn't set. Loaded via optionalRequire so
    // Metro doesn't try to bundle the SDK when it's absent from
    // node_modules.
    captureException(error, {
      contexts: {
        react: { componentStack: errorInfo.componentStack ?? '' },
      },
      tags: { source: 'ErrorBoundary' },
    });
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  reload = async () => {
    // Try expo-updates if it's installed — gives us a true cold reload.
    // Loaded through optionalRequire so Metro skips it when the package
    // isn't present (otherwise the bundle fails the same way Sentry did).
    const Updates = optionalRequire<any>('expo-updates');
    if (Updates?.reloadAsync) {
      try {
        await Updates.reloadAsync();
        return;
      } catch {
        // ignore — fall through to state reset
      }
    }
    this.reset();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const isDev = __DEV__;
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center' }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: '#FEE2E2',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
            }}
          >
            <Ionicons name="alert-circle" size={36} color="#DC2626" />
          </View>

          <Text
            style={{
              marginTop: 20,
              fontSize: 22,
              fontWeight: '700',
              color: '#0A0A0A',
              textAlign: 'center',
            }}
          >
            Something went wrong
          </Text>
          <Text
            style={{
              marginTop: 8,
              fontSize: 14,
              color: '#71717A',
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            The app hit an unexpected error. Reloading usually fixes it. If it
            keeps happening, let us know what you were doing right before.
          </Text>

          {/* Dev-only error detail — collapsed in prod so users never see stack traces */}
          {isDev ? (
            <View
              style={{
                marginTop: 20,
                padding: 12,
                borderRadius: 12,
                backgroundColor: '#F4F4F5',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#52525B', marginBottom: 4 }}>
                {this.state.error.name}: {this.state.error.message}
              </Text>
              <Text style={{ fontSize: 10, color: '#71717A', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                {this.state.error.stack?.split('\n').slice(0, 6).join('\n')}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={this.reload}
            style={{
              marginTop: 24,
              height: 56,
              borderRadius: 16,
              backgroundColor: '#16A34A',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
            }}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={{ marginLeft: 8, fontSize: 16, fontWeight: '700', color: '#fff' }}>
              Reload the app
            </Text>
          </Pressable>

          <Pressable
            onPress={this.reset}
            style={{
              marginTop: 12,
              height: 48,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#71717A' }}>
              Try to keep going
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}
