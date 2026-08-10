// =============================================================================
// POST /password-reset-verify
//
// Two modes, one endpoint:
//
//   {contact, code}                → check the code is live. Nothing consumed.
//   {contact, code, new_password}  → check it, set the password, consume it.
//
// The two-call shape exists because the app's reset screen checks the code on
// one step and takes the new password on the next. Splitting it keeps that UX
// without inventing a second short-lived token to carry between the steps.
//
// The password is set with the SERVICE ROLE and NO SESSION IS CREATED. That is
// a deliberate improvement over the old Supabase verifyOtp flow, where merely
// verifying a code signed you in — which is why forgot-password.tsx needed an
// explicit customer-vs-partner side check afterwards to stop a partner-only
// account walking into the customer app. A reset now proves you own the
// address and nothing more; you then sign in through the normal door, which
// already enforces which side you're registered for.
//
// Brute force is bounded by attempts (5) and a ten-minute expiry, not by the
// hash — six digits is trivially crackable offline, so the hash only means a
// leaked backup doesn't hand out live codes.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, clientIp, httpError, HttpError, jsonResponse,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  email: z.string().email().max(254).optional(),
  phone: z.string().min(8).max(20).optional(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  new_password: z.string().min(8).max(200).optional(),
});

const MAX_ATTEMPTS = 5;

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

    const email = parsed.data.email?.trim().toLowerCase();
    const phone = parsed.data.phone?.trim();
    const { code, new_password } = parsed.data;
    if (!email && !phone) throw httpError(400, 'Enter your email or phone number.');
    const contact = email ?? phone!;

    // Per-IP ceiling on guessing across many contacts. The per-code attempt
    // counter below handles a single target.
    await checkRateLimit({
      bucketKey: `ip:${clientIp(req) ?? 'unknown'}:pw_reset_verify`,
      endpoint: 'password-reset-verify',
      limit: 30,
      windowSeconds: 3600,
    });

    const admin = adminClient();

    const { data: row } = await admin
      .from('password_reset_codes')
      .select('id, profile_id, code_hash, expires_at, consumed_at, attempts')
      .eq('contact', contact)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Same message for "no code was ever issued" and "the code is wrong", so
    // this endpoint doesn't become the oracle the request endpoint closed.
    const WRONG = 'That code is wrong or has expired. Ask for a new one.';
    if (!row) throw httpError(400, WRONG);
    if (new Date(row.expires_at).getTime() < Date.now()) throw httpError(400, WRONG);
    if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
      throw httpError(429, 'Too many wrong tries on that code. Ask for a new one.');
    }

    const ok = (await sha256Hex(code)) === row.code_hash;
    if (!ok) {
      // Count the miss before returning, or the five-guess ceiling is fiction.
      await admin
        .from('password_reset_codes')
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq('id', row.id);
      throw httpError(400, WRONG);
    }

    // Check-only: the code is good, nothing consumed, so the next call can use
    // it to actually set the password.
    if (!new_password) {
      return jsonResponse({ ok: true, verified: true }, { status: 200 }, cors);
    }

    const { error: pwErr } = await admin.auth.admin.updateUserById(row.profile_id, {
      password: new_password,
    });
    if (pwErr) {
      console.error('[password-reset-verify] password update failed', pwErr);
      throw httpError(400, pwErr.message ?? "Couldn't save that password.");
    }

    // Consume it — one code, one reset.
    await admin
      .from('password_reset_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id);

    // Every existing session for this account dies with the password change.
    // Whoever prompted the reset — including an attacker already signed in —
    // loses access at this moment rather than keeping a live token.
    try {
      await admin.auth.admin.signOut(row.profile_id, 'global');
    } catch (e) {
      console.warn('[password-reset-verify] global sign-out failed (non-fatal)', e);
    }

    return jsonResponse({ ok: true, reset: true }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[password-reset-verify] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
