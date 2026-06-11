// =============================================================================
// OAuth helpers — Apple + Google
//
// Customer-only sign-in. Partners use the partner-signin screen (code +
// email/phone + password) and have no OAuth path by design.
//
// Wiring is "graceful-degrade": if the native SDK isn't installed or the
// env-var client ID is missing, the helpers return a friendly error
// instead of crashing.
//
// ─── Setup checklist (run this once before shipping OAuth) ────────────────
//
// 1. Install:
//      npx expo install expo-apple-authentication expo-auth-session expo-crypto expo-web-browser
//
// 2. Apple (iOS):
//    a. In your Apple Developer account, enable "Sign In with Apple" on
//       the Movvy app id (com.movvy.app).
//    b. In Supabase Auth → Providers → Apple, enable + paste the Services ID,
//       team ID, key ID, and private key (.p8 file contents).
//    c. Add to app.json:
//         "ios": { ..., "usesAppleSignIn": true }
//
// 3. Google:
//    a. Create OAuth 2.0 client IDs in Google Cloud Console:
//       • iOS client ID    → EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
//       • Android client ID → EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
//       • Web client ID    → EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID  (passed to
//         signInWithIdToken so Supabase trusts the token audience)
//    b. In Supabase Auth → Providers → Google, enable + paste the web
//       client ID + secret.
//    c. iOS additionally needs the URL scheme from the iOS client added
//       under app.json ios.infoPlist.CFBundleURLTypes (it's the reverse
//       form: com.googleusercontent.apps.<numbers>).
//
// =============================================================================

import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase/client';
import type { AuthResult } from './supabase/auth';

const APPLE_NATIVE_AVAILABLE = Platform.OS === 'ios';

// ─── Apple (imperative — call from a Pressable onPress) ────────────────────

export async function signInWithApple(): Promise<AuthResult> {
  if (!APPLE_NATIVE_AVAILABLE) {
    return { ok: false, error: 'Sign in with Apple is only available on iOS.' };
  }
  try {
    // Lazy import so the absence of the native module doesn't crash the
    // bundle. Once `expo-apple-authentication` is installed this resolves
    // to the real SDK.
    const AppleAuth = await import('expo-apple-authentication').catch(() => null);
    if (!AppleAuth) {
      return {
        ok: false,
        error: 'Install expo-apple-authentication to enable Apple sign-in.',
      };
    }
    const available = await AppleAuth.isAvailableAsync();
    if (!available) {
      return { ok: false, error: 'Apple sign-in is not available on this device.' };
    }

    const credential = await AppleAuth.signInAsync({
      requestedScopes: [
        AppleAuth.AppleAuthenticationScope.FULL_NAME,
        AppleAuth.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { ok: false, error: 'Apple did not return an identity token.' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    // The user-cancel error is harmless — surface a friendlier line.
    if (e?.code === 'ERR_REQUEST_CANCELED') {
      return { ok: false, error: 'Sign-in cancelled.' };
    }
    return { ok: false, error: e?.message ?? 'Apple sign-in failed.' };
  }
}

// ─── Google (hook — useGoogleSignIn() inside a component) ──────────────────
//
// Returns { signIn, isReady, error } so the screen can render a disabled
// button until the SDK + client IDs are wired. Calling signIn() opens the
// system OAuth popup; once it resolves successfully, the user is signed
// in via Supabase and the consuming screen can navigate.

interface GoogleSignInApi {
  /** Opens the Google OAuth popup. Resolves with { ok, error? }. */
  signIn: () => Promise<AuthResult>;
  /** False while the auth-request is initialising. */
  isReady: boolean;
  /** Reason the button should be disabled (missing env, missing SDK, etc). */
  blockedReason: string | null;
}

export function useGoogleSignIn(): GoogleSignInApi {
  // Capture env vars at hook-render time so they're consistent across the
  // returned helpers.
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  const blockedReason = useMemo(() => {
    if (!iosClientId && !androidClientId && !webClientId) {
      return 'Set EXPO_PUBLIC_GOOGLE_*_CLIENT_ID in .env.local to enable Google sign-in.';
    }
    return null;
  }, [iosClientId, androidClientId, webClientId]);

  // Lazy-import the providers. If the package isn't installed we return a
  // disabled API rather than crashing the screen.
  // Note: useAuthRequest must be called at the top level — we can't
  // conditionally call it. We import + call it via a "trampoline" pattern
  // by attempting the require and falling back to a stub when missing.
  let request: any = null;
  let response: any = null;
  let promptAsync: any = null;
  let sdkAvailable = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Google = require('expo-auth-session/providers/google');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WebBrowser = require('expo-web-browser');
    WebBrowser.maybeCompleteAuthSession?.();
    sdkAvailable = true;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    [request, response, promptAsync] = Google.useAuthRequest({
      iosClientId,
      androidClientId,
      webClientId,
    });
  } catch {
    // Package not installed yet — leave handles null and surface the error.
  }

  // Sign in to Supabase when Google returns an id_token. This effect fires
  // exactly once per successful prompt; the screen-level useEffect on
  // `response` would be redundant.
  useEffect(() => {
    if (!response || response.type !== 'success') return;
    const idToken = response.authentication?.idToken ?? response.params?.id_token;
    if (!idToken) return;
    supabase.auth.signInWithIdToken({ provider: 'google', token: idToken }).catch((e) => {
      // Swallow — the consumer's signIn() promise resolution above already
      // surfaces this. No need to throw from the effect.
      console.warn('[oauth/google] signInWithIdToken error', e);
    });
  }, [response]);

  const signIn = async (): Promise<AuthResult> => {
    if (!sdkAvailable) {
      return {
        ok: false,
        error: 'Install expo-auth-session + expo-web-browser to enable Google sign-in.',
      };
    }
    if (blockedReason) return { ok: false, error: blockedReason };
    if (!promptAsync) {
      return { ok: false, error: 'Google sign-in isn\'t ready yet — try again in a moment.' };
    }
    try {
      const result = await promptAsync();
      if (result?.type === 'cancel' || result?.type === 'dismiss') {
        return { ok: false, error: 'Sign-in cancelled.' };
      }
      if (result?.type !== 'success') {
        return { ok: false, error: 'Google sign-in failed.' };
      }
      const idToken = result.authentication?.idToken ?? result.params?.id_token;
      if (!idToken) {
        return { ok: false, error: 'Google did not return an identity token.' };
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Google sign-in failed.' };
    }
  };

  return {
    signIn,
    isReady: sdkAvailable && !!request,
    blockedReason,
  };
}
