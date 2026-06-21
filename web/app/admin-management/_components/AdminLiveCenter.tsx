// =============================================================================
// AdminLiveCenter — single mount-in-layout component that powers every
// live-data behaviour in the admin console:
//
//   1. Subscribes to Supabase Realtime postgres_changes on every table
//      the admin reads. Debounced router.refresh() keeps the current
//      page's server data fresh.
//   2. Toast notifications — context-aware copy on every interesting
//      event (new booking, applicant, support reply, etc). Toasts auto-
//      dismiss after 6s; click to dismiss early.
//   3. Sound effect — short Web Audio beep when a new customer support
//      message arrives. No audio asset needed — synthesized in browser.
//      Suppressed while the admin is already looking at /support so a
//      reply they're typing doesn't beep at themselves.
//   4. Offline reconnect — tracks navigator.onLine + Supabase channel
//      status. On reconnect, fires a router.refresh() so any state that
//      changed during the outage flows in, plus a "back online" toast.
//
// Replaces the per-page <RealtimeRefresh> components — one global
// subscription covers every screen.
// =============================================================================

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

// Tables the admin reads anywhere. Adding new admin pages? Add the
// table here so live updates work without re-mounting subscriptions.
const WATCHED_TABLES = [
  'bookings',
  'chat_threads',
  'chat_messages',
  'partner_teams',
  'companies',
  'disputes',
  'verification_documents',
] as const;

type WatchedTable = (typeof WATCHED_TABLES)[number];

// What to show on screen per (table, event). Returning null means
// "trigger the refresh but skip the toast" — used for noisy events
// like booking status transitions.
interface ToastSpec {
  message: string;
  /** Optional href to navigate to on toast click. */
  href?: string;
  /** Whether to play the new-message sound. */
  sound?: boolean;
  /** Optional accent color. */
  tone?: 'success' | 'warning' | 'info';
}

function describeEvent(
  table: WatchedTable,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  row: any,
  oldRow: any,
  currentPathname: string,
): ToastSpec | null {
  // Suppress toasts on the page that's already showing the data — admin
  // typing a reply in /support shouldn't beep at themselves.
  const onSupport = currentPathname.startsWith('/admin-management/support');
  const onApprovals = currentPathname.startsWith('/admin-management/approvals');
  const onMoves = currentPathname.startsWith('/admin-management/moves');

  if (table === 'chat_messages' && event === 'INSERT') {
    if (row?.is_admin) return null;            // our own reply
    if (onSupport) return null;                // already looking at chat
    return {
      message: 'New customer support message',
      href: '/admin-management/support',
      sound: true,
      tone: 'info',
    };
  }

  if (table === 'chat_threads' && event === 'INSERT') {
    if (onSupport) return null;
    return {
      message: 'New support thread opened',
      href: '/admin-management/support',
      tone: 'info',
    };
  }

  if (table === 'bookings' && event === 'INSERT') {
    return {
      message: `New booking · ${row?.short_code ?? row?.id?.slice(0, 8)}`,
      href: '/admin-management/moves',
      tone: 'success',
    };
  }

  if (table === 'bookings' && event === 'UPDATE') {
    // Only surface status transitions to / from 'completed' or
    // 'cancelled' — middle-of-move status pings are noise.
    if (row?.status === 'completed' && oldRow?.status !== 'completed') {
      return {
        message: `Move completed · ${row?.short_code}`,
        href: '/admin-management/moves?tab=active',
        tone: 'success',
      };
    }
    if (row?.status === 'cancelled' && oldRow?.status !== 'cancelled') {
      return {
        message: `Move cancelled · ${row?.short_code}`,
        href: '/admin-management/moves',
        tone: 'warning',
      };
    }
    return null;  // refresh-only, no toast
  }

  if (table === 'partner_teams' && event === 'INSERT') {
    if (onApprovals) return null;
    return {
      message: `New crew application · ${row?.display_name ?? '2-person team'}`,
      href: '/admin-management/approvals',
      tone: 'info',
    };
  }

  if (table === 'companies' && event === 'INSERT') {
    if (onApprovals) return null;
    return {
      message: `New company application · ${row?.display_name ?? row?.legal_name}`,
      href: '/admin-management/approvals',
      tone: 'info',
    };
  }

  if (table === 'disputes' && event === 'INSERT') {
    return {
      message: `New dispute opened`,
      tone: 'warning',
    };
  }

  // Refresh-only for everything else (verification docs uploaded,
  // approval-status transitions, etc.) — would be too noisy.
  return null;
}

interface Toast {
  id: number;
  message: string;
  href?: string;
  tone: 'success' | 'warning' | 'info';
}

let toastIdCounter = 0;

export function AdminLiveCenter() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const supabase = supabaseBrowser();
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Refs avoid stale-closure inside the long-lived subscription callback.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const wasConnectedRef = useRef(true);

  useEffect(() => {
    let pendingRefresh: ReturnType<typeof setTimeout> | null = null;
    let lastFiredAt = 0;

    const queueRefresh = () => {
      if (pendingRefresh) clearTimeout(pendingRefresh);
      const wait = Math.max(500, 500 - (Date.now() - lastFiredAt));
      pendingRefresh = setTimeout(() => {
        lastFiredAt = Date.now();
        router.refresh();
      }, wait);
    };

    const showToast = (spec: ToastSpec) => {
      const id = ++toastIdCounter;
      setToasts((cur) => [
        ...cur,
        { id, message: spec.message, href: spec.href, tone: spec.tone ?? 'info' },
      ].slice(-5)); // cap at 5 visible at once
      // Auto-dismiss after 6s
      setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== id));
      }, 6000);
      if (spec.sound) playBeep();
    };

    const channel = supabase.channel('admin-live-center');

    for (const table of WATCHED_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE';
          new: any;
          old: any;
        }) => {
          queueRefresh();
          const spec = describeEvent(
            table as WatchedTable,
            payload.eventType,
            payload.new,
            payload.old,
            pathRef.current,
          );
          if (spec) showToast(spec);
        },
      );
    }

    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        if (!wasConnectedRef.current) {
          // We RECONNECTED after a drop — refresh and tell the admin.
          queueRefresh();
          showToast({
            message: 'Reconnected · syncing any missed updates',
            tone: 'success',
          });
        }
        wasConnectedRef.current = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
        if (wasConnectedRef.current) {
          showToast({
            message: 'Connection lost · trying to reconnect',
            tone: 'warning',
          });
        }
        wasConnectedRef.current = false;
      }
    });

    // Browser-level offline/online — surfaces WiFi drops before Supabase
    // even notices. Online handler is redundant with the SUBSCRIBED hook
    // above but useful when the WS was already dead pre-resume.
    const onOffline = () => {
      if (wasConnectedRef.current) {
        showToast({
          message: 'You\'re offline · live updates paused',
          tone: 'warning',
        });
        wasConnectedRef.current = false;
      }
    };
    window.addEventListener('offline', onOffline);

    return () => {
      if (pendingRefresh) clearTimeout(pendingRefresh);
      window.removeEventListener('offline', onOffline);
      supabase.removeChannel(channel);
    };
  }, [router, supabase]);

  const dismiss = (id: number) =>
    setToasts((cur) => cur.filter((t) => t.id !== id));

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          toast={t}
          onDismiss={() => dismiss(t.id)}
          onClick={() => {
            if (t.href) router.push(t.href);
            dismiss(t.id);
          }}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onClick,
  onDismiss,
}: {
  toast: Toast;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const toneClasses = {
    success: 'border-emerald-200 bg-emerald-50',
    warning: 'border-amber-200 bg-amber-50',
    info: 'border-zinc-200 bg-white',
  }[toast.tone];
  const iconClasses = {
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    info: 'text-zinc-600',
  }[toast.tone];
  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-2xl border shadow-lg px-4 py-3 flex items-start gap-3 cursor-pointer hover:shadow-xl transition-shadow ${toneClasses}`}
      onClick={onClick}
    >
      <div className={`mt-0.5 ${iconClasses}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </div>
      <div className="flex-1 text-sm font-semibold text-zinc-900">{toast.message}</div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="text-zinc-400 hover:text-zinc-700"
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

// ─── Audio synthesis ───────────────────────────────────────────────────────
// Plays a short two-note chime (E5 → G5, ~250ms total) via Web Audio API.
// No asset, no autoplay restrictions (the user has interacted with the
// page by signing in; AudioContext resumes on demand).
function playBeep() {
  try {
    const Ctx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (freq: number, startAt: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Volume envelope — quick attack, smooth decay. Keeps it ear-friendly.
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + startAt + duration,
      );
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    };
    play(659.25, 0, 0.15);     // E5
    play(783.99, 0.1, 0.18);   // G5
    // Close after the longest note finishes (releases the audio session).
    setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch {
    // Fail silently — sound is nice-to-have, not critical.
  }
}
