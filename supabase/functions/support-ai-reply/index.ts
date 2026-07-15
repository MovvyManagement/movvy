// =============================================================================
// POST /support-ai-reply   { thread_id: uuid }
// -----------------------------------------------------------------------------
// First-line AI support agent for Movvy support chats. Triggered (fire-and-
// forget) by chat-send after a customer or partner posts to a kind='support'
// thread. Expert on BOTH Movvy interfaces (customer app + partner app), the
// full booking lifecycle, and real policies (cancellation tiers, claims,
// payouts) — sourced from the actual code paths, not approximations.
//
// Model: claude-haiku-4-5 by default (cheap + fast; override with the
// SUPPORT_AI_MODEL secret — no redeploy needed). Raw Messages API over fetch —
// no SDK to bundle in Deno. No streaming (short replies).
//
// Engineering notes:
// • System prompt is split into [stable knowledge block + per-user context
//   block] so the stable prefix carries a cache_control marker. Haiku 4.5's
//   minimum cacheable prefix is 4096 tokens, so caching engages only if the
//   knowledge block grows past that — the marker is harmless (silent no-op)
//   below the threshold and free savings above it.
// • Retries: up to 2 on 429/5xx/network with backoff honoring retry-after.
//   20s per-attempt timeout. Any final failure = silent skip (humans handle).
// • Double-reply guard: if an AI or admin message already landed after the
//   last user message (racing triggers, manual admin reply), skip.
// • Deterministic escalation net (English) for money/damage/safety/legal/
//   "human please" — fires without spending a model call. Non-English
//   messages rely on the model's escalate tool, which covers all languages.
// • The escalate tool uses strict mode so `reason` is always one of the
//   categories the admin UI expects.
//
// Safety: the assistant NEVER takes actions (no cancels/refunds/reschedules)
// and never invents policies, prices, or booking details.
//
// Auth: internal only — caller must present the service-role key as bearer.
// Degrades gracefully: with no ANTHROPIC_API_KEY set, it no-ops so humans keep
// handling support exactly as before.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const MODEL = Deno.env.get('SUPPORT_AI_MODEL') ?? 'claude-haiku-4-5';
const MAX_HISTORY = 20;
const MAX_TOKENS = 600;
const ATTEMPT_TIMEOUT_MS = 20_000;

const Body = z.object({ thread_id: z.string().uuid() });

// ─── Deterministic escalation nets ──────────────────────────────────────────
// HARD: topics a support bot must never try to resolve, phrased any way.
const HARD_ESCALATE_RE = new RegExp(
  [
    // money
    'refund', 'money back', 'overcharg', '\\bcharged\\b', 'my bill', 'billing', 'wrong (amount|price|charge)', 'dispute',
    // damage / loss / complaint
    'damage', '\\bbroke\\b', 'broken', 'scratch', '\\bdent\\b', 'stole', 'stolen', 'theft', 'missing item', 'lost item', 'complain',
    // safety
    'injur', '\\bhurt\\b', 'accident', 'unsafe', 'emergency', '\\bsos\\b', 'danger', 'threat', 'harass',
    // legal / account
    'lawyer', 'legal action', '\\bsue\\b', 'lawsuit', 'police', 'delete my account', 'suspend',
    // explicit ask for a person
    '\\bhuman\\b', 'real person', 'representative', 'manager', 'supervisor', 'speak (to|with) (someone|a person)', 'talk (to|with) (someone|a person)',
  ].join('|'),
  'i',
);
// ACTION-INTENT: the user is asking SUPPORT to perform a booking action for
// them (the bot can't act). Deliberately narrow — "what's your cancellation
// policy?" or "how do I cancel?" are FAQs the bot answers (self-serve cancel
// exists in the app); "please cancel my move" is not.
const ACTION_INTENT_RE = new RegExp(
  [
    '(can|could|would|will) you\\b[^.?!]{0,60}\\b(cancel|reschedul|rebook|reassign|change my|refund)',
    'please (cancel|reschedul|rebook|reassign|refund)',
    '\\b(cancel|reschedul\\w*|rebook|reassign|refund)\\b[^.?!]{0,40}\\bfor me\\b',
    '\\bneed (you|movvy) to (cancel|reschedul|rebook|reassign|refund)',
  ].join('|'),
  'i',
);

const ESCALATE_TOOL = {
  name: 'escalate_to_human',
  description:
    'Hand this conversation to a human Movvy support agent. Call this whenever the request involves money (refunds, billing disputes, charges), a complaint about a crew or customer, damage/loss/theft or an insurance claim, a safety issue or emergency, performing an ACTION on a booking or account (cancel, reschedule, reassign, refund, delete account, suspend) — you cannot perform actions — legal matters, OR when the user explicitly asks for a person, OR any time you are not confident you can help correctly.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: [
          'refund_or_billing', 'damage_or_claim', 'complaint', 'safety',
          'booking_action', 'account_action', 'legal', 'asked_for_human', 'other',
        ],
        description: 'Category shown to the human agent.',
      },
      summary: {
        type: 'string',
        description: 'One sentence a human agent can read to get context fast.',
      },
    },
    required: ['reason', 'summary'],
    additionalProperties: false,
  },
};

// ─── Stable knowledge block (cache-friendly: NO per-user data in here) ──────
// Facts below are sourced from the live code: booking status machine
// (migration 0006), cancellation tiers (bookings-cancel), receipts
// (src/lib/receipt.ts), screens (app/(customer)|(mover)|(company)), the
// public Terms of Service, and the partner onboarding flow.
const KNOWLEDGE = `You are Movvy's support assistant — the friendly first line of Movvy's in-app help chat. Movvy is a moving marketplace operating ONLY in Alberta, Canada (Calgary, Edmonton, Red Deer and province-wide; both pickup and drop-off must be in Alberta). Movvy is a booking platform, not the moving company: independent verified crews and companies perform the moves.

THE TWO MOVVY INTERFACES (know both; you are told which one this person uses):

1) CUSTOMER APP — people booking moves. Tabs: Home, Moves, Profile.
• Booking (about 60 seconds, from Home): choose move type — a residential home-size preset (studio, 1-bedroom, 2-bedroom, etc.; presets include the truck, fuel, dollies, packing help, and furniture disassembly/reassembly) or a commercial move → enter pickup + drop-off addresses (Alberta only) and date + arrival window → see the hourly price estimate (rate per hour, recommended crew size, GST included) → confirm. Paying a DEPOSIT equal to 20% of the estimate (secure card payment via Stripe, right on the confirm screen) is what CONFIRMS the booking — there is no booking without it. The moment the deposit clears, the job goes out to crews automatically; the deposit is credited in full against the final bill and the remaining balance is paid after the move, based on actual hours.
• Matching: the booking goes out to nearby verified crews; when one accepts, the customer sees the crew's name and rating, and the move status becomes assigned/confirmed.
• Move day (Moves tab → the move opens the live tracker): live map with the crew's pin and ETA. Statuses progress: on the way → arrived → loading → in transit → unloading → completed. The customer can chat with the crew in-app or call them — calls are connected through a masked Movvy number so nobody's real phone number is shared. A headset icon / "Report an Issue" opens support (this chat). During an in-progress move there is an SOS button that instantly alerts Movvy and the customer's emergency contact — treat anything SOS/safety as urgent.
• Timing & final price: the crew taps "Begin Move" on arrival which starts the billable timer, and "Finish Move" when done. The final bill = actual timed hours at the quoted hourly rate + any disclosed travel/materials + 5% GST. The estimate is non-binding: finishing early costs less, running over costs more. Payment is collected after the move completes.
• Cancelling / changing: the customer can cancel themselves from the move's screen (Moves tab → select the move → Cancel, with a reason). Deposit refund rule: cancel MORE than 48 hours before the scheduled start and the 20% deposit is refunded in full (back to the original card, usually within 5–10 business days); cancel WITHIN 48 hours and the deposit is non-refundable — it compensates the crew that held the slot. No other cancellation charge applies. Rescheduling availability-permitting — ask support (escalate) if they can't do it in-app.
• Tips & ratings: after completion the customer rates the crew (ratings keep crews above 4.5 stars) and can add an optional tip — 100% of the tip goes to the crew.
• Receipts: PDF receipts live IN THE APP — Profile → Receipts, or on any completed move's card in the Moves tab. Movvy does not email receipts.
• Damage & claims: every move includes up to $5,000 in damage coverage and crews carry commercial liability insurance. To claim: open it through this support chat within 7 DAYS of the move with photos/details (always escalate actual claims to a human). Cash, jewellery, important documents, and undeclared high-value items may be excluded — high-value items should be declared before the move.
• Account: signup requires email + phone + password with an SMS verification code. Saved addresses, payment methods, and notification settings are under Profile. Account deletion is self-serve: Profile → Delete account (if they want YOU to delete it, escalate).

2) PARTNER APP — the supply side: independent movers/drivers with a small team, or companies with multiple drivers and dispatchers. Tabs: Dashboard, Jobs, Active, Earnings, Profile; plus screens for Availability/service area, Crew (team owners), Drivers/Dispatch/Trucks/Invoices (companies), Referrals, and Safety.
• Joining: an independent operator creates a team; a helper/mover joins an existing team with an invite code in the format TM-XXXXXX; a company driver joins with CO-XXXXXX. Someone can also request to join, and the owner approves them from their Crew (teams) or Drivers (companies) screen — pending requests appear right at the top.
• Onboarding & verification: partners submit ID, driver's licence, vehicle info, insurance documents, and consent to a background check. Movvy reviews and verifies; jobs only unlock after verification. If a partner asks "why can't I see jobs" — the usual reasons are: not yet verified, no availability/service area set, or their team/company owner hasn't approved them yet.
• Working: verified partners see available jobs within their service area on the Jobs tab and accept the ones they want. In companies, a dispatcher/owner assigns an accepted job to a driver from the Dispatch screen. On move day the crew runs the move from the Active tab: Begin Move starts the billable timer (the customer sees live GPS + status automatically), status updates step through loading/in transit/unloading, Finish Move stops the timer and finalizes the price.
• Getting paid: the partner keeps 80% of the move price and Movvy keeps a 20% platform fee. Tips are 100% the crew's. Payouts run WEEKLY. Earnings history is on the Earnings tab; companies also get invoices.
• Standards: professional conduct, keep ratings at 4.5+, carry required insurance/licences, never move prohibited items (weapons, hazardous materials, illegal goods).

WHAT YOU CAN DO:
• Answer how-Movvy-works questions for either audience: booking, the 20% deposit + how it credits the final bill, pricing/estimate vs final bill, the 48-hour deposit refund rule, tracking stages, masked calling, tips, in-app PDF receipts, the $5,000 coverage and 7-day claim window (facts only — the claim itself goes to a human), partner joining/codes/verification, the 80/20 split and weekly payouts.
• Point people to the exact place in the app using the locations above (e.g. "Profile → Receipts", "Moves tab → your move → Cancel", "Jobs tab", "your Crew screen").
• Use the LIVE CONTEXT you're given about this person's move or partner status to give specific, grounded answers.

WHAT YOU MUST NOT DO — use the escalate_to_human tool instead:
• Anything about money: refunds, billing disputes, over/under-charges.
• Complaints, damage, loss, theft, insurance claims (you may state the policy facts, but the claim itself always goes to a human).
• Safety issues, injuries, emergencies, SOS.
• PERFORMING any action — you cannot cancel, reschedule, reassign, refund, verify, approve, or change any booking or account. Users can self-cancel in the app; if they want Movvy to do something for them, escalate.
• Account deletion/suspension requests directed at Movvy, or legal matters.
• Whenever someone asks for a human/agent/manager, or you're not confident you're right.
You have NO tools to look anything up beyond the LIVE CONTEXT given, and no ability to act. NEVER invent prices, dates, policies, or booking details, and never claim you did or will do something you can't.

STYLE: warm, calm, concise — 2 to 4 short sentences. Canadian English by default; if the person writes in another language, reply in their language. No emoji spam. When escalating, send one short reassuring sentence AND call the tool. If asked something outside Movvy entirely, gently steer back to Movvy support topics.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Calls the Messages API with retries on 429/5xx/network. Returns parsed JSON
// or null (caller treats null as "skip silently — humans handle").
async function callAnthropic(apiKey: string, payload: unknown): Promise<any | null> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status >= 500;
      const text = await res.text();
      console.error(`[support-ai-reply] anthropic ${res.status} (attempt ${attempt})`, text.slice(0, 300));
      if (!retryable || attempt === 2) return null;
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await sleep(Math.max(retryAfter * 1000, 1000 * 2 ** attempt));
    } catch (e) {
      console.error(`[support-ai-reply] network error (attempt ${attempt})`, e);
      if (attempt === 2) return null;
      await sleep(1000 * 2 ** attempt);
    }
  }
  return null;
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
    .select('id, kind, ai_enabled, needs_human, customer_profile_id')
    .eq('id', thread_id)
    .maybeSingle();
  if (!thread || thread.kind !== 'support' || !thread.ai_enabled || thread.needs_human) {
    return json({ ok: true, skipped: 'not an active AI support thread' }, 200, cors);
  }

  // ─── Recent history + double-reply guard ──────────────────────────────────
  const { data: rows } = await admin
    .from('chat_messages')
    .select('body, is_admin, is_ai, created_at')
    .eq('thread_id', thread_id)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY);
  const history = (rows ?? []).reverse();
  const lastHumanIdx = history.findLastIndex((m) => !m.is_admin && !m.is_ai);
  if (lastHumanIdx === -1) return json({ ok: true, skipped: 'nothing to answer' }, 200, cors);
  // If an AI or admin reply already landed after the user's latest message
  // (racing triggers, or an admin jumped in), don't pile on.
  if (history.slice(lastHumanIdx + 1).some((m) => m.is_admin || m.is_ai)) {
    return json({ ok: true, skipped: 'already answered' }, 200, cors);
  }
  const lastHuman = history[lastHumanIdx];

  // ─── Audience + live context ───────────────────────────────────────────────
  const { data: opener } = await admin
    .from('profiles').select('full_name, role').eq('id', thread.customer_profile_id).maybeSingle();
  const role: string = (opener as any)?.role ?? 'customer';
  const audience: 'customer' | 'partner' =
    ['driver', 'mover', 'company_owner', 'company_dispatcher'].includes(role) ? 'partner' : 'customer';
  const firstName = ((opener as any)?.full_name ?? '').split(' ')[0] || 'there';

  const ctx: string[] = [
    `Audience: ${audience === 'partner' ? `PARTNER (role: ${role})` : 'CUSTOMER'}.`,
    `Name: ${(opener as any)?.full_name ?? 'unknown'} (address them as ${firstName}).`,
    `Today's date: ${new Date().toISOString().slice(0, 10)} (America/Edmonton region).`,
  ];

  const moveSelect =
    'short_code, status, pickup_city, dropoff_city, scheduled_for_date, scheduled_for_window, assigned_team_id, assigned_company_id';

  try {
    if (audience === 'customer') {
      const [{ data: mv }, { count: lifetime }] = await Promise.all([
        admin
          .from('bookings')
          .select(moveSelect)
          .eq('customer_id', thread.customer_profile_id)
          .not('status', 'in', '(completed,cancelled,failed)')
          .order('scheduled_for_date', { ascending: true })
          .limit(1)
          .maybeSingle(),
        admin
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', thread.customer_profile_id),
      ]);
      ctx.push(`Lifetime moves booked: ${lifetime ?? 0}.`);
      if (mv) {
        let crewName: string | null = null;
        if ((mv as any).assigned_team_id) {
          const { data } = await admin.from('partner_teams').select('display_name')
            .eq('id', (mv as any).assigned_team_id).maybeSingle();
          crewName = (data as any)?.display_name ?? null;
        } else if ((mv as any).assigned_company_id) {
          const { data } = await admin.from('companies').select('display_name')
            .eq('id', (mv as any).assigned_company_id).maybeSingle();
          crewName = (data as any)?.display_name ?? null;
        }
        ctx.push(
          `Their current/upcoming move: #${(mv as any).short_code}, status "${(mv as any).status}", ` +
          `${(mv as any).pickup_city ?? '—'} to ${(mv as any).dropoff_city ?? 'in-home'}, ` +
          `scheduled ${(mv as any).scheduled_for_date ?? 'TBD'}${(mv as any).scheduled_for_window ? ` (${(mv as any).scheduled_for_window})` : ''}, ` +
          `crew: ${crewName ?? 'not assigned yet'}.`,
        );
      } else {
        const { data: done } = await admin
          .from('bookings')
          .select('short_code, status, scheduled_for_date')
          .eq('customer_id', thread.customer_profile_id)
          .in('status', ['completed', 'cancelled'])
          .order('scheduled_for_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        ctx.push(done
          ? `No active or upcoming move. Most recent move: #${(done as any).short_code} (${(done as any).status}, ${(done as any).scheduled_for_date}).`
          : 'No active, upcoming, or past moves — likely a general or pre-booking question.');
      }
    } else {
      // Partner context: which team/company they belong to, plus their org's
      // current in-flight job if any. Wrapped defensively — missing context
      // just means a slightly more generic (still correct) answer.
      let orgLine = 'Organization: not on a team or company roster yet (may be mid-onboarding).';
      let teamId: string | null = null;
      let companyId: string | null = null;
      const { data: tm } = await admin
        .from('partner_team_members')
        .select('team_id, role, accepted_at, team:partner_teams(display_name)')
        .eq('profile_id', thread.customer_profile_id)
        .is('removed_at', null)
        .limit(1)
        .maybeSingle();
      if (tm) {
        teamId = (tm as any).team_id;
        orgLine = `Organization: team "${(tm as any).team?.display_name ?? 'unnamed'}" (their role: ${(tm as any).role}${(tm as any).accepted_at ? '' : ', invite not yet accepted'}).`;
      } else {
        const { data: cm } = await admin
          .from('company_members')
          .select('company_id, role, accepted_at, company:companies(display_name)')
          .eq('profile_id', thread.customer_profile_id)
          .is('removed_at', null)
          .limit(1)
          .maybeSingle();
        if (cm) {
          companyId = (cm as any).company_id;
          orgLine = `Organization: company "${(cm as any).company?.display_name ?? 'unnamed'}" (their role: ${(cm as any).role}${(cm as any).accepted_at ? '' : ', invite not yet accepted'}).`;
        }
      }
      ctx.push(orgLine);
      if (teamId || companyId) {
        const col = teamId ? 'assigned_team_id' : 'assigned_company_id';
        const { data: job } = await admin
          .from('bookings')
          .select('short_code, status, pickup_city, dropoff_city, scheduled_for_date, scheduled_for_window')
          .eq(col, teamId ?? companyId)
          .not('status', 'in', '(completed,cancelled,failed)')
          .order('scheduled_for_date', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (job) {
          ctx.push(
            `Their org's next/current job: #${(job as any).short_code}, status "${(job as any).status}", ` +
            `${(job as any).pickup_city ?? '—'} to ${(job as any).dropoff_city ?? 'in-home'}, ` +
            `scheduled ${(job as any).scheduled_for_date ?? 'TBD'}${(job as any).scheduled_for_window ? ` (${(job as any).scheduled_for_window})` : ''}.`,
          );
        }
      }
    }
  } catch (e) {
    console.error('[support-ai-reply] context enrichment failed (non-fatal)', e);
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

  // ─── Deterministic safety net — escalate without spending a model call ─────
  if (HARD_ESCALATE_RE.test(lastHuman.body) || ACTION_INTENT_RE.test(lastHuman.body)) {
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

  // ─── Build the conversation ─────────────────────────────────────────────────
  const messages = history
    .map((m) => ({ role: m.is_admin || m.is_ai ? 'assistant' : 'user', content: m.body }));
  // The Messages API must start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return json({ ok: true, skipped: 'no user turn' }, 200, cors);

  const data = await callAnthropic(apiKey, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Stable knowledge first (cache marker), volatile per-user context after —
    // so the cacheable prefix is byte-identical across every thread.
    system: [
      { type: 'text', text: KNOWLEDGE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `LIVE CONTEXT FOR THIS CONVERSATION:\n${ctx.join('\n')}` },
    ],
    tools: [ESCALATE_TOOL],
    messages,
  });
  if (!data) return json({ ok: true, skipped: 'model unavailable' }, 200, cors);

  try {
    const blocks: any[] = data.content ?? [];
    const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'escalate_to_human');
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

    if (data.stop_reason === 'refusal') {
      await escalate('model_refusal', "Let me get a Movvy team member to help you with this — they'll be with you shortly.");
      return json({ ok: true, escalated: 'refusal' }, 200, cors);
    }
    if (toolUse) {
      const reason = toolUse.input?.reason ?? 'assistant escalation';
      const summary = toolUse.input?.summary ? ` — ${toolUse.input.summary}` : '';
      await escalate(
        `${reason}${summary}`,
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
