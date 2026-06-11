import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BookingDraft, MoveType, Address, MoveDetails } from '@/types';

interface BookingState {
  draft: BookingDraft;
  setMoveType: (t: MoveType) => void;
  setPickup: (a: Address) => void;
  setDropoff: (a: Address) => void;
  setDetails: (d: MoveDetails) => void;
  setSchedule: (date: string, timeWindow: string, scheduling: 'asap' | 'scheduled') => void;
  setPromoCode: (code: string) => void;
  reset: () => void;
}

const emptyDraft: BookingDraft = {};

// =============================================================================
// Booking draft store
//
// Persisted to AsyncStorage so a draft survives an app crash, backgrounding,
// or a force-quit. Without this, a customer who's 5 steps deep into the
// booking flow loses everything if the app reloads — terrible UX.
//
// What's stored: just the `draft` slice (addresses, date, type, details,
// promo). Methods don't need persisting. We use Zustand's persist
// middleware with AsyncStorage as the backing store; partialize narrows
// to just `draft` so we never accidentally persist transient handlers.
// =============================================================================
export const useBookingStore = create<BookingState>()(
  persist(
    (set) => ({
      draft: emptyDraft,
      setMoveType: (moveType) => set((s) => ({ draft: { ...s.draft, moveType } })),
      setPickup: (pickup) => set((s) => ({ draft: { ...s.draft, pickup } })),
      setDropoff: (dropoff) => set((s) => ({ draft: { ...s.draft, dropoff } })),
      setDetails: (details) => set((s) => ({ draft: { ...s.draft, details } })),
      setSchedule: (date, timeWindow, scheduling) =>
        set((s) => ({ draft: { ...s.draft, date, timeWindow, scheduling } })),
      setPromoCode: (promoCode) => set((s) => ({ draft: { ...s.draft, promoCode } })),
      reset: () => set({ draft: emptyDraft }),
    }),
    {
      name: 'movvy-booking-draft',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the draft itself, not the setter functions
      partialize: (state) => ({ draft: state.draft }),
      // Bump this when BookingDraft shape changes incompatibly
      version: 1,
    },
  ),
);
