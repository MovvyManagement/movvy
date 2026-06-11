// =============================================================================
// EditBusinessRegistrationSheet
//
// Editor for the company's registration number + business-license document.
// Customer-facing receipts pull from registration_number so it must be
// editable post-onboarding (typos, renumbered LLC, etc.).
//
// Document upload uses the existing useUploadDocument hook → signed Storage
// URL from the documents-upload-url edge function. Once the PUT succeeds we
// invalidate the company-documents query so the row shows up immediately.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from './Input';
import { useCompany, useUpdateCompany, useCompanyDocuments, useUploadDocument } from '@/lib/data';
import { useToast } from './Toast';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  companyId: string | null;
  onClose: () => void;
}

const IS_IOS = Platform.OS === 'ios';

export function EditBusinessRegistrationSheet({ visible, companyId, onClose }: Props) {
  const { data: company } = useCompany(companyId);
  const update = useUpdateCompany(companyId);
  const { data: docs } = useCompanyDocuments(companyId);
  const upload = useUploadDocument();
  const toast = useToast();
  const qc = useQueryClient();

  const [reg, setReg] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!visible || !company) return;
    setReg(company.registration_number ?? '');
  }, [visible, company]);

  const onFile = docs?.find((d) => d.kind === 'business_registration');
  const canSave = !!company && !saving && reg.trim().length >= 3 && reg.trim() !== company.registration_number;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await update.mutateAsync({ registration_number: reg.trim() });
      haptic.success();
      toast.success('Registration updated');
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update registration.");
    } finally {
      setSaving(false);
    }
  };

  const pickAndUpload = async () => {
    if (!companyId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.error('Photo library permission denied');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const mime = asset.mimeType ?? 'image/jpeg';
    const name = asset.fileName ?? `business-reg-${Date.now()}.jpg`;
    setUploading(true);
    try {
      await upload.mutateAsync({
        bucket: 'verifications',
        kind: 'business_registration',
        subject_type: 'company',
        subject_id: companyId,
        fileUri: asset.uri,
        fileName: name,
        mimeType: mime,
      });
      qc.invalidateQueries({ queryKey: ['company-documents', companyId] });
      haptic.success();
      toast.success('Document uploaded — Movvy will review it shortly');
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const statusBadge = (() => {
    if (!onFile) return { label: 'Not uploaded', tone: 'text-silver-500', bg: 'bg-silver-100' };
    if (onFile.status === 'approved') return { label: 'Approved', tone: 'text-brand-700', bg: 'bg-brand-50' };
    if (onFile.status === 'rejected') return { label: 'Rejected', tone: 'text-danger', bg: 'bg-red-50' };
    if (onFile.status === 'expired') return { label: 'Expired', tone: 'text-warning', bg: 'bg-amber-50' };
    return { label: 'In review', tone: 'text-amber-700', bg: 'bg-amber-50' };
  })();

  const body = (
    <ScrollView
      contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
      keyboardShouldPersistTaps="handled"
    >
      {IS_IOS ? null : (
        <View className="self-center h-1.5 w-12 rounded-full bg-silver-200 mb-4" />
      )}

      <Text className="text-2xl font-bold text-ink-900">Business registration</Text>
      <Text className="mt-1 text-sm text-silver-500">
        Your GST / HST or provincial business number. Printed on every
        receipt the company issues. Upload your license so Movvy can verify.
      </Text>

      <View className="mt-5">
        <Input
          label="Registration number"
          placeholder="123456789RT0001"
          autoCapitalize="characters"
          autoCorrect={false}
          value={reg}
          onChangeText={setReg}
          leftIcon={<Ionicons name="receipt-outline" size={18} color="#71717A" />}
        />
      </View>

      <Pressable
        onPress={save}
        disabled={!canSave}
        className={`mt-3 h-12 rounded-2xl items-center justify-center flex-row ${
          canSave ? 'bg-brand-600 active:opacity-90' : 'bg-silver-300'
        }`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-base font-bold text-white">Save registration number</Text>
        )}
      </Pressable>

      <Text className="mt-6 text-xs font-semibold uppercase tracking-wider text-silver-500 mb-2">
        Business license document
      </Text>

      <View className="rounded-2xl border border-silver-200 p-4">
        <View className="flex-row items-center">
          <View className="h-11 w-11 rounded-2xl bg-silver-100 items-center justify-center">
            <Ionicons name="document-text-outline" size={20} color="#0A0A0A" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-base font-bold text-ink-900">License on file</Text>
            <Text className="text-xs text-silver-500 mt-0.5">
              {onFile
                ? `Uploaded ${new Date(onFile.created_at).toLocaleDateString()}`
                : 'No document yet'}
            </Text>
          </View>
          <View className={`px-2 py-1 rounded-full ${statusBadge.bg}`}>
            <Text className={`text-[11px] font-bold ${statusBadge.tone}`}>{statusBadge.label}</Text>
          </View>
        </View>

        {onFile?.status === 'rejected' && onFile.rejection_reason ? (
          <View className="mt-3 rounded-xl bg-red-50 p-3">
            <Text className="text-xs text-danger">
              <Text className="font-bold">Rejected: </Text>
              {onFile.rejection_reason}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={pickAndUpload}
          disabled={uploading}
          className={`mt-3 h-12 rounded-2xl items-center justify-center flex-row border ${
            uploading
              ? 'border-silver-200 bg-silver-50'
              : onFile
              ? 'border-silver-300 bg-white active:opacity-70'
              : 'border-brand-600 bg-brand-600 active:opacity-90'
          }`}
        >
          {uploading ? (
            <ActivityIndicator color="#71717A" />
          ) : (
            <>
              <Ionicons
                name={onFile ? 'refresh' : 'cloud-upload-outline'}
                size={18}
                color={onFile ? '#0A0A0A' : '#fff'}
              />
              <Text
                className={`ml-2 text-base font-bold ${onFile ? 'text-ink-900' : 'text-white'}`}
              >
                {onFile ? 'Replace document' : 'Upload license'}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <Pressable onPress={onClose} className="mt-4 h-12 items-center justify-center">
        <Text className="text-sm font-semibold text-silver-500">Done</Text>
      </Pressable>
    </ScrollView>
  );

  if (IS_IOS) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['bottom']}>
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            {body}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white"
            style={{ maxHeight: '90%' }}
          >
            {body}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
