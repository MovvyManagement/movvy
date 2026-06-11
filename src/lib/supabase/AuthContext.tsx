// AuthContext — exposes the current session + a derived profile to any screen.
// Subscribes to auth state changes (login/logout/refresh) and triggers re-renders.

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './client';

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
}

const Ctx = createContext<AuthState>({ loading: true, session: null, user: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, session: null, user: null });

  useEffect(() => {
    if (!supabaseConfigured) {
      setState({ loading: false, session: null, user: null });
      return;
    }

    // Initial session check
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setState({ loading: false, session, user: session?.user ?? null });
      })
      .catch(() => setState({ loading: false, session: null, user: null }));

    // Subscribe to auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ loading: false, session, user: session?.user ?? null });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
