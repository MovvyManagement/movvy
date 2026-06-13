// =============================================================================
// HiddenAdminTrigger — the founder's secret door into the admin console.
//
// Wraps an existing UI element (the footer Movvy logo, in this case) and
// routes to /admin-management/login when triple-clicked within 600ms.
// Visitors clicking it once or twice get the normal anchor behavior
// (a no-op since the wrapped element doesn't do anything else). The
// trigger leaves zero visible affordance — no cursor change, no
// tooltip, no border. The only way to discover it is to know it exists.
//
// Keyboard fallback: Ctrl+Shift+M (or ⌘+Shift+M on macOS) anywhere on
// the page also navigates. Useful when the footer is offscreen.
// =============================================================================

'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const TRIPLE_CLICK_WINDOW_MS = 600;

export function HiddenAdminTrigger({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const clickCount = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard shortcut. Cmd/Ctrl+Shift+M works from any page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key.toLowerCase() === 'm' &&
        e.shiftKey &&
        (e.metaKey || e.ctrlKey)
      ) {
        e.preventDefault();
        router.push('/admin-management/login');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  function handleClick() {
    clickCount.current += 1;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (clickCount.current >= 3) {
      clickCount.current = 0;
      router.push('/admin-management/login');
      return;
    }
    // Reset the counter if the next click doesn't land in the window.
    resetTimer.current = setTimeout(() => {
      clickCount.current = 0;
    }, TRIPLE_CLICK_WINDOW_MS);
  }

  return (
    <span onClick={handleClick} className="cursor-default select-none">
      {children}
    </span>
  );
}
