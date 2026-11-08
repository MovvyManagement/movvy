'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, callFunction, clearTrackSession, loadTrackSession, openTracking, type Snapshot } from '@/lib/movvy';
import { Button, Card, ErrorNote, Field, Spinner } from '@/components/booking/ui';
import { LiveMove } from './LiveMove';

export function TrackMove() {
  const params = useSearchParams();
  const urlCode = params.get('code') ?? '';
  const [session, setSession] = useState<{ token: string; snapshot: Snapshot } | null>(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState(urlCode);
  const [last4, setLast4] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refresh in the same tab carries on. A closed tab starts at the form.
  useEffect(() => {
    const saved = loadTrackSession();
    if (!saved || (urlCode && saved.code.toUpperCase() !== urlCode.toUpperCase())) {
      setChecking(false);
      return;
    }
    callFunction<{ snapshot: Snapshot }>('web-track', { action: 'snapshot', token: saved.token })
      .then((res) => {
        setSession({ token: saved.token, snapshot: res.snapshot });
        setCode(saved.code);
      })
      .catch((e: ApiError) => {
        if (e.status === 401) clearTrackSession();
      })
      .finally(() => setChecking(false));
  }, [urlCode]);

  const leave = useCallback((reason?: string) => {
    setSession(null);
    setLast4('');
    setError(reason ?? null);
  }, []);

  const submit = async () => {
    if (!code.trim()) {
      setError('Enter your move code.');
      return;
    }
    if (!/^\d{4}$/.test(last4)) {
      setError('Enter the last 4 digits of your phone number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await openTracking(code.trim(), last4);
      setSession(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="flex justify-center py-32">
        <Spinner />
      </div>
    );
  }

  if (session) return <LiveMove initial={session.snapshot} token={session.token} onLeave={leave} />;

  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-12 sm:pt-20">
      <h1 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">Track your move</h1>
      <p className="mt-2 text-silver-600">Enter your move code to see your crew live. It&apos;s in your booking confirmation email.</p>
      <Card className="mt-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Move code" placeholder="MV-1234" value={code} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
          <Field
            label="Last 4 digits of your phone number"
            placeholder="0123"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
          />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" loading={busy} className="w-full">
            Show my move
          </Button>
        </form>
      </Card>
    </div>
  );
}
