// Publications in the window (Wave 6 part a, 24 Oct 2026): what the page reads from the main side (src/main/publications.ts
// pub:state), which publication and edition are being worked on, and the one way a change is made and said.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PubState } from '../../../../../main/publications';
import { moduleChanged, useModuleTick } from '../../../state/modules';
import { errorMessage } from '../../../lib/errors';
import { showError, toast, useApp } from '../../../state/store';

// Which publication is shown and which edition is open in the builder (kept while the tab moves between parts).
let chosen: { pub: string; edition: string } = { pub: '', edition: '' };
const listeners = new Set<() => void>();
export function choose(next: Partial<typeof chosen>): void {
  chosen = { ...chosen, ...next };
  listeners.forEach((fn) => fn());
}
export function useChosen(): typeof chosen {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => chosen,
  );
}

export function usePub(): { state: PubState | null; failed: string | null; reload(): void } {
  const tick = useModuleTick();
  const revision = useApp((s) => s.revision);
  const { pub } = useChosen();
  const [state, setState] = useState<PubState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        void window.nv.pub.state(pub || undefined).then(
          (s) => {
            if (!live) return;
            setState(s);
            setFailed(null);
            if (s.current && s.current.pub.path !== chosen.pub) chosen = { ...chosen, pub: s.current.pub.path };
          },
          (err) => live && setFailed(errorMessage(err)),
        ),
      state ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, revision, again, pub]);
  useEffect(() => window.nv.modules.onChanged((m) => m === 'publications' && setAgain((x) => x + 1)), []);
  return { state, failed, reload: useCallback(() => setAgain((x) => x + 1), []) };
}

/** A change made, said, and the page read again. */
export async function act<T>(run: () => Promise<T>, said?: string | ((v: T) => string)): Promise<T | undefined> {
  try {
    const v = await run();
    moduleChanged();
    if (said) toast(typeof said === 'function' ? said(v) : said);
    return v;
  } catch (err) {
    showError(err);
    return undefined;
  }
}

/** Sending shown plainly (9.2 uplift F51): one suffix and one sentence while sending isn't connected (sending
 *  goes through the host app), never engine names. */
export const SEND_BLOCKED_SUFFIX = '(needs connecting)';
export const SEND_BLOCKED_WORDS = 'Sending isn’t set up on this PC; until it is, the setting is kept and sending says when it couldn’t go.';

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const KIND_ICON: Record<string, import('../../../components/Icon').IconName> = {
  story: 'newspaper',
  brief: 'text',
  weather: 'sun',
  sports: 'table',
  image: 'image',
  cartoon: 'frame',
  crossword: 'grid',
  sudoku: 'numbered',
  wordsearch: 'search',
  dailyword: 'dice',
  quote: 'quote',
  onthisday: 'history',
};
