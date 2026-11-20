// Holding a closing overlay for its exit (5 Nov 2026 feel-motion: menus, dialogs and pickers vanished in one frame
// while everything arrives softly): when the value goes to null, the last one is kept for its 120ms fade, then let
// go. Without movement nothing is held. The held element wears data-nv-leaving (styles/kit.css).

import { useEffect, useState } from 'react';

export function useLeaving<T>(value: T | null, ms = 140): { value: T | null; leaving: boolean } {
  const [held, setHeld] = useState<T | null>(value);
  useEffect(() => {
    if (value) {
      setHeld(value);
      return;
    }
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setHeld(null);
      return;
    }
    const t = setTimeout(() => setHeld(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  if (value) return { value, leaving: false };
  return { value: held, leaving: held !== null };
}
