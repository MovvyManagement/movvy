// =============================================================================
// offlineStatusQueue — status taps survive dead zones.
//
// Movers spend the day in basements, freight elevators and concrete stairwells.
// Before this, tapping "Arrived at pickup" with no signal just threw an error:
// the crew moved on, the customer never saw the update, and the billing timeline
// ended up wrong.
//
// Now a status tap that fails for NETWORK reasons is written to a persisted
// FIFO queue and replayed automatically once signal returns. The UI advances
// immediately (optimistically), so the crew keeps working.
//
// Two rules that matter:
//   1. STRICT ORDER. Booking statuses are a state machine (on_the_way → arrived
//      → loading → …) and the DB rejects out-of-order jumps, so we replay
//      oldest-first and STOP at the first failure instead of skipping ahead.
//   2. ONLY network errors queue. A real server rejection (invalid transition,
//      not authorised) is a permanent no — queueing it would retry forever. We
//      queue only when the request never got an HTTP response.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const KEY = 'movvy.pendingStatusUpdates.v1';

export interface PendingStatusUpdate {
  id: string;
  booking_id: string;
  new_status: string;
  queued_at: string;
}

type Listener = (pending: PendingStatusUpdate[]) => void;
const listeners = new Set<Listener>();
let cache: PendingStatusUpdate[] | null = null;
let flushing = false;

async function read(): Promise<PendingStatusUpdate[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as PendingStatusUpdate[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function write(next: PendingStatusUpdate[]): Promise<void> {
  cache = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / unavailable — the in-memory cache still drives this session */
  }
  listeners.forEach((l) => l(next));
}

/** Subscribe to queue changes (for the "waiting to sync" banner). */
export function subscribePending(l: Listener): () => void {
  listeners.add(l);
  read().then((p) => l(p));
  return () => {
    listeners.delete(l);
  };
}

export async function getPending(): Promise<PendingStatusUpdate[]> {
  return read();
}

/**
 * True when the failure means "we never reached the server" — the only case
 * worth retrying. supabase-js surfaces a non-2xx as FunctionsHttpError (which
 * carries a `context` Response); a dead connection throws FunctionsFetchError
 * or a raw TypeError from fetch.
 */
export function isNetworkError(err: any): boolean {
  if (!err) return false;
  const name = String(err.name ?? '');
  const msg = String(err.message ?? '').toLowerCase();
  if (name === 'FunctionsHttpError') return false; // server answered — don't retry
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return true;
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('connection')
  );
}

export async function enqueue(booking_id: string, new_status: string): Promise<void> {
  const pending = await read();
  await write([
    ...pending,
    {
      id: `${booking_id}:${new_status}:${Date.now()}`,
      booking_id,
      new_status,
      queued_at: new Date().toISOString(),
    },
  ]);
}

/**
 * Replay queued updates oldest-first. Stops at the first failure so the state
 * machine is never applied out of order. A permanent server rejection is
 * dropped (retrying it forever would wedge the queue behind a dead entry).
 */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let pending = await read();
    while (pending.length > 0) {
      const item = pending[0];
      try {
        const { error } = await supabase.functions.invoke('bookings-update-status', {
          body: { booking_id: item.booking_id, new_status: item.new_status },
        });
        if (error) throw error;
        pending = pending.slice(1);
        await write(pending);
      } catch (e) {
        if (isNetworkError(e)) return; // still offline — keep the queue intact
        // Server said no (already past this status, cancelled, …). Drop it and
        // continue so one dead entry can't block the rest.
        console.warn('[offlineStatusQueue] dropping rejected update', item.new_status, e);
        pending = pending.slice(1);
        await write(pending);
      }
    }
  } finally {
    flushing = false;
  }
}
