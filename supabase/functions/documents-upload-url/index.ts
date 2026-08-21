// POST /documents-upload-url
// Returns a short-lived signed upload URL for a verification document.
// The client uploads the file directly to Storage with the URL — file bytes
// never pass through the edge function.

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  adminClient, audit, checkRateLimit, clientIp, httpError, HttpError, jsonResponse, requireAuth,
} from '../_shared/security.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { handle } from '../_shared/serve.ts';
import { r2Configured, r2PresignUpload } from '../_shared/r2.ts';

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'heic') return 'image/heic';
  if (e === 'webp') return 'image/webp';
  if (e === 'pdf') return 'application/pdf';
  if (e === 'mp4') return 'video/mp4';
  if (e === 'mov') return 'video/quicktime';
  return 'application/octet-stream';
}

const DocKind = z.enum([
  'gov_id', 'driver_license', 'vehicle_registration', 'insurance',
  'business_registration', 'wcb', 'fleet_insurance', 'selfie_with_id',
]);

const Body = z.object({
  bucket: z.enum(['verifications', 'profile-photos', 'move-photos', 'company-photos']),
  kind: DocKind.optional(),
  // For verifications: scope = profile / team / company. Path inferred from subject.
  // 'vehicle' added in 0116: registration and insurance name a specific truck,
  // so they attach to one rather than to the whole company.
  subject_type: z.enum(['profile', 'team', 'company', 'booking', 'vehicle']),
  subject_id: z.string().uuid(),
  file_ext: z.string().regex(/^[a-z0-9]{1,5}$/),
});

handle(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, cors);

  try {
    const user = await requireAuth(req);

    await checkRateLimit({
      bucketKey: `user:${user.id}:documents_upload_url`,
      endpoint: 'documents-upload-url',
      limit: 30,
      windowSeconds: 3600,
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
    const { bucket, kind, subject_type, subject_id, file_ext } = parsed.data;

    // Authorization check: user must own / be a member of the subject
    const admin = adminClient();
    if (subject_type === 'profile' && subject_id !== user.id) {
      throw httpError(403, 'Cannot upload for another profile');
    }
    if (subject_type === 'team') {
      const { data } = await admin.from('partner_team_members')
        .select('team_id').eq('team_id', subject_id).eq('profile_id', user.id).eq('status', 'active').is('removed_at', null).maybeSingle();
      if (!data) throw httpError(403, 'Not a member of this team');
    }
    if (subject_type === 'company') {
      const { data } = await admin.from('company_members')
        .select('company_id, role').eq('company_id', subject_id).eq('profile_id', user.id).eq('status', 'active').is('removed_at', null).maybeSingle();
      if (!data || !['owner','dispatcher'].includes(data.role)) throw httpError(403, 'Not a company admin');
    }
    if (subject_type === 'vehicle') {
      // The uploader must run the company that owns the truck. Same bar as a
      // company-level document, because that is what this replaces.
      const { data: v } = await admin.from('vehicles')
        .select('company_id').eq('id', subject_id).maybeSingle();
      if (!v?.company_id) throw httpError(404, 'Truck not found');
      const { data: m } = await admin.from('company_members')
        .select('role').eq('company_id', v.company_id).eq('profile_id', user.id)
        .eq('status', 'active').is('removed_at', null).maybeSingle();
      if (!m || !['owner', 'dispatcher'].includes(m.role)) {
        throw httpError(403, 'Only a crew admin can upload truck paperwork');
      }
    }
    if (subject_type === 'booking') {
      const { data } = await admin.from('bookings')
        .select('customer_id, assigned_driver_profile_id').eq('id', subject_id).single();
      if (!data) throw httpError(404, 'Booking not found');
      if (data.customer_id !== user.id && data.assigned_driver_profile_id !== user.id) {
        throw httpError(403, 'Not a participant in this booking');
      }
    }

    // Path convention: bucket/<subject_id>/<kind>-<uuid>.<ext>
    // The leading segment matches storage RLS policy lookups
    const id = crypto.randomUUID();
    // Vehicle documents live under the OWNING COMPANY's folder, not the
    // vehicle's. Storage RLS matches on the first path segment, and every
    // existing policy is written against company/team/profile ids — filing
    // them under a vehicle id would put them in a folder no policy grants.
    let vehicleCompanyId: string | null = null;
    if (subject_type === 'vehicle') {
      const { data: v } = await admin.from('vehicles')
        .select('company_id').eq('id', subject_id).maybeSingle();
      vehicleCompanyId = (v as any)?.company_id ?? null;
    }
    const segmentOne = subject_type === 'team' || subject_type === 'company'
      ? subject_id
      : subject_type === 'vehicle'
      ? (vehicleCompanyId ?? user.id)
      : (subject_type === 'booking' ? subject_id : user.id);
    const filename = kind ? `${kind}-${id}.${file_ext}` : `${id}.${file_ext}`;
    const path = `${segmentOne}/${filename}`;

    // When R2 is configured, prefer it for the upload — egress is free and
    // Cloudflare's CDN sits in front of every read. Falls back to Supabase
    // Storage silently if R2 isn't configured or the presign throws.
    // The Storage path convention is mirrored so the same RLS-by-folder
    // posture maps onto R2 object keys (bucket is encoded as a path prefix).
    let signed: any;
    let storageProvider: 'supabase' | 'r2' = 'supabase';
    let publicUrl: string | null = null;
    if (r2Configured()) {
      try {
        const r2 = await r2PresignUpload({
          path: `${bucket}/${path}`,
          contentType: mimeForExt(file_ext),
        });
        signed = { signedUrl: r2.uploadUrl, token: null, path };
        publicUrl = r2.publicUrl;
        storageProvider = 'r2';
      } catch (e) {
        console.warn('[documents-upload-url] R2 presign failed, falling back to Supabase', e);
      }
    }
    if (storageProvider === 'supabase') {
      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUploadUrl(path);
      if (error || !data) {
        console.error('[documents-upload-url] signedUrl error', error);
        throw httpError(500, 'Could not create upload URL');
      }
      signed = data;
    }

    // If kind specified, pre-register the row in verification_documents.
    // The row's status stays 'pending' until admin reviews.
    let documentId: string | null = null;
    if (kind && (bucket === 'verifications')) {
      const insertCol: Record<string, string | null> = {
        profile_id: null, team_id: null, company_id: null, vehicle_id: null,
      };
      if (subject_type === 'profile') insertCol.profile_id = subject_id;
      if (subject_type === 'team') insertCol.team_id = subject_id;
      if (subject_type === 'company') insertCol.company_id = subject_id;
      if (subject_type === 'vehicle') {
        insertCol.vehicle_id = subject_id;
        // Keep company_id populated too: the approvals console groups by
        // company, and the legacy fallback in vehicle_is_road_ready reads it.
        insertCol.company_id = vehicleCompanyId;
      }

      const { data: doc } = await admin.from('verification_documents').insert({
        ...insertCol,
        kind,
        storage_bucket: bucket,
        storage_path: path,
        status: 'pending',
      }).select('id').single();
      documentId = doc?.id ?? null;
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: 'document.upload_url_issued',
      entityType: 'document',
      entityId: documentId ?? undefined,
      ip: clientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      payload: { bucket, subject_type, subject_id, kind, path },
    });

    return jsonResponse(
      {
        ok: true,
        upload: signed,
        path,
        document_id: documentId,
        storage: storageProvider,
        public_url: publicUrl,
      },
      { status: 200 },
      cors,
    );
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, { status: e.status }, cors);
    console.error('[documents-upload-url] unhandled', e);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 }, cors);
  }
});
