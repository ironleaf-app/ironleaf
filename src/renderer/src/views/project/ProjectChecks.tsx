// Catch-up on the project page (10.0 item 19: "a project page that keeps itself up to date"). The banner under the
// header and the Overview tile share this: the page's checks from `projects:checks` (standing checks plus proposals
// from the notes changed since it was last updated), an inline review, and per-PC dismissal memory. Accepting writes
// through the page's own edits with Undo; leaving dismisses here only; nothing is ever applied silently. Kit classes
// only (suggestion-bar, card, trow, button small): no new CSS.

import { useCallback, useEffect, useState } from 'react';
import type { ProjectEdit } from '../../../../shared/project-file';
import type { ItemRef } from '../../../../shared/project-hub';
import { capProposals, catchupWords, moreWords, type CatchProposal, type ProjectCheckState, type StandingCheck } from '../../../../shared/project-checks';
import { Icon } from '../../components/Icon';
import { toast, useApp } from '../../state/store';
import { useEditor } from './Inline';

/** This project's checks, re-read whenever the notes change (the revision tick) or the project is edited. */
export function useProjectCheckState(path: string, version: string): ProjectCheckState | null {
  const revision = useApp((s) => s.revision);
  const [state, setState] = useState<ProjectCheckState | null>(null);
  useEffect(() => {
    let live = true;
    window.nv.projects
      .checks()
      .then((all) => live && setState(all.find((s) => s.path === path) ?? null), () => live && setState(null));
    return () => void (live = false);
  }, [path, revision, version]);
  return state;
}

// ── Dismissal memory (this PC only, a convenience: the worst a cleared store does is show the lines again) ─────────

const storeKey = (path: string) => `nv:project-checks:${path}`;
const listeners = new Set<() => void>();
const readDismissed = (path: string): Set<string> => {
  try {
    const raw = localStorage.getItem(storeKey(path));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
};
const writeDismissed = (path: string, keys: Set<string>) => {
  try {
    localStorage.setItem(storeKey(path), JSON.stringify([...keys].slice(0, 500)));
  } catch {
    // Not kept: the lines show again next time.
  }
  listeners.forEach((fn) => fn());
};

/** The proposal keys left alone on this PC (read fresh: dismissing anywhere updates everywhere). */
export function readDismissedKeys(path: string): Set<string> {
  return readDismissed(path);
}

export function useDismissedKeys(path: string): { has(key: string): boolean; dismiss(key: string): void; dismissAll(keys: string[]): void; restore(keys: string[]): void } {
  const [, setN] = useState(0);
  useEffect(() => {
    const fn = () => setN((n) => n + 1);
    listeners.add(fn);
    const onStorage = (e: StorageEvent) => e.key === storeKey(path) && setN((n) => n + 1);
    window.addEventListener('storage', onStorage);
    return () => void (listeners.delete(fn), window.removeEventListener('storage', onStorage));
  }, [path]);
  return {
    has: (key) => readDismissed(path).has(key),
    dismiss: (key) => {
      const keys = readDismissed(path);
      keys.add(key);
      writeDismissed(path, keys);
    },
    dismissAll: (keys) => writeDismissed(path, new Set([...readDismissed(path), ...keys])),
    restore: (keys) => {
      const left = readDismissed(path);
      keys.forEach((k) => left.delete(k));
      writeDismissed(path, left);
    },
  };
}

// ── The review ───────────────────────────────────────────────────────────────────────────────────────────────────────

function ProposalRow({ p, onAccept, onLeave }: { p: CatchProposal; onAccept(): void; onLeave(): void }) {
  const { canEdit } = useEditor();
  return (
    <div className="trow">
      <span className="t clip">
        {p.what}
        {p.who ? ` · ${p.who}` : ''}
        {p.when ? ` · by ${p.when}` : ''}
        <span className="meta clip"> · From {p.from}</span>
      </span>
      {p.kind === 'decision' && <span className="tag slate">decision</span>}
      {canEdit && (
        <>
          <button type="button" className="button small" title={p.kind === 'decision' ? 'Log it on the Decisions tab' : 'Add it to What’s next'} onClick={onAccept}>
            Add
          </button>
          <button type="button" className="button small" title="Leave the project as it is" onClick={onLeave}>
            Leave it
          </button>
        </>
      )}
    </div>
  );
}

function CheckRow({ c, onOpen }: { c: StandingCheck; onOpen(): void }) {
  return (
    <div className="trow">
      <span className="t clip">
        {c.words} <span className="meta clip">{c.detail}</span>
      </span>
      <button type="button" className="button small" title="Open it where it sits" onClick={onOpen}>
        Open
      </button>
    </div>
  );
}

function useReview(path: string, state: ProjectCheckState | null) {
  const { edit } = useEditor();
  const dismissed = useDismissedKeys(path);
  const waiting = (state?.proposals ?? []).filter((p) => !dismissed.has(p.key));
  const accept = useCallback(
    (p: CatchProposal) => {
      const item = p.kind === 'decision' ? { what: p.what } : { what: p.what, ...(p.who ? { who: p.who } : {}), ...(p.when ? { when: p.when } : {}) };
      void edit({ kind: 'add', list: p.kind === 'decision' ? 'decisions' : 'next', item } as ProjectEdit);
    },
    [edit],
  );
  const leave = useCallback((p: CatchProposal) => dismissed.dismiss(p.key), [dismissed]);
  const caughtUp = useCallback(() => {
    const keys = waiting.map((p) => p.key);
    if (!keys.length) return;
    dismissed.dismissAll(keys);
    toast('Marked caught up. Nothing on the project was changed.', { label: 'Undo', run: () => dismissed.restore(keys) });
  }, [dismissed, waiting]);
  return { checks: state?.checks ?? [], waiting, accept, leave, caughtUp, updated: state?.updated };
}

/** The banner under the header (every tab): what waits from the notes, with its review. Nothing waits, nothing shows. */
export function ProjectChecksBanner({ version, onOpen }: { version: string; onOpen(ref: ItemRef): void }) {
  const { path, canEdit } = useEditor();
  const state = useProjectCheckState(path, version);
  const { checks, waiting, accept, leave, caughtUp, updated } = useReview(path, state);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!waiting.length && !checks.length) setOpen(false);
  }, [waiting.length, checks.length]);
  if (!state || (!waiting.length && !checks.length)) return null;
  const { shown, more } = capProposals(waiting);
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="suggestion-bar" role="status">
        <Icon name="refresh" size={14} />
        <span className="suggestion-bar-words">
          {catchupWords({ proposals: waiting.length, checks: checks.length, ...(updated ? { updated } : {}) })}
          {more > 0 && <span className="suggestion-bar-stale"> {moreWords(shown.length, waiting.length)}.</span>}
        </span>
        <button type="button" className="suggestion-bar-button primary" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Review'}
        </button>
        {canEdit && waiting.length > 0 && (
          <button type="button" className="suggestion-bar-button" title="Leave everything waiting as it is" onClick={caughtUp}>
            Mark caught up
          </button>
        )}
      </div>
      {open && (
        <div className="card" style={{ marginTop: 8, padding: '4px 14px 8px' }}>
          {checks.map((c, i) => (
            <CheckRow key={`${c.kind}:${i}`} c={c} onOpen={() => onOpen(c.ref)} />
          ))}
          {shown.map((p) => (
            <ProposalRow key={p.key} p={p} onAccept={() => accept(p)} onLeave={() => leave(p)} />
          ))}
          {more > 0 && <p className="vsub">Showing {shown.length} of {waiting.length} ({moreWords(shown.length, waiting.length)}): accept or leave these to see the rest.</p>}
        </div>
      )}
    </div>
  );
}

/** The Overview tile: the same waiting lines, compactly, with the same review. The hub mounts it only when something
 *  waits (it knows the state already), so the layout counts it like any tile. */
export function ProjectChecksTile({ state, onOpen }: { state: ProjectCheckState; onOpen(ref: ItemRef, title?: string): void }) {
  const { path, canEdit } = useEditor();
  const { checks, waiting, accept, leave, caughtUp, updated } = useReview(path, state);
  const [open, setOpen] = useState(false);
  if (!waiting.length && !checks.length) return null;
  const { shown, more } = capProposals(waiting);
  return (
    <section className="ph-tile ph-a-catchup" data-hub-tile="catchup">
      <header className="ph-tile-head">
        <Icon name="refresh" size={14} />
        <h3>Waiting from your notes</h3>
        {waiting.length > 0 && <span className="ph-count">{waiting.length}</span>}
        <span className="ph-space" />
        <button className="ph-tile-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Review'} <Icon name="forward" size={11} />
        </button>
      </header>
      <p className="ph-faint">
        {catchupWords({ proposals: waiting.length, checks: checks.length, ...(updated ? { updated } : {}) })}
        {more > 0 ? ` ${moreWords(shown.length, waiting.length)}.` : ''}
      </p>
      {open && (
        <div>
          {checks.map((c, i) => (
            <CheckRow key={`${c.kind}:${i}`} c={c} onOpen={() => onOpen(c.ref, c.words)} />
          ))}
          {shown.map((p) => (
            <ProposalRow key={p.key} p={p} onAccept={() => accept(p)} onLeave={() => leave(p)} />
          ))}
          {canEdit && waiting.length > 0 && (
            <button type="button" className="button small" title="Leave everything waiting as it is" onClick={caughtUp}>
              Mark caught up
            </button>
          )}
        </div>
      )}
    </section>
  );
}
