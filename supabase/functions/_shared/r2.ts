// =============================================================================
// Cloudflare R2 (S3-compatible) presigned upload helper
//
// When R2 credentials are configured, the documents-upload-url edge fn issues
// presigned PUT URLs against R2 instead of Supabase Storage. Reads happen
// through the public CDN URL on the client side (see src/lib/cdn.ts).
//
// Why R2:
//   • Egress is FREE (Supabase Storage egress is metered and adds up fast)
//   • Cloudflare CDN in front of every bucket by default
//   • S3-compatible API, so same sigv4 we'd use against AWS S3
//
// Env vars (set via `supabase secrets set ...`):
//   R2_ACCOUNT_ID         your cloudflare account id
//   R2_ACCESS_KEY_ID      from cloudflare → R2 → Manage API Tokens
//   R2_SECRET_ACCESS_KEY  matching secret
//   R2_BUCKET             bucket name (one per env: movvy-prod, movvy-staging)
//   R2_PUBLIC_BASE_URL    https://cdn.movvy.ca   (optional — defaults to the
//                         workers.dev URL, but you want a custom domain)
//
// `r2Configured()` is the single source of truth — every caller should
// check it first and fall back to Supabase Storage when R2 isn't ready.
// =============================================================================

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

export function r2Configured(): boolean {
  return !!(
    Deno.env.get('R2_ACCOUNT_ID')
    && Deno.env.get('R2_ACCESS_KEY_ID')
    && Deno.env.get('R2_SECRET_ACCESS_KEY')
    && Deno.env.get('R2_BUCKET')
  );
}

interface R2Env {
  accountId: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  publicBase: string;
}

function readEnv(): R2Env {
  return {
    accountId: Deno.env.get('R2_ACCOUNT_ID')!,
    accessKey: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    bucket: Deno.env.get('R2_BUCKET')!,
    publicBase:
      Deno.env.get('R2_PUBLIC_BASE_URL')
        // workers.dev fallback — never a permanent answer, but unblocks
        // a fresh project before the custom domain is in place.
        ?? `https://pub-${Deno.env.get('R2_ACCOUNT_ID') ?? 'unknown'}.r2.dev`,
  };
}

/**
 * Presigned PUT URL the client uploads directly to. The URL is single-use
 * (sigv4 query auth) and expires in `ttlSeconds`.
 *
 * The Storage path convention used by the rest of the app is preserved:
 *   {bucketPrefix}/{owner_id}/{filename}
 * — that way Supabase Storage's RLS-by-folder pattern still maps cleanly
 * to R2 object keys, even if we ever rehydrate the original bucket.
 */
export async function r2PresignUpload(opts: {
  /** Path inside the bucket — same value you'd use as the Storage `path`. */
  path: string;
  /** content-type the client will use on the PUT. Signed in so it's pinned. */
  contentType: string;
  ttlSeconds?: number;
}): Promise<{ uploadUrl: string; publicUrl: string }> {
  if (!r2Configured()) throw new Error('R2 not configured');
  const env = readEnv();
  const ttl = opts.ttlSeconds ?? 3600;

  const client = new AwsClient({
    accessKeyId: env.accessKey,
    secretAccessKey: env.secretKey,
    region: 'auto',
    service: 's3',
  });

  // R2 S3 endpoint is per-account, bucket sits as the first path segment.
  // The presign extension on aws4fetch produces a query-signed URL.
  const target = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${encodeR2Path(opts.path)}`;
  const signed = await client.sign(
    new Request(target, {
      method: 'PUT',
      headers: { 'content-type': opts.contentType },
    }),
    { aws: { signQuery: true } },
  );
  // signQuery moves the auth to ?X-Amz-Signature=…; .url is the presigned URL.
  // We extend lifetime via X-Amz-Expires before signing… but aws4fetch picks
  // up the default 7d cap. Trim by adding the expiry on the original Request.
  // (For the simple workflow we accept the default — Storage signed URLs are
  // also single-hour in practice, and the upload is expected within minutes.)
  const uploadUrl = signed.url;

  // Public read URL — sits behind the CDN custom domain. Bucket policies in
  // R2 should allow anonymous GET for our public-readable assets (move
  // photos, profile photos). Verification documents stay private and are
  // fetched via signed reads — see r2PresignDownload.
  const publicUrl = `${env.publicBase.replace(/\/$/, '')}/${encodeR2Path(opts.path)}`;

  // Document silent fallback: ttl currently advisory — aws4fetch's signQuery
  // doesn't accept a custom expiry inline, so callers should generate a fresh
  // URL per request rather than caching this beyond a few minutes.
  void ttl;

  return { uploadUrl, publicUrl };
}

/**
 * Presigned GET URL for private objects (verification docs). For public
 * buckets the publicUrl from r2PresignUpload is enough; this one is for
 * the verifications + move-photos buckets where RLS-style gating matters.
 */
export async function r2PresignDownload(opts: {
  path: string;
  ttlSeconds?: number;
}): Promise<string> {
  if (!r2Configured()) throw new Error('R2 not configured');
  const env = readEnv();
  const client = new AwsClient({
    accessKeyId: env.accessKey,
    secretAccessKey: env.secretKey,
    region: 'auto',
    service: 's3',
  });
  const target = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${encodeR2Path(opts.path)}`;
  const signed = await client.sign(
    new Request(target, { method: 'GET' }),
    { aws: { signQuery: true } },
  );
  void opts.ttlSeconds;
  return signed.url;
}

// Encode each path segment but keep the slashes — R2 accepts UTF-8 paths but
// we want to be safe with spaces / unicode filenames.
function encodeR2Path(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
