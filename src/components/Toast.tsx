// =============================================================================
// Toast — lightweight, non-modal feedback layer
//
// Replaces most Alert.alert() calls. Native iOS alerts hijack the screen
// and require a tap to dismiss; toasts slide in at the top, sit for a few
// seconds, slide out. Three visual variants:
//   • success → brand green
//   • error   → red
//   • info    → neutral grey
//
// Usage:
//   const toast = useToast();
//   toast.show('Receipt sent', { variant: 'success' });
//
// The provider mounts once in app/_layout.tsx alongside ErrorBoundary.
// =============================================================================

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Animated, Pressable, Text, View, Platform } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

type Variant = 'success' | 'error' | 'info';

interface ToastOptions {
  variant?: Variant;
  /** Auto-dismiss after this many ms. Default 4000. Pass 0 to require manual tap. */
  durationMs?: number;
}

interface ToastState {
  id: number;
  message: string;
  variant: Variant;
  durationMs: number;
}

interface ToastApi {
  show: (message: string, options?: ToastOptions) => void;
  success: (message: string, options?: Omit<ToastOptions, 'variant'>) => void;
  error: (message: string, options?: Omit<ToastOptions, 'variant'>) => void;
  info: (message: string, options?: Omit<ToastOptions, 'variant'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slide = useRef(new Animated.Value(-100)).current;

  const dismiss = useCallback(() => {
    Animated.timing(slide, {
      toValue: -100,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setToast(null));
  }, [slide]);

  const show = useCallback<ToastApi['show']>((message, options) => {
    const variant = options?.variant ?? 'info';
    const durationMs = options?.durationMs ?? 4000;
    const id = ++nextId.current;
    setToast({ id, message, variant, durationMs });
    if (timer.current) clearTimeout(timer.current);
    Animated.spring(slide, {
      toValue: 0,
      tension: 80,
      friction: 12,
      useNativeDriver: true,
    }).start();
    if (durationMs > 0) {
      timer.current = setTimeout(() => dismiss(), durationMs);
    }
  }, [dismiss, slide]);

  const api: ToastApi = {
    show,
    success: (m, o) => show(m, { ...o, variant: 'success' }),
    error: (m, o) => show(m, { ...o, variant: 'error' }),
    info: (m, o) => show(m, { ...o, variant: 'info' }),
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastPill toast={toast} slide={slide} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

// ─── visual ────────────────────────────────────────────────────────────────

function ToastPill({
  toast,
  slide,
  onDismiss,
}: {
  toast: ToastState | null;
  slide: Animated.Value;
  onDismiss: () => void;
}) {
  // Sit just below the safe-area top inset so the pill doesn't overlap the
  // status bar / notch.
  const insets = useContext(SafeAreaInsetsContext);
  const top = (insets?.top ?? (Platform.OS === 'ios' ? 44 : 24)) + 8;

  if (!toast) return null;

  const palette = {
    success: { bg: '#16A34A', icon: 'checkmark-circle' as const },
    error: { bg: '#DC2626', icon: 'alert-circle' as const },
    info: { bg: '#0A0A0A', icon: 'information-circle' as const },
  }[toast.variant];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top,
        left: 16,
        right: 16,
        transform: [{ translateY: slide }],
        zIndex: 9999,
      }}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLabel={toast.message}
        accessibilityHint="Tap to dismiss"
        style={{
          backgroundColor: palette.bg,
          borderRadius: 16,
          paddingVertical: 12,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          // Soft shadow so it floats over content
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 6,
        }}
      >
        <Ionicons name={palette.icon} size={20} color="#fff" />
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            marginLeft: 8,
            flex: 1,
            color: '#fff',
            fontSize: 14,
            fontWeight: '600',
          }}
          numberOfLines={3}
        >
          {toast.message}
        </Text>
        <View
          style={{
            marginLeft: 8,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.2)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="close" size={14} color="#fff" />
        </View>
      </Pressable>
    </Animated.View>
  );
}
