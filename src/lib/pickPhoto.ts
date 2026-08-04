// =============================================================================
// pickPhoto — one way to get a photo out of the user, everywhere in the app.
//
// Why this exists: every upload screen called
// ImagePicker.requestMediaLibraryPermissionsAsync() before opening the picker.
// On iOS that is both unnecessary and actively harmful — the system picker
// (PHPicker) runs OUT OF PROCESS and needs no permission at all, while the
// permission request opens the "Selected Photos" management sheet for anyone
// whose library access is set to Limited. That sheet has a Cancel button and no
// way to submit anything, so uploading looked broken: the photo grid appeared,
// nothing could be confirmed, and the caller never received a file.
//
// So: iOS goes straight to the picker. Android still needs the runtime grant.
// Both offer the camera, because a registration or an insurance slip is usually
// photographed on the spot rather than already sitting in the camera roll.
// =============================================================================

import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export interface PickedPhoto {
  uri: string;
  name: string;
  mime: string;
}

function toPicked(asset: ImagePicker.ImagePickerAsset, label: string): PickedPhoto {
  return {
    uri: asset.uri,
    name: asset.fileName ?? `${label}-${Date.now()}.jpg`,
    mime: asset.mimeType ?? 'image/jpeg',
  };
}

async function fromLibrary(label: string): Promise<PickedPhoto | null> {
  // Android only — see the header. Requesting this on iOS is what broke uploads.
  if (Platform.OS === 'android') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo access needed',
        'Movvy needs access to your photos to attach this document. You can turn it on in Settings.',
      );
      return null;
    }
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.85,
  });
  if (result.canceled || result.assets.length === 0) return null;
  return toPicked(result.assets[0], label);
}

async function fromCamera(label: string): Promise<PickedPhoto | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      'Camera access needed',
      'Movvy needs your camera to photograph this document. You can turn it on in Settings.',
    );
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });
  if (result.canceled || result.assets.length === 0) return null;
  return toPicked(result.assets[0], label);
}

/**
 * Ask for a photo, giving the user the choice of camera or library.
 * Resolves to null when they back out of either step — callers should just
 * return quietly in that case.
 *
 * `label` only names the fallback filename (e.g. 'vehicle_registration').
 */
export function pickPhoto(label = 'photo', title = 'Add a photo'): Promise<PickedPhoto | null> {
  return new Promise((resolve) => {
    Alert.alert(title, 'Take a new photo or choose one from your library.', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Take photo', onPress: () => fromCamera(label).then(resolve) },
      { text: 'Choose from library', onPress: () => fromLibrary(label).then(resolve) },
    ]);
  });
}
