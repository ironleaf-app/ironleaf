// Pickers opened from anywhere (a folder to move into, a note to merge into, a template, a file for a canvas card):
// the same keyboard-first list as the quick switcher, returning what was picked.

import { useSyncExternalStore, type ReactNode } from 'react';
import { fuzzyFilter } from '../lib/fuzzy';
import { useLeaving } from '../lib/useLeaving';
import { Picker, type PickerItem } from './Picker';

interface Pending {
  placeholder: string;
  items(query: string): PickerItem[];
  extraRow?(query: string): { label: string; run(): void } | null;
  footer?: ReactNode;
  resolve(id: string | null): void;
}

let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function pick(options: Omit<Pending, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    current?.resolve(null);
    current = { ...options, resolve };
    emit();
  });
}

/** A pick left open when the page changes is cancelled (sweep 058 on: the "What kind of doc?" picker
 *  floated over every later page). The promise settles as a cancel, so its caller simply stops. */
export function cancelPick(): void {
  if (!current) return;
  const p = current;
  current = null;
  emit();
  p.resolve(null);
}

function done(id: string | null): void {
  const p = current;
  current = null;
  emit();
  p?.resolve(id);
}

export function PickerHost() {
  const p = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  const held = useLeaving(p);
  const show = held.value;
  if (!show) return null;
  return (
    <div className="nv-leave-wrap" data-nv-leaving={held.leaving ? 'true' : undefined} inert={held.leaving}>
      <Picker
        placeholder={show.placeholder}
        items={show.items}
        extraRow={show.extraRow ? (q) => {
          const row = show.extraRow!(q);
          return row ? { label: row.label, run: () => { done(null); row.run(); } } : null;
        } : undefined}
        footer={show.footer}
        onPick={(item) => done(item.id)}
        onClose={() => done(null)}
      />
    </div>
  );
}

/** A folder to move something into ('' is the top of the notes); null when cancelled. */
export async function pickFolder(folders: string[], moving?: string): Promise<string | null> {
  const choices = ['', ...folders].filter((f) => !moving || (f !== moving && !f.startsWith(`${moving}/`)));
  const id = await pick({
    placeholder: 'Move to which folder?',
    items: (q) =>
      fuzzyFilter(choices, q, (f) => f || '/').map((f) => ({ id: `folder:${f}`, label: f || 'The top of your notes', detail: f ? undefined : '/' })),
    footer: <span>↑↓ to move · Enter to choose · Esc to cancel</span>,
  });
  return id === null ? null : id.slice('folder:'.length);
}

/** A file among the notes (notes first), for links, merges and canvas cards. */
export async function pickFile(placeholder: string, paths: string[], titleOf: (p: string) => string): Promise<string | null> {
  const id = await pick({
    placeholder,
    items: (q) =>
      fuzzyFilter(paths, q, (p) => `${titleOf(p)} ${p}`).map((p) => ({ id: p, label: titleOf(p), detail: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : undefined })),
    footer: <span>↑↓ to move · Enter to choose · Esc to cancel</span>,
  });
  return id;
}
