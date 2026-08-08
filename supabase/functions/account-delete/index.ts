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
import { sendBrandedEmail } from '../_shared/email.ts';
import { accountDeleted } from '../_shared/emails/index.ts';
import { fmtDatePlusDays } from '../_shared/format.ts';

const Body = z.object({
  reason: z.string().max(500).optional(),
  confirm_email_or_phone: z.string().min(3).max(254),
});

/** A unique, unroutable stand-in for a deleted user's phone number.
 *  +999 is ITU-reserved (no real subscriber can hold it) and E.164 allows 15
 *  digits total, leaving 12 for the id-derived part. Deterministic, so calling
 *  account-delete twice produces the same tombstone instead of colliding. */
async function tombstonePhone(profileId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`movvy.deleted.phone:${profileId}`),
  );
  // 40 bits keeps the value comfortably under 10^12 before padding.
  const bytes = new Uint8Array(digest).slice(0, 5);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return `+999${(n % 1_000_000_000_000n).toString().padStart(12, '0')}`;
}

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
    // tap doesn't nuke an account. We pull full_name too because the deletion-
    // confirmation email we send below fires AFTER PII is stripped, so we
    // need to capture it now.
    const { data: profile } = await admin
      .from('profiles')
      .select('email, phone, full_name')
      .eq('id', user.id)
      .single();
    const emailBeforeDelete = profile?.email ?? null;
    const fullNameBeforeDelete = profile?.full_name ?? null;

    const typed = confirm_email_or_phone.trim().toLowerCase();
    const emailMatch = profile?.email && typed === String(profile.email).toLowerCase();
    const phoneMatch = profile?.phone && typed === String(profile.phone).toLowerCase();
    if (!emailMatch && !phoneMatch) {
      throw httpError(400, 'Confirmation does not match your email or phone');
    }

    const LIVE_STATUSES = [
      'pending','searching','assigned','confirmed','on_the_way','arrived','loading','in_transit','unloading',
    ];

    // Block deletion while a booking is in flight — refund / dispute first
    const { data: openBookings } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: false })
      .eq('customer_id', user.id)
      .in('status', LIVE_STATUSES);
    if ((openBookings?.length ?? 0) > 0) {
      throw httpError(400, 'Finish or cancel your active moves before deleting your account.');
    }

    // Same guard from the PARTNER side: a crew member who is the assigned
    // performer (or the live-location source) on a move that hasn't finished
    // can't delete themselves out from under the customer. The org admin has to
    // reassign or release those moves first.
    const { data: assignedMoves } = await admin
      .from('bookings')
      .select('id')
      .or(`assigned_driver_profile_id.eq.${user.id},tracking_profile_id.eq.${user.id}`)
      .in('status', LIVE_STATUSES);
    if ((assignedMoves?.length ?? 0) > 0) {
      throw httpError(
        400,
        "You're still assigned to an active move. Ask your crew admin to reassign or release it first.",
      );
    }

    // Do the soft-delete via the helper RPC
    const { error: delErr } = await admin.rpc('request_account_deletion', {
      p_profile_id: user.id,
      p_reason: reason ?? null,
    });
    if (delErr) throw httpError(500, 'Could not delete account');

    // Revoke all sessions AND ban the auth user so a "deleted" account can't
    // sign back in. We BAN rather than hard-delete the auth row on purpose:
    // profiles.id references auth.users(id) ON DELETE CASCADE, so removing the
    // auth row would take the profile — and every booking, payout and audit
    // record hanging off it — with it. The profile is already soft-deleted +
    // PII-redacted above.
    try {
      await admin.auth.admin.signOut(user.id, 'global');
      // ~100 years — effectively permanent, reversible by support if needed.
      await admin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' });
    } catch (e) {
      console.warn('[account-delete] session revoke / ban failed', e);
    }

    // ── Release the email + phone so the person can come back ────────────────
    // request_account_deletion() redacts profiles.email/phone, but auth.users
    // keeps the originals, and GoTrue enforces uniqueness there. Deleting your
    // account therefore burned both identifiers permanently: signing up again
    // with the same phone returned `phone_exists` and the same email
    // `email_exists`, with no way for the user (or support, short of SQL) to
    // recover. For a phone number someone has had for years, that meant they
    // could never use Movvy again.
    //
    // So tombstone them on auth.users too. The row and its id survive — every
    // FK stays intact — while the identifiers are freed for a genuinely fresh
    // signup, which gets a NEW profile id and therefore none of the deleted
    // account's history.
    //
    // GoTrue will not clear a phone: `null` and `""` are both accepted with a
    // 200 and silently ignored, so it has to be REPLACED. +999 is an
    // ITU-reserved country code that can never belong to a real subscriber,
    // and E.164 caps the whole thing at 15 digits — hence 999 + 12. Derived
    // from a hash of the user id so a retried delete is idempotent rather than
    // conflicting with its own first attempt.
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(user.id);
      const patch: { email?: string; phone?: string } = {
        email: `deleted+${user.id}@deleted.movvy.ca`,
      };
      if (authUser?.user?.phone) patch.phone = await tombstonePhone(user.id);
      const { error: freeErr } = await admin.auth.admin.updateUserById(user.id, patch);
      if (freeErr) throw freeErr;
    } catch (e) {
      // Non-fatal: the account IS deleted either way. Worst case the
      // identifiers stay reserved, which is the old behaviour — but log loudly,
      // because it means a returning customer will hit "already registered".
      console.error('[account-delete] could not release email/phone', e);
    }

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'account.deleted',
      entityType: 'profile',
      entityId: user.id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: { reason },
    });

    // PIPEDA-compliant deletion confirmation. We pre-captured email +
    // full_name above so the RPC's PII strip doesn't leave us without an
    // address to send to.
    if (emailBeforeDelete) {
      sendBrandedEmail({
        to: emailBeforeDelete,
        template: accountDeleted({
          fullName: fullNameBeforeDelete,
          hardDeleteOn: fmtDatePlusDays(30),
        }),
      }).catch((e) => console.warn('[account-delete] email send failed', e));
    }

    return jsonResponse({ ok: true }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[account-delete] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
