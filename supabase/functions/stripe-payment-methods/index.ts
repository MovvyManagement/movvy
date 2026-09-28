// =============================================================================
// POST /stripe-payment-methods   { action, payment_method_id? }
// -----------------------------------------------------------------------------
// Manage the signed-in customer's SAVED cards on Stripe — the real backing for
// the /(customer)/payment-methods screen. Cards are tokenized by Stripe's
// native Payment Sheet (SetupIntent) and attached to the customer, so the app
// never sees or stores a raw card number (no PCI scope). Charges at checkout
// (stripe-create-payment-intent) then reuse these same saved cards for one-tap.
//
// Actions:
//   • list        → the customer's card payment methods + which is default
//   • setup       → a SetupIntent client_secret + ephemeral key, for the app to
//                   present the Payment Sheet in "save a card" mode
//   • detach      → remove a saved card (must belong to this customer)
//   • set_default → mark a saved card as the customer's default
//
// Trust model: the Stripe customer is resolved SERVER-SIDE from the caller's
// profile (stripe_customer_id, service-role only). A caller can only ever touch
// their own customer's payment methods; detach/set_default verify the target PM
// belongs to that customer before doing anything.
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  checkRateLimit, httpError, HttpError, jsonResponse, requireAuth, adminClient,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  action: z.enum(['list', 'setup', 'detach', 'set_default']),
  // Required for detach / set_default; ignored otherwise.
  payment_method_id: z.string().startsWith('pm_').max(255).optional(),
});

const STRIPE_VERSION = '2024-06-20';

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function stripe(
  secretKey: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, string>; version?: string } = { method: 'GET' },
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (init.version) headers['Stripe-Version'] = init.version;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method,
    headers,
    body: init.body ? form(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[stripe-payment-methods] Stripe error', path, res.status, json?.error?.message);
    throw httpError(502, json?.error?.message ?? 'Payment provider error.');
  }
  return json;
}

/**
 * Resolve the caller's Stripe customer id, creating (and persisting) one the
 * first time. Mirrors stripe-create-payment-intent so a customer who manages
 * cards before their first payment still gets a stable customer.
 */
async function resolveCustomer(admin: any, secretKey: string, userId: string): Promise<string> {
  const { data: prof } = await admin
    .from('profiles')
    .select('stripe_customer_id, full_name, email')
    .eq('id', userId)
    .maybeSingle();
  let customerId: string | null = (prof as any)?.stripe_customer_id ?? null;
  if (customerId) return customerId;

  const created = await stripe(secretKey, 'customers', {
    method: 'POST',
    body: {
      name: (prof as any)?.full_name ?? '',
      email: (prof as any)?.email ?? '',
      'metadata[profile_id]': userId,
    },
  });
  customerId = created.id as string;
  await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
  return customerId;
}

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:stripe_pm`,
      endpoint: 'stripe-payment-methods',
      limit: 30,
      windowSeconds: 60,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { action, payment_method_id } = parsed.data;

    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!secretKey) {
      console.error('[stripe-payment-methods] STRIPE_SECRET_KEY unset');
      throw httpError(503, 'Payments are not configured yet.');
    }

    const admin = adminClient();
    const customerId = await resolveCustomer(admin, secretKey, user.id);

    if (action === 'list') {
      // Default PM lives on the customer's invoice_settings.
      const customer = await stripe(secretKey, `customers/${customerId}`);
      const defaultPm: string | null =
        customer?.invoice_settings?.default_payment_method ?? null;
      const pms = await stripe(secretKey, `payment_methods?customer=${customerId}&type=card&limit=100`);
      const cards = (pms.data ?? []).map((pm: any) => ({
        id: pm.id,
        brand: pm.card?.brand ?? 'other',
        last4: pm.card?.last4 ?? '',
        exp_month: pm.card?.exp_month ?? 0,
        exp_year: pm.card?.exp_year ?? 0,
        is_default: pm.id === defaultPm,
      }));
      return jsonResponse({ cards }, { status: 200 }, cors);
    }

    if (action === 'setup') {
      // SetupIntent so the native Payment Sheet can collect + save a card
      // without a charge. Ephemeral key lets that sheet show existing cards too.
      const si = await stripe(secretKey, 'setup_intents', {
        method: 'POST',
        body: {
          customer: customerId,
          'automatic_payment_methods[enabled]': 'true',
          usage: 'off_session',
        },
      });
      const ek = await stripe(secretKey, 'ephemeral_keys', {
        method: 'POST',
        version: STRIPE_VERSION,
        body: { customer: customerId },
      });
      return jsonResponse({
        setup_intent_client_secret: si.client_secret,
        ephemeral_key_secret: ek.secret ?? null,
        customer_id: customerId,
      }, { status: 200 }, cors);
    }

    // detach / set_default both need a PM that belongs to THIS customer.
    if (!payment_method_id) throw httpError(400, 'payment_method_id is required');
    const pm = await stripe(secretKey, `payment_methods/${payment_method_id}`);
    if (pm?.customer !== customerId) {
      throw httpError(403, 'That card is not on your account.');
    }

    if (action === 'detach') {
      await stripe(secretKey, `payment_methods/${payment_method_id}/detach`, { method: 'POST' });
      return jsonResponse({ ok: true }, { status: 200 }, cors);
    }

    if (action === 'set_default') {
      await stripe(secretKey, `customers/${customerId}`, {
        method: 'POST',
        body: { 'invoice_settings[default_payment_method]': payment_method_id },
      });
      return jsonResponse({ ok: true }, { status: 200 }, cors);
    }

    throw httpError(400, 'Unknown action');
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[stripe-payment-methods] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
