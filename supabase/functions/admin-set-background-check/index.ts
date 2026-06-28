// =============================================================================
// POST /admin-set-background-check
//
// Admin records the result of a background check (manual today, Certn-driven
// later). Single endpoint covers the whole lifecycle:
//
//   • Create a new check row in consent_pending / in_progress / passed / failed
//   • Update an existing check (provider, result URL, status, notes)
//
// Body:
//   {
//     check_id?: uuid                     // optional — update existing
//     subject_type: 'team' | 'company' | 'driver'
//     subject_id: uuid
//     status: 'consent_pending' | 'in_progress' | 'passed' | 'flagged' |
//             'failed' | 'expired'
//     provider?: string                   // default 'manual'
//     provider_ref?: string               // e.g. Certn report id
//     result_summary?: string
//     result_document_url?: string        // Storage URL of PDF
//     consent_document_url?: string
//     notes?: string
//     hit_count?: number
//   }
// =============================================================================

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError,
  jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';

const Body = z.object({
  check_id: z.string().uuid().optional(),
  subject_type: z.enum(['team', 'company', 'driver']),
  subject_id: z.string().uuid(),
  status: z.enum([
    'consent_pending', 'in_progress', 'passed', 'flagged', 'failed', 'expired',
  ]),
  provider: z.string().max(40).default('manual'),
  provider_ref: z.string().max(120).optional(),
  result_summary: z.string().max(1000).optional(),
  result_document_url: z.string().url().max(500).optional(),
  consent_document_url: z.string().url().max(500).optional(),
  notes: z.string().max(2000).optional(),
  hit_count: z.number().int().nonnegative().optional(),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);
    if (!['movvy_admin', 'movvy_support'].includes(user.role)) {
      throw httpError(403, 'Admins only');
    }

    await checkRateLimit({
      bucketKey: `user:${user.id}:admin_set_background_check`,
      endpoint: 'admin-set-background-check',
      limit: 60, windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const admin = adminClient();

    // ─── Verify the subject exists (so we don't create orphan checks) ───────
    if (input.subject_type === 'team') {
      const { data } = await admin.from('partner_teams').select('id').eq('id', input.subject_id).maybeSingle();
      if (!data) throw httpError(404, 'Team not found');
    } else if (input.subject_type === 'company') {
      const { data } = await admin.from('companies').select('id').eq('id', input.subject_id).maybeSingle();
      if (!data) throw httpError(404, 'Company not found');
    } else {
      const { data } = await admin.from('profiles').select('id').eq('id', input.subject_id).maybeSingle();
      if (!data) throw httpError(404, 'Driver profile not found');
    }

    // ─── Compute timestamps from status ─────────────────────────────────────
    const now = new Date().toISOString();
    const stamps: Record<string, unknown> = {
      status: input.status,
      reviewed_by_admin_id: user.id,
    };
    if (input.provider) stamps.provider = input.provider;
    if (input.provider_ref) stamps.provider_ref = input.provider_ref;
    if (input.result_summary) stamps.result_summary = input.result_summary;
    if (input.result_document_url) stamps.result_document_url = input.result_document_url;
    if (input.consent_document_url) {
      stamps.consent_document_url = input.consent_document_url;
      stamps.consent_signed_at = now;
      stamps.consent_ip = clientIp(req);
    }
    if (input.notes) stamps.notes = input.notes;
    if (input.hit_count != null) stamps.hit_count = input.hit_count;

    // Lifecycle timestamps
    if (input.status === 'in_progress') {
      stamps.requested_at = now;
    } else if (
      input.status === 'passed' ||
      input.status === 'flagged' ||
      input.status === 'failed'
    ) {
      stamps.completed_at = now;
      // Expires 12 months from completion (Alberta CPIC standard)
      const expires = new Date();
      expires.setFullYear(expires.getFullYear() + 1);
      stamps.expires_at = expires.toISOString();
    }

    // ─── Insert or update ───────────────────────────────────────────────────
    let resultRow: any;
    if (input.check_id) {
      const { data, error } = await admin
        .from('background_checks')
        .update(stamps)
        .eq('id', input.check_id)
        .select('*')
        .single();
      if (error || !data) throw httpError(404, 'Check not found');
      resultRow = data;
    } else {
      const { data, error } = await admin
        .from('background_checks')
        .insert({
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          requested_by_admin_id: user.id,
          ...stamps,
        })
        .select('*')
        .single();
      if (error || !data) {
        console.error('[admin-set-background-check] insert failed', error);
        throw httpError(500, error?.message ?? 'Insert failed');
      }
      resultRow = data;
    }

    // ─── Audit ──────────────────────────────────────────────────────────────
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'background_check.set',
      entityType: 'background_check',
      entityId: resultRow.id,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: {
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        status: input.status,
        provider: input.provider,
      },
    });

    return jsonResponse({ ok: true, check: resultRow }, { status: 200 }, cors);
  } catch (e) {
    if (e instanceof HttpError) {
      return jsonResponse({ error: e.message }, { status: e.status }, cors);
    }
    console.error('[admin-set-background-check] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
