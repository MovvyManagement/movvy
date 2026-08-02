// =============================================================================
// CrewPortal — the "your code / join a crew" panel shown on every partner's
// profile (both surfaces). New operator model:
//   • Everyone has their OWN org with a unique CO- code — share it and people
//     join YOUR crew (you become their admin).
//   • Enter someone else's code to join THEIR crew (instant). One crew at a time.
//   • Leave a crew to go back to running solo under your own code.
//   • Once your crew is 2+, name it.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, useAuth } from '@/lib/supabase';
import { useMyMembership } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';

export function CrewPortal() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: membership } = useMyMembership();

  // The caller's OWN org (the one they created at signup — org_role='admin').
  // This is the code they share, even while they're crewing for someone else.
  const myOrg = useQuery({
    queryKey: ['my-operator-org', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('company_members')
        .select('company_id, companies!inner(id, invite_code, display_name)')
        .eq('profile_id', user!.id)
        .eq('org_role', 'admin')
        .is('removed_at', null)
        .maybeSingle();
      if (!data) return null;
      const c: any = (data as any).companies;
      // How many people are on my crew (me + anyone who joined my code).
      const { count } = await supabase
        .from('company_members')
        .select('profile_id', { count: 'exact', head: true })
        .eq('company_id', c.id)
        .is('removed_at', null);
      return { id: c.id as string, code: c.invite_code as string, name: c.display_name as string, size: count ?? 1 };
    },
  });

  const onCrew = membership?.org_role === 'crew'; // I've joined someone else's
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-membership'] });
    qc.invalidateQueries({ queryKey: ['my-operator-org'] });
    qc.invalidateQueries({ queryKey: ['company-driver-roster'] });
  };

  // Show + share the code without dashes (COR5AMHB). Join is dash-tolerant.
  const codeNoDash = myOrg.data?.code ? myOrg.data.code.replace(/-/g, '').toUpperCase() : null;

  const copyCode = async () => {
    if (!codeNoDash) return;
    await Clipboard.setStringAsync(codeNoDash);
    haptic.success();
    toast.success('Code copied');
  };

  const shareCode = async () => {
    if (!codeNoDash) return;
    Share.share({
      message:
        `Join my Movvy crew.\n\n` +
        `1. Download Movvy\n` +
        `2. Create your account\n` +
        `3. In your profile, tap "Join a crew" and enter code ${codeNoDash}`,
    }).catch(() => {});
  };

  const join = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      toast.error('Enter the full crew code.');
      return;
    }
    setJoining(true);
    try {
      const { data, error } = await supabase.rpc('join_crew_by_code', { p_code: code });
      if (error) throw error;
      haptic.success();
      toast.success(`You're on ${(data as any)?.company_name ?? 'the crew'}`);
      setJoinCode('');
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not join that crew.');
    } finally {
      setJoining(false);
    }
  };

  const leave = () => {
    Alert.alert('Leave this crew?', "You'll go back to running solo under your own code.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          try {
            const { error } = await supabase.rpc('leave_crew');
            if (error) throw error;
            haptic.success();
            toast.success('You left the crew');
            refresh();
          } catch (e: any) {
            toast.error(e?.message ?? 'Could not leave the crew.');
          } finally {
            setLeaving(false);
          }
        },
      },
    ]);
  };

  const saveName = async () => {
    if (!myOrg.data?.id || name.trim().length < 2) return;
    setSavingName(true);
    try {
      const { error } = await supabase
        .from('companies')
        .update({ display_name: name.trim() })
        .eq('id', myOrg.data.id);
      if (error) throw error;
      haptic.success();
      toast.success('Crew name saved');
      setName('');
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save the name.');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <View className="mt-4 rounded-3xl border border-silver-100 bg-white p-5">
      {/* Your code */}
      <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
        Your crew code
      </Text>
      {myOrg.isLoading ? (
        <ActivityIndicator color="#16A34A" className="my-4" />
      ) : (
        <>
          <View className="mt-2 flex-row items-center">
            <Text className="text-2xl font-bold tracking-widest text-ink-900">
              {codeNoDash ?? '—'}
            </Text>
            <Pressable onPress={copyCode} hitSlop={8} className="ml-3 h-9 w-9 rounded-full bg-silver-100 items-center justify-center">
              <Ionicons name="copy-outline" size={16} color="#0A0A0A" />
            </Pressable>
            <Pressable onPress={shareCode} hitSlop={8} className="ml-2 h-9 w-9 rounded-full bg-silver-100 items-center justify-center">
              <Ionicons name="share-outline" size={16} color="#0A0A0A" />
            </Pressable>
          </View>
          <Text className="mt-1 text-xs text-silver-500 leading-5">
            Share this so movers can join your crew — you'll be their admin.
          </Text>

          {/* Name your crew — once it's 2+ people */}
          {!onCrew && (myOrg.data?.size ?? 1) >= 2 ? (
            <View className="mt-4 rounded-2xl bg-silver-50 p-3">
              <Text className="text-xs font-semibold text-ink-900">Name your crew</Text>
              <View className="mt-2 flex-row items-center gap-2">
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={myOrg.data?.name ?? 'Crew name'}
                  placeholderTextColor="#A1A1AA"
                  className="flex-1 rounded-xl border border-silver-200 bg-white px-3 py-2.5 text-sm text-ink-900"
                />
                <Pressable
                  onPress={saveName}
                  disabled={savingName || name.trim().length < 2}
                  className={`rounded-xl px-4 py-2.5 ${name.trim().length >= 2 ? 'bg-brand-600' : 'bg-silver-200'}`}
                >
                  <Text className="text-sm font-bold text-white">Save</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      )}

      {/* Crew membership */}
      <View className="mt-5 h-px bg-silver-100" />
      {onCrew ? (
        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            You're on a crew
          </Text>
          <View className="mt-2 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Ionicons name="people" size={18} color="#047857" />
              <Text className="ml-2 text-sm font-bold text-ink-900">
                {membership?.company_name ?? 'Crew'}
              </Text>
            </View>
            <Pressable onPress={leave} disabled={leaving} className="rounded-full border border-silver-200 px-4 py-2">
              <Text className="text-sm font-semibold text-danger">{leaving ? 'Leaving…' : 'Leave'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-silver-500">
            Join a crew
          </Text>
          <View className="mt-2 flex-row items-center gap-2">
            <TextInput
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
              placeholder="Enter a code (CO-XXXXXX)"
              placeholderTextColor="#A1A1AA"
              autoCapitalize="characters"
              autoCorrect={false}
              className="flex-1 rounded-xl border border-silver-200 bg-white px-3 py-2.5 text-sm text-ink-900"
            />
            <Pressable
              onPress={join}
              disabled={joining || joinCode.trim().length < 4}
              className={`rounded-xl px-4 py-2.5 ${joinCode.trim().length >= 4 ? 'bg-brand-600' : 'bg-silver-200'}`}
            >
              <Text className="text-sm font-bold text-white">{joining ? '…' : 'Join'}</Text>
            </Pressable>
          </View>
          <Text className="mt-1 text-xs text-silver-500 leading-5">
            Working under someone? Enter their code to join their crew.
          </Text>
        </View>
      )}
    </View>
  );
}
