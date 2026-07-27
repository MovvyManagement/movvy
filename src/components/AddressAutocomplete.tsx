import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
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
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (result: GeocodeResult) => void;
  leftDotColor?: string;
}

export function AddressAutocomplete({
  label,
  placeholder = 'Start typing an address',
  value,
  onChangeText,
  onSelect,
  leftDotColor = '#0A0A0A',
}: Props) {
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSearch = useRef(false);

  // Debounced search whenever value changes
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    const q = value.trim();
    if (q.length < 3) {
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
        const results = await searchCalgary(q, ctrl.signal);
        setSuggestions(results);
        setOpen(true);
        // Distinguish "still typing" (no error) from "really nothing"
        // (helpful nudge). 6+ chars feels committed; shorter is mid-type.
        if (results.length === 0) {
          setError(q.length >= 6 ? 'No matching addresses — try a different one' : null);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setError('Address search is offline — type the full address manually');
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value]);

  const handleSelect = async (r: GeocodeResult) => {
    haptic.success();

    // Google autocomplete predictions carry NO coordinates — only a place_id.
    // The booking flow needs lat/lng (pricing distance, map pins, city routing),
    // so resolve the place_id to real coordinates before committing. Nominatim
    // results already have coords and skip straight through.
    let final = r;
    if (needsResolution(r)) {
      setResolving(true);
      setError(null);
      const resolved = await resolvePlaceId(r.place_id!);
      setResolving(false);
      if (!resolved) {
        // Keep the dropdown open — never commit a coord-less address, or the
        // booking silently breaks downstream (NaN distance, no pins).
        setError('Couldn’t pin that address — try another suggestion');
        return;
      }
      final = resolved;
    }

    skipNextSearch.current = true;
    const { city } = cityProvinceFromGeocode(final);
    onChangeText(`${final.label}${city ? `, ${city}` : ''}`.trim());
    onSelect(final);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-2 text-sm font-semibold text-ink-900">{label}</Text>
      ) : null}

      {/* Input */}
      <View
        className="flex-row items-center rounded-2xl border bg-white px-4 border-silver-200"
        style={{ minHeight: 52 }}
      >
        <View className="mr-3 h-3 w-3 rounded-full" style={{ backgroundColor: leftDotColor }} />
        <TextInput
          value={value}
          onChangeText={(t) => {
            onChangeText(t);
            setOpen(true);
          }}
          placeholder={placeholder}
          placeholderTextColor="#A1A1AA"
          className="flex-1 text-base text-ink-900"
          style={{ paddingVertical: 14 }}
          autoCorrect={false}
          autoCapitalize="words"
        />
        {loading || resolving ? (
          <ActivityIndicator size="small" color="#71717A" />
        ) : value ? (
          <Pressable
            onPress={() => {
              onChangeText('');
              setSuggestions([]);
              setOpen(false);
              setError(null);
            }}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color="#A1A1AA" />
          </Pressable>
        ) : null}
      </View>

      {/* Dropdown */}
      {open && (suggestions.length > 0 || error) ? (
        <View className="mt-2 rounded-2xl border border-silver-200 bg-white overflow-hidden">
          {error && suggestions.length === 0 ? (
            <View className="flex-row items-center px-4 py-3">
              <Ionicons name="information-circle-outline" size={16} color="#A1A1AA" />
              <Text className="ml-2 text-sm text-silver-500">{error}</Text>
            </View>
          ) : null}

          {suggestions.map((s, idx) => (
            <Pressable
              key={s.id}
              onPress={() => handleSelect(s)}
              disabled={resolving}
              className={`px-4 py-3 flex-row items-center active:bg-silver-50 ${
                idx < suggestions.length - 1 ? 'border-b border-silver-100' : ''
              }`}
            >
              <Ionicons name="location" size={16} color="#047857" />
              <View className="ml-3 flex-1">
                <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
                  {s.label}
                </Text>
                {s.secondary ? (
                  <Text className="text-xs text-silver-500" numberOfLines={1}>
                    {s.secondary}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}

          <View className="flex-row items-center px-3 py-2 bg-silver-50">
            <Ionicons name="location-outline" size={10} color="#A1A1AA" />
            <Text className="ml-1.5 text-[10px] text-silver-400">
              Alberta-wide address search
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
