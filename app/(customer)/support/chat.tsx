// /(customer)/support/chat — drops the customer straight into a live chat with
// Movvy support. This is the primary "I need help" action (the old hub with its
// wall of options is still one tap away via the "⋯" button in the chat header,
// which opens /(customer)/support for SOS / claims / disputes / audit).
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { ChatSheet } from '@/components/ChatSheet';
import { useEnsureSupportThread } from '@/lib/data';
import { useToast } from '@/components/Toast';

export default function SupportChatScreen() {
  const ensure = useEnsureSupportThread();
  const toast = useToast();
  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    ensure
      .mutateAsync()
      .then((id) => {
        if (mounted) setThreadId(id);
      })
      .catch((e: any) => {
        if (!mounted) return;
        toast.error(e?.message ?? "Couldn't open support chat.");
        router.back();
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {threadId ? (
        <ChatSheet
          visible
          threadId={threadId}
          peerName="Movvy Support"
          callNumber="+16134163426"
          quickReplies={[
            "I need help with my move",
            "My crew hasn't arrived",
            "I need to change my booking date",
            "Something was damaged",
            "I have a billing question",
          ]}
          onClose={() => router.back()}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#16A34A" />
        </View>
      )}
    </View>
  );
}
