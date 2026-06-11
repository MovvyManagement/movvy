// =============================================================================
// CDN URL resolver
//
// The mobile app stores objects either in Supabase Storage (default) or
// Cloudflare R2 (when the server-side R2_* env vars are set). Reads should
// go through the public CDN URL whenever possible — egress is free, latency
// is lower, and Supabase's Storage egress meter doesn't tick.
//
// Usage:
//   • Upload paths: prefer the `public_url` returned by documents-upload-url
//     (set when storage='r2') and fall back to a Supabase signed read URL.
//   • For arbitrary keys you already know about, call cdnUrl(bucket, path).
// =============================================================================

import Constants from 'expo-constants';
import { supabase } from './supabase';

const CDN_BASE =
  (Constants.expoConfig?.extra?.R2_PUBLIC_BASE_URL as string | undefined)
  ?? process.env.EXPO_PUBLIC_R2_PUBLIC_BASE_URL
  ?? '';

/**
 * Resolve a CDN URL for `bucket/path`. If R2 is configured (`EXPO_PUBLIC_
 * R2_PUBLIC_BASE_URL` is set), returns the public CDN URL; otherwise returns
 * a fresh Supabase signed URL (1 hour TTL).
 */
export async function cdnUrl(bucket: string, path: string, ttlSeconds = 3600): Promise<string> {
  if (CDN_BASE) {
    // R2 mirrors the storage layout: `${bucket}/${path}` is the object key.
    return `${CDN_BASE.replace(/\/$/, '')}/${bucket}/${encodePath(path)}`;
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    // Last-ditch: return the public URL (might 401 if the bucket is private
    // — caller should expect that and surface a graceful broken-image).
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }
  return data.signedUrl;
}

/** Synchronous variant — only safe when the CDN base is configured. */
export function cdnUrlSync(bucket: string, path: string): string | null {
  if (!CDN_BASE) return null;
  return `${CDN_BASE.replace(/\/$/, '')}/${bucket}/${encodePath(path)}`;
}

export function cdnConfigured(): boolean {
  return !!CDN_BASE;
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}
