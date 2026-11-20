// The pieces every record view draws with (24 Oct 2026, Workstream 1 part D): a value as people read it (a status as its
// pill, a person with their initials, a day in words, progress as a bar), a value edited in place — deliberately: a
// double-click, the pencil, or E on a row; one click opens the record (the peek) — and records dragged where it means
// something (src/shared/project-workspace.ts dropPlan), with what a drop will do said while hovering.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { plainText } from '../../../../shared/plain-text';
import { meetingTimeWords } from '../../../../shared/work-meetings';
import type { FieldInfo, FieldType } from '../../../../shared/record-views';
import { fieldLabel, valueOf } from '../../../../shared/record-views';
import type { DropPlan } from '../../../../shared/project-workspace';
import { KIND_WORDS, type FieldValue, type WsRecord } from '../../../../shared/workspace-records';
import { Icon, type IconName } from '../../components/Icon';
import { openMenu, type MenuItem } from '../../components/Menu';
import { initials, personHue } from '../../lib/projectLook';
import { isDoneRecord, toneOf } from '../../lib/recordTone';
import { minPopupTop } from '../../lib/windowButtons';
import { visibleWho } from '../../components/plan/plan';
import * as A from '../../state/actions';

// ── What a view edits and opens with ─────────────────────────────────────────────────────────────────────────────────

export interface RecordCtx {
  canEdit: boolean;
  fields: FieldInfo[];
  /** Fields of a record that can be changed where they show. */
  editable(r: WsRecord): string[];
  /** One field changed (true when written). */
  setField(r: WsRecord, field: string, value: FieldValue): Promise<boolean>;
  open(r: WsRecord, e?: { ctrlKey?: boolean; metaKey?: boolean }): void;
  /** Taking a record out, when it is not a note to bin (Systems rows leave their list). */
  removeRecord?(r: WsRecord): void;
  /** What dropping a record on another (or on a board column's value) would do. */
  plan(dragged: WsRecord, target: { record?: WsRecord; section?: string }): DropPlan | null;
  drop(dragged: WsRecord, target: { record?: WsRecord; section?: string }): void;
  byId: Map<string, WsRecord>;
  people: string[];
  /** Who the person is, so their own name never shows on their own items (SPEC; sweep 3, 017). */
  me?: string | null;
}
export const RecordContext = createContext<RecordCtx | null>(null);
export function useRecords(): RecordCtx {
  const c = useContext(RecordContext);
  if (!c) throw new Error('A record view needs its context.');
  return c;
}

// The Wave 7 part b modules' records (src/shared/life-records.ts).
const LIFE_KIND_ICON = { album: 'image', photo: 'image', creative: 'canvas', release: 'flag', customer: 'person', campaign: 'bolt', post: 'chat', ticket: 'chat', website: 'globe', check: 'check', machine: 'server', service: 'bolt', runbook: 'task', run: 'history', healthnote: 'chart', goal: 'target', habit: 'check', greview: 'review', list: 'list', listitem: 'check' } as const satisfies Record<string, IconName>;
// The Wave 7 part a modules' records (Home, Vehicles, Career, Travel).
const PERSONAL_KIND_ICON = { application: 'briefcase', interview: 'calendar', letter: 'mail', cv: 'idcard', trip: 'plane', booking: 'calendar', expense: 'receipt', appliance: 'bolt', upkeep: 'task', utility: 'bolt', vehicle: 'car', fuel: 'fuel', servicing: 'settings', 'due-date': 'bell' } as const satisfies Record<string, IconName>;
export const KIND_ICON: Record<WsRecord['kind'], IconName> = { action: 'task', milestone: 'flag', workstream: 'layers', meeting: 'calendar', file: 'file', person: 'person', risk: 'warning', decision: 'check', question: 'help', update: 'history', note: 'notes', item: 'table', entry: 'chart', bill: 'receipt', account: 'bank', budget: 'target', spend: 'wallet', document: 'idcard', series: 'history', weekly: 'review', wsweek: 'chart', metric: 'chart', site: 'pin', room: 'grid', device: 'computer', patch: 'branch', vendor: 'briefcase', quote: 'tag', order: 'receipt', contract: 'doc', ...LIFE_KIND_ICON, ...PERSONAL_KIND_ICON };

/** The currency money fields are shown in (Finance's own, src/shared/record-modules.ts; AUD until set). */
let currency = 'AUD';
export const setRecordCurrency = (c: string) => void (currency = /^[A-Z]{3}$/.test(c) ? c : 'AUD');
export function moneyText(v: number): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function typeOf(fields: FieldInfo[], key: string): FieldType {
  if (key === 'title') return 'text';
  return fields.find((f) => f.key === key)?.type ?? 'text';
}

/** A tone for a status-like word (lib/recordTone.ts, pinned by tests/uplift-92-status.test.mjs). */
export { isDoneRecord, toneOf } from '../../lib/recordTone';

/** "Mon 26 Oct", with the year when it isn't this one. */
export function dayWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <span className="ws-avatar" style={{ ['--hue' as string]: personHue(name), width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function StatusPill({ value, field }: { value: FieldValue; field?: string }) {
  if (value === null || value === '') return null;
  return (
    <span className={`ws-pill tone-${toneOf(value, field)}`}>
      <span className="ws-dot" />
      {cap(String(value))}
    </span>
  );
}

/** A value as people read it. */
export function Value({ r, field, fields, compact }: { r: WsRecord; field: string; fields: FieldInfo[]; compact?: boolean }): ReactNode {
  const ctx = useContext(RecordContext);
  const v = field === 'title' ? r.title : (r.fields[field] ?? valueOf(r, field));
  if (v === null || v === '') return null;
  // A meeting's time reads one way, and no time reads as nothing (sweep 3, 015).
  if (field === 'time' && r.kind === 'meeting') {
    const words = meetingTimeWords(String(v));
    return words ? <span className="ws-time">{words}</span> : null;
  }
  // People: up to three names with their initials, then "+N" (sweep 3, 015: a cell stacked 9 names).
  if (field === 'people' && typeof v === 'string') {
    const names = v.split(/,\s*/).map((n) => n.trim()).filter(Boolean).filter((n) => visibleWho(n, ctx?.me) !== '');
    if (names.length > 1) {
      const shown = names.slice(0, 3);
      return (
        <span className="ws-people" title={names.join(', ')}>
          {shown.map((n) => (
            <span key={n} className="ws-person">
              <Avatar name={n} size={compact ? 18 : 20} />
              <span>{n}</span>
            </span>
          ))}
          {names.length > shown.length && <span className="ws-more">+{names.length - shown.length}</span>}
        </span>
      );
    }
  }
  if (field === 'project') return <span className="ws-proj-ref" title={String(v)}>{String(v)}</span>;
  // An open action says nothing about its status (only overdue, due today or done do).
  if (field === 'status' && (r.kind === 'action' || r.kind === 'risk') && /^open$/i.test(String(v)) && compact) return null;
  const type = typeOf(fields, field);
  if (field === 'progress' && typeof v === 'number')
    return (
      <span className="ws-progress" title={`${v}%`}>
        <span className="ws-progress-bar">
          <span style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
        </span>
        <span className="ws-progress-n">{v}%</span>
      </span>
    );
  // A question reads Open or Answered, never a bare No (t248, 12 Nov 2026, structure N5).
  if (field === 'answered' && r.kind === 'question') return v ? <span className="ws-pill tone-ok"><span className="ws-dot" />Answered</span> : <span className="ws-pill"><span className="ws-dot" />Open</span>;
  if (type === 'bool') return v ? <Icon name="check" size={13} className="ws-yes" /> : <span className="ws-faint">No</span>;
  if (type === 'date' && typeof v === 'string') {
    const late = (field === 'due' || field === 'date') && v < todayIso() && !isDoneRecord(r) && r.kind !== 'update' && r.kind !== 'decision' && r.kind !== 'meeting' && r.kind !== 'entry' && r.kind !== 'note';
    return <span className={`ws-day${late ? ' is-late' : ''}`}>{dayWords(v)}</span>;
  }
  if (type === 'status') return <StatusPill value={v} field={field} />;
  if (type === 'person') {
    // The person's own name never shows on their own items (SPEC; sweep 3, 017: every Actions card read "Jesse").
    const shown = visibleWho(String(v), ctx?.me);
    if (!shown) return null;
    return (
      <span className="ws-person">
        <Avatar name={shown} size={compact ? 18 : 20} />
        <span>{shown}</span>
      </span>
    );
  }
  if (type === 'number') return <span className="ws-num">{typeof v === 'number' ? v.toLocaleString('en-AU') : String(v)}</span>;
  if (type === 'money') return <span className={`ws-num ws-money${typeof v === 'number' && v < 0 ? ' is-neg' : ''}`}>{typeof v === 'number' ? moneyText(v) : String(v)}</span>;
  // Words a person reads (sweep 076/086): a value written as a link shows its label, never "[[path|label]]".
  // Clipped words keep their full text on hover (8.6).
  if (type === 'long') return <span className="ws-long" title={plainText(String(v))}>{plainText(String(v))}</span>;
  const text = plainText(String(v));
  return <span title={text}>{text}</span>;
}

// ── Editing a value in place (deliberately) ──────────────────────────────────────────────────────────────────────────

/** The editor for one value: a day picker for days, choices for a status, a name with suggestions, words. */
export function ValueEditor({ r, field, onDone }: { r: WsRecord; field: string; onDone(): void }) {
  const ctx = useRecords();
  const type = typeOf(ctx.fields, field);
  const start = field === 'title' ? r.title : r.fields[field] ?? '';
  const [text, setText] = useState(String(start ?? ''));
  const box = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const opened = useRef(Date.now());
  useLayoutEffect(() => {
    const take = () => {
      box.current?.focus();
      if (type !== 'date') box.current?.select();
    };
    take();
    // The row under it may take the keys as the double-click ends (a draggable row focuses on mouse up): take them back.
    const t = window.setTimeout(take, 0);
    return () => window.clearTimeout(t);
  }, []);
  const save = async (value: FieldValue) => {
    if (done.current) return;
    done.current = true;
    if (String(value ?? '') !== String(start ?? '')) await ctx.setField(r, field, value);
    onDone();
  };
  const listId = `ws-list-${field}`;
  const options = type === 'person' ? ctx.people : ctx.fields.find((f) => f.key === field)?.values ?? [];
  return (
    <span className="ws-editor" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <input
        ref={box}
        type={type === 'date' ? 'date' : type === 'number' || type === 'money' ? 'number' : 'text'}
        value={text}
        aria-label={fieldLabel(field)}
        list={options.length ? listId : undefined}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void save((type === 'number' || type === 'money') && text.trim() ? Number(text) : text.trim());
          if (e.key === 'Escape') {
            done.current = true;
            onDone();
          }
        }}
        onBlur={() => {
          if (Date.now() - opened.current < 250) return void window.setTimeout(() => box.current?.focus(), 0);
          void save((type === 'number' || type === 'money') && text.trim() ? Number(text) : text.trim());
        }}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.slice(0, 40).map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </span>
  );
}

/** Choices for a status-like field as a menu (the values seen, then "Something else…" and "Clear"). */
export function chooseValue(anchor: HTMLElement, ctx: RecordCtx, r: WsRecord, field: string, typeOwn: () => void): void {
  const info = ctx.fields.find((f) => f.key === field);
  const now = String(r.fields[field] ?? '');
  const usual = field === 'status' && r.kind === 'action' ? ['Open', 'Done'] : field === 'status' && r.kind === 'risk' ? ['Open', 'Closed'] : field === 'impact' ? ['High', 'Medium', 'Low'] : [];
  const values = [...new Set([...usual, ...(info?.values ?? [])])].filter((v) => !(r.kind === 'action' && field === 'status' && /^(overdue|due today)$/i.test(v))).slice(0, 14);
  const items: MenuItem[] = [{ heading: fieldLabel(field) }, ...values.map((v) => ({ label: cap(v), checked: v.toLowerCase() === now.toLowerCase(), run: () => void ctx.setField(r, field, v) })), { separator: true }, { label: 'Something else…', icon: 'pencil', run: typeOwn }];
  if (now && field !== 'status') items.push({ label: 'Clear', icon: 'close', run: () => void ctx.setField(r, field, '') });
  openMenu(anchor, items);
}

/**
 * A value in a view that can be changed where it is: shown as read; a double-click or its pencil edits it (a status
 * opens its choices). One click goes to the row (which opens the record).
 */
export function Cell({ r, field, compact }: { r: WsRecord; field: string; compact?: boolean }) {
  const ctx = useRecords();
  const [editing, setEditing] = useState(false);
  const can = ctx.canEdit && ctx.editable(r).includes(field);
  const type = typeOf(ctx.fields, field);
  const startEdit = (anchor: HTMLElement) => {
    if (!can) return;
    if ((type === 'status' || type === 'bool') && field !== 'title') chooseValue(anchor, ctx, r, field, () => setEditing(true));
    else setEditing(true);
  };
  if (editing) return <ValueEditor r={r} field={field} onDone={() => setEditing(false)} />;
  return (
    <span
      className={`ws-cell${can ? ' can-edit' : ''}`}
      data-field={field}
      onDoubleClick={(e) => {
        if (!can) return;
        e.stopPropagation();
        startEdit(e.currentTarget);
      }}
    >
      <Value r={r} field={field} fields={ctx.fields} compact={compact} />
      {can && (r.fields[field] === null || r.fields[field] === undefined || r.fields[field] === '') && field !== 'title' && <span className="ws-empty-val">+</span>}
      {can && (
        <button
          type="button"
          className="ws-pencil"
          tabIndex={-1}
          title={`Edit ${fieldLabel(field).toLowerCase()}`}
          aria-label={`Edit ${fieldLabel(field).toLowerCase()}`}
          onClick={(e) => {
            e.stopPropagation();
            startEdit(e.currentTarget.parentElement as HTMLElement);
          }}
        >
          <Icon name="pencil" size={11} />
        </button>
      )}
    </span>
  );
}

/** An action's tick (an explicit control, so ticking never needs the edit). */
export function Tick({ r }: { r: WsRecord }) {
  const ctx = useRecords();
  if (r.kind !== 'action') return null;
  const done = r.fields.done === true;
  const can = ctx.canEdit && ctx.editable(r).includes('done');
  return (
    <button
      type="button"
      className={`ws-tick${done ? ' is-done' : ''}`}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Put “${r.title}” back on the list` : `Tick off “${r.title}”`}
      disabled={!can}
      onClick={(e) => {
        e.stopPropagation();
        void ctx.setField(r, 'done', !done);
      }}
    >
      {done && <Icon name="check" size={11} />}
    </button>
  );
}

/**
 * One click opens a record (the peek); a double-click edits the value under the pointer instead, so the open waits a
 * moment for a second click and steps aside when one comes.
 */
let pendingOpen = 0;
export function clickOpen(ctx: RecordCtx, r: WsRecord) {
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, .ws-editor, .ws-tick, .ws-pencil')) return;
    window.clearTimeout(pendingOpen);
    if (e.detail > 1) return;
    const keys = { ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    pendingOpen = window.setTimeout(() => ctx.open(r, keys), 240);
  };
}

/** Keys on a focused record: Enter opens it, E edits its name. */
/** A record that is a note or file of its own (a Bill, a Machine, a meeting note): it can be deleted where it is seen. A line
 *  inside a project (an action, a risk) and the project itself never are, so deleting a row can't take a project with it. */
export const ownsNote = (r: WsRecord): boolean => !!r.path && r.path !== r.project;

/** A record's own menu, the same on every layout (26 Oct 2026): open it, open its page, and Delete (to Recently deleted, with
 *  Undo). */
export function rowMenu(ctx: RecordCtx, r: WsRecord): MenuItem[] {
  return [
    { label: 'Open', icon: 'sidebarRight', run: () => ctx.open(r) },
    ...(r.path ? [{ label: 'Open full page', icon: 'external', run: () => A.openPath(r.path!) } as MenuItem] : []),
    ...(ownsNote(r) ? [{ separator: true } as MenuItem, { label: 'Delete', icon: 'trash', danger: true, disabled: !ctx.canEdit, run: () => (ctx.removeRecord ? ctx.removeRecord(r) : void A.trashPath(r.path!)) } as MenuItem] : []),
  ];
}
/** Right-click on a record: its menu at the pointer. */
export function rowContext(ctx: RecordCtx, r: WsRecord) {
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    e.preventDefault();
    openMenu(e, rowMenu(ctx, r));
  };
}

export function rowKeys(ctx: RecordCtx, r: WsRecord, edit: () => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, button.ws-pencil')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      ctx.open(r, e);
    } else if ((e.key === 'Delete' || (e.key === 'Backspace' && (e.ctrlKey || e.metaKey))) && ctx.canEdit && ownsNote(r)) {
      e.preventDefault();
      if (ctx.removeRecord) ctx.removeRecord(r);
      else void A.trashPath(r.path!);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      openMenu(e.currentTarget as HTMLElement, rowMenu(ctx, r));
    } else if ((e.key === 'e' || e.key === 'E' || e.key === 'F2') && !e.ctrlKey && !e.metaKey && ctx.canEdit && ctx.editable(r).length) {
      e.preventDefault();
      edit();
    }
  };
}

// ── Dragging records ─────────────────────────────────────────────────────────────────────────────────────────────────

export const RECORD_MIME = 'application/x-nv-record';
let dragging: WsRecord | null = null;
export const draggedRecord = () => dragging;
export function startDrag(e: React.DragEvent, r: WsRecord): void {
  dragging = r;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(RECORD_MIME, r.id);
  e.dataTransfer.setData('text/plain', r.title);
  document.body.classList.add('ws-dragging');
  // The card may leave the page while it's held (its section closed for another), so its own dragend never comes: the
  // drag ends for us too when anything is dropped, or at the next press of a button or key.
  const done = () => {
    for (const t of ['dragend', 'drop', 'pointerdown', 'keydown']) window.removeEventListener(t, done, true);
    if (dragging === r) window.setTimeout(() => dragging === r && endDrag(), 0);
  };
  for (const t of ['dragend', 'drop', 'pointerdown', 'keydown']) window.addEventListener(t, done, true);
}
export function endDrag(): void {
  dragging = null;
  document.body.classList.remove('ws-dragging');
  setHint(null);
}

// The line under the pointer that says what a drop will do ("Make it Northgate’s next step").
let hintEl: HTMLDivElement | null = null;
export function setHint(words: string | null, x = 0, y = 0): void {
  if (!words) {
    hintEl?.remove();
    hintEl = null;
    return;
  }
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.className = 'ws-drop-hint';
    document.body.appendChild(hintEl);
  }
  hintEl.textContent = words;
  hintEl.style.left = `${x + 14}px`;
  // Never up under the window buttons (8.6.1): below their band.
  hintEl.style.top = `${Math.max(minPopupTop(), y + 16)}px`;
}

/** Props that make an element a drop target for records, with the plan said while over it. */
export function useDropTarget(target: { record?: WsRecord; section?: string } | null, planFor?: (r: WsRecord) => { words: string; run(): void } | null) {
  const ctx = useContext(RecordContext);
  const [over, setOver] = useState(false);
  useEffect(() => () => setHint(null), []);
  const plan = (r: WsRecord) => {
    if (planFor) return planFor(r);
    if (!ctx || !target) return null;
    const p = ctx.plan(r, target);
    return p ? { words: p.words, run: () => ctx.drop(r, target) } : null;
  };
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        const r = dragging;
        if (!r || !e.dataTransfer.types.includes(RECORD_MIME)) return;
        const p = plan(r);
        if (!p) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
        setHint(p.words, e.clientX, e.clientY);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
        setHint(null);
      },
      onDrop: (e: React.DragEvent) => {
        const r = dragging;
        setOver(false);
        setHint(null);
        if (!r) return;
        const p = plan(r);
        if (!p) return;
        e.preventDefault();
        e.stopPropagation();
        endDrag();
        p.run();
      },
    },
  };
}

/** A record's kind in a word ("Action"). */
export const kindWord = (r: WsRecord) => KIND_WORDS[r.kind].one;
