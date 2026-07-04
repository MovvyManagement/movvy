'use client';

// =============================================================================
// MobileTopBar — hamburger + slide-in nav drawer for < md screens. The desktop
// sidebar is hidden on mobile (md:flex); this gives phone triage without
// duplicating the whole sidebar. Links are passed in from the server layout so
// gating (management-only items) stays server-side.
// =============================================================================

import { useState } from 'react';
import Link from 'next/link';
import { logout } from '../login/actions';

export interface MobileLink { href: string; label: string; badge?: number }

export function MobileTopBar({ links, userLabel }: { links: MobileLink[]; userLabel: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <div className="flex items-center justify-between px-4 h-14 bg-white border-b border-zinc-200 sticky top-0 z-30">
        <Link href="/admin-management/dashboard" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">M</div>
          <span className="text-sm font-bold text-zinc-900">Movvy Ops</span>
        </Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="h-9 w-9 rounded-lg hover:bg-zinc-100 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute right-0 top-0 h-full w-72 bg-white shadow-xl p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-zinc-500 truncate">{userLabel}</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="h-8 w-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto">
              {links.map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-700 hover:bg-zinc-100">
                  <span>{l.label}</span>
                  {l.badge ? <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">{l.badge > 99 ? '99+' : l.badge}</span> : null}
                </Link>
              ))}
            </nav>
            <form action={logout} className="pt-2 border-t border-zinc-100">
              <button className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100">Sign out</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
