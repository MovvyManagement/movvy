import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * Smoothly interpolates a Marker's coordinate between GPS pings so the pin
 * glides instead of jumping. Used inside LiveMap.native — see usage there.
 *
 * IMPORTANT: react-native-maps' Marker accepts an Animated.AnimatedRegion which
 * we drive with Animated.timing. This file exports a tiny helper around that.
 */

export function useAnimatedCoord(target: { lat: number; lng: number } | null) {
  const ref = useRef<any>(null);
  const animated = useRef<any>(null);

  // Lazy-create the AnimatedRegion only on native (kept out of web bundle)
  useEffect(() => {
    if (animated.current) return;
    try {
      const { AnimatedRegion } = require('react-native-maps');
      if (target) {
        animated.current = new AnimatedRegion({
          latitude: target.lat,
          longitude: target.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    } catch {
      // web build — react-native-maps may not be resolvable
    }
  }, []);

  useEffect(() => {
    if (!target || !animated.current) return;
    if (animated.current.timing) {
      animated.current
        .timing({
          latitude: target.lat,
          longitude: target.lng,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: false,
        })
        .start();
    }
  }, [target?.lat, target?.lng]);

  return { ref, animatedCoord: animated.current };
}
