// Request a short-lived signed upload URL from the edge function, then PUT the file.

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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
