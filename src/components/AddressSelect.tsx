import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Address } from '@/types';

interface Props {
  options: Address[];
  value?: Address;
  onChange: (a: Address) => void;
  onAddNew?: () => void;
}

export function AddressSelect({ options, value, onChange, onAddNew }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="flex-row gap-2 pr-5">
        {options.map((opt) => {
          const sel = value?.line1 === opt.line1;
          return (
            <Pressable
              key={opt.label + opt.line1}
              onPress={() => onChange(opt)}
              className={`flex-row items-center rounded-2xl border px-3 py-2.5 active:opacity-80 ${
                sel ? 'bg-brand-50 border-brand-600' : 'bg-white border-silver-200'
              }`}
            >
              <View
                className={`h-8 w-8 rounded-xl items-center justify-center ${
                  sel ? 'bg-brand-600' : 'bg-silver-100'
                }`}
              >
                <Ionicons
                  name={opt.label === 'Home' ? 'home' : opt.label === 'Work' ? 'briefcase' : 'location'}
                  size={14}
                  color={sel ? '#fff' : '#0A0A0A'}
                />
              </View>
              <View className="ml-2 max-w-[160px]">
                <Text className={`text-xs font-bold ${sel ? 'text-brand-700' : 'text-ink-900'}`}>
                  {opt.label || 'Saved'}
                </Text>
                <Text className="text-[10px] text-silver-500" numberOfLines={1}>
                  {opt.line1}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {onAddNew ? (
          <Pressable
            onPress={onAddNew}
            className="flex-row items-center rounded-2xl border border-dashed border-silver-300 bg-white px-3 py-2.5 active:opacity-80"
          >
            <View className="h-8 w-8 rounded-xl items-center justify-center bg-silver-100">
              <Ionicons name="add" size={16} color="#0A0A0A" />
            </View>
            <Text className="ml-2 text-xs font-bold text-ink-900">New address</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}
