// What the Timeline remembers for this library (src/main/library-state.ts 'timeline'): its zoom, how rows are grouped and
// sorted, the filters, who "mine" is, and whether the list of things to look at is open. Kept in Ironleaf's own data
// folder, never among the notes.

import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { ZOOMS, type GroupBy, type SortBy, type Zoom } from '../../../../shared/timeline';

export interface TimelineMemory {
  zoom: Zoom;
  group: GroupBy;
  sort: SortBy;
  risk: boolean;
  mine: boolean;
  quarter: boolean;
  /** The person "mine" means, as written in the projects. */
  me: string;
  needs: boolean;
}

const DEFAULTS: TimelineMemory = { zoom: 'months', group: 'none', sort: 'due', risk: false, mine: false, quarter: false, me: '', needs: false };
const GROUPS: GroupBy[] = ['status', 'due', 'owner', 'health', 'none'];
const SORTS: SortBy[] = ['due', 'start', 'name', 'health'];

function clean(v: unknown): TimelineMemory {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    zoom: ZOOMS.includes(o.zoom as Zoom) ? (o.zoom as Zoom) : DEFAULTS.zoom,
    group: GROUPS.includes(o.group as GroupBy) ? (o.group as GroupBy) : DEFAULTS.group,
    sort: SORTS.includes(o.sort as SortBy) ? (o.sort as SortBy) : DEFAULTS.sort,
    risk: o.risk === true,
    mine: o.mine === true && typeof o.me === 'string' && !!o.me,
    quarter: o.quarter === true,
    me: typeof o.me === 'string' ? o.me.slice(0, 120) : '',
    needs: o.needs === true,
  };
}

let memory: TimelineMemory | null = null;
let loading: Promise<void> | null = null;
/** The library the memory is for (another one opened reads its own afresh). */
let loadedFor = '';
let timer = 0;
const listeners = new Set<() => void>();

export function useTimelineMemory(): [TimelineMemory | null, (change: Partial<TimelineMemory>) => void] {
  const [, setTick] = useState(0);
  const library = useApp((s) => s.vault?.path ?? '');
  if (library !== loadedFor) {
    loadedFor = library;
    memory = null;
    loading = null;
  }
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    loading ??= window.nv.state
      .load<TimelineMemory>('timeline')
      .catch(() => null)
      .then((saved) => {
        memory = clean(saved);
        listeners.forEach((l) => l());
      });
    return () => void listeners.delete(fn);
  }, [library]);
  const change = (patch: Partial<TimelineMemory>) => {
    memory = { ...(memory ?? DEFAULTS), ...patch };
    listeners.forEach((l) => l());
    clearTimeout(timer);
    timer = window.setTimeout(() => void window.nv.state.save('timeline', memory).catch(() => undefined), 300);
  };
  return [memory, change];
}
