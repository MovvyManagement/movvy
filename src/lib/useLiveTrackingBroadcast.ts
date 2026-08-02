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

import { useEffect } from 'react';
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
}: {
  bookingId: string | undefined;
  status: BookingStatus | undefined;
  isSource: boolean;
}): void {
  const active =
    isSource && !!bookingId && !!status && MOVING_STATUSES.includes(status);

  useEffect(() => {
    if (active && bookingId) {
      startLiveLocation(bookingId);
    } else {
      stopLiveLocation();
    }
    // No unmount cleanup on purpose — broadcasting must survive backgrounding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bookingId]);
}
