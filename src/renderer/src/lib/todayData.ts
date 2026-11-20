// Today's answer, read once and kept for every opener (t146, 9 Nov 2026): every Tasks, Note, Graph,
// Project and Today open asked the bridge for the day again — the same answer, over and over, each with
// its own re-render inside the switch. The same revision at the same day under the same settings is the
// same answer; anything changed reads again. Read-only: every opener only reads what it keeps.
import { isoOf } from '../../../shared/hub';
import { DEFAULT_PREFS, type Prefs } from '../../../shared/prefs';
import type { TodayData } from '../../../shared/today';
import { getState } from '../state/store';

let kept: { revision: number; day: string; prefs: Prefs; data: TodayData } | null = null;

const keyNow = () => {
  const s = getState();
  return { revision: s.revision, day: isoOf(Date.now()), prefs: s.settings?.prefs ?? DEFAULT_PREFS };
};

/** Today's answer as kept, if it is still the answer (a warm mount's first paint). */
export function todayDataSync(): TodayData | null {
  const k = kept;
  if (!k) return null;
  const now = keyNow();
  return k.revision === now.revision && k.day === now.day && k.prefs === now.prefs ? k.data : null;
}

/** Today's answer, over the bridge once per revision, day and settings. Rejects as the bridge does. */
export function todayData(): Promise<TodayData> {
  const sync = todayDataSync();
  if (sync) return Promise.resolve(sync);
  const key = keyNow();
  return window.nv.today.data().then((d) => {
    // Kept only when nothing moved while reading (a change landing mid-read leaves no stale entry;
    // the revision's own effects read again where they listen).
    const now = keyNow();
    if (now.revision === key.revision && now.day === key.day && now.prefs === key.prefs) kept = { ...key, data: d };
    return d;
  });
}
