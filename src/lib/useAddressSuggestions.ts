// =============================================================================
// useAddressSuggestions — address suggestions for whatever is typed in a field.
//
// Shared by every address field in the app (the booking search sheet and the
// inline autocomplete), so they all behave the same way and are equally fast:
//
//   • Text searched earlier in this session shows its suggestions instantly.
//   • Otherwise the search goes out after a short pause in typing, not on
//     every single keystroke.
//   • While that answer is on its way, the suggestions already on screen are
//     narrowed to the ones that still fit, so the list keeps up with the
//     keyboard instead of freezing on stale rows.
//   • An answer that arrives late, for text that has since changed, is
//     dropped instead of overwriting newer suggestions.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import {
  narrowSuggestions,
  rememberedSearch,
  searchAlberta,
  type GeocodeResult,
} from './geocoding';

/** How long typing has to pause before the server is asked. */
const TYPING_PAUSE_MS = 200;

/** Shortest text worth searching for. Matches the server's own minimum. */
const MIN_SEARCH_LENGTH = 3;

export type SuggestionOutcome =
  /** Nothing to report yet: too little text, or an answer is on its way. */
  | 'idle'
  /** The search answered with at least one suggestion. */
  | 'results'
  /** The search answered, and nothing matched. */
  | 'empty'
  /** The search could not be reached at all. */
  | 'offline';

export interface AddressSuggestions {
  suggestions: GeocodeResult[];
  /** True while an answer for the current text is still on its way. */
  loading: boolean;
  outcome: SuggestionOutcome;
}

const NOTHING: AddressSuggestions = { suggestions: [], loading: false, outcome: 'idle' };

export function useAddressSuggestions(text: string, enabled = true): AddressSuggestions {
  const [state, setState] = useState<AddressSuggestions>(NOTHING);
  // Bumped on every change. An answer only counts if its number is still the
  // newest one when it arrives.
  const newest = useRef(0);

  useEffect(() => {
    const mine = ++newest.current;
    const query = text.trim();

    if (!enabled || query.length < MIN_SEARCH_LENGTH) {
      setState(NOTHING);
      return;
    }

    const remembered = rememberedSearch(query);
    if (remembered) {
      setState({
        suggestions: remembered,
        loading: false,
        outcome: remembered.length > 0 ? 'results' : 'empty',
      });
      return;
    }

    setState((shown) => ({
      suggestions: narrowSuggestions(shown.suggestions, query),
      loading: true,
      outcome: 'idle',
    }));

    const timer = setTimeout(() => {
      searchAlberta(query)
        .then((results) => {
          if (newest.current !== mine) return;
          setState({
            suggestions: results,
            loading: false,
            outcome: results.length > 0 ? 'results' : 'empty',
          });
        })
        .catch(() => {
          if (newest.current !== mine) return;
          setState({ suggestions: [], loading: false, outcome: 'offline' });
        });
    }, TYPING_PAUSE_MS);

    return () => clearTimeout(timer);
  }, [text, enabled]);

  return state;
}
