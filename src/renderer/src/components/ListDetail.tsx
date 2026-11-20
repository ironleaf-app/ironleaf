// List and detail (20 Nov 2026, on a ~2000 px monitor). A list page on a wide window is the list at --w-content
// with the chosen row's detail beside it at --w-side or more (styles/page-frame.css .nv-split): the detail is as
// tall as the window, so a short list never leaves a cavern under it and a long row never runs 2,000 px to its
// date. Below the split width the detail folds away and the list stands alone, as before. One shape for every list
// page (People, Projects, Meetings, Bookmarks): the page passes its list and the record its chosen row names.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ReadingView } from './ReadingView';
import * as A from '../state/actions';
import { requestSearch } from '../state/modals';
import type { RecordPeek, RecordRef } from '../../../shared/records';
import { TYPE_WORDS } from '../../../shared/records';
import { docs } from '../state/docs';
import { openRecordPage, peek } from '../state/peek';
import { useApp } from '../state/store';
import { Icon } from './Icon';
import { usePanesMark } from '../lib/panesMark';
import { ConnectedGroupList, TYPE_ICONS } from './Peek';

/** The note's opening words: its first plain paragraph (no properties, headings, lists, tasks or quotes), cut at a
 *  sentence near 280 characters, so the detail reads a line or two of prose, never the note's markup run together. */
export function openingWords(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const para of body.split(/\r?\n\s*\r?\n/)) {
    const lines = para.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || lines.some((l) => /^(#|[-*+] |\d+[.)] |>|\||```|!\[\[|%%)/.test(l))) continue;
    const words = lines.join(' ').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[*_`]/g, '').trim();
    if (words.length < 12) continue;
    if (words.length <= 280) return words;
    const cut = words.slice(0, 280);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    return end > 120 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return '';
}

/** A list this short once read its detail under it (round 2). Round 3 keeps the list and detail side by side in
 *  full-height panes at every length; the number stays for the pages that pass it. */
export const SHORT_LIST = 4;

/** Where the panes go three across: list | detail | context, from this frame width (px). Fluid below it. */
export const THREE_PANES = 2200;

/** The third pane (round 3): a detail shown in a ListDetail at a very wide frame puts what it connects to here. */
const ContextPane = createContext<HTMLElement | null>(null);
export const useContextPane = () => useContext(ContextPane);
export const ContextPaneProvider = ContextPane.Provider;

/** The list with its detail beside it, as app panes (layout round 3, 20 Nov 2026, at 3440x1400): the page's head
 *  stays compact at the top and the panes fill the window to its foot, each scrolling inside itself
 *  (styles/panes.css). From THREE_PANES of frame width the detail's connections (people, files, projects,
 *  timeline) stand in a third pane instead of tiny columns inside the detail. Narrow, the detail folds away and
 *  the list stands alone in its pane. */
export function ListDetail({ list, detail, label, className, context = true }: { list: ReactNode; detail: ReactNode; label: string; className?: string; /** Whether the detail has connections for a third pane (a template's preview has none). */ context?: boolean; /** How many rows the list shows (kept for the pages that pass it). */ rows?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [three, setThree] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  usePanesMark(box);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setThree(context && el.clientWidth >= THREE_PANES));
    ro.observe(el);
    return () => ro.disconnect();
  }, [context]);
  return (
    <div ref={box} className={`nv-split is-panes nv-panes-root${three ? ' is-three' : ''}${context ? '' : ' no-context'}${className ? ` ${className}` : ''}`} data-panes={three ? 3 : 2}>
      <div className="nv-split-main nv-pane">{list}</div>
      <aside className="nv-split-side nv-pane" aria-label={label}>
        <div className="nv-split-side-inner">
          <ContextPane.Provider value={three ? slot : null}>{detail}</ContextPane.Provider>
        </div>
      </aside>
      {three && <aside ref={setSlot} className="nv-split-context nv-pane" aria-label="What it connects to" />}
    </div>
  );
}

/** A record's detail: what it is, its facts, its opening words and what it connects to, with Open. Read from the
 *  same peek the floating peek reads (src/shared/records.ts), so the two never disagree. */
export function RecordDetail({ refTo, actions, empty, onOpen, extra }: { refTo: RecordRef | null; actions?: ReactNode; empty?: ReactNode; /** More the page knows about it, after its words (a coming meeting's prep). */ extra?: ReactNode; /** The page's own way to open it (a person opens their People page). */ onOpen?(newTab: boolean): void }) {
  const revision = useApp((s) => s.revision);
  const key = refTo ? JSON.stringify(refTo) : '';
  const [data, setData] = useState<{ key: string; peek: RecordPeek | null } | null>(null);
  useEffect(() => {
    if (!refTo) return;
    let alive = true;
    // A short wait, so running the pointer down the list does not ask for every row on the way.
    const t = window.setTimeout(() => {
      void window.nv.records.peek(refTo).then(
        (p) => alive && setData({ key, peek: p }),
        () => alive && setData({ key, peek: null }),
      );
    }, 90);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // The ref is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  // The last record stays until the next one is read, so moving down the list never flashes an empty pane.
  const shown = data?.peek ?? null;
  const record = shown?.record ?? null;
  // A whole note reads in the pane, as a reading pane does (round 3: the detail fills the window's height with the
  // note itself, never two lines of opening words and a blank below); a task or a decision reads the note it is in.
  const leadPath = record && record.type !== 'file' && /\.md$/i.test(record.path) ? record.path : null;
  const [body, setBody] = useState<string>('');
  useEffect(() => {
    if (!leadPath) {
      setBody('');
      return;
    }
    let alive = true;
    let off = () => {};
    void docs
      .acquire(leadPath)
      .then((t) => {
        if (!alive) {
          docs.release(leadPath);
          return;
        }
        setBody(t);
        off = docs.subscribe(leadPath, (next) => setBody(next));
      })
      .catch(() => alive && setBody(''));
    return () => {
      alive = false;
      off();
      docs.release(leadPath);
    };
  }, [leadPath]);
  const slot = useContextPane();
  if (!refTo) return <div className="nv-detail is-empty">{empty}</div>;
  if (!record) return <div className="nv-detail is-loading" aria-busy="true" />;
  const facts = record.facts.filter((f) => f.value && f.key !== 'title').slice(0, 8);
  const groups = (shown?.groups ?? []).filter((g) => g.items.length);
  const reading = leadPath ? readingBody(body, record.title) : '';
  const groupList =
    groups.length > 0 ? (
      <div className="nv-detail-groups">
        {groups.map((g) => (
          <ConnectedGroupList key={`${record.id}:${g.key}`} g={g} self={record} shownAtFirst={slot ? 12 : 4} onOpen={(r, page) => (page ? openRecordPage(r, 'tab') : peek({ id: r.id }, { title: r.title, type: r.type }))} />
        ))}
      </div>
    ) : null;
  return (
    <article className="nv-detail" aria-label={record.title}>
      <header className="nv-detail-head">
        <span className="nv-detail-icon" aria-hidden="true">
          <Icon name={TYPE_ICONS[record.type]} size={16} />
        </span>
        <div className="nv-detail-words">
          <span className="nv-detail-kind">{record.kind ?? TYPE_WORDS[record.type]}{shown?.projectTitle ? ` · ${shown.projectTitle}` : ''}</span>
          <h2 className="nv-detail-title">{record.title}</h2>
        </div>
      </header>
      <div className="nv-detail-actions">
        <button type="button" className="button primary small" onClick={(e) => (onOpen ? onOpen(e.ctrlKey || e.metaKey) : openRecordPage(record, e.ctrlKey || e.metaKey ? 'tab' : 'current'))}>
          Open
        </button>
        {actions}
      </div>
      {facts.length > 0 && (
        <dl className="nv-detail-facts">
          {facts.map((f) => (
            <div key={f.key} className="nv-detail-fact">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!slot && groupList}
      {reading ? (
        <ReadingView className="nv-detail-read" text={reading} path={leadPath!} interactive={false} onOpenLink={(target, newTab) => void A.openLink(target, leadPath!, newTab ? 'tab' : 'current')} onOpenTag={(tag) => requestSearch(`tag:#${tag}`)} />
      ) : null}
      {extra}
      {!slot && !groupList && !reading && !extra && <p className="nv-detail-quiet">Nothing connected to it yet.</p>}
      {slot &&
        createPortal(
          <div className="nv-context">
            <h3 className="nv-context-head">What it connects to</h3>
            {groupList ?? <p className="nv-detail-quiet">Nothing connected to it yet.</p>}
          </div>,
          slot,
        )}
    </article>
  );
}

/** The note's words for the reading pane: no properties block, and no first heading that only repeats its title
 *  (the detail's own head names it). Empty when nothing is left to read. */
export function readingBody(text: string, title: string): string {
  let body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const h = /^\s*#\s+(.+?)\s*(?:\r?\n|$)/.exec(body);
  if (h && h[1].trim().toLowerCase() === title.trim().toLowerCase()) body = body.slice(h[0].length);
  return body.trim() ? body : '';
}

/** An element's own width, measured (a container's: the chat column and a folded side bar are counted). */
export function useWidth(): [(el: HTMLElement | null) => void, number, HTMLElement | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth / 8) * 8));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w, el];
}

/** What a record connects to (people, projects, files, its timeline), as the detail's groups read, on its own: the
 *  meeting page's far-right region (round 3). */
export function RecordConnections({ refTo, shownAtFirst = 8 }: { refTo: RecordRef; shownAtFirst?: number }) {
  const revision = useApp((s) => s.revision);
  const key = JSON.stringify(refTo);
  const [p, setP] = useState<RecordPeek | null>(null);
  useEffect(() => {
    let alive = true;
    void window.nv.records.peek(refTo).then(
      (x) => alive && setP(x),
      () => alive && setP(null),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  const record = p?.record;
  const groups = (p?.groups ?? []).filter((g) => g.items.length);
  if (!record || !groups.length) return null;
  return (
    <div className="nv-detail-groups">
      {groups.map((g) => (
        <ConnectedGroupList key={`${record.id}:${g.key}`} g={g} self={record} shownAtFirst={shownAtFirst} onOpen={(r, page) => (page ? openRecordPage(r, 'tab') : peek({ id: r.id }, { title: r.title, type: r.type }))} />
      ))}
    </div>
  );
}

/** A value that follows another after it has held still for `ms` (a list's hovered row, so running the pointer down
 *  the list does not load every row's detail on the way). */
export function useSettled<T>(value: T, ms = 140): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A window with the room for panes that fill it (round 3): wide and tall enough that a dashboard's blocks become
 *  window-tall panes showing all they hold, instead of three rows each and a blank half under them. */
export function useRoomy(query = '(min-width: 1800px) and (min-height: 900px)'): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, [query]);
  return on;
}
