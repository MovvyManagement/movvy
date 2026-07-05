// =============================================================================
// POST /support-ai-reply   { thread_id: uuid }
// -----------------------------------------------------------------------------
// First-line AI support agent for Movvy support chats. Triggered (fire-and-
// forget) by chat-send after a customer or partner posts to a kind='support'
// thread. It understands BOTH Movvy interfaces (the customer app and the
// partner app) and the full app workflow, answers simple questions itself, and
// hands off to a human for anything sensitive.
//
// Model: claude-haiku-4-5 (cheap + fast, ideal for support). Raw Messages API
// over fetch — no SDK to bundle in Deno. No streaming (short replies).
//
// Safety: the assistant NEVER takes actions (no cancels/refunds/reschedules)
// and escalates on money, complaints, damage, safety, or an explicit ask for a
// human — via the escalate_to_human tool AND a deterministic keyword net.
//
// Auth: internal only — caller must present the service-role key as bearer.
// Degrades gracefully: with no ANTHROPIC_API_KEY set, it no-ops so humans keep
// handling support exactly as before.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const MODEL = 'claude-haiku-4-5';
const MAX_HISTORY = 12;

const Body = z.object({ thread_id: z.string().uuid() });

// Topics the assistant must never try to resolve — hand straight to a human.
const ESCALATE_RE = new RegExp(
  [
    'refund', 'money back', 'charge me', 'overcharg', 'my bill', 'billing',
    'complain', 'complaint', 'damage', 'broke', 'broken', 'scratch', 'stole', 'theft', 'stolen',
    'injur', 'hurt', 'accident', 'emergency', '\\bsos\\b',
    'lawyer', 'legal', '\\bsue\\b', 'lawsuit',
    'cancel', 'reschedule', 'reassign', 'delete my account', 'suspend',
    'human', 'agent', 'representative', 'real person', 'someone real', 'manager', 'supervisor',
  ].join('|'),
  'i',
);

const ESCALATE_TOOL = {
  name: 'escalate_to_human',
  description:
    'Hand this conversation to a human Movvy support agent. Call this whenever the request involves money (refunds, billing, charges), a complaint about a crew, damage or an insurance claim, a safety issue or emergency, taking an action on a booking (cancel/reschedule/reassign), account deletion or suspension, legal matters, OR when the user explicitly asks to speak to a person — or any time you are not confident you can help correctly.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Short category, e.g. "refund request", "damage claim", "asked for a human".' },
      summary: { type: 'string', description: 'One sentence an agent can read to get context fast.' },
    },
    required: ['reason'],
  },
};

function knowledge(audience: 'customer' | 'partner', contextLine: string): string {
  return `You are Movvy's support assistant — the friendly first line of Movvy's in-app help chat. Movvy is a moving marketplace operating in Alberta, Canada (Calgary, Edmonton, Red Deer and beyond). You are chatting inside the app with a ${audience === 'partner' ? 'MOVER/PARTNER (a driver, hourly mover, or moving company on the supply side)' : 'CUSTOMER (someone booking a move)'}.

There are TWO separate Movvy apps/interfaces — understand both:
1. CUSTOMER app — people who book moves.
2. PARTNER app — the drivers / hourly movers / moving companies who fulfil the moves. Companies have owners + dispatchers + drivers; independent operators run a small "team" (an operator + hourly movers).

HOW THE WHOLE THING WORKS (end to end):
• Customer signs up with email + phone (SMS one-time code verifies the phone).
• They book in ~60 seconds: pick a start address, a destination, a date, and a home-size preset (e.g. 2-bedroom apartment) — or a commercial move. Residential presets INCLUDE packing, furniture disassembly/assembly, the truck, fuel, and dollies.
• Pricing is HOURLY and shown as an up-front ESTIMATE. There is NO deposit and NO card required to book — you "book now, pay after the move". The crew starts a timer when they arrive (Begin Move) and stops it when done (Finish Move); the final invoice is the ACTUAL time on site, so it can be less if they finish early or more if it runs over. GST (5%) applies. Every move includes up to $5,000 in damage coverage.
• Cancellation: free up to 48 hours before the move; inside 48 hours a small fee applies that goes to the crew.
• Once booked, the move goes out to nearby verified partners; a crew accepts it. The customer then gets LIVE TRACKING: a map with the driver's pin + ETA and five stages — on the way → arrived → loading → in transit → unloading → completed. They can chat with the crew in-app or call them through a masked Movvy line (real phone numbers stay private).
• When the move completes, the customer rates the crew and can add an optional tip (the tip goes to the crew). A PDF receipt is available in the app (Profile → Receipts / Move history) — Movvy does not email receipts.
• PARTNER side: a mover joins with a team/company invite code (format TM-XXXXXX for a team, CO-XXXXXX for a company) or requests to join and the owner approves them. They complete onboarding (ID, licence, documents, background check) and once Movvy verifies them they appear on the roster. Verified partners see available jobs within their service area, accept a job, (companies) assign a driver, run the move with the Begin/Finish timer, and get paid weekly. Movvy keeps 20%, the partner keeps 80%; tips are 100% the crew's.
• SAFETY: during an in-progress move there is an SOS button that instantly alerts Movvy admin, dispatch, and the customer's emergency contact. Treat anything safety-related as urgent.

CONTEXT FOR THIS PERSON:
${contextLine}

WHAT YOU CAN DO:
• Explain how booking, pricing/estimates vs final bill, tracking, cancellation policy, tips, receipts, coverage, and the partner join/payout process work.
• Reassure and point them to the right place in the app (e.g. "you can watch your driver's ETA on the Moves tab", "your receipt is under Profile → Receipts").
• Answer general how-to questions clearly and briefly.

WHAT YOU MUST NOT DO — escalate to a human instead (use the escalate_to_human tool):
• Anything about money: refunds, billing disputes, being over/under-charged.
• Complaints about a crew or customer, damage, theft, or insurance claims.
• Safety issues, injuries, emergencies, or SOS.
• Taking an ACTION on a booking — you cannot cancel, reschedule, reassign, refund, or change anyone's move or account. If they need that, escalate.
• Account deletion or suspension, or legal matters.
• Any time the person asks to talk to a human/agent/manager, or you're not sure you can answer correctly.
You have NO ability to look up private data beyond the context above and cannot perform actions — never claim you did something you can't.

STYLE: warm, calm, and concise (2–4 sentences, Canadian English, no emoji spam). If you're escalating, still send one short reassuring sentence to the person and call the tool. Never invent prices, policies, or specific booking details you weren't given.`;
}

async function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  // Internal-only: caller must present the service-role key as bearer.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return json({ error: 'Forbidden' }, 403, cors);
  }

  let thread_id: string;
  try {
    thread_id = Body.parse(await req.json()).thread_id;
  } catch {
    return json({ error: 'Invalid input' }, 400, cors);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  // ─── Load the thread + gate ────────────────────────────────────────────────
  const { data: thread } = await admin
    .from('chat_threads')
    .select('id, kind, ai_enabled, needs_human, customer_profile_id, booking_id')
    .eq('id', thread_id)
    .maybeSingle();
  if (!thread || thread.kind !== 'support' || !thread.ai_enabled || thread.needs_human) {
    return json({ ok: true, skipped: 'not an active AI support thread' }, 200, cors);
  }

  // ─── Recent history ────────────────────────────────────────────────────────
  const { data: rows } = await admin
    .from('chat_messages')
    .select('body, is_admin, is_ai, created_at')
    .eq('thread_id', thread_id)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY);
  const history = (rows ?? []).reverse();
  const lastHuman = [...history].reverse().find((m) => !m.is_admin && !m.is_ai);
  if (!lastHuman) return json({ ok: true, skipped: 'nothing to answer' }, 200, cors);

  // ─── Audience + light context ──────────────────────────────────────────────
  const { data: opener } = await admin
    .from('profiles').select('full_name, role').eq('id', thread.customer_profile_id).maybeSingle();
  const role = (opener as any)?.role ?? 'customer';
  const audience: 'customer' | 'partner' =
    ['driver', 'mover', 'company_owner'].includes(role) ? 'partner' : 'customer';

  let contextLine = `They are a ${audience}. Name: ${(opener as any)?.full_name ?? 'unknown'}.`;
  if (audience === 'customer') {
    const { data: mv } = await admin
      .from('bookings')
      .select('short_code, status, pickup_city, dropoff_city, scheduled_for_date')
      .eq('customer_id', thread.customer_profile_id)
      .not('status', 'in', '(completed,cancelled,failed)')
      .order('scheduled_for_date', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (mv) {
      contextLine += ` They have a move #${(mv as any).short_code} (${(mv as any).status}) from ${(mv as any).pickup_city} to ${(mv as any).dropoff_city ?? 'in-home'} on ${(mv as any).scheduled_for_date}.`;
    } else {
      contextLine += ' They have no active or upcoming move right now.';
    }
  }

  const insertAi = async (body: string) => {
    await admin.from('chat_messages').insert({
      thread_id, sender_profile_id: null, is_admin: true, is_ai: true, body,
    });
    await admin.from('chat_threads').update({ last_message_at: new Date().toISOString() }).eq('id', thread_id);
  };
  const escalate = async (reason: string, note: string) => {
    await admin.from('chat_threads').update({
      needs_human: true, escalated_at: new Date().toISOString(), escalation_reason: reason,
    }).eq('id', thread_id);
    await insertAi(note);
  };

  // ─── Deterministic safety net — escalate sensitive topics without the model ─
  if (ESCALATE_RE.test(lastHuman.body)) {
    await escalate(
      'keyword',
      "Thanks for the details — I'm connecting you with a Movvy team member who can help with this. They'll reply right here shortly.",
    );
    return json({ ok: true, escalated: 'keyword' }, 200, cors);
  }

  // ─── No API key → let humans handle it (graceful no-op) ─────────────────────
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.log('[support-ai-reply] ANTHROPIC_API_KEY unset — skipping (humans handle)');
    return json({ ok: true, skipped: 'no api key' }, 200, cors);
  }

  // ─── Ask Haiku ─────────────────────────────────────────────────────────────
  const messages = history
    .map((m) => ({ role: m.is_admin || m.is_ai ? 'assistant' : 'user', content: m.body }));
  // The Messages API must start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return json({ ok: true, skipped: 'no user turn' }, 200, cors);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: knowledge(audience, contextLine),
        tools: [ESCALATE_TOOL],
        messages,
      }),
    });
    if (!res.ok) {
      console.error('[support-ai-reply] anthropic error', res.status, await res.text());
      return json({ ok: true, skipped: 'model error' }, 200, cors);
    }
    const data = await res.json();
    const blocks: any[] = data.content ?? [];
    const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'escalate_to_human');
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

    if (data.stop_reason === 'refusal') {
      await escalate('model_refusal', "Let me get a Movvy team member to help you with this — they'll be with you shortly.");
      return json({ ok: true, escalated: 'refusal' }, 200, cors);
    }
    if (toolUse) {
      const reason = toolUse.input?.reason ?? 'assistant escalation';
      await escalate(
        reason,
        text || "I'm connecting you with a Movvy team member who can help — they'll reply here shortly.",
      );
      return json({ ok: true, escalated: reason }, 200, cors);
    }
    if (text) {
      await insertAi(text);
      return json({ ok: true, replied: true }, 200, cors);
    }
    return json({ ok: true, skipped: 'empty reply' }, 200, cors);
  } catch (e) {
    console.error('[support-ai-reply] unhandled', e);
    return json({ ok: true, skipped: 'exception' }, 200, cors);
  }
});
