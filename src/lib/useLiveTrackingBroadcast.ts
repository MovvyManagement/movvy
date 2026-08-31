// =============================================================================
// useLiveTrackingBroadcast — starts/stops the background live-location task.
//
// Mounted on the crew's active-move screen. When THIS device is the booking's
// tracking source and the move is in a moving state, it starts OS background
// location updates (which keep pinging even when the app is backgrounded or
// closed). When the move ends — or this device stops being the source — it
// tears the task down.
//
// Deliberately does NOT stop on unmount: the whole point is to keep sharing
// location when the app leaves the foreground. It stops only when the move is
// no longer active (the background task also self-stops once the booking leaves
// a moving status, as a belt-and-suspenders for an app that was killed).
// =============================================================================

import { useEffect, useRef } from 'react';
import { startLiveLocation, stopLiveLocation } from '@/lib/bgTracking';
import type { BookingStatus } from '@/types';

const MOVING_STATUSES: BookingStatus[] = [
  'on_the_way',
  'arrived',
  'loading',
  'in_transit',
  'unloading',
];

export function useLiveTrackingBroadcast({
  bookingId,
  status,
  isSource,
  onBlocked,
}: {
  bookingId: string | undefined;
  status: BookingStatus | undefined;
  isSource: boolean;
  /**
   * Fired when this device SHOULD be broadcasting but couldn't start — almost
   * always because Location permission isn't granted. Lets the screen warn the
   * crew instead of the customer's map silently going dark. Fires once per
   * blocked session (re-armed once tracking succeeds or the move ends).
   */
  onBlocked?: () => void;
}): void {
  const active =
    isSource && !!bookingId && !!status && MOVING_STATUSES.includes(status);

  // Keep the latest callback without making it an effect dependency.
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  const warnedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (active && bookingId) {
      startLiveLocation(bookingId).then((ok) => {
        if (cancelled) return;
        if (ok) {
          warnedRef.current = false;
        } else if (!warnedRef.current) {
          warnedRef.current = true;
          onBlockedRef.current?.();
        }
      });
    } else {
      stopLiveLocation();
      warnedRef.current = false;
    }
    // No unmount cleanup on purpose — broadcasting must survive backgrounding.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bookingId]);
}
