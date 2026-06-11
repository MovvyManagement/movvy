// POST /promo-validate
// Validates a promo code for the current user against a hypothetical subtotal.
// Used at the pricing step so the customer sees the discount before they confirm.
// Does NOT mark the promo as redeemed — that happens in bookings-create.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, checkRateLimit, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),
  subtotal_cents: z.number().int().min(0),
  city_slug: z.string().optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:promo_validate`,
      endpoint: 'promo-validate',
      limit: 30, windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { code, subtotal_cents, city_slug } = parsed.data;

    const admin = adminClient();

    const { data: promo } = await admin
      .from('promo_codes')
      .select('*, cities(slug)')
      .eq('code', code)
      .eq('is_active', true)
      .maybeSingle();

    if (!promo) return jsonResponse({ ok: false, reason: 'invalid_code' }, { status: 200 }, cors);

    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return jsonResponse({ ok: false, reason: 'expired' }, { status: 200 }, cors);
    }
    if (promo.max_redemptions && promo.redeemed_count >= promo.max_redemptions) {
      return jsonResponse({ ok: false, reason: 'fully_redeemed' }, { status: 200 }, cors);
    }
    if (promo.min_subtotal_cents && subtotal_cents < promo.min_subtotal_cents) {
      return jsonResponse({
        ok: false,
        reason: 'min_subtotal_not_met',
        min_subtotal_cents: promo.min_subtotal_cents,
      }, { status: 200 }, cors);
    }
    if (city_slug && promo.cities?.slug && promo.cities.slug !== city_slug) {
      return jsonResponse({ ok: false, reason: 'wrong_city' }, { status: 200 }, cors);
    }

    // Per-user limit
    const { count: userUses } = await admin
      .from('promo_redemptions')
      .select('*', { count: 'exact', head: true })
      .eq('promo_code_id', promo.id)
      .eq('profile_id', user.id);
    if ((userUses ?? 0) >= (promo.per_user_limit ?? 1)) {
      return jsonResponse({ ok: false, reason: 'per_user_limit' }, { status: 200 }, cors);
    }

    // Compute discount
    let discountCents = 0;
    if (promo.kind === 'percent_off') {
      discountCents = Math.round((subtotal_cents * promo.value) / 100);
    } else if (promo.kind === 'amount_off_cents') {
      discountCents = Math.min(promo.value, subtotal_cents);
    } else if (promo.kind === 'free_service_fee') {
      // Service fee is folded into our pricing now; treat as flat $25 off as a placeholder
      discountCents = Math.min(2500, subtotal_cents);
    }

    return jsonResponse({
      ok: true,
      promo_id: promo.id,
      code: promo.code,
      kind: promo.kind,
      value: promo.value,
      discount_cents: discountCents,
    }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[promo-validate] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
