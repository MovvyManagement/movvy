// POST /notifications-send
// Sends a push notification to a profile via Expo Push API.
//
// Triggered manually or by a DB trigger that calls this function whenever a
// row is inserted into `notifications` with channel='push'. For v1 we keep it
// simple — just sends and updates the notification row's sent_at.
//
// FREE: Expo Push doesn't charge per-message (rate-limited to ~600/sec).

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  profile_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(500),
  data: z.record(z.any()).optional(),
});

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    // Only admins or self can trigger a push (self is for "test push" buttons)
    if (!['movvy_admin', 'movvy_support'].includes(user.role)) {
      throw httpError(403, 'Admins only');
    }

    await checkRateLimit({
      bucketKey: `user:${user.id}:notifications_send`,
      endpoint: 'notifications-send',
      limit: 300, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { profile_id, title, body, data } = parsed.data;

    const admin = adminClient();

    // Look up every registered device for this profile
    const { data: tokens } = await admin
      .from('device_tokens')
      .select('expo_push_token, platform')
      .eq('profile_id', profile_id);
    if (!tokens || tokens.length === 0) {
      return jsonResponse({ ok: true, sent: 0, reason: 'no_devices' }, { status: 200 }, cors);
    }

    // Send to all devices in parallel batches of 100 (Expo's batch limit)
    const messages = tokens.map((t) => ({
      to: t.expo_push_token,
      title,
      body,
      sound: 'default' as const,
      priority: 'high' as const,
      data: data ?? {},
    }));

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'accept-encoding': 'gzip, deflate',
            'content-type': 'application/json',
          },
          body: JSON.stringify(batch),
        });
        const json = await res.json();
        const okCount = (json?.data ?? []).filter((t: any) => t.status === 'ok').length;
        sent += okCount;
        failed += batch.length - okCount;
      } catch (e) {
        console.error('[notifications-send] batch failed', e);
        failed += batch.length;
      }
    }

    // Insert the in_app record + mark delivered
    await admin.from('notifications').insert({
      profile_id,
      channel: 'push',
      category: 'manual',
      title,
      body,
      data: data ?? {},
      sent_at: new Date().toISOString(),
      delivered_at: sent > 0 ? new Date().toISOString() : null,
    });

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'push.sent',
      entityType: 'notification',
      payload: { profile_id, sent, failed, devices: tokens.length },
    });

    return jsonResponse({ ok: true, sent, failed, devices: tokens.length }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[notifications-send] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
