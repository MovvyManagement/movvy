// =============================================================================
// usePhoneProxy — Uber-style proxy-line calling.
//
// Both the customer's live tracker and the driver's active screen need a
// "Call" button that connects the two parties through a Movvy proxy number
// — neither side ever sees the other's real phone. The proxy-session-create
// edge function exists; we just need to invoke it and route the returned
// number to the native dialer.
//
// When Twilio isn't wired up yet the edge function returns
// `{ ok: false, status: 'twilio_not_configured' }` with a 200. We treat that
// as a soft state (toast + fallback to chat) instead of an error.
// =============================================================================

import { useMutation } from '@tanstack/react-query';
import { Linking, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export interface ProxyCallResult {
  ok: boolean;
  /** Present when ok=true. E.164 number to dial. */
  proxyNumber?: string;
  /** Stable code from the edge function: 'twilio_not_configured', 'no_driver_assigned', etc. */
  status?: string;
  /** Human-readable message for surfacing in a toast. */
  message?: string;
}

export function usePhoneProxy() {
  return useMutation({
    mutationFn: async (booking_id: string): Promise<ProxyCallResult> => {
      const { data, error } = await supabase.functions.invoke('proxy-session-create', {
        body: { booking_id },
      });
      if (error) throw error;
      // Edge function returns 200 with ok=false for the "not configured" path,
      // so we trust the payload shape instead of checking status code.
      const payload = (data ?? {}) as {
        ok?: boolean;
        proxy_number?: string;
        status?: string;
        message?: string;
        error?: string;
      };
      if (payload.error) throw new Error(payload.error);
      return {
        ok: payload.ok === true,
        proxyNumber: payload.proxy_number,
        status: payload.status,
        message: payload.message,
      };
    },
  });
}

/** Open the native dialer for an E.164 number. iOS + Android handle this via
 *  the `tel:` URL scheme; the OS asks the user for a one-tap confirmation
 *  before actually placing the call. Web falls back to a clipboard copy
 *  prompt because browsers don't dial. */
export async function placeProxyCall(proxyNumber: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Best we can do on web — the user copies the number and dials manually.
    throw new Error('Calls aren\'t supported in the browser. Please use the mobile app.');
  }
  const url = `tel:${proxyNumber}`;
  const can = await Linking.canOpenURL(url);
  if (!can) throw new Error('Your device can\'t place phone calls.');
  await Linking.openURL(url);
}
