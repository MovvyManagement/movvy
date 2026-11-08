'use client';

import { useEffect, useRef, useState } from 'react';
import { type Address, type AddressMatch, resolveAddress, searchAddresses } from '@/lib/movvy';
import { Spinner } from './ui';

// Live address search, limited to Alberta on the server.
export function AddressField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: Address | null;
  onChange: (address: Address | null) => void;
}) {
  const [text, setText] = useState(value?.line1 ?? '');
  const [matches, setMatches] = useState<AddressMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const skipSearch = useRef(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const query = text.trim();
    if (query.length < 3) {
      setMatches([]);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchAddresses(query, controller.signal);
        setMatches(results);
        setNote(results.length ? null : 'No Alberta address matched. Movvy currently serves Alberta only.');
        setOpen(true);
        setBusy(false);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setNote((e as Error).message);
        setBusy(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = async (match: AddressMatch) => {
    setOpen(false);
    setBusy(true);
    setNote(null);
    try {
      const address = await resolveAddress(match);
      skipSearch.current = true;
      setText(address.line1);
      onChange(address);
    } catch (e) {
      setNote((e as Error).message);
      onChange(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <label className="block">
        <span className="text-sm font-semibold text-ink-900">{label}</span>
        <div className="relative mt-1.5">
          <input
            value={text}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              if (value) onChange(null);
            }}
            onFocus={() => matches.length > 0 && !value && setOpen(true)}
            className="block w-full rounded-2xl border border-silver-300 bg-white py-3 pl-4 pr-11 text-base text-ink-900 outline-none transition placeholder:text-silver-400 focus:border-brand-800 focus:ring-2 focus:ring-brand-100"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            {busy ? (
              <Spinner />
            ) : value ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A7A3E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="Address confirmed">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : null}
          </span>
        </div>
      </label>
      {value ? <p className="mt-1 text-xs text-silver-500">{[value.city, value.postal].filter(Boolean).join(' · ')}</p> : null}
      {note ? <p className="mt-1 text-xs font-medium text-red-700">{note}</p> : null}
      {open && matches.length > 0 ? (
        <ul className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-silver-200 bg-white shadow-xl">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => pick(m)} className="block w-full px-4 py-3 text-left hover:bg-silver-50">
                <span className="block text-sm font-semibold text-ink-900">{m.label}</span>
                {m.secondary ? <span className="block text-xs text-silver-500">{m.secondary}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
