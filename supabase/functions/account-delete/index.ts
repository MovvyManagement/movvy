// POST /account-delete
// Customer-initiated soft delete. App Store + Play Store require this for any
// app with sign-up. We:
//   1. Soft-delete the profile row (deleted_at = now())
//   2. Remove PII (saved addresses, device tokens, full_name, phone)
//   3. Revoke any active auth sessions so the user can't keep using the app
//   4. Audit log the request
//
// Bookings + ratings + audit trail stay (legal/financial retention).

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  reason: z.string().max(500).optional(),
  confirm_email_or_phone: z.string().min(3).max(254),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:account_delete`,
      endpoint: 'account-delete',
      limit: 3, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { reason, confirm_email_or_phone } = parsed.data;

    const admin = adminClient();

    // Confirm the typed email/phone matches the account — friction so a stray
    // tap doesn't nuke an account.
    const { data: profile } = await admin
      .from('profiles')
      .select('email, phone')
      .eq('id', user.id)
      .single();

    const typed = confirm_email_or_phone.trim().toLowerCase();
    const emailMatch = profile?.email && typed === String(profile.email).toLowerCase();
    const phoneMatch = profile?.phone && typed === String(profile.phone).toLowerCase();
    if (!emailMatch && !phoneMatch) {
      throw httpError(400, 'Confirmation does not match your email or phone');
    }

    // Block deletion while a booking is in flight — refund / dispute first
    const { data: openBookings } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: false })
      .eq('customer_id', user.id)
      .in('status', ['pending','searching','assigned','confirmed','on_the_way','arrived','loading','in_transit','unloading']);
    if ((openBookings?.length ?? 0) > 0) {
      throw httpError(400, 'Finish or cancel your active moves before deleting your account.');
    }

    // Do the soft-delete via the helper RPC
    const { error: delErr } = await admin.rpc('request_account_deletion', {
      p_profile_id: user.id,
      p_reason: reason ?? null,
    });
    if (delErr) throw httpError(500, 'Could not delete account');

    // Revoke all sessions — uses Auth admin API
    try {
      await admin.auth.admin.signOut(user.id, 'global');
    } catch (e) {
      console.warn('[account-delete] session revoke failed', e);
    }

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'account.deleted',
      entityType: 'profile',
      entityId: user.id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { reason },
    });

    return jsonResponse({ ok: true }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[account-delete] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
