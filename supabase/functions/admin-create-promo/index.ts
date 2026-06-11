// POST /admin-create-promo
// Admin creates a promo code (or updates an existing one).

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Code must be 3-30 chars · A-Z 0-9 _ -'),
  kind: z.enum(['percent_off', 'amount_off_cents', 'free_service_fee']),
  value: z.number().int().min(0).max(10000),
  min_subtotal_cents: z.number().int().min(0).optional(),
  max_redemptions: z.number().int().positive().optional(),
  per_user_limit: z.number().int().positive().default(1),
  city_slug: z.string().min(1).max(40).optional(),
  expires_at: z.string().datetime().optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    if (user.role !== 'movvy_admin') throw httpError(403, 'Full admins only');

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const input = parsed.data;

    // Validate percent value
    if (input.kind === 'percent_off' && (input.value < 1 || input.value > 100)) {
      throw httpError(400, 'percent_off value must be 1-100');
    }

    const admin = adminClient();
    let cityId: string | null = null;
    if (input.city_slug) {
      const { data: city } = await admin.from('cities').select('id').eq('slug', input.city_slug).single();
      if (!city) throw httpError(400, 'Unknown city slug');
      cityId = city.id;
    }

    const { data, error } = await admin
      .from('promo_codes')
      .upsert({
        code: input.code,
        kind: input.kind,
        value: input.value,
        min_subtotal_cents: input.min_subtotal_cents ?? 0,
        max_redemptions: input.max_redemptions ?? null,
        per_user_limit: input.per_user_limit,
        city_id: cityId,
        expires_at: input.expires_at ?? null,
        is_active: true,
        created_by: user.id,
      }, { onConflict: 'code' })
      .select('id, code, kind, value, is_active')
      .single();

    if (error) throw httpError(400, error.message);

    await audit({
      actorId: user.id, actorRole: user.role,
      action: 'promo.created',
      entityType: 'promo_code',
      entityId: data.id,
      ip: clientIp(req), ua: req.headers.get('user-agent') ?? undefined,
      payload: input,
    });

    return jsonResponse({ ok: true, promo: data }, { status: 201 }, cors);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[admin-create-promo] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
