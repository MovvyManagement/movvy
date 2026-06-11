// POST /device-tokens-register
// Registers (or refreshes) an Expo Push token for the signed-in profile.
// Called on app launch and whenever the token rotates.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  expo_push_token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android', 'web']),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { expo_push_token, platform } = parsed.data;

    const admin = adminClient();

    // Upsert by token so re-registering same device is idempotent
    const { data, error } = await admin
      .from('device_tokens')
      .upsert({
        profile_id: user.id,
        platform,
        expo_push_token,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'expo_push_token' })
      .select('id, platform')
      .single();

    if (error) throw httpError(500, 'Could not register device');

    return jsonResponse({ ok: true, device: data }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[device-tokens-register] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
