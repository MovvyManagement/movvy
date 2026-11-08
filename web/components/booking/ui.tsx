'use client';

// Small building blocks shared by the booking and live tracking pages.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Spinner({ light = false }: { light?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 ${
        light ? 'border-white/30 border-t-white' : 'border-silver-300 border-t-ink-900'
      }`}
    />
  );
}

export function Button({
  children,
  variant = 'primary',
  loading = false,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'green' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  const styles = {
    primary: 'bg-ink-900 text-white hover:bg-ink-700',
    green: 'bg-brand-800 text-white hover:bg-brand-900',
    secondary: 'border border-silver-300 bg-white text-ink-900 hover:border-ink-900',
    ghost: 'text-silver-600 hover:text-ink-900',
    danger: 'bg-red-700 text-white hover:bg-red-800',
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {loading ? <Spinner light={variant === 'primary' || variant === 'green' || variant === 'danger'} /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = '', dark = false }: { children: ReactNode; className?: string; dark?: boolean }) {
  const surface = dark ? 'bg-ink-900 text-white' : 'border border-silver-200 bg-white';
  return <div className={`rounded-3xl p-5 sm:p-6 ${surface} ${className}`}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wider text-silver-500">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink-900">{label}</span>
      <input
        {...rest}
        className={`mt-1.5 block w-full rounded-2xl border bg-white px-4 py-3 text-base text-ink-900 outline-none transition placeholder:text-silver-400 focus:border-brand-800 focus:ring-2 focus:ring-brand-100 ${
          error ? 'border-red-400' : 'border-silver-300'
        } ${rest.className ?? ''}`}
      />
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-700">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-silver-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 text-sm ${strong ? 'font-bold text-ink-900' : 'text-silver-600'}`}>
      <span>{label}</span>
      <span className={strong ? '' : 'font-medium text-ink-900'}>{value}</span>
    </div>
  );
}

/** A panel over the page: a bottom sheet on phones, a centred dialog on desktop. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" />
      <div className="relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-silver-200 px-5 py-4">
          <h2 className="text-lg font-bold text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-silver-100 text-ink-900 hover:bg-silver-200"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
