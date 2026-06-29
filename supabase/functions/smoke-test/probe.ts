// Tiny probe — query email_events broadly to see if the webhook is firing at
// all. Returns the last 20 events across ALL recipients.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handle } from '../_shared/serve.ts';

handle(async (req) => {
  const expected = Deno.env.get('SMOKE_TEST_SECRET');
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (expected && body.secret !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: events, error } = await admin
    .from('email_events')
    .select('id, event_type, template, recipient, occurred_at, bounce_reason')
    .order('occurred_at', { ascending: false })
    .limit(30);

  return new Response(
    JSON.stringify({
      total_events: events?.length ?? 0,
      error: error?.message ?? null,
      events: events ?? [],
    }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
