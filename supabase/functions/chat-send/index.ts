// POST /chat-send
// Send a chat message in a booking or support thread.
// Auth + rate limit + content length + RLS-gated insert.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  checkRateLimit, httpError, HttpError, jsonResponse, requireAuth, userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  thread_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    // 60 messages/min/user — plenty for normal chat, blocks spam
    await checkRateLimit({
      bucketKey: `user:${user.id}:chat_send`,
      endpoint: 'chat-send',
      limit: 60, windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { thread_id, body } = parsed.data;

    // RLS policy `chat_messages_send` enforces sender is a thread participant.
    const supabase = userClient(req.headers.get('Authorization'));
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        thread_id,
        sender_profile_id: user.id,
        is_admin: ['movvy_admin', 'movvy_support'].includes(user.role),
        body,
      })
      .select('id, body, created_at')
      .single();

    if (error) throw httpError(403, 'Not authorized to post to this thread');

    // Bump thread last_message_at so the inbox sorts correctly
    await supabase
      .from('chat_threads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', thread_id);

    return jsonResponse({ ok: true, message: data }, { status: 201 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[chat-send] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
