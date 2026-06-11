// Pick from camera/library + compress to ~1600px / 80% before upload.
// Keeps Storage costs down and uploads fast. Returns a local URI ready to PUT.

import { Platform } from 'react-native';

export interface CompressedAsset {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
}

/**
 * Open the photo library, let the user pick one image, compress it.
 * Permission prompt handled by expo-image-picker.
 */
export async function pickAndCompressImage(opts: {
  source?: 'library' | 'camera';
  maxWidth?: number;
  quality?: number;
} = {}): Promise<CompressedAsset | null> {
  if (Platform.OS === 'web') {
    // On web, fall back to plain file input — out of scope for this util
    throw new Error('Image picking on web not supported yet');
  }
  const ImagePicker = await import('expo-image-picker');
  const ImageManipulator = await import('expo-image-manipulator');

  const launcher = opts.source === 'camera'
    ? ImagePicker.launchCameraAsync
    : ImagePicker.launchImageLibraryAsync;

  // Ensure permission
  if (opts.source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }

  const res = await launcher({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 1,            // pull at full quality so the manipulator has range
  });
  if (res.canceled || !res.assets?.[0]) return null;

  const asset = res.assets[0];

  // Compress + resize. Max longest edge = 1600px.
  const maxW = opts.maxWidth ?? 1600;
  const quality = opts.quality ?? 0.80;

  const needsResize = asset.width > maxW || asset.height > maxW;
  const resizeAction = needsResize
    ? [{ resize: asset.width >= asset.height ? { width: maxW } : { height: maxW } }]
    : [];

  const out = await ImageManipulator.manipulateAsync(asset.uri, resizeAction, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const fileName = asset.fileName ?? `photo-${Date.now()}.jpg`;
  return {
    uri: out.uri,
    width: out.width,
    height: out.height,
    mimeType: 'image/jpeg',
    fileName,
  };
}
