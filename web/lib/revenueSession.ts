// =============================================================================
// Revenue session token — the "PIN entered this session" proof.
//
// The revenue PIN itself is verified server-side by the admin-console edge
// function (which holds the salted hash). On success we mint a short-lived,
// HMAC-signed token bound to the user id and store it as an httpOnly cookie.
// The Revenue page re-validates the token (+ re-checks management) on every
// load, so the cookie can't be forged and can't outlive its 8h window.
//
// REVENUE_SESSION_SECRET must be set in the web env (Vercel). In development
// we fall back to a constant so the gate still functions locally. In
// production there is NO fallback: the dev constant is public (it lives in
// this repo), so signing with it would let anyone who reads the source forge
// the unlock cookie. Fail closed instead — minting throws a clear error and
// verification always reports "locked" until the env var is set.
// =============================================================================

import crypto from 'node:crypto';

const SECRET =
  process.env.REVENUE_SESSION_SECRET ||
  (process.env.NODE_ENV === 'production' ? null : 'movvy-dev-revenue-secret-set-me');
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const REVENUE_COOKIE = 'movvy_rev';

export function mintRevenueToken(userId: string): string {
  if (!SECRET) {
    throw new Error(
      'REVENUE_SESSION_SECRET is not set — add it in Vercel env vars before using the Revenue screen.',
    );
  }
  const exp = Date.now() + TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyRevenueToken(token: string | undefined, userId: string): boolean {
  if (!SECRET) return false;
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [uid, expStr, sig] = parts;
  if (uid !== userId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${uid}.${expStr}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
