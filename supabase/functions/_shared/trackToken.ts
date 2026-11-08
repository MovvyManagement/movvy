// =============================================================================
// Move-code tracking tokens.
//
// The website's live page has no signed-in user. After someone proves a move
// code and the last four digits of the customer's phone, web-track issues one
// of these so the page can keep refreshing without asking again.
//
// Format: <booking uuid>.<expiry seconds>.<HMAC-SHA256 signature>
// It names one booking, expires, and can't be altered without the secret.
// =============================================================================

const encoder = new TextEncoder();
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

async function signingKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('WEB_TRACK_SECRET');
  // Fail closed: without a secret no token can be issued or trusted.
  if (!secret) throw new Error('WEB_TRACK_SECRET is not set');
  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function issueTrackToken(
  bookingId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const payload = `${bookingId}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the booking id, or null if the token is forged, altered or expired. */
export async function verifyTrackToken(token: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [bookingId, expiry, signature] = parts;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(),
      fromBase64Url(signature),
      encoder.encode(`${bookingId}.${expiry}`),
    );
    if (!valid) return null;
  } catch (e) {
    console.error('[trackToken] verify failed', e);
    return null;
  }
  if (Number(expiry) < Date.now() / 1000) return null;
  return bookingId;
}
