// POST /chat-send
// Send a chat message in a booking or support thread.
// Auth + rate limit + content length + RLS-gated insert.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, httpError, HttpError, jsonResponse, requireAuth, userClient,
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

    // ─── Notify the other side ─────────────────────────────────────────────
    // Chat used to be silent: a customer could message the crew (or vice-versa)
    // and nobody was told, so messages sat unread until someone happened to open
    // the thread. Fan out an in-app notification to every participant except the
    // sender. Fire-and-forget — a notification hiccup must never fail the send.
    try {
      const admin = adminClient();
      const { data: t } = await admin
        .from('chat_threads')
        .select('kind, booking_id, customer_profile_id, partner_profile_id')
        .eq('id', thread_id)
        .maybeSingle();

      const recipients = new Set<string>();
      if (t?.customer_profile_id) recipients.add(t.customer_profile_id as string);
      if (t?.partner_profile_id) recipients.add(t.partner_profile_id as string);

      // Booking threads: also tell whoever is actually working the move — the
      // assigned performer, the live-location source, and the org's admins.
      if (t?.booking_id) {
        const { data: bk } = await admin
          .from('bookings')
          .select('short_code, customer_id, assigned_driver_profile_id, tracking_profile_id, assigned_company_id')
          .eq('id', t.booking_id)
          .maybeSingle();
        if (bk?.customer_id) recipients.add(bk.customer_id as string);
        if (bk?.assigned_driver_profile_id) recipients.add(bk.assigned_driver_profile_id as string);
        if (bk?.tracking_profile_id) recipients.add(bk.tracking_profile_id as string);
        if (bk?.assigned_company_id) {
          const { data: admins } = await admin
            .from('company_members')
            .select('profile_id')
            .eq('company_id', bk.assigned_company_id)
            .eq('org_role', 'admin')
            .eq('status', 'active')
            .is('removed_at', null);
          for (const m of admins ?? []) recipients.add((m as any).profile_id);
        }
      }

      recipients.delete(user.id); // never notify the sender

      if (recipients.size > 0) {
        const preview = body.length > 90 ? `${body.slice(0, 90)}…` : body;
        await admin.from('notifications').insert(
          Array.from(recipients).map((profile_id) => ({
            profile_id,
            channel: 'in_app' as const,
            category: 'chat.message',
            title: 'New message',
            body: preview,
            data: { thread_id, booking_id: t?.booking_id ?? null },
          })),
        );
      }
    } catch (notifyErr) {
      console.warn('[chat-send] notify failed (non-fatal)', notifyErr);
    }

    // Bump thread last_message_at so the inbox sorts correctly, and read back
    // the flags that decide whether the AI assistant should reply.
    //
    // SERVICE ROLE, not the caller's client. Participants can read and post to
    // a thread but have no UPDATE policy on chat_threads, so this ran as a
    // zero-row update for every customer and partner message: last_message_at
    // stayed NULL, the console's Support Inbox (which sorts
    // last_message_at desc nullslast) buried the newest question at the
    // BOTTOM of the list, and `.single()` on the empty result threw — leaving
    // `thread` null, so the first-line AI reply never fired either. Only
    // admin-sent messages, which do have an update policy, ever bumped it.
    const { data: thread } = await adminClient()
      .from('chat_threads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', thread_id)
      .select('kind, ai_enabled, needs_human')
      .maybeSingle();

    // First-line AI support: when a customer/partner (not an admin) posts to an
    // active AI support thread, fire support-ai-reply in the BACKGROUND so it
    // never adds latency to this send. The AI reply lands via realtime.
    const senderIsAdmin = ['movvy_admin', 'movvy_support'].includes(user.role);
    if (thread && thread.kind === 'support' && thread.ai_enabled && !thread.needs_human && !senderIsAdmin) {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const url = Deno.env.get('SUPABASE_URL');
      if (serviceKey && url) {
        const bg = fetch(`${url}/functions/v1/support-ai-reply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ thread_id }),
        }).catch((e) => console.error('[chat-send] ai trigger failed', e));
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg); } catch { /* not on edge runtime */ }
      }
    }

    return jsonResponse({ ok: true, message: data }, { status: 201 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[chat-send] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
