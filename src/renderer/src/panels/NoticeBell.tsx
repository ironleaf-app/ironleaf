// The bell in the header beside search (10.0 Endless Tech; inside the former host app; 19 Oct 2026, the former host
// app and Vault design: "how the chat integrates into everything"): finished tasks, approvals and questions
// waiting, automations that ran and work handed to the former host app, the same list as the bell beside the
// account in the former host app's sidebar (the former host app keeps it). A notice opens its conversation in the
// former host app. Reminders that came due (19 Oct 2026, src/main/reminders.ts) are Ironleaf's own and show here on
// its own too: one opens its note at the line, and can be ticked or snoozed from the bell (10 minutes, an hour,
// tomorrow at 9:00 am) without opening anything.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { NoticesView, TaskNotice } from '../../../shared/notices';
import { bellPanelPlace } from '../../../shared/bell-place';
import { Icon, type IconName } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { snoozeTimes } from '../../../shared/reminders';
import * as A from '../state/actions';
import { openModal } from '../state/modals';
import { showError, toast, useApp } from '../state/store';

let view: NoticesView = { items: [], unread: 0 };
// A failed load keeps the last-known list and says so (9.2 uplift F100), never "Nothing waiting".
let failed = false;
let snap: NoticesView & { failed: boolean } = { ...view, failed: false };
const listeners = new Set<() => void>();
let started = false;
const tell = () => {
  snap = { ...view, failed };
  for (const fn of listeners) fn();
};
const set = (next: NoticesView | null | undefined) => {
  if (!next || !Array.isArray(next.items)) {
    if (!failed) {
      failed = true;
      tell();
    }
    return;
  }
  view = next;
  failed = false;
  tell();
};
const fail = () => {
  failed = true;
  tell();
};
const refresh = () => void window.nv.notices.list().then(set, fail);
function subscribe(fn: () => void) {
  if (!started) {
    started = true;
    refresh();
    window.nv.on.noticesChanged(set);
    window.addEventListener('focus', refresh);
  }
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
/** Today's the former host app rows read the bell's own store (9 Nov 2026, t53-today-needs-you: one list, so
 *  Today and the bell agree), and read it fresh when Today opens. */
export function useNotices() {
  return useSyncExternalStore(subscribe, () => snap);
}
export const refreshNotices = () => refresh();

// finance and documents: the modules' notices (src/main/record-modules.ts): a bill due, a price change, a document expiring.
// tidy: the weekly tidy is ready (src/main/weekly-tidy.ts): one opens the review list.
const ICONS: Record<string, IconName> = { finance: 'wallet', documents: 'idcard', reminder: 'clock', tidy: 'sparkle', names: 'pencil', done: 'check', failed: 'warning', approval: 'lock', 'automation-approval': 'lock', question: 'help', plan: 'list', automation: 'bolt', 'automation-result': 'bolt' };
const tone = (kind: string) => (kind === 'reminder' || kind === 'finance' || kind === 'documents' ? 'reminder' : kind === 'failed' ? 'failed' : ['approval', 'automation-approval', 'question', 'plan', 'tidy', 'names'].includes(kind) ? 'waiting' : 'done');

/** "just now", "12 min ago", "3 h ago", else "19 Oct, 9:40 am". */
export function noticeWhen(at: number, now = Date.now()): string {
  const ago = now - at;
  if (ago < 60_000) return 'just now';
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)} min ago`;
  if (ago < 6 * 3_600_000) return `${Math.floor(ago / 3_600_000)} h ago`;
  const d = new Date(at);
  return `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?$/i, ' $1m').toLowerCase()}`;
}

export function NoticeBell() {
  const state = useSyncExternalStore(subscribe, () => snap);
  const canEdit = useApp((s) => s.canEdit);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!place) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') { e.stopPropagation(); setPlace(null); button.current?.focus(); }
        return;
      }
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setPlace(null);
    };
    document.addEventListener('keydown', close, true);
    document.addEventListener('pointerdown', close, true);
    return () => { document.removeEventListener('keydown', close, true); document.removeEventListener('pointerdown', close, true); };
  }, [place]);
  const toggle = () => {
    if (place) return setPlace(null);
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    refresh();
    setPlace(bellPanelPlace(r, { width: window.innerWidth, height: window.innerHeight }));
  };
  // One click opens the one thing the caption names (9.2 uplift F103): the conversation when one is named,
  // else the note. A notice naming both offers the note as a second action on its row, never a second window.
  const open = (item: TaskNotice) => {
    setPlace(null);
    if (item.sessionId) void window.nv.notices.open(item.id).finally(refresh);
    else if (item.kind === 'tidy') {
      A.openTidy();
      void window.nv.notices.read(item.id).then(set, () => toast('Couldn’t mark it read.'));
    } else if (item.kind === 'names' && !item.note) {
      openModal({ kind: 'names' });
      void window.nv.notices.read(item.id).then(set, () => toast('Couldn’t mark it read.'));
    } else {
      if (item.note) A.openAtLine(item.note, item.line ?? 0);
      void window.nv.notices.read(item.id).then(set, () => toast('Couldn’t mark it read.'));
    }
  };
  // A reminder ticked or snoozed from its notice (its notices are read once it is).
  const done = (item: TaskNotice) =>
    item.reminder &&
    void window.nv.reminders.done(item.reminder).then((words) => {
      toast(words);
      refresh();
    }, showError);
  const snooze = (item: TaskNotice, until: number) =>
    item.reminder &&
    void window.nv.reminders.snooze(item.reminder, until).then((words) => {
      toast(words);
      refresh();
    }, showError);
  const label = state.unread ? `Notices, ${state.unread} new` : 'Notices';
  return (
    <>
      <button ref={button} className="places-bell" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={!!place} onClick={toggle}>
        <Icon name="bell" size={17} />
        {state.unread > 0 && <span className="places-bell-count" aria-hidden="true">{state.unread > 9 ? '9+' : state.unread}</span>}
      </button>
      {place &&
        createPortal(
          <div ref={panel} className="notices" role="dialog" aria-label="Notices" style={place.top !== undefined ? { left: place.left, top: place.top } : { left: place.left, bottom: place.bottom }}>
            <div className="notices-head">
              <span className="notices-title">Notices</span>
              {state.unread > 0 && <button className="notices-link" onClick={() => void window.nv.notices.read().then(set)}>Mark all read</button>}
              {state.items.length > 0 && <button className="notices-link" onClick={() => void window.nv.notices.clear().then(set)}>Clear</button>}
            </div>
            {state.items.length ? (
              <ul className="notices-list">
                {state.items.map((item) => (
                  <li key={item.id} className={item.reminder && !item.read ? 'has-actions' : undefined}>
                    <button className={`notice is-${tone(item.kind)}${item.read ? ' is-read' : ''}`} onClick={() => open(item)}>
                      <span className="notice-icon"><Icon name={ICONS[item.kind] ?? 'check'} size={14} /></span>
                      <span className="notice-text">
                        <span className="notice-title">{item.title}</span>
                        <span className="notice-body">{item.body}</span>
                        <span className="notice-when">{noticeWhen(item.at)}{item.sessionId ? '' : item.kind === 'tidy' ? ' · Open the tidy' : item.kind === 'names' && !item.note ? ' · Choose' : item.note ? ' · Open the note' : ''}</span>
                      </span>
                      {!item.read && <span className="notice-dot" aria-label="New" />}
                    </button>
                    {item.note && item.sessionId && (
                      <div className="notice-actions">
                        <button className="notice-action" onClick={() => { setPlace(null); A.openAtLine(item.note!, item.line ?? 0); }}>
                          Open the note
                        </button>
                      </div>
                    )}
                    {item.reminder && !item.read && (
                      <div className="notice-actions">
                        <button className="notice-action" disabled={!canEdit} onClick={() => done(item)}>
                          <Icon name="check" size={13} /> Done
                        </button>
                        <span className="notice-actions-label">Snooze</span>
                        {snoozeTimes(Date.now()).map((t, i) => (
                          <button key={t.label} className="notice-action" disabled={!canEdit} title={t.label === 'Tomorrow, 9:00 am' ? 'Remind me again tomorrow at 9:00 am' : `Remind me again in ${t.label}`} onClick={() => snooze(item, snoozeTimes(Date.now())[i].at)}>
                            {t.short}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : state.failed ? (
              <EmptyState size="panel" icon="bell" title="Couldn't open notices" line="What was waiting is still waiting. The list just wouldn't open." action={{ label: 'Try again', run: refresh }} />
            ) : (
              <EmptyState size="panel" icon="bell" title="Nothing waiting" line="Reminders as they come due, finished tasks, approvals waiting for you and automations that ran show up here." />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
