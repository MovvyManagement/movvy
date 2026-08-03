// =============================================================================
// usePendingStatusSync — drains the offline status queue and reports its size.
//
// Mounted on the crew's Active screen. Retries whenever there's a realistic
// chance signal came back:
//   • on mount (app just opened / crew navigated back)
//   • when the app returns to the foreground (walked out of the basement)
//   • every 15s while anything is still queued
//
// No NetInfo dependency on purpose — a failed send IS the connectivity check,
// and adding a native module here would mean another native rebuild.
// =============================================================================

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { flushQueue, subscribePending } from '@/lib/offlineStatusQueue';

export function usePendingStatusSync(): number {
  const [count, setCount] = useState(0);
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const before = count;
      await flushQueue();
      if (cancelled) return;
      // Something drained → pull real server state back in so the optimistic
      // values are replaced by the authoritative ones.
      if (before > 0) {
        qc.invalidateQueries({ queryKey: ['my-current-job'] });
        qc.invalidateQueries({ queryKey: ['my-team-current-job'] });
        qc.invalidateQueries({ queryKey: ['bookings'] });
      }
    };

    const unsub = subscribePending((p) => {
      if (!cancelled) setCount(p.length);
    });
    run();

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const id = setInterval(() => {
      if (count > 0) run();
    }, 15_000);

    return () => {
      cancelled = true;
      unsub();
      sub.remove();
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return count;
}
