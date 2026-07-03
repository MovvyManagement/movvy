// =============================================================================
// POST /admin-console
//
// Privileged management operations for the ops console. The web app has no
// service-role client, so every write to admin_members / admin_settings (the
// revenue PIN) routes through here. EVERY action requires the caller to resolve
// as 'management' via movvy_admin_access() — staff and non-admins get 403.
//
// Actions (body.action):
//   • pin_status                         -> { isSet }
//   • verify_pin { pin }                 -> { ok }          (rate-limited)
//   • set_pin { new_pin, current_pin? }  -> { ok }          (current required if one exists)
//   • invite_member { email, full_name?, access_level } -> { ok, invited }
//   • set_member { id, access_level?, blocked? }         -> { ok }
//   • remove_member { id }               -> { ok }
//
// The 6-digit revenue PIN is stored ONLY here as `salt$sha256(salt:pin)` in
// admin_settings — never returned to the browser.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse,
  requireAuth, userClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const ROOT_EMAIL = 'management@movvy.ca';
const PIN_KEY = 'revenue_pin';
const PIN_RE = /^\d{6}$/;

const Body = z.object({
  action: z.enum(['pin_status', 'verify_pin', 'set_pin', 'invite_member', 'set_member', 'remove_member']),
  pin: z.string().optional(),
  new_pin: z.string().optional(),
  current_pin: z.string().optional(),
  email: z.string().email().optional(),
  full_name: z.string().max(120).optional(),
  access_level: z.enum(['management', 'staff']).optional(),
  id: z.string().uuid().optional(),
  blocked: z.boolean().optional(),
});

// ─── PIN hashing — salted SHA-256 (second factor; verify is rate-limited) ─────
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPin(pin: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return toHex(digest);
}
function randomSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}
// Constant-time-ish compare to avoid trivial timing leaks on the hash.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    // Management gate — the single authority for every action here.
    const authHeader = req.headers.get('Authorization');
    const { data: level } = await userClient(authHeader).rpc('movvy_admin_access');
    if (level !== 'management') throw httpError(403, 'Management access required');

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const input = parsed.data;
    const admin = adminClient();

    // ─── PIN status ──────────────────────────────────────────────────────────
    if (input.action === 'pin_status') {
      const { data } = await admin.from('admin_settings').select('key').eq('key', PIN_KEY).maybeSingle();
      return jsonResponse({ ok: true, isSet: !!data }, { status: 200 }, cors);
    }

    // ─── Verify PIN (rate-limited hard — 6 digits is only 1M combos) ─────────
    if (input.action === 'verify_pin') {
      await checkRateLimit({
        bucketKey: `user:${user.id}:revenue_pin_verify`,
        endpoint: 'admin-console:verify_pin',
        limit: 8,
        windowSeconds: 900,
      });
      if (!input.pin || !PIN_RE.test(input.pin)) throw httpError(400, 'Enter your 6-digit PIN');
      const { data: row } = await admin.from('admin_settings').select('value').eq('key', PIN_KEY).maybeSingle();
      if (!row) return jsonResponse({ ok: false, notSet: true }, { status: 200 }, cors);
      const [salt, stored] = String(row.value).split('$');
      const ok = !!salt && !!stored && safeEqual(await hashPin(input.pin, salt), stored);
      if (!ok) {
        await audit({
          actorId: user.id, actorRole: user.role, action: 'admin.revenue_pin_failed',
          entityType: 'admin_settings', entityId: PIN_KEY, ip: clientIp(req),
        });
      }
      return jsonResponse({ ok }, { status: 200 }, cors);
    }

    // ─── Set / change PIN ────────────────────────────────────────────────────
    if (input.action === 'set_pin') {
      if (!input.new_pin || !PIN_RE.test(input.new_pin)) throw httpError(400, 'New PIN must be exactly 6 digits');
      const { data: existing } = await admin.from('admin_settings').select('value').eq('key', PIN_KEY).maybeSingle();
      if (existing) {
        // Changing an existing PIN requires the current one.
        const [salt, stored] = String(existing.value).split('$');
        const currentOk =
          input.current_pin && PIN_RE.test(input.current_pin) && salt && stored &&
          safeEqual(await hashPin(input.current_pin, salt), stored);
        if (!currentOk) throw httpError(403, 'Current PIN is incorrect');
      }
      const salt = randomSalt();
      const value = `${salt}$${await hashPin(input.new_pin, salt)}`;
      await admin.from('admin_settings').upsert({ key: PIN_KEY, value, updated_by: user.id, updated_at: new Date().toISOString() });
      await audit({
        actorId: user.id, actorRole: user.role, action: existing ? 'admin.revenue_pin_changed' : 'admin.revenue_pin_set',
        entityType: 'admin_settings', entityId: PIN_KEY, ip: clientIp(req),
      });
      return jsonResponse({ ok: true }, { status: 200 }, cors);
    }

    // ─── Invite an employee ──────────────────────────────────────────────────
    if (input.action === 'invite_member') {
      if (!input.email) throw httpError(400, 'Email is required');
      const email = input.email.trim().toLowerCase();
      const accessLevel = input.access_level ?? 'staff';

      const { error: insErr } = await admin.from('admin_members').insert({
        email, full_name: input.full_name?.trim() || null, access_level: accessLevel, invited_by: user.id,
      });
      if (insErr) {
        if (insErr.code === '23505') throw httpError(409, 'That email is already on the team.');
        throw httpError(400, insErr.message);
      }

      // Send a Supabase auth invite so they can set a password. If they already
      // have an account, the invite fails — that's fine, they can just sign in.
      let invited = false;
      try {
        const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: 'https://movvy.ca/admin-management/reset-password',
        });
        invited = !invErr;
      } catch (_e) { /* already-registered / provider off — non-fatal */ }

      await audit({
        actorId: user.id, actorRole: user.role, action: 'admin.member_invited',
        entityType: 'admin_member', entityId: email, ip: clientIp(req),
        payload: { access_level: accessLevel, invited },
      });
      return jsonResponse({ ok: true, invited }, { status: 200 }, cors);
    }

    // ─── Update an employee (block/unblock, change level) ────────────────────
    if (input.action === 'set_member') {
      if (!input.id) throw httpError(400, 'Member id is required');
      const { data: member } = await admin.from('admin_members').select('email').eq('id', input.id).maybeSingle();
      if (!member) throw httpError(404, 'Member not found');
      // The root management account can never be demoted or blocked.
      if (String(member.email).toLowerCase() === ROOT_EMAIL) {
        throw httpError(403, 'The root management account cannot be modified.');
      }
      const patch: Record<string, unknown> = {};
      if (input.access_level) patch.access_level = input.access_level;
      if (typeof input.blocked === 'boolean') patch.blocked = input.blocked;
      if (Object.keys(patch).length === 0) throw httpError(400, 'Nothing to update');
      await admin.from('admin_members').update(patch).eq('id', input.id);
      await audit({
        actorId: user.id, actorRole: user.role, action: 'admin.member_updated',
        entityType: 'admin_member', entityId: input.id, ip: clientIp(req), payload: patch,
      });
      return jsonResponse({ ok: true }, { status: 200 }, cors);
    }

    // ─── Remove an employee ──────────────────────────────────────────────────
    if (input.action === 'remove_member') {
      if (!input.id) throw httpError(400, 'Member id is required');
      const { data: member } = await admin.from('admin_members').select('email').eq('id', input.id).maybeSingle();
      if (!member) throw httpError(404, 'Member not found');
      if (String(member.email).toLowerCase() === ROOT_EMAIL) {
        throw httpError(403, 'The root management account cannot be removed.');
      }
      await admin.from('admin_members').delete().eq('id', input.id);
      await audit({
        actorId: user.id, actorRole: user.role, action: 'admin.member_removed',
        entityType: 'admin_member', entityId: input.id, ip: clientIp(req), payload: { email: member.email },
      });
      return jsonResponse({ ok: true }, { status: 200 }, cors);
    }

    throw httpError(400, 'Unknown action');
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, corsHeaders(req));
    console.error('[admin-console] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, corsHeaders(req));
  }
});
