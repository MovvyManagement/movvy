// =============================================================================
// POST /partner-welcome-on-signup
//
// Called by a Supabase Database Webhook on INSERT into `partner_teams`. Sends
// the branded moverApplicationReceived email so the partner gets a "thanks,
// we'll review your stuff" greeting the moment they sign up.
//
// To configure (one-time, manual in Supabase dashboard):
//   Database → Webhooks → Create
//     Name:         partner-welcome
//     Table:        public.partner_teams
//     Events:       INSERT
//     Type:         Supabase Edge Functions
//     Edge Function: partner-welcome-on-signup
//     HTTP Headers: { "x-webhook-secret": "<DB_WEBHOOK_SECRET env>" }
//
// Note: we email the FIRST member of the team (typically the founder).
// Multi-member teams have only one owner at signup, so this lands at
// the right inbox.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handle } from '../_shared/serve.ts';
import { sendBrandedEmail } from '../_shared/email.ts';
import { moverApplicationReceived } from '../_shared/emails/index.ts';

handle(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const expected = Deno.env.get('DB_WEBHOOK_SECRET');
  const got = req.headers.get('x-webhook-secret');
  if (expected && got !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  if (payload?.type && payload.type !== 'INSERT') {
    return new Response(JSON.stringify({ skipped: 'not_an_insert' }), { status: 200 });
  }
  const record = payload?.record ?? payload?.new ?? {};
  const teamId = record?.id;
  if (!teamId) {
    return new Response(JSON.stringify({ skipped: 'no_team_id' }), { status: 200 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[partner-welcome-on-signup] Supabase env missing');
    return new Response('Server misconfigured', { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Find the team's founder (first/only member at signup time)
  const { data: member } = await supabase
    .from('partner_team_members')
    .select('profiles!partner_team_members_profile_id_fkey(email, full_name)')
    .eq('team_id', teamId)
    .is('removed_at', null)
    .limit(1)
    .maybeSingle();

  const profile = (member as any)?.profiles;
  if (!profile?.email) {
    return new Response(
      JSON.stringify({ skipped: 'no_member_email_yet', teamId }),
      { status: 200 },
    );
  }

  const result = await sendBrandedEmail({
    to: profile.email,
    template: moverApplicationReceived({ fullName: profile.full_name ?? null }),
  });

  if (result.error) {
    console.warn('[partner-welcome-on-signup] send failed', result.error);
  }

  return new Response(
    JSON.stringify({ ok: !result.error, providerId: result.providerId, error: result.error }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
