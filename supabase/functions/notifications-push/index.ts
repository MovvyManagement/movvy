// =============================================================================
// POST /notifications-push
//
// Sends a push notification to a target profile via Expo Push API.
// Called from:
//   • a DB webhook on `notifications` INSERT where channel='push'  (preferred)
//   • directly from other edge functions for one-off pushes
//
// Body:
//   { profile_id, title, body, data? }
//
// Looks up every active device_tokens row for that profile and fans out one
// Expo Push message per device. Expo dedupes by token on their end.
//
// In dev (no EXPO_ACCESS_TOKEN set), the call is logged to console so the
// trigger pipeline can be tested without real push delivery.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient,
  audit,
  checkRateLimit,
  clientIp,
  httpError,
  HttpError,
  jsonResponse,
  requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  profile_id: z.string().uuid(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  data: z.record(z.string(), z.any()).optional(),
  /** Optional category — informs whether the OS shows a custom sound etc. */
  category: z.string().max(80).optional(),
});

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'default' | 'high';
  channelId?: string;
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    // Two kinds of caller:
    //   • the DB trigger `notifications_push_fanout` on notifications INSERT —
    //     presents the internal shared secret and skips user auth + rate limit.
    //   • a signed-in admin/support doing a one-off push — requireAuth.
    const internalSecret = req.headers.get('x-internal-secret');
    const expectedInternal = Deno.env.get('DB_WEBHOOK_SECRET');
    const isInternal = !!internalSecret && !!expectedInternal && internalSecret === expectedInternal;

    let user: { id: string; role: string } | null = null;
    if (!isInternal) {
      user = await requireAuth(req);
      await checkRateLimit({
        bucketKey: `user:${user.id}:notifications_push`,
        endpoint: 'notifications-push',
        limit: 200,
        windowSeconds: 60,
      });
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { profile_id, title, body, data, category } = parsed.data;

    const admin = adminClient();

    // Fan out to every device token registered for this profile.
    const { data: tokens, error: tErr } = await admin
      .from('device_tokens')
      .select('expo_push_token')
      .eq('profile_id', profile_id);
    if (tErr) throw httpError(500, 'Could not load device tokens');

    if (!tokens || tokens.length === 0) {
      // No devices yet — return 200 so the trigger doesn't retry forever.
      return jsonResponse({ ok: true, sent: 0, reason: 'no_devices' }, { status: 200 }, cors);
    }

    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.expo_push_token as string,
      title,
      body,
      sound: 'default',
      priority: 'high',
      data: { ...(data ?? {}), category },
      channelId: 'default',
    }));

    // Expo Push API — batch up to 100 per request. The access token is OPTIONAL
    // (only needed if the Expo project turned on enhanced push security), so we
    // deliver for real even without it, adding the header only when it's set.
    const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    const pushHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (accessToken) pushHeaders.Authorization = `Bearer ${accessToken}`;

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: pushHeaders,
      body: JSON.stringify(messages),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error('[notifications-push] expo error', res.status, json);
      throw httpError(502, 'Push provider rejected the batch');
    }

    if (user) {
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: 'notification.pushed',
        entityType: 'profile',
        entityId: profile_id,
        ip: clientIp(req),
        ua: req.headers.get('user-agent') ?? undefined,
        payload: { sent: messages.length, category },
      });
    }

    return jsonResponse({ ok: true, sent: messages.length }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[notifications-push] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
