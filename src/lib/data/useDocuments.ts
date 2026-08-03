// Request a short-lived signed upload URL from the edge function, then PUT the file.

import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '@/lib/supabase';

type Bucket = 'verifications' | 'profile-photos' | 'move-photos' | 'company-photos';
type DocKind = 'gov_id' | 'driver_license' | 'vehicle_registration' | 'insurance' | 'business_registration' | 'wcb' | 'fleet_insurance' | 'selfie_with_id';

interface UploadArgs {
  bucket: Bucket;
  kind?: DocKind;
  subject_type: 'profile' | 'team' | 'company' | 'booking';
  subject_id: string;
  fileUri: string;       // local file:// URI from expo-image-picker
  fileName: string;
  mimeType: string;
}

export function useUploadDocument() {
  return useMutation({
    mutationFn: async (args: UploadArgs) => {
      const ext = args.fileName.split('.').pop()?.toLowerCase() ?? 'jpg';

      // 1) Ask the edge function for a signed upload URL + document row
      const { data: prep, error: prepErr } = await supabase.functions.invoke('documents-upload-url', {
        body: {
          bucket: args.bucket,
          kind: args.kind,
          subject_type: args.subject_type,
          subject_id: args.subject_id,
          file_ext: ext,
        },
      });
      if (prepErr) throw prepErr;
      if (prep?.error) throw new Error(prep.error);

      // 2) Read the local file as a binary Blob (Expo / RN)
      const fileRes = await fetch(args.fileUri);
      const blob = await fileRes.blob();

      // 3) PUT directly to Storage / R2 via the signed URL (bytes never
      // pass through the edge fn). R2 signed URLs are PUT-only and don't
      // accept Supabase's `x-upsert` header, so we only emit it when the
      // edge fn told us it issued a Supabase signed URL.
      const headers: Record<string, string> = { 'content-type': args.mimeType };
      if (prep.storage !== 'r2') headers['x-upsert'] = 'true';
      const uploadRes = await fetch(prep.upload.signedUrl, {
        method: 'PUT',
        headers,
        body: blob,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed: ${uploadRes.status}`);
      }

      return {
        path: prep.path as string,
        document_id: prep.document_id as string | null,
        storage: (prep.storage ?? 'supabase') as 'supabase' | 'r2',
        public_url: (prep.public_url ?? null) as string | null,
      };
    },
  });
}

// ─── Truck registration review state ─────────────────────────────────────────
// Job acceptance is gated on an APPROVED truck registration, so the partner
// needs to see exactly where theirs stands — and, when it's been sent back, the
// reviewer's comment telling them what to re-upload.

export interface TruckRegistrationStatus {
  status: 'missing' | 'pending' | 'approved' | 'rejected' | 'expired';
  rejection_reason?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
}

export function useTruckRegistrationStatus() {
  return useQuery({
    queryKey: ['truck-registration-status'],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<TruckRegistrationStatus> => {
      const { data, error } = await supabase.rpc('my_truck_registration_status');
      if (error) throw error;
      return (data ?? { status: 'missing' }) as TruckRegistrationStatus;
    },
  });
}
