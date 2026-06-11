// Security utilities for Edge Functions.
// Every public endpoint MUST use checkRateLimit + requireAuth.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Service role client — full DB access, used only inside edge functions. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** User-scoped client that uses the caller's JWT, so RLS applies. */
export function userClient(authHeader: string | null): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader ?? '' } },
    },
  );
}

export interface AuthedUser {
  id: string;
  email: string | null;
  role: string;
}

/** Verify the request's JWT and return the user's profile row. 401 on failure. */
export async function requireAuth(req: Request): Promise<AuthedUser> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw httpError(401, 'Missing Authorization header');

  const supabase = userClient(authHeader);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw httpError(401, 'Invalid or expired session');

  // Fetch role from profiles using the service client (bypasses RLS for this read)
  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, role, is_suspended, deleted_at')
    .eq('id', user.id)
    .single();

  if (!profile) throw httpError(403, 'No profile found');
  if (profile.is_suspended) throw httpError(403, 'Account is suspended');
  if (profile.deleted_at) throw httpError(403, 'Account is deleted');

  return { id: profile.id, email: profile.email, role: profile.role };
}

/** DB-backed sliding-window rate limit. Returns true if request is allowed. */
export async function checkRateLimit(opts: {
  bucketKey: string;          // e.g. 'user:<uuid>:bookings_create' or 'ip:<ip>:auth_signup'
  endpoint: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.rpc('rl_check_and_increment', {
    p_bucket_key: opts.bucketKey,
    p_endpoint: opts.endpoint,
    p_limit: opts.limit,
    p_window_seconds: opts.windowSeconds,
  });
  if (error) {
    // Fail open on rate-limit infra failure (logged) — but never on auth.
    console.error('[rl] error', error);
    return;
  }
  if (data === false) {
    throw httpError(429, 'Rate limit exceeded. Please slow down.');
  }
}

/** Write an audit log entry for a sensitive operation. */
export async function audit(opts: {
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  ip?: string;
  ua?: string;
  payload?: unknown;
}) {
  const admin = adminClient();
  await admin.from('audit_logs').insert({
    actor_profile_id: opts.actorId,
    actor_role: opts.actorRole,
    action: opts.action,
    entity_type: opts.entityType,
    entity_id: opts.entityId ?? null,
    ip_address: opts.ip ?? null,
    user_agent: opts.ua ?? null,
    payload: opts.payload ?? null,
  });
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const httpError = (status: number, message: string) => new HttpError(status, message);

export function jsonResponse(body: unknown, init: ResponseInit = {}, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}
