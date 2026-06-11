// Route guards — hooks that redirect when auth state doesn't match the screen.

import { useEffect } from 'react';
import { router } from 'expo-router';
import { useAuth } from './AuthContext';

/** Redirect to the welcome screen if the user is not signed in. */
export function useRequireAuth(redirectTo: string = '/') {
  const { loading, session } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (!session) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace(redirectTo as any);
    }
  }, [loading, session, redirectTo]);
  return { ready: !loading && !!session };
}

/** Redirect signed-in users away from auth screens (welcome, login, signup). */
export function useRedirectIfAuthed(redirectTo: string = '/(customer)/home') {
  const { loading, session } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (session) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace(redirectTo as any);
    }
  }, [loading, session, redirectTo]);
  return { isAuthed: !loading && !!session };
}
