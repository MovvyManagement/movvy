'use client';

// =============================================================================
// MfaManager — optional TOTP two-factor for admin accounts.
//
// Uses Supabase's client-side MFA API (enroll -> QR -> challenge -> verify).
// Enrollment is OPTIONAL and NOT enforced at the gate, so turning it on can
// never lock anyone out. Once adoption is universal, enforcement (AAL2 in the
// middleware) can be switched on separately.
// =============================================================================

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

type Factor = { id: string; friendly_name?: string | null; status: string };

export function MfaManager() {
  const supabase = supabaseBrowser();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const startEnroll = async () => {
    setError(null); setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${Date.now()}` });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const verifyEnroll = async () => {
    if (!enrolling) return;
    setError(null); setBusy(true);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
    if (chErr) { setBusy(false); setError(chErr.message); return; }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: ch.id, code: code.trim() });
    setBusy(false);
    if (vErr) { setError('That code did not match. Try the current 6-digit code.'); return; }
    setEnrolling(null); setCode(''); refresh();
  };

  const unenroll = async (factorId: string) => {
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    refresh();
  };

  const active = factors.filter((f) => f.status === 'verified');

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 max-w-lg">
      <div className="text-sm font-semibold text-zinc-900 mb-1">Two-factor authentication</div>
      <p className="text-xs text-zinc-500 mb-4">
        Add an authenticator app (Google Authenticator, 1Password, Authy) for a second factor on your admin login. Optional, but recommended.
      </p>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : active.length > 0 ? (
        <div className="space-y-2">
          {active.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <span className="text-sm font-semibold text-emerald-800">✓ {f.friendly_name || 'Authenticator'} enabled</span>
              <button disabled={busy} onClick={() => unenroll(f.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">Remove</button>
            </div>
          ))}
        </div>
      ) : enrolling ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">Scan this with your authenticator app, then enter the 6-digit code.</p>
          <div className="flex items-center gap-4">
            <div className="rounded-xl border border-zinc-200 p-2 bg-white" dangerouslySetInnerHTML={{ __html: enrolling.qr }} />
            <div className="text-xs text-zinc-500 break-all">
              <div className="font-semibold text-zinc-700 mb-1">Manual key</div>
              <code>{enrolling.secret}</code>
            </div>
          </div>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="123456" className="w-32 rounded-lg border border-zinc-300 py-2 px-3 text-center tracking-widest outline-none focus:border-emerald-500" />
            <button disabled={busy || code.length !== 6} onClick={verifyEnroll} className="rounded-lg bg-emerald-600 text-white text-sm font-semibold px-4 hover:bg-emerald-700 disabled:opacity-60">Verify & enable</button>
            <button onClick={() => { setEnrolling(null); setCode(''); }} className="text-sm text-zinc-500 px-2">Cancel</button>
          </div>
        </div>
      ) : (
        <button disabled={busy} onClick={startEnroll} className="rounded-lg bg-zinc-900 text-white text-sm font-semibold px-4 py-2 hover:bg-zinc-800 disabled:opacity-60">
          {busy ? 'Starting…' : 'Set up authenticator'}
        </button>
      )}

      {error ? <p className="text-sm text-red-600 mt-3">{error}</p> : null}
    </div>
  );
}
