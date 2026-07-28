import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  FlatList,
  Keyboard,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  searchCalgary,
  resolvePlaceId,
  needsResolution,
  cityProvinceFromGeocode,
  type GeocodeResult,
} from '@/lib/geocoding';
import { haptic } from '@/lib/haptics';

interface Props {
  visible: boolean;
  /** Prompt shown as the input placeholder, e.g. "Enter starting address". */
  placeholder?: string;
  /** Seed the search box (e.g. the previously chosen value) when re-opening. */
  initialQuery?: string;
  onClose: () => void;
  /** Fires with the coordinate-resolved result + a ready-to-display string. */
  onSelect: (result: GeocodeResult, displayText: string) => void;
  /** Colour of the leading dot (pickup = dark, dropoff = green). */
  accent?: string;
}

// Full-screen address search. Opened when a booking address field is tapped:
// the input sits at the TOP of the screen and suggestions fill the space above
// the keyboard, so results are never hidden behind it (the old inline dropdown
// problem). Picking a suggestion resolves its coordinates, hands them back, and
// closes — the caller drops the value into its inline field.
export function AddressSearchSheet({
  visible,
  placeholder = 'Search an address',
  initialQuery = '',
  onClose,
  onSelect,
  accent = '#0A0A0A',
}: Props) {
  const [q, setQ] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset + autofocus each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setQ(initialQuery);
    setSuggestions([]);
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Debounced search.
  useEffect(() => {
    if (!visible) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    const query = q.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const results = await searchCalgary(query, ctrl.signal);
        setSuggestions(results);
        if (results.length === 0) {
          setError(query.length >= 6 ? 'No matching addresses — try a different one' : null);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setError('Address search is offline — type the full address manually');
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q, visible]);

  const handleSelect = async (r: GeocodeResult) => {
    haptic.success();
    let final = r;
    // Google predictions carry no coordinates — resolve before committing.
    if (needsResolution(r)) {
      setResolving(true);
      setError(null);
      const resolved = await resolvePlaceId(r.place_id!);
      setResolving(false);
      if (!resolved) {
        setError('Couldn’t pin that address — try another suggestion');
        return;
      }
      final = resolved;
    }
    const { city } = cityProvinceFromGeocode(final);
    const displayText = `${final.label}${city ? `, ${city}` : ''}`.trim();
    Keyboard.dismiss();
    onSelect(final, displayText);
    onClose();
  };

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {/* A Modal is a separate native window that the app's root SafeAreaProvider
          doesn't reach, so SafeAreaView reads 0 insets and content slides under
          the Dynamic Island. Giving the modal its own provider fixes the top
          inset (and makes the back button tappable instead of hidden). */}
      <SafeAreaProvider>
        <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        {/* Header: back + search input pinned to the top */}
        <View className="px-4 pt-2 pb-3 border-b border-silver-100">
          <View className="flex-row items-center">
            <Pressable onPress={close} hitSlop={10} className="pr-2 py-2">
              <Ionicons name="chevron-back" size={26} color="#0A0A0A" />
            </Pressable>
            <View
              className="flex-1 flex-row items-center rounded-2xl border bg-white px-4 border-silver-200"
              style={{ minHeight: 50 }}
            >
              <View className="mr-3 h-3 w-3 rounded-full" style={{ backgroundColor: accent }} />
              <TextInput
                ref={inputRef}
                value={q}
                onChangeText={setQ}
                placeholder={placeholder}
                placeholderTextColor="#A1A1AA"
                className="flex-1 text-base text-ink-900"
                style={{ paddingVertical: 12 }}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="search"
              />
              {loading || resolving ? (
                <ActivityIndicator size="small" color="#71717A" />
              ) : q ? (
                <Pressable onPress={() => setQ('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color="#A1A1AA" />
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        {/* Suggestions fill the rest, above the keyboard */}
        <FlatList
          data={suggestions}
          keyExtractor={(s) => s.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            error && suggestions.length === 0 ? (
              <View className="flex-row items-center px-4 py-3">
                <Ionicons name="information-circle-outline" size={16} color="#A1A1AA" />
                <Text className="ml-2 text-sm text-silver-500">{error}</Text>
              </View>
            ) : null
          }
          renderItem={({ item: s }) => (
            <Pressable
              onPress={() => handleSelect(s)}
              disabled={resolving}
              className="px-5 py-4 flex-row items-center active:bg-silver-50 border-b border-silver-100"
            >
              <Ionicons name="location" size={18} color="#047857" />
              <View className="ml-3 flex-1">
                <Text className="text-base font-semibold text-ink-900" numberOfLines={1}>
                  {s.label}
                </Text>
                {s.secondary ? (
                  <Text className="text-xs text-silver-500" numberOfLines={1}>
                    {s.secondary}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
