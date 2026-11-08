'use client';

// =============================================================================
// Website booking. The same moves, prices and rules as the app's flow:
// bookings-create holds the move as a draft, invisible to crews, and the Stripe
// webhook releases it to them once the 20% deposit lands.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  type Address,
  addressPayload,
  ARRIVAL_WINDOW,
  ApiError,
  buildCalendar,
  callFunction,
  formatDate,
  money,
  openTracking,
  type Quote,
} from '@/lib/movvy';
import { AddressField } from './AddressField';
import { ForgotPasswordForm, SignInForm, SignUpForm } from './AccountForms';
import { StripePayment, TestModeNote } from './StripePayment';
import { Button, Card, ErrorNote, Field, Row, SectionLabel, Spinner } from './ui';

type MoveKind = 'home_move' | 'commercial';
type CommercialKind = 'office' | 'retail' | 'warehouse' | 'restaurant' | 'single_items' | 'labor_only';

interface Access {
  pickupFloor?: number;
  dropoffFloor?: number;
  pickupElevator?: boolean;
  dropoffElevator?: boolean;
  parking?: string;
  entryCode?: string;
  notes?: string;
}

interface Draft {
  pickup: Address | null;
  dropoff: Address | null;
  date: string | null;
  kind: MoveKind;
  preset: string | null;
  commercialKind: CommercialKind;
  workstations: number;
  crewSize: number;
  estimatedHours: number;
  notes: string;
  access: Access;
}

interface HeldBooking {
  id: string;
  code: string;
  clientSecret: string;
  amountCents: number;
}

const emptyDraft: Draft = {
  pickup: null,
  dropoff: null,
  date: null,
  kind: 'home_move',
  preset: null,
  commercialKind: 'office',
  workstations: 10,
  crewSize: 3,
  estimatedHours: 4,
  notes: '',
  access: {},
};

// Same presets as the app's details step.
const PRESETS = [
  { key: 'apt-1', dwelling: 'apartment', bedrooms: 1, title: '1-bedroom apartment', hours: 6, crew: 2 },
  { key: 'apt-2', dwelling: 'apartment', bedrooms: 2, title: '2-bedroom apartment', hours: 8, crew: 2 },
  { key: 'apt-3', dwelling: 'apartment', bedrooms: 3, title: '3-bedroom apartment', hours: 10, crew: 3 },
  { key: 'house-2', dwelling: 'house', bedrooms: 2, title: '2-bedroom house', hours: 8, crew: 2 },
  { key: 'house-3', dwelling: 'house', bedrooms: 3, title: '3-bedroom house', hours: 10, crew: 3 },
  { key: 'house-4', dwelling: 'house', bedrooms: 4, title: '4-bedroom house', hours: 12, crew: 3 },
] as const;

const COMMERCIAL_KINDS: { key: CommercialKind; label: string }[] = [
  { key: 'office', label: 'Office' },
  { key: 'retail', label: 'Retail' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'single_items', label: 'Single items' },
  { key: 'labor_only', label: 'Labour only' },
];

const STEPS = ['Where and when', 'Your move', 'Estimate', 'Account', 'Deposit'];
const DRAFT_KEY = 'movvy-web-booking-draft-v1';
const HELD_KEY = 'movvy-web-booking-held-v1';

function readStored<T>(storage: 'local' | 'session', key: string): T | null {
  try {
    const raw = (storage === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(storage: 'local' | 'session', key: string, value: unknown | null) {
  try {
    const target = storage === 'local' ? localStorage : sessionStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage. The booking still works in this tab.
  }
}

function detailsFor(draft: Draft): Record<string, unknown> {
  if (draft.kind === 'home_move') {
    const preset = PRESETS.find((p) => p.key === draft.preset);
    return {
      moveType: 'home_move',
      dwelling: preset?.dwelling,
      bedrooms: preset?.bedrooms,
      livingRooms: 1,
      bathrooms: 1,
      floor: 1,
      hasElevator: false,
      packingNeeded: true,
      assemblyNeeded: true,
      heavyItems: false,
      fragileItems: false,
      access: draft.access,
    };
  }
  return {
    moveType: 'commercial',
    commercialKind: draft.commercialKind,
    workstations: draft.workstations,
    crewSize: draft.crewSize,
    estimatedHours: draft.estimatedHours,
    notes: draft.notes,
    access: draft.access,
  };
}

export function BookingFlow() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [hydrated, setHydrated] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [minDate, setMinDate] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; date: string; last4: string } | null>(null);

  useEffect(() => {
    const stored = readStored<Draft>('local', DRAFT_KEY);
    if (stored) setDraft({ ...emptyDraft, ...stored });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeStored('local', DRAFT_KEY, draft);
  }, [draft, hydrated]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const getEstimate = useCallback(async () => {
    if (!draft.pickup || !draft.dropoff) return;
    setQuote(null);
    setQuoteError(null);
    setStep(2);
    try {
      const res = await callFunction<{ quote: Quote; min_date: string }>('web-quote', {
        pickup: { lat: draft.pickup.lat, lng: draft.pickup.lng, city: draft.pickup.city },
        dropoff: { lat: draft.dropoff.lat, lng: draft.dropoff.lng, city: draft.dropoff.city },
        details: detailsFor(draft),
      });
      setQuote(res.quote);
      setMinDate(res.min_date);
    } catch (e) {
      setQuoteError((e as Error).message);
    }
  }, [draft]);

  const finish = (code: string, last4: string) => {
    setDone({ code, date: draft.date as string, last4 });
    writeStored('local', DRAFT_KEY, null);
    writeStored('session', HELD_KEY, null);
    window.scrollTo({ top: 0 });
  };

  if (done) return <Confirmed {...done} />;

  return (
    <div className="mx-auto max-w-2xl px-5 pb-20 pt-8 sm:pt-12">
      <Progress step={step} />
      {step === 0 ? (
        <WhereWhen draft={draft} update={update} onNext={() => setStep(1)} />
      ) : step === 1 ? (
        <YourMove draft={draft} update={update} onBack={() => setStep(0)} onNext={getEstimate} />
      ) : step === 2 ? (
        <Estimate
          draft={draft}
          update={update}
          quote={quote}
          error={quoteError}
          minDate={minDate}
          onBack={() => setStep(1)}
          onChangeDate={() => setStep(0)}
          onNext={() => setStep(3)}
        />
      ) : step === 3 ? (
        <AccountStep onBack={() => setStep(2)} onNext={() => setStep(4)} />
      ) : quote ? (
        <DepositStep draft={draft} quote={quote} onBack={() => setStep(3)} onPaid={finish} />
      ) : null}
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mb-7">
      <div className="flex gap-1.5" aria-hidden>
        {STEPS.map((label, i) => (
          <span key={label} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-silver-200'}`} />
        ))}
      </div>
      <p className="mt-2 text-xs font-bold uppercase tracking-wider text-silver-500">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>
    </div>
  );
}

function Actions({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-6 flex gap-3">
      {onBack ? (
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      ) : null}
      <div className="flex-1">{children}</div>
    </div>
  );
}

function WhereWhen({ draft, update, onNext }: { draft: Draft; update: (p: Partial<Draft>) => void; onNext: () => void }) {
  const days = useMemo(() => buildCalendar(), []);
  const selectable = days.some((d) => d.iso === draft.date && !d.disabled);
  const ready = !!draft.pickup && !!draft.dropoff && selectable;
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">Book your move</h1>
      <p className="mt-2 text-silver-600">Vetted crews, live tracking and honest hourly pricing, anywhere in Alberta.</p>
      <Card className="mt-6 space-y-5">
        <AddressField label="Moving from" placeholder="Start typing your pickup address" value={draft.pickup} onChange={(pickup) => update({ pickup })} />
        <AddressField label="Moving to" placeholder="Start typing your drop-off address" value={draft.dropoff} onChange={(dropoff) => update({ dropoff })} />
      </Card>
      <Card className="mt-4">
        <SectionLabel>Moving day</SectionLabel>
        <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6">
          {days.map((d) => {
            const selected = draft.date === d.iso && !d.disabled;
            return (
              <button
                key={d.iso}
                type="button"
                disabled={d.disabled}
                aria-pressed={selected}
                onClick={() => update({ date: d.iso })}
                className={`w-[68px] shrink-0 rounded-2xl border px-2 py-3 text-center transition ${
                  selected
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : d.disabled
                    ? 'cursor-not-allowed border-silver-100 bg-silver-50 text-silver-300'
                    : 'border-silver-200 bg-white text-ink-900 hover:border-ink-900'
                }`}
              >
                <span className="block text-xs font-medium">{d.weekday}</span>
                <span className="block text-xl font-bold">{d.day}</span>
                <span className="block text-xs font-medium">{d.month}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-silver-600">Your crew arrives between {ARRIVAL_WINDOW}.</p>
      </Card>
      <Actions>
        <Button className="w-full" disabled={!ready} onClick={onNext}>
          Continue
        </Button>
      </Actions>
    </>
  );
}

function Counter({ label, sub, value, min, max, onChange }: { label: string; sub: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const button = 'flex h-10 w-10 items-center justify-center rounded-full border border-silver-300 text-lg font-bold text-ink-900 hover:border-ink-900 disabled:opacity-30';
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-semibold text-ink-900">{label}</p>
        <p className="text-xs text-silver-500">{sub}</p>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className={button}>
          −
        </button>
        <span className="w-7 text-center text-base font-bold">{value}</span>
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className={button}>
          +
        </button>
      </div>
    </div>
  );
}

function YourMove({ draft, update, onBack, onNext }: { draft: Draft; update: (p: Partial<Draft>) => void; onBack: () => void; onNext: () => void }) {
  const ready = draft.kind === 'commercial' || !!draft.preset;
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">What are we moving?</h1>
      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-silver-100 p-1">
        {(
          [
            ['home_move', 'Residential'],
            ['commercial', 'Commercial and other'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={draft.kind === key}
            onClick={() => update({ kind: key })}
            className={`min-h-[44px] rounded-xl px-3 text-sm font-bold transition ${draft.kind === key ? 'bg-white text-ink-900 shadow-sm' : 'text-silver-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {draft.kind === 'home_move' ? (
        <>
          <p className="mt-4 text-sm text-silver-600">Each option includes packing and disassembly. Pick the closest fit and the crew adapts on the day.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={draft.preset === p.key}
                onClick={() => update({ preset: p.key })}
                className={`rounded-3xl border p-5 text-left transition ${draft.preset === p.key ? 'border-brand-800 bg-brand-50 ring-1 ring-brand-800' : 'border-silver-200 bg-white hover:border-ink-900'}`}
              >
                <span className="block text-base font-bold text-ink-900">{p.title}</span>
                <span className="mt-1 block text-sm text-silver-600">
                  About {p.hours} hours · {p.crew}-person crew · truck included
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Card className="mt-4">
          <SectionLabel>Type of job</SectionLabel>
          <div className="mt-3 flex flex-wrap gap-2">
            {COMMERCIAL_KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                aria-pressed={draft.commercialKind === k.key}
                onClick={() => update({ commercialKind: k.key })}
                className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold transition ${draft.commercialKind === k.key ? 'border-ink-900 bg-ink-900 text-white' : 'border-silver-300 text-ink-900 hover:border-ink-900'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="mt-4 divide-y divide-silver-100">
            <Counter label="Workstations or desks" sub="Approximate count" value={draft.workstations} min={0} max={500} onChange={(workstations) => update({ workstations })} />
            <Counter label="Crew size" sub="2 to 12 people" value={draft.crewSize} min={2} max={12} onChange={(crewSize) => update({ crewSize })} />
            <Counter label="Estimated hours" sub="4 hour minimum" value={draft.estimatedHours} min={4} max={16} onChange={(estimatedHours) => update({ estimatedHours })} />
          </div>
          <div className="mt-3">
            <Field label="Notes for the crew" placeholder="Loading dock at rear, freight elevator, parking validated" value={draft.notes} maxLength={2000} onChange={(e) => update({ notes: e.target.value })} />
          </div>
        </Card>
      )}
      <Actions onBack={onBack}>
        <Button className="w-full" disabled={!ready} onClick={onNext}>
          See my estimate
        </Button>
      </Actions>
    </>
  );
}

function Estimate({
  draft,
  update,
  quote,
  error,
  minDate,
  onBack,
  onChangeDate,
  onNext,
}: {
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  quote: Quote | null;
  error: string | null;
  minDate: string | null;
  onBack: () => void;
  onChangeDate: () => void;
  onNext: () => void;
}) {
  const [showAccess, setShowAccess] = useState(false);
  const access = draft.access;
  const setAccess = (patch: Access) => update({ access: { ...access, ...patch } });
  const tooSoon = !!minDate && !!draft.date && draft.date < minDate;

  if (error) {
    return (
      <>
        <h1 className="text-3xl font-bold tracking-tight text-ink-900">Your estimate</h1>
        <div className="mt-5">
          <ErrorNote>{error}</ErrorNote>
        </div>
        <Actions onBack={onBack}>
          <Button variant="secondary" className="w-full" onClick={onChangeDate}>
            Change addresses
          </Button>
        </Actions>
      </>
    );
  }
  if (!quote) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-silver-600">
        <Spinner /> Working out your estimate
      </div>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">Your estimate</h1>
      <Card dark className="mt-5">
        <p className="text-xs font-bold uppercase tracking-wider text-silver-400">Estimated total</p>
        <p className="mt-1 text-5xl font-bold tracking-tight">{money(quote.total_cents)}</p>
        <p className="mt-2 text-sm text-silver-300">
          {quote.crew} movers · {quote.trucks > 1 ? `${quote.trucks} trucks` : '1 truck'} · {money(quote.hourly_rate_cents)} an hour
        </p>
      </Card>
      <Card className="mt-4 space-y-2.5">
        <Row label={`On-site work (${quote.on_site_hours} hours)`} value={money(quote.service_cents)} />
        <Row label="Travel" value={money(quote.travel_cents)} />
        {quote.transit_cents > 0 ? <Row label="Long-distance transit" value={money(quote.transit_cents)} /> : null}
        {quote.fuel_cents > 0 ? <Row label="Fuel" value={money(quote.fuel_cents)} /> : null}
        <Row label="Materials" value={money(quote.materials_cents)} />
        <Row label="GST" value={money(quote.gst_cents)} />
        <div className="border-t border-silver-200 pt-2.5">
          <Row label="Deposit today (20%)" value={money(quote.deposit_cents)} strong />
          <div className="mt-1.5">
            <Row label="Estimated balance after your move" value={money(quote.balance_cents)} />
          </div>
        </div>
      </Card>
      <p className="mt-3 text-sm leading-relaxed text-silver-600">
        This is an estimate. You pay for actual time, with a 4-hour minimum, so finishing early costs less. Your deposit comes off the final bill and is fully refundable if you cancel more than 48 hours before your move.
      </p>

      <Card className="mt-4">
        <SectionLabel>Your move</SectionLabel>
        <div className="mt-3 space-y-1.5 text-sm text-ink-900">
          <p>
            <strong>From:</strong> {draft.pickup?.line1}, {draft.pickup?.city}
          </p>
          <p>
            <strong>To:</strong> {draft.dropoff?.line1}, {draft.dropoff?.city}
          </p>
          <p>
            <strong>When:</strong> {draft.date ? formatDate(draft.date) : ''}, arriving {ARRIVAL_WINDOW}
          </p>
        </div>
        <button type="button" onClick={() => setShowAccess(!showAccess)} aria-expanded={showAccess} className="mt-4 text-sm font-semibold text-brand-800 hover:underline">
          {showAccess ? 'Hide access details' : 'Add floors, parking or a buzzer code (optional)'}
        </button>
        {showAccess ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pickup floor" inputMode="numeric" value={access.pickupFloor ?? ''} onChange={(e) => setAccess({ pickupFloor: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })} />
              <Field label="Drop-off floor" inputMode="numeric" value={access.dropoffFloor ?? ''} onChange={(e) => setAccess({ dropoffFloor: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })} />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-900">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-5 w-5 accent-[#0A7A3E]" checked={!!access.pickupElevator} onChange={(e) => setAccess({ pickupElevator: e.target.checked })} /> Elevator at pickup
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-5 w-5 accent-[#0A7A3E]" checked={!!access.dropoffElevator} onChange={(e) => setAccess({ dropoffElevator: e.target.checked })} /> Elevator at drop-off
              </label>
            </div>
            <Field label="Parking" placeholder="Alley only, no street parking" value={access.parking ?? ''} maxLength={200} onChange={(e) => setAccess({ parking: e.target.value })} />
            <Field label="Buzzer or gate code" value={access.entryCode ?? ''} maxLength={100} onChange={(e) => setAccess({ entryCode: e.target.value })} />
            <Field label="Anything else for the crew" value={access.notes ?? ''} maxLength={500} onChange={(e) => setAccess({ notes: e.target.value })} />
          </div>
        ) : null}
      </Card>
      {tooSoon && minDate ? (
        <div className="mt-4">
          <ErrorNote>The earliest available date for this address is {formatDate(minDate)}. Please choose a later date.</ErrorNote>
        </div>
      ) : null}
      <Actions onBack={onBack}>
        {tooSoon ? (
          <Button className="w-full" onClick={onChangeDate}>
            Change date
          </Button>
        ) : (
          <Button className="w-full" onClick={onNext}>
            Continue to book
          </Button>
        )}
      </Actions>
    </>
  );
}

function AccountStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [mode, setMode] = useState<'loading' | 'signed-in' | 'create' | 'sign-in' | 'forgot'>('loading');
  const [who, setWho] = useState('');

  const check = useCallback(async () => {
    const { data } = await supabaseBrowser().auth.getUser();
    if (data.user) {
      setWho(data.user.email ?? data.user.phone ?? 'your account');
      setMode('signed-in');
    } else {
      setMode((m) => (m === 'loading' ? 'create' : m));
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    setMode('create');
  };

  if (mode === 'loading') {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">
        {mode === 'signed-in' ? 'Ready to book' : mode === 'sign-in' ? 'Sign in' : mode === 'forgot' ? 'Reset your password' : 'Create your account'}
      </h1>
      {mode === 'create' ? <p className="mt-2 text-silver-600">One account for movvy.ca and the Movvy app, so your move shows up in both.</p> : null}
      <Card className="mt-5">
        {mode === 'signed-in' ? (
          <div className="space-y-4">
            <p className="text-sm text-silver-600">
              You&apos;re signed in as <strong className="text-ink-900">{who}</strong>.
            </p>
            <Button className="w-full" onClick={onNext}>
              Continue to deposit
            </Button>
            <button type="button" onClick={signOut} className="block w-full text-center text-sm font-semibold text-silver-600 hover:text-ink-900">
              Use a different account
            </button>
          </div>
        ) : mode === 'create' ? (
          <>
            <SignUpForm onSignedUp={onNext} onHaveAccount={() => setMode('sign-in')} />
            <p className="mt-5 text-center text-sm text-silver-600">
              Already have an account?{' '}
              <button type="button" onClick={() => setMode('sign-in')} className="font-semibold text-brand-800 hover:underline">
                Sign in
              </button>
            </p>
          </>
        ) : mode === 'sign-in' ? (
          <>
            <SignInForm onSignedIn={onNext} onForgot={() => setMode('forgot')} />
            <p className="mt-5 text-center text-sm text-silver-600">
              New to Movvy?{' '}
              <button type="button" onClick={() => setMode('create')} className="font-semibold text-brand-800 hover:underline">
                Create an account
              </button>
            </p>
          </>
        ) : (
          <ForgotPasswordForm onDone={() => setMode('sign-in')} />
        )}
      </Card>
      <Actions onBack={onBack}>
        <span />
      </Actions>
    </>
  );
}

const PROMO_MESSAGES: Record<string, string> = {
  invalid_code: "That code isn't valid.",
  expired: 'That code has expired.',
  fully_redeemed: 'That code has been fully used.',
  min_subtotal_not_met: "This move doesn't meet that code's minimum.",
  wrong_city: "That code doesn't apply in this city.",
  per_user_limit: "You've already used that code.",
};

function DepositStep({
  draft,
  quote,
  onBack,
  onPaid,
}: {
  draft: Draft;
  quote: Quote;
  onBack: () => void;
  onPaid: (code: string, last4: string) => void;
}) {
  const [held, setHeld] = useState<HeldBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; discount: number } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);

  // Rounded exactly as the server rounds, so this matches the charge.
  const discount = Math.min(promo?.discount ?? 0, quote.total_cents);
  const totalCents = Math.ceil((quote.total_cents - discount) / 100) * 100;
  const depositCents = Math.ceil((totalCents * 0.2) / 100) * 100;
  const citySlug = (draft.pickup?.city ?? '').trim().toLowerCase().replace(/\s+/g, '-') || 'calgary';

  const accessToken = async () => {
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) throw new ApiError('Please sign in again to continue.', 401);
    return data.session.access_token as string;
  };

  // A refresh keeps the move already held, instead of creating a second one.
  useEffect(() => {
    const stored = readStored<HeldBooking>('session', HELD_KEY);
    if (stored) setHeld(stored);
  }, []);

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setCheckingPromo(true);
    setPromoError(null);
    try {
      const res = await callFunction<{ ok: boolean; reason?: string; discount_cents?: number }>(
        'promo-validate',
        { code, subtotal_cents: quote.subtotal_cents, city_slug: citySlug },
        await accessToken(),
      );
      if (res.ok) {
        setPromo({ code, discount: res.discount_cents ?? 0 });
      } else {
        setPromo(null);
        setPromoError(PROMO_MESSAGES[res.reason ?? ''] ?? "This code can't be used on this booking.");
      }
    } catch (e) {
      setPromo(null);
      setPromoError((e as Error).message);
    } finally {
      setCheckingPromo(false);
    }
  };

  const startPayment = async () => {
    if (!draft.pickup || !draft.dropoff || !draft.date) return;
    setBusy(true);
    setError(null);
    try {
      const token = await accessToken();
      const created = await callFunction<{ booking: { id: string; short_code: string } }>(
        'bookings-create',
        {
          city_slug: citySlug,
          pickup: addressPayload(draft.pickup),
          dropoff: addressPayload(draft.dropoff),
          schedule: { mode: 'scheduled', date: draft.date, window: ARRIVAL_WINDOW },
          details: detailsFor(draft),
          customer_notes: draft.kind === 'commercial' ? draft.notes || undefined : undefined,
          promo_code: promo?.code,
          client_estimate_total_cents: quote.total_cents,
        },
        token,
      );
      const payment = await callFunction<{ client_secret: string; amount_cents: number }>(
        'stripe-create-payment-intent',
        { booking_id: created.booking.id, kind: 'deposit' },
        token,
      );
      const next: HeldBooking = {
        id: created.booking.id,
        code: created.booking.short_code,
        clientSecret: payment.client_secret,
        amountCents: payment.amount_cents,
      };
      writeStored('session', HELD_KEY, next);
      setHeld(next);
    } catch (e) {
      setError(
        (e as ApiError).status === 403 && (e as Error).message.includes('Only customers')
          ? 'This login belongs to a moving company. Please book with a customer account.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  // Backing out releases the held move, so nothing half-booked is left behind.
  const startOver = async () => {
    if (held) {
      try {
        await callFunction('bookings-cancel', { booking_id: held.id, reason: 'Deposit payment not completed at checkout' }, await accessToken());
      } catch (e) {
        console.warn('[book] releasing held move failed', e);
      }
      writeStored('session', HELD_KEY, null);
      setHeld(null);
    }
    onBack();
  };

  const paid = async () => {
    const { data } = await supabaseBrowser().auth.getUser();
    onPaid(held?.code as string, (data.user?.phone ?? '').replace(/\D/g, '').slice(-4));
  };

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">Pay your deposit</h1>
      <p className="mt-2 text-silver-600">Your move is confirmed once the 20% deposit goes through.</p>
      <div className="mt-5">
        <TestModeNote />
      </div>
      <Card className="mt-4 space-y-2.5">
        <Row label="Estimated total" value={money(totalCents)} />
        {discount > 0 ? <Row label={`Promo ${promo?.code}`} value={`−${money(discount)}`} /> : null}
        <div className="border-t border-silver-200 pt-2.5">
          <Row label="Deposit due today" value={held ? money(held.amountCents) : money(depositCents)} strong />
        </div>
      </Card>

      {held ? (
        <Card className="mt-4">
          <StripePayment
            clientSecret={held.clientSecret}
            label={`Pay ${money(held.amountCents)} deposit`}
            returnUrl={`${window.location.origin}/track?code=${encodeURIComponent(held.code)}`}
            onPaid={paid}
          />
        </Card>
      ) : (
        <Card className="mt-4 space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Promo code (optional)" value={promoInput} autoCapitalize="characters" onChange={(e) => setPromoInput(e.target.value)} />
            </div>
            <Button variant="secondary" loading={checkingPromo} disabled={!promoInput.trim()} onClick={applyPromo}>
              Apply
            </Button>
          </div>
          {promoError ? <p className="text-xs font-medium text-red-700">{promoError}</p> : null}
          <ErrorNote>{error}</ErrorNote>
          <Button variant="green" className="w-full" loading={busy} onClick={startPayment}>
            Continue to payment
          </Button>
        </Card>
      )}
      <Actions onBack={startOver}>
        <span />
      </Actions>
    </>
  );
}

function Confirmed({ code, date, last4 }: { code: string; date: string; last4: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const openLive = async () => {
    setBusy(true);
    try {
      if (last4.length === 4) await openTracking(code, last4);
    } catch (e) {
      console.warn('[book] automatic tracking unlock failed', e);
    }
    router.push(`/track?code=${encodeURIComponent(code)}`);
  };

  return (
    <div className="mx-auto max-w-xl px-5 pb-24 pt-12 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-800">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <h1 className="mt-5 text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">Your move is booked</h1>
      <p className="mt-2 text-silver-600">
        {formatDate(date)}, arriving {ARRIVAL_WINDOW}. We&apos;re arranging your crew now.
      </p>
      <Card className="mt-7">
        <SectionLabel>Your move code</SectionLabel>
        <p className="mt-1 text-4xl font-bold tracking-tight text-ink-900">{code}</p>
        <p className="mt-3 text-sm leading-relaxed text-silver-600">
          Keep this code. Come back to <strong className="text-ink-900">movvy.ca/track</strong> any time and enter it with the last 4 digits of your phone number to see your move live. We&apos;ve emailed it to you too.
        </p>
      </Card>
      <Button className="mt-6 w-full" loading={busy} onClick={openLive}>
        Open live tracking
      </Button>
    </div>
  );
}
