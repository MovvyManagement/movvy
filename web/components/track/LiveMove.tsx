'use client';

// =============================================================================
// The website's live move page: what the customer sees after entering a move
// code. Refreshes from web-track every few seconds, so it shows the same state
// and crew location as the app.
//
// Anyone with the code and phone digits can watch and pay. Chat, calling,
// changes and cancelling also need the account password, handled by
// useAccountGate below.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  type Address,
  addressPayload,
  ARRIVAL_WINDOW,
  ApiError,
  buildCalendar,
  callFunction,
  clearTrackSession,
  formatDate,
  money,
  type MoveStatus,
  type Snapshot,
} from '@/lib/movvy';
import { AddressField } from '@/components/booking/AddressField';
import { ForgotPasswordForm, SignInForm } from '@/components/booking/AccountForms';
import { StripePayment, TestModeNote } from '@/components/booking/StripePayment';
import { Button, Card, ErrorNote, Field, Row, SectionLabel, Sheet, Spinner } from '@/components/booking/ui';
import { LiveMap } from './LiveMap';

const REFRESH_MS = 5_000;
const HIDDEN_REFRESH_MS = 30_000;
const FINISHED_REFRESH_MS = 60_000;
const STALE_LOCATION_MS = 2 * 60_000;
const MIN_BILLABLE_HOURS = 4;

const STAGES: { status: MoveStatus; label: string }[] = [
  { status: 'on_the_way', label: 'On the way' },
  { status: 'arrived', label: 'Arrived' },
  { status: 'loading', label: 'Loading' },
  { status: 'in_transit', label: 'To drop-off' },
  { status: 'unloading', label: 'Unloading' },
  { status: 'completed', label: 'Complete' },
];

const HEADLINES: Partial<Record<MoveStatus, string>> = {
  draft: "We're confirming your deposit",
  pending: 'Booking received',
  searching: 'Booking confirmed. Arranging your crew',
  assigned: 'Your crew is assigned',
  confirmed: 'Your crew is confirmed',
  on_the_way: 'Your crew is on the way to pickup',
  arrived: 'Your crew has arrived at pickup',
  loading: 'Loading your items',
  in_transit: 'On the way to drop-off',
  unloading: 'Arrived at drop-off. Unloading',
  completed: 'Your move is complete',
  cancelled: 'This move was cancelled',
  failed: 'This move could not be completed',
};

const CANCEL_REASONS = ['My plans changed', 'I need a different date', 'Booked by mistake', 'Found another option', 'Other'];

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });

function etaMinutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(to.lat - from.lat) / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lng - from.lng) / 2) ** 2;
  const km = 6371 * 2 * Math.asin(Math.sqrt(a));
  // Same estimate as the app: road distance about 1.3x, at 50 km/h.
  return Math.max(1, Math.round(((km * 1.3) / 50) * 60));
}

const pointOf = (p: { lat: number | null; lng: number | null } | null) =>
  p && p.lat != null && p.lng != null ? { lat: Number(p.lat), lng: Number(p.lng) } : null;

// ─── Account gate ───────────────────────────────────────────────────────────

type GateAction = 'chat' | 'call' | 'change' | 'cancel';

/** Confirms the browser is signed in as the customer who owns this move. */
async function ownsMove(bookingId: string) {
  const supabase = supabaseBrowser();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return { signedIn: false, owner: false };
  const { data } = await supabase.from('bookings').select('id').eq('id', bookingId).maybeSingle();
  return { signedIn: true, owner: !!data };
}

function GateSheet({ bookingId, onClose, onPassed }: { bookingId: string; onClose: () => void; onPassed: () => void }) {
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const afterSignIn = async () => {
    const { owner } = await ownsMove(bookingId);
    if (owner) {
      onPassed();
    } else {
      await supabaseBrowser().auth.signOut();
      setError('That account did not book this move. Sign in with the account you booked with.');
    }
  };

  return (
    <Sheet title={forgot ? 'Reset your password' : 'Enter your password'} onClose={onClose}>
      {forgot ? (
        <ForgotPasswordForm onDone={() => setForgot(false)} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-silver-600">To keep your move safe, chat, calls, changes and cancelling need the account you booked with.</p>
          <ErrorNote>{error}</ErrorNote>
          <SignInForm onSignedIn={afterSignIn} onForgot={() => setForgot(true)} submitLabel="Continue" />
        </div>
      )}
    </Sheet>
  );
}

// ─── Billing meter ──────────────────────────────────────────────────────────

function BillingMeter({ snap }: { snap: Snapshot }) {
  const b = snap.billing;
  const [, tick] = useState(0);
  const running = !!b.started_at && !b.completed_at;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!b.started_at || b.completed_at) return null;

  const start = new Date(b.started_at).getTime();
  const now = Date.now();
  const elapsed = Math.max(0, now - start);
  const transitStart = b.in_transit_at ? new Date(b.in_transit_at).getTime() : null;
  const transitEnd = b.unloading_at ? new Date(b.unloading_at).getTime() : null;
  // On a long haul the highway is a fixed per-km charge, so the clock pauses.
  const transitMs = b.is_long_haul && transitStart ? Math.max(0, (transitEnd ?? now) - transitStart) : 0;
  const billable = Math.max(0, elapsed - transitMs);
  const worked = billable / 3_600_000;
  const hours = Math.max(MIN_BILLABLE_HOURS, worked);
  const cents = Math.round(hours * (b.hourly_rate_cents ?? 17500)) + (b.is_long_haul ? b.transit_cents : 0);
  const seconds = Math.floor(elapsed / 1000);
  const clock = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const onHighway = b.is_long_haul && !!transitStart && !transitEnd;

  return (
    <Card dark>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-silver-400">Time on the clock</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{clock}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-wider text-silver-400">Cost so far</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{money(cents)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-silver-400">
        {onHighway ? 'The clock is paused for the highway, which is a fixed charge. ' : ''}
        {worked < MIN_BILLABLE_HOURS ? 'Includes the 4-hour minimum. ' : ''}
        Before materials, fuel and GST, which are added to your final bill.
      </p>
    </Card>
  );
}

// ─── Chat ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  sender_profile_id: string;
  body: string;
  created_at: string;
}

function ChatSheet({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { data: booking } = await supabase
          .from('bookings')
          .select('id, customer_id, assigned_driver_profile_id')
          .eq('id', bookingId)
          .single();
        if (!booking) throw new Error('Could not open this chat.');
        if (cancelled) return;
        setCustomerId(booking.customer_id);

        let id: string | undefined = (await supabase.from('chat_threads').select('id').eq('booking_id', bookingId).maybeSingle()).data?.id;
        if (!id) {
          const { data: created, error: createError } = await supabase
            .from('chat_threads')
            .insert({
              kind: 'booking',
              booking_id: bookingId,
              customer_profile_id: booking.customer_id,
              partner_profile_id: booking.assigned_driver_profile_id,
            })
            .select('id')
            .single();
          if (createError || !created) throw new Error('Could not open this chat.');
          id = created.id;
        }
        if (cancelled || !id) return;
        setThreadId(id);

        const { data: history } = await supabase
          .from('chat_messages')
          .select('id, sender_profile_id, body, created_at')
          .eq('thread_id', id)
          .order('created_at', { ascending: true })
          .limit(200);
        if (!cancelled) setMessages((history ?? []) as Message[]);

        channel = supabase
          .channel(`web-chat-${id}-${Date.now()}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${id}` },
            (payload: { new: unknown }) => {
              const message = payload.new as Message;
              setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]));
            },
          )
          .subscribe();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [bookingId]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = async () => {
    const body = text.trim();
    if (!body || !threadId) return;
    setSending(true);
    setError(null);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      await callFunction('chat-send', { thread_id: threadId, body }, data.session?.access_token);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet title="Chat with your crew" onClose={onClose}>
      <div className="flex h-[52vh] flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto">
          {messages.length === 0 ? <p className="py-10 text-center text-sm text-silver-500">Send your crew a message.</p> : null}
          {messages.map((m) => {
            const mine = m.sender_profile_id === customerId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${mine ? 'bg-ink-900 text-white' : 'bg-silver-100 text-ink-900'}`}>{m.body}</p>
              </div>
            );
          })}
          <div ref={end} />
        </div>
        <div className="mt-3 space-y-2">
          <ErrorNote>{error}</ErrorNote>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
              aria-label="Message"
              placeholder="Type a message"
              className="min-w-0 flex-1 rounded-2xl border border-silver-300 px-4 py-3 text-base outline-none focus:border-brand-800"
            />
            <Button type="submit" loading={sending} disabled={!text.trim() || !threadId}>
              Send
            </Button>
          </form>
        </div>
      </div>
    </Sheet>
  );
}

function CallSheet({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [number, setNumber] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabaseBrowser().auth.getSession();
        const res = await callFunction<{ ok?: boolean; proxy_number?: string; message?: string }>(
          'proxy-session-create',
          { booking_id: bookingId },
          data.session?.access_token,
        );
        if (res.ok && res.proxy_number) setNumber(res.proxy_number);
        else setMessage(res.message ?? "Calling isn't available right now. Please use chat.");
      } catch (e) {
        setMessage((e as Error).message);
      }
    })();
  }, [bookingId]);

  return (
    <Sheet title="Call your crew" onClose={onClose}>
      {number ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-silver-600">Your real number stays private. Call from the phone on your account.</p>
          <p className="text-2xl font-bold tabular-nums text-ink-900">{number}</p>
          <a href={`tel:${number}`} className="flex min-h-[48px] items-center justify-center rounded-2xl bg-brand-800 text-sm font-bold text-white hover:bg-brand-900">
            Call now
          </a>
        </div>
      ) : message ? (
        <p className="text-sm text-silver-600">{message}</p>
      ) : (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
    </Sheet>
  );
}

// ─── Change and cancel ──────────────────────────────────────────────────────

function ChangeSheet({ snap, onClose, onSaved }: { snap: Snapshot; onClose: () => void; onSaved: () => void }) {
  const days = useMemo(() => buildCalendar(), []);
  const [date, setDate] = useState(snap.date);
  const [pickup, setPickup] = useState<Address | null>(null);
  const [dropoff, setDropoff] = useState<Address | null>(null);
  const [notes, setNotes] = useState(snap.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const patch: Record<string, unknown> = { booking_id: snap.booking_id };
    if (date !== snap.date) {
      patch.scheduled_for_date = date;
      patch.scheduled_for_window = ARRIVAL_WINDOW;
    }
    if (notes !== snap.notes) patch.customer_notes = notes;
    if (pickup) patch.pickup = addressPayload(pickup);
    if (dropoff) patch.dropoff = addressPayload(dropoff);
    if (Object.keys(patch).length === 1) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      await callFunction('bookings-modify', patch, data.session?.access_token);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Change your move" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <SectionLabel>Moving day</SectionLabel>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <button
                key={d.iso}
                type="button"
                disabled={d.disabled}
                aria-pressed={date === d.iso}
                onClick={() => setDate(d.iso)}
                className={`w-[64px] shrink-0 rounded-2xl border px-1 py-2 text-center ${
                  date === d.iso ? 'border-ink-900 bg-ink-900 text-white' : d.disabled ? 'border-silver-100 bg-silver-50 text-silver-300' : 'border-silver-200 text-ink-900'
                }`}
              >
                <span className="block text-xs">{d.weekday}</span>
                <span className="block text-lg font-bold">{d.day}</span>
                <span className="block text-xs">{d.month}</span>
              </button>
            ))}
          </div>
        </div>
        <AddressField label={`New pickup (now ${snap.pickup.line1})`} placeholder="Leave empty to keep it" value={pickup} onChange={setPickup} />
        {snap.dropoff ? <AddressField label={`New drop-off (now ${snap.dropoff.line1})`} placeholder="Leave empty to keep it" value={dropoff} onChange={setDropoff} /> : null}
        <Field label="Notes for the crew" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        <p className="text-xs text-silver-500">Changing an address can update your estimate.</p>
        <ErrorNote>{error}</ErrorNote>
        <Button className="w-full" loading={busy} onClick={save}>
          Save changes
        </Button>
      </div>
    </Sheet>
  );
}

function CancelSheet({ snap, onClose, onDone }: { snap: Snapshot; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      await callFunction('bookings-cancel', { booking_id: snap.booking_id, reason: `Customer · ${reason}` }, data.session?.access_token);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Cancel your move" onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-2xl bg-silver-50 p-4 text-sm leading-relaxed text-ink-900">
          {snap.can.deposit_refundable
            ? `You're more than 48 hours from your move, so your ${money(snap.money.deposit_cents)} deposit will be fully refunded.`
            : `You're within 48 hours of your move, so your ${money(snap.money.deposit_cents)} deposit is non-refundable and goes to the crew.`}
        </p>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink-900">Why are you cancelling?</legend>
          {CANCEL_REASONS.map((r) => (
            <label key={r} className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-2xl border px-4 text-sm ${reason === r ? 'border-ink-900 bg-silver-50' : 'border-silver-200'}`}>
              <input type="radio" name="cancel-reason" className="h-4 w-4 accent-[#0A0A0A]" checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
        </fieldset>
        <ErrorNote>{error}</ErrorNote>
        <Button variant="danger" className="w-full" disabled={!reason} loading={busy} onClick={confirm}>
          Cancel this move
        </Button>
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Keep my move
        </Button>
      </div>
    </Sheet>
  );
}

// ─── Final bill and rating ──────────────────────────────────────────────────

function FinalBill({ snap, token, onChanged }: { snap: Snapshot; token: string; onChanged: () => void }) {
  const [tipPct, setTipPct] = useState(0);
  const [payment, setPayment] = useState<{ secret: string; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);
  const final = snap.money.final_cents ?? snap.money.estimate_cents;
  const tipCents = Math.round((final * tipPct) / 100);
  const paid = snap.money.paid || justPaid;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await callFunction<{ client_secret?: string; amount_cents: number; settled?: boolean }>('stripe-create-payment-intent', {
        track_token: token,
        kind: 'final',
        tip_cents: tipCents,
      });
      if (res.settled) {
        setJustPaid(true);
        onChanged();
      } else if (res.client_secret) {
        setPayment({ secret: res.client_secret, amount: res.amount_cents });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <SectionLabel>Your final bill</SectionLabel>
      <div className="space-y-2">
        {snap.money.actual_hours != null ? <Row label="Time worked" value={`${snap.money.actual_hours} hours`} /> : null}
        <Row label="Final total" value={money(final, true)} />
        {snap.money.deposit_applied_cents > 0 ? <Row label="Deposit paid" value={`−${money(snap.money.deposit_applied_cents, true)}`} /> : null}
        {snap.money.credit_applied_cents > 0 ? <Row label="Referral credit" value={`−${money(snap.money.credit_applied_cents, true)}`} /> : null}
        <div className="border-t border-silver-200 pt-2">
          <Row label={paid ? 'Paid' : 'Balance due'} value={paid ? 'Thank you' : money(snap.money.due_cents, true)} strong />
        </div>
      </div>
      {paid ? null : payment ? (
        <StripePayment
          clientSecret={payment.secret}
          label={`Pay ${money(payment.amount, true)}`}
          returnUrl={`${window.location.origin}/track?code=${encodeURIComponent(snap.short_code)}`}
          onPaid={() => {
            setJustPaid(true);
            setPayment(null);
            onChanged();
          }}
        />
      ) : (
        <>
          <TestModeNote />
          <div>
            <p className="text-sm font-semibold text-ink-900">Add a tip. 100% goes to your crew.</p>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {[0, 15, 18, 20, 25].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  aria-pressed={tipPct === pct}
                  onClick={() => setTipPct(pct)}
                  className={`min-h-[44px] rounded-xl border text-sm font-bold ${tipPct === pct ? 'border-ink-900 bg-ink-900 text-white' : 'border-silver-300 text-ink-900 hover:border-ink-900'}`}
                >
                  {pct === 0 ? 'None' : `${pct}%`}
                </button>
              ))}
            </div>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <Button variant="green" className="w-full" loading={busy} onClick={start}>
            Pay {money(snap.money.due_cents + tipCents, true)}
          </Button>
        </>
      )}
    </Card>
  );
}

function RateCrew({ token, onDone }: { token: string; onDone: () => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await callFunction('web-track', { action: 'rate', token, overall: stars, comment: comment.trim() || undefined });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <SectionLabel>Rate your crew</SectionLabel>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={stars === n} onClick={() => setStars(n)} className="p-1">
            <svg width="34" height="34" viewBox="0 0 24 24" fill={n <= stars ? '#0FA353' : 'none'} stroke={n <= stars ? '#0FA353' : '#A1A1AA'} strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
              <path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z" />
            </svg>
          </button>
        ))}
      </div>
      {stars > 0 ? (
        <>
          <Field label="Anything to add? (optional)" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
          <ErrorNote>{error}</ErrorNote>
          <Button className="w-full" loading={busy} onClick={submit}>
            Submit rating
          </Button>
        </>
      ) : null}
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

function ActionButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-[48px] rounded-2xl border border-silver-300 bg-white px-3 text-sm font-bold text-ink-900 transition hover:border-ink-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function LiveMove({
  initial,
  token,
  onLeave,
}: {
  initial: Snapshot;
  token: string;
  onLeave: (reason?: string) => void;
}) {
  const [snap, setSnap] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [gate, setGate] = useState<GateAction | null>(null);
  const [panel, setPanel] = useState<GateAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const finishedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await callFunction<{ snapshot: Snapshot }>('web-track', { action: 'snapshot', token });
      if (!live.current) return;
      setSnap(res.snapshot);
      setOffline(false);
      finishedRef.current = ['completed', 'cancelled', 'failed'].includes(res.snapshot.status);
    } catch (e) {
      if (!live.current) return;
      if ((e as ApiError).status === 401) {
        clearTrackSession();
        onLeave((e as Error).message);
        return;
      }
      setOffline(true);
    }
  }, [token, onLeave]);

  useEffect(() => {
    live.current = true;
    const loop = async () => {
      await refresh();
      if (!live.current) return;
      timer.current = setTimeout(loop, document.hidden ? HIDDEN_REFRESH_MS : finishedRef.current ? FINISHED_REFRESH_MS : REFRESH_MS);
    };
    timer.current = setTimeout(loop, REFRESH_MS);
    const wake = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [refresh]);

  const guarded = async (action: GateAction) => {
    const { owner } = await ownsMove(snap.booking_id);
    if (owner) setPanel(action);
    else setGate(action);
  };

  const pickup = useMemo(() => pointOf(snap.pickup), [snap.pickup.lat, snap.pickup.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const dropoff = useMemo(() => pointOf(snap.dropoff), [snap.dropoff?.lat, snap.dropoff?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const crewPoint = useMemo(() => (snap.ping ? { lat: Number(snap.ping.lat), lng: Number(snap.ping.lng) } : null), [snap.ping?.lat, snap.ping?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = snap.status === 'on_the_way' ? 'pickup' : snap.status === 'in_transit' ? 'drop-off' : null;
  const target = heading === 'pickup' ? pickup : heading === 'drop-off' ? dropoff : null;
  const eta = crewPoint && target ? etaMinutes(crewPoint, target) : null;
  const stale = !!snap.ping && Date.now() - new Date(snap.ping.recorded_at).getTime() > STALE_LOCATION_MS;
  const closed = ['completed', 'cancelled', 'failed'].includes(snap.status);
  const stageIndex = STAGES.findIndex((s) => s.status === snap.status);
  const timeFor = (status: MoveStatus) => [...snap.timeline].reverse().find((t) => t.status === status)?.at;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:pt-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-brand-800">Move {snap.short_code}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{HEADLINES[snap.status] ?? 'Your move'}</h1>
          <p className="mt-1 text-sm text-silver-600">
            {formatDate(snap.date)}, arriving {snap.window}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            clearTrackSession();
            onLeave();
          }}
          className="shrink-0 text-sm font-semibold text-silver-600 hover:text-ink-900"
        >
          Close
        </button>
      </div>

      {offline ? <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">Reconnecting. What you see may be a few moments old.</p> : null}
      {notice ? <p className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-900">{notice}</p> : null}

      {snap.status === 'cancelled' || snap.status === 'failed' ? null : (
        <ol className="mt-6 grid grid-cols-6 gap-1.5" aria-label="Move progress">
          {STAGES.map((stage, i) => {
            const done = stageIndex >= i;
            const at = timeFor(stage.status);
            return (
              <li key={stage.status} aria-current={stageIndex === i ? 'step' : undefined}>
                <span className={`block h-1.5 rounded-full ${done ? 'bg-brand-600' : 'bg-silver-200'}`} />
                <span className={`mt-1.5 block text-[11px] font-semibold leading-tight sm:text-xs ${done ? 'text-ink-900' : 'text-silver-400'}`}>{stage.label}</span>
                {done && at ? <span className="block text-[10px] text-silver-500 sm:text-xs">{timeOf(at)}</span> : null}
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <div className="relative">
            <LiveMap pickup={pickup} dropoff={dropoff} crew={closed ? null : crewPoint} target={closed ? null : target} />
            {eta != null && heading ? (
              <div className="pointer-events-none absolute left-3 top-3 rounded-2xl bg-white px-4 py-2.5 shadow-lg">
                <p className="text-xs font-semibold text-silver-500">Heading to {heading}</p>
                <p className="text-lg font-bold text-ink-900">About {eta} min</p>
              </div>
            ) : null}
          </div>
          {stale ? <p className="text-xs text-silver-500">Last location update at {timeOf(snap.ping!.recorded_at)}. It will refresh when the crew&apos;s phone reconnects.</p> : null}
          {!snap.ping && !closed && stageIndex >= 0 ? <p className="text-xs text-silver-500">Waiting for the crew&apos;s location.</p> : null}
          <BillingMeter snap={snap} />
        </div>

        <div className="space-y-4">
          {snap.status === 'completed' ? (
            <>
              <FinalBill snap={snap} token={token} onChanged={refresh} />
              {snap.crew && !snap.rated ? <RateCrew token={token} onDone={refresh} /> : null}
              {snap.rated ? <p className="text-center text-sm font-medium text-silver-600">Thanks for rating your crew.</p> : null}
            </>
          ) : null}

          <Card>
            <SectionLabel>Your crew</SectionLabel>
            {snap.crew?.name || snap.crew?.driver_first_name ? (
              <div className="mt-3">
                <p className="flex items-center gap-2 text-lg font-bold text-ink-900">
                  {snap.crew.name ?? 'Movvy crew'}
                  {snap.crew.verified ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-800">Verified</span> : null}
                </p>
                <p className="mt-0.5 text-sm text-silver-600">
                  {snap.crew.rating_avg != null ? `${Number(snap.crew.rating_avg).toFixed(1)} stars · ${snap.crew.rating_count} review${snap.crew.rating_count === 1 ? '' : 's'}` : 'New to Movvy'}
                </p>
                {snap.crew.driver_first_name ? <p className="mt-2 text-sm text-ink-900">{snap.crew.driver_first_name} is your driver</p> : null}
                {snap.crew.truck ? <p className="text-sm text-ink-900">Truck: {snap.crew.truck}</p> : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-silver-600">{closed ? 'No crew was assigned.' : "We'll show your crew here as soon as they're assigned."}</p>
            )}
            {!closed && snap.crew ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <ActionButton onClick={() => guarded('chat')}>Chat</ActionButton>
                <ActionButton onClick={() => guarded('call')}>Call</ActionButton>
              </div>
            ) : null}
          </Card>

          <Card className="space-y-3">
            <SectionLabel>Your move</SectionLabel>
            <p className="text-sm text-ink-900">
              <strong>From:</strong> {snap.pickup.line1}, {snap.pickup.city}
            </p>
            {snap.dropoff ? (
              <p className="text-sm text-ink-900">
                <strong>To:</strong> {snap.dropoff.line1}, {snap.dropoff.city}
              </p>
            ) : null}
            {snap.status !== 'completed' ? <Row label="Estimate" value={money(snap.money.estimate_cents)} /> : null}
            {snap.status !== 'completed' && snap.money.deposit_cents > 0 ? <Row label="Deposit paid" value={money(snap.money.deposit_cents)} /> : null}
            {snap.can.modify || snap.can.cancel ? (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {snap.can.modify ? <ActionButton onClick={() => guarded('change')}>Change</ActionButton> : null}
                {snap.can.cancel ? <ActionButton onClick={() => guarded('cancel')}>Cancel</ActionButton> : null}
              </div>
            ) : null}
            {!snap.can.modify && !closed && snap.status !== 'draft' && stageIndex < 0 ? <p className="text-xs text-silver-500">Changes close 24 hours before your move.</p> : null}
          </Card>
        </div>
      </div>

      {gate ? (
        <GateSheet
          bookingId={snap.booking_id}
          onClose={() => setGate(null)}
          onPassed={() => {
            setPanel(gate);
            setGate(null);
          }}
        />
      ) : null}
      {panel === 'chat' ? <ChatSheet bookingId={snap.booking_id} onClose={() => setPanel(null)} /> : null}
      {panel === 'call' ? <CallSheet bookingId={snap.booking_id} onClose={() => setPanel(null)} /> : null}
      {panel === 'change' ? (
        <ChangeSheet
          snap={snap}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            setNotice('Your changes are saved.');
            refresh();
          }}
        />
      ) : null}
      {panel === 'cancel' ? (
        <CancelSheet
          snap={snap}
          onClose={() => setPanel(null)}
          onDone={() => {
            setPanel(null);
            setNotice('Your move has been cancelled.');
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
