// =============================================================================
// RealtimeRefresh — tiny client island that turns any server-rendered admin
// page into a live one.
//
// How it works:
//   1. Mount with `tables={['bookings', 'chat_threads', ...]}` on the page.
//   2. On mount, subscribes to Supabase Realtime postgres_changes for every
//      INSERT / UPDATE / DELETE on those tables.
//   3. Any matching event calls router.refresh() with a 500ms debounce —
//      Next.js re-runs the page's server component, which re-queries
//      Supabase, and the new HTML streams in without a navigation.
//
// Why this pattern over converting pages to client components:
//   • Server components keep the initial render fast + SEO-friendly
//   • Database queries stay server-side (no anon-key egress per visitor)
//   • Auth gating stays in middleware (no flash of empty state)
//   • We only ship a tiny WebSocket-subscribing component to the browser
//
// The price: refreshes re-fetch the whole page. Fine for an ops dashboard
// where the data changes maybe a few times per minute; would need a smarter
// invalidation strategy if we ever had 50+ events/sec.
// =============================================================================

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

interface RealtimeRefreshProps {
  /** Tables to watch. ANY insert/update/delete on any of these → refresh. */
  tables: string[];
  /**
   * Optional per-table filter using postgres_changes filter syntax —
   * e.g. `{ bookings: 'status=eq.searching' }` to only react to
   * newly-searching bookings. Omit to react to all rows on the table.
   */
  filters?: Record<string, string>;
  /** Min ms between refreshes. Default 500. Prevents thrashing under bursts. */
  debounceMs?: number;
  /** Unique channel name. Lets you have multiple instances on one page. */
  channel?: string;
}

export function RealtimeRefresh({
  tables,
  filters,
  debounceMs = 500,
  channel = 'admin-realtime',
}: RealtimeRefreshProps) {
  const router = useRouter();
  const supabase = supabaseBrowser();

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    let lastFiredAt = 0;

    // Debounced refresh — a flurry of updates collapses into a single
    // refresh `debounceMs` after the LAST event. Prevents 5 status
    // transitions on a single booking from triggering 5 re-fetches.
    const queueRefresh = () => {
      if (pending) clearTimeout(pending);
      const now = Date.now();
      const elapsed = now - lastFiredAt;
      const wait = Math.max(debounceMs, debounceMs - elapsed);
      pending = setTimeout(() => {
        lastFiredAt = Date.now();
        router.refresh();
      }, wait);
    };

    const ch = supabase.channel(channel);
    for (const table of tables) {
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          // Realtime accepts a single column filter per binding.
          // Omitted when no filter is configured for the table.
          ...(filters?.[table] ? { filter: filters[table] } : {}),
        },
        queueRefresh,
      );
    }
    ch.subscribe();

    return () => {
      if (pending) clearTimeout(pending);
      supabase.removeChannel(ch);
    };
  }, [
    // Stringify arrays so the effect doesn't re-subscribe on every render
    // due to a fresh array identity from the parent.
    tables.join(','),
    JSON.stringify(filters ?? {}),
    debounceMs,
    channel,
    router,
    supabase,
  ]);

  return null;
}
