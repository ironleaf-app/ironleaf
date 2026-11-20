// The peek (WS1 part B, 24 Oct 2026): a record opened at the right of the window with everything connected to it, so a
// click takes the person somewhere instead of into an edit field (23 Oct). The record's fields first (a person or
// meeting named in them opens in turn), then what it connects to, grouped: actions, meetings, people, files, decisions
// and risks, the timeline, projects, notes, each row saying how it connects. Back and Forward (and Alt+← / Alt+→), the
// trail of where the person went, Open full page, Edit (where it is written, deliberately), Esc closes and gives the
// keys back to what opened it. Read from src/shared/records.ts. A project-owned record's facts change where shown (4
// Nov 2026): the same fields as the project page (views/project/Inline.tsx, LayoutEdit.tsx), through project:edit, so
// the note, the page and the peek all show the change at once, with Undo. A single click still never edits.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ConnectedGroup, ConnectedItem, RecordPeek, RecordType, VaultRecord } from '../../../shared/records';
import { TYPE_WORDS, canEditNoteFact } from '../../../shared/records';
import { noteLead } from '../../../shared/note-lead';
import { docs } from '../state/docs';
import type { Project, ProjectEdit } from '../../../shared/project-file';
import { HEALTHS, STATUSES, isProjectProps } from '../../../shared/project-file';
import type { ProjectView } from '../../../shared/types';
import { dayInStyle } from '../../../shared/layouts';
import { recordChoices, recordFactEdit, recordFactText } from '../../../shared/record-edits';
import { wantsDone } from '../../../shared/project-close';
import { useProjectCloser } from '../views/project/useProjectCloser';
import { effectiveHealth, levelTone, readDate, shortDate, statusReading } from '../lib/projectLook';
import { closePeek, editRecord, makePersonPage, openRecordPage, peek, peekBack, peekForward, peekGo, peekNamed, usePeek } from '../state/peek';
import { showError, toast, useApp } from '../state/store';
import { EditorContext, Inline, InlineDate, type Suggestion } from '../views/project/Inline';
import { Choice, Pct, choicesFrom } from '../views/project/LayoutEdit';
import { DATE_STATUSES, STREAM_STATUSES } from '../views/project/LayoutDashboard';
import { Icon, type IconName } from './Icon';
import { PersonSummary } from './PersonSummary';
import { FileCard } from './FileCard';
import { saveNoteFact } from '../lib/noteFacts';
import { addFilesTo } from '../state/vaultFiles';
import * as A from '../state/actions';
import { isFinished } from '../../../shared/finished';

export const TYPE_ICONS: Record<RecordType, IconName> = {
  project: 'layers',
  action: 'task',
  milestone: 'flag',
  workstream: 'timeline',
  meeting: 'calendar',
  decision: 'check',
  risk: 'warning',
  file: 'file',
  person: 'person',
  org: 'briefcase',
  note: 'notes',
};

const SHOWN = 5;
const DAY = 86400000;

/** A day as people read it, and how near it is ("Today", "Tomorrow", "3 days overdue", "Mon 26 Oct"). */
function dayWords(iso: string | undefined, open: boolean): { words: string; tone: 'bad' | 'warn' | 'none' } | null {
  const ms = readDate(iso);
  if (ms === null) return null;
  const today = new Date().setHours(0, 0, 0, 0);
  const days = Math.round((ms - today) / DAY);
  if (open && days < 0) return { words: -days === 1 ? '1 day overdue' : `${-days} days overdue`, tone: 'bad' };
  if (days === 0) return { words: 'Today', tone: open ? 'warn' : 'none' };
  if (days === 1) return { words: 'Tomorrow', tone: open ? 'warn' : 'none' };
  const d = new Date(ms);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return { words: Math.abs(days) <= 6 ? `${wd} ${shortDate(ms)}` : shortDate(ms), tone: 'none' };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Thu 22 Oct 2026". */
const longDay = (ms: number) => {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const isOpenRecord = (r: VaultRecord) => !r.done && !isFinished(r.status);

/** A status as a tone: structured state first (a done record is calm green, an open record past its day is
 *  red whatever its words claim), then the one status reading's whole words (9.2 uplift F58). A risk level's
 *  High reads through levelTone at its call site instead: levels are not statuses. */
function statusTone(r: VaultRecord, value: string): 'ok' | 'warn' | 'bad' | 'none' {
  if (r.done || isFinished(r.status)) return 'ok';
  if (r.type === 'action' && r.due && isOpenRecord(r) && r.due < new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)) return 'bad';
  return statusReading(value).tone;
}

/** First-letter upper, as the hero reads health (10.0 third round F7: the foot printed frontmatter raw). */
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** What a row says under its name: who, when, its state, then how it connects. */
function rowMeta(item: ConnectedItem, self?: VaultRecord): { bits: { text: string; tone?: string }[]; why: string } {
  const r = item.record;
  const notSelf = (who?: string) => !!who && !(self && (self.type === 'person' || self.type === 'org') && [self.title, ...(self.names ?? [])].some((n) => n.toLowerCase() === who.toLowerCase()));
  const bits: { text: string; tone?: string }[] = [];
  const open = isOpenRecord(r);
  if (r.type === 'action') {
    if (r.done) bits.push({ text: 'Done', tone: 'ok' });
    if (notSelf(r.owner)) bits.push({ text: r.owner! });
    const d = dayWords(r.due, open);
    if (d) bits.push({ text: d.words, tone: d.tone });
    else if (r.when) bits.push({ text: `By ${r.when}` });
  } else if (r.type === 'milestone' || r.type === 'meeting' || r.type === 'decision') {
    // Open or shut from the record itself (9.2 uplift F136): "Held over" stays open and late; only a done
    // state ("Passed") reads shut. Never a substring of the status words.
    const d = dayWords(r.date, r.type === 'milestone' && open && statusReading(r.status).state !== 'done');
    if (d) bits.push({ text: d.words, tone: r.type === 'milestone' ? d.tone : 'none' });
    if (r.status) bits.push({ text: cap(r.status), tone: statusTone(r, r.status) });
  } else if (r.type === 'workstream' || r.type === 'risk') {
    if (r.level) bits.push({ text: cap(r.level), tone: levelTone(r.level) });
    if (notSelf(r.owner)) bits.push({ text: r.owner! });
    if (r.status) bits.push({ text: cap(r.status), tone: statusTone(r, r.status) });
    if (r.progress !== undefined) bits.push({ text: `${r.progress}%` });
  } else if (r.type === 'file') {
    bits.push({ text: r.facts.find((f) => f.key === 'kind')?.value ?? 'File' });
    const where = r.facts.find((f) => f.key === 'where')?.value;
    if (where) bits.push({ text: where });
  } else if (r.type === 'person' || r.type === 'org') {
    // A person's line reads by their role in THIS context (p10-vault-connected C2, 4 Nov 2026): the whys
    // carry it ("Owner", "Joinery lead", "Attendee"), never a global fact from another area of life.
  } else if (r.type === 'project') {
    // One health everywhere (p10-vault-connected C3, 4 Nov 2026): the effective health Home weighs
    // (late steps and a past due day), not the raw stored word, so Connected and Home agree.
    const stored = r.facts.find((f) => f.key === 'health')?.value;
    const health = effectiveHealth({ health: stored, lateMine: r.lateMine ?? 0, due: r.due, status: r.status }) ?? stored;
    if (health) bits.push({ text: cap(health), tone: statusTone(r, health) });
  }
  // How it connects, unless its group already says so.
  const why = item.whys.filter((w) => w && !(r.type === 'person' && w === bits[0]?.text)).join(' · ');
  return { bits, why };
}

export function ConnectedRow({ item, onOpen, below, self }: { item: ConnectedItem; onOpen(r: VaultRecord, page: boolean): void; below?: ReactNode; self?: VaultRecord }) {
  const r = item.record;
  const { bits, why } = rowMeta(item, self);
  return (
    <li>
      <button
        className={`peek-row kind-${r.type}${isOpenRecord(r) ? '' : ' is-done'}`}
        title={`${r.title}${'\n'}Open it (Ctrl+click: beside it)`}
        onClick={(e) => onOpen(r, e.ctrlKey || e.metaKey)}
      >
        <span className="peek-row-icon" aria-hidden="true">
          <Icon name={TYPE_ICONS[r.type]} size={13} />
        </span>
        <span className="peek-row-main">
          <span className="peek-row-title">{r.title}</span>
          {bits.length > 0 && (
            <span className="peek-row-meta">
              {bits.map((b, i) => (
                <span key={i} className={b.tone && b.tone !== 'none' ? `peek-tone tone-${b.tone}` : undefined}>
                  {b.text}
                </span>
              ))}
            </span>
          )}
          {why && <span className="peek-row-why">{why}</span>}
        </span>
        <Icon name="chevron" size={12} className="peek-row-go" />
      </button>
      {below}
    </li>
  );
}

export function ConnectedGroupList({ g, onOpen, below, shownAtFirst = SHOWN, self }: { g: ConnectedGroup; onOpen(r: VaultRecord, page: boolean): void; below?(r: VaultRecord): ReactNode; shownAtFirst?: number; self?: VaultRecord }) {
  const [all, setAll] = useState(false);
  const open = g.items.filter((x) => isOpenRecord(x.record)).length;
  const shown = all ? g.items : g.items.slice(0, shownAtFirst);
  const counts = g.key === 'actions' && open !== g.items.length ? `${open} open · ${g.items.length}` : String(g.items.length);
  return (
    <section className="peek-group" aria-label={g.label}>
      <h3 className="peek-group-head">
        <span>{g.label}</span>
        <span className="peek-group-count">{counts}</span>
      </h3>
      <ul className="peek-list">
        {shown.map((it) => (
          <ConnectedRow key={it.record.id} item={it} onOpen={onOpen} below={below?.(it.record)} self={self} />
        ))}
      </ul>
      {g.items.length > shownAtFirst && (
        <button className="peek-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${g.items.length}`}
        </button>
      )}
    </section>
  );
}

function FactValue({ r, k, value, refId, refs }: { r: VaultRecord; k: string; value: string; refId?: string; refs?: { id: string; name: string }[] }) {
  // A meeting's attendees: each name goes on to that person.
  if (refs?.length)
    return (
      <span className="peek-fact-links">
        {refs.map((x, i) => (
          <span key={x.id}>
            <button className="peek-fact-link" onClick={() => peek({ id: x.id }, { title: x.name, type: 'person' })} title={`Open ${x.name}`}>
              {x.name}
            </button>
            {i < refs.length - 1 ? ', ' : ''}
          </span>
        ))}
      </span>
    );
  if (refId)
    return (
      <button className="peek-fact-link" onClick={() => peek({ id: refId })} title={`Open ${value}`}>
        {value}
      </button>
    );
  if (k === 'status' || k === 'health' || k === 'level') {
    const tone = statusTone(r, value);
    return (
      <span className={`pj-pill peek-pill tone-${tone}`}>
        <span className="pj-dot" />
        {value.charAt(0).toUpperCase() + value.slice(1)}
      </span>
    );
  }
  if (k === 'email') return <a href={`mailto:${value}`}>{value}</a>;
  if ((k === 'date' || k === 'due') && readDate(value) !== null) {
    const d = dayWords(/^\d{4}-\d{2}-\d{2}/.test(value) ? value : undefined, false);
    const ms = readDate(value)!;
    return (
      <span>
        {longDay(ms)}
        {d && /Today|Tomorrow/.test(d.words) ? <span className="peek-soft"> · {d.words}</span> : null}
      </span>
    );
  }
  return <span>{value}</span>;
}

/** Editing one fact where shown: the project as the peek read it, who it can suggest, and the save. */
interface FactEditing {
  project: Project;
  people: Suggestion[];
  save(fact: string, value: string): Promise<boolean>;
}

/** Editing a tick box on its own line (a run sheet's, a meeting's or a plain note's): the way Tasks ticks it. */
interface TaskEditing {
  tick(done: boolean): Promise<boolean>;
  setDue(iso: string | null): Promise<boolean>;
}

/** A fact's field, or its plain words when it has nowhere to write (src/shared/record-edits.ts says which). A linked
 *  value still opens on a single click; its pencil (or the keyboard) changes it. */
function EditableFact({ r, k, value, label, refId, refs, edit, propSave, task }: { r: VaultRecord; k: string; value: string; label: string; refId?: string; refs?: { id: string; name: string }[]; edit: FactEditing | null; propSave: ((fact: string, value: string) => Promise<boolean>) | null; task: TaskEditing | null }) {
  const raw = edit ? recordFactText(edit.project, r, k, r.path) : null;
  if (edit && raw !== null) {
    if (k === 'owner')
      return (
        <Inline value={raw} label={label} compact suggest={edit.people} onSave={(v) => edit.save('owner', v)}>
          <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
        </Inline>
      );
    if (k === 'role' || k === 'what')
      return (
        <Inline value={raw} label={label} onSave={(v) => edit.save(k, v)}>
          <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
        </Inline>
      );
  } else if (propSave && canEditNoteFact(r, k)) {
    if (k === 'date')
      return (
        <InlineDate value={value} iso label={label} onSave={(v) => propSave(k, v)}>
          <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
        </InlineDate>
      );
    return (
      <Inline value={value} label={label} onSave={(v) => propSave(k, v)}>
        <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
      </Inline>
    );
  } else if (task && r.type === 'action' && k === 'status') {
    return <Choice value={r.done ? 'Done' : 'Open'} options={['Done', 'Open']} label={label} tone={r.done ? 'ok' : 'none'} onSave={(v) => task.tick(v === 'Done')} />;
  } else if (task && r.type === 'action' && k === 'when' && r.due) {
    return (
      <InlineDate value={r.due} iso label={label} onSave={(v) => task.setDue(v || null)}>
        <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
      </InlineDate>
    );
  }
  if (!edit || raw === null)
    return <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />;
  if (k === 'status' || k === 'health' || k === 'level') {
    if (r.type === 'action' && k === 'status')
      return <Choice value={r.done ? 'Done' : 'Open'} options={['Done', 'Open']} label={label} tone={r.done ? 'ok' : 'none'} onSave={(v) => edit.save('done', v === 'Done' ? 'true' : 'false')} />;
    const usual = r.type === 'workstream' ? STREAM_STATUSES : r.type === 'milestone' ? DATE_STATUSES : r.type === 'project' && k === 'status' ? [...STATUSES] : r.type === 'project' && k === 'health' ? [...HEALTHS] : k === 'level' ? ['High', 'Medium', 'Low'] : [];
    return <Choice value={raw} options={choicesFrom(recordChoices(edit.project, r, k) ?? [raw], usual)} label={label} tone={k === 'level' ? levelTone(raw) : statusTone(r, raw)} dot={k !== 'level'} onSave={(v) => edit.save(k, v)} />;
  }
  if (k === 'progress') return <Pct value={r.progress} onSave={(n) => edit.save('progress', n === null ? '' : String(n))} />;
  if (k === 'date' || k === 'due')
    return (
      <InlineDate value={raw} iso label={label} onSave={(v) => edit.save(k, v ? dayInStyle(v, [raw]) : '')}>
        <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
      </InlineDate>
    );
  if (k === 'when')
    return (
      <InlineDate value={raw} label={label} onSave={(v) => edit.save('when', v)}>
        <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
      </InlineDate>
    );
  if (k === 'next' || k === 'why')
    return (
      <Inline value={raw} label={label} onSave={(v) => edit.save(k, v)}>
        <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />
      </Inline>
    );
  return <FactValue r={r} k={k} value={value} refId={refId} refs={refs} />;
}

function Facts({ r, edit, propSave, task }: { r: VaultRecord; edit: FactEditing | null; propSave: ((fact: string, value: string) => Promise<boolean>) | null; task: TaskEditing | null }) {
  // The project is said above when the record is written in the project's own page.
  const facts = r.facts.filter((f) => f.value && !(f.key === 'project' && r.path === r.project));
  // The due day of an action reads with how near it is.
  const due = r.type === 'action' ? dayWords(r.due, isOpenRecord(r)) : null;
  if (!facts.length && !due && !task) return null;
  const dueShown = due && (
    <>
      <span className={due.tone !== 'none' ? `peek-tone tone-${due.tone}` : undefined}>{due.words}</span>
      {/* The words as written only when they say more than the date beside them ("end of the month"), never "31 Oct 2026" twice. */}
      {r.when && !readDate(r.when.trim().replace(/^by\s+/i, '')) && <span className="peek-soft"> · “{r.when}”</span>}
      {r.due && <span className="peek-soft"> · {longDay(readDate(r.due)!)}</span>}
    </>
  );
  const dueRaw = edit ? recordFactText(edit.project, r, 'when', r.path) : null;
  return (
    <dl className="peek-facts">
      {(due || task) && (
        <div className="peek-fact">
          <dt>Due</dt>
          <dd>
            {edit && dueRaw !== null ? (
              <InlineDate value={dueRaw} label="By" onSave={(v) => edit.save('when', v)}>
                {dueShown}
              </InlineDate>
            ) : task && r.due ? (
              <InlineDate value={r.due} iso label="By" onSave={(v) => task.setDue(v || null)}>
                {dueShown}
              </InlineDate>
            ) : task ? (
              <InlineDate value="" iso label="By" placeholder="+ By" onSave={(v) => task.setDue(v || null)} />
            ) : (
              dueShown
            )}
          </dd>
        </div>
      )}
      {facts
        .filter((f) => !(due && f.key === 'when'))
        .map((f) => (
          <div className="peek-fact" key={f.key}>
            <dt>{f.label}</dt>
            <dd>
              <EditableFact r={r} k={f.key} value={f.value} label={f.label} refId={f.ref} refs={f.refs} edit={edit} propSave={propSave} task={task} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

const WHERE_WORDS: Partial<Record<RecordType, string>> = { action: 'Written in', milestone: 'Key date in', workstream: 'Workstream of', decision: 'Decided in', risk: 'Risk in', person: 'Named in', org: 'Named in' };

export function PeekHost() {
  const p = usePeek();
  const revision = useApp((s) => s.revision);
  const byPath = useApp((s) => s.byPath);
  const canEdit = useApp((s) => s.canEdit);
  const entry = p.open ? p.stack[p.at] : undefined;
  const [data, setData] = useState<{ key: string; peek: RecordPeek | null } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const key = entry ? JSON.stringify(entry.ref) : '';

  // Where the keys were when the peek opened, so Esc gives them back.
  useEffect(() => {
    if (p.open && !opener.current) opener.current = document.activeElement;
    if (!p.open) opener.current = null;
  }, [p.open]);
  // Just opened over the page, it lets clicks through for half a second: the second click of a double-click (to edit) on
  // a value it opened over reaches the value, not the peek. Before the paint (a layout effect runs ahead of it; an
  // effect runs after, so the first paint was already clickable and a fast second click landed on the peek instead of
  // the value, and Tasks rows' who and when would not change).
  const [entering, setEntering] = useState(false);
  useLayoutEffect(() => {
    if (!p.open) return;
    setEntering(true);
    const t = window.setTimeout(() => setEntering(false), 520);
    return () => window.clearTimeout(t);
  }, [p.open]);

  useEffect(() => {
    if (!entry) return;
    let alive = true;
    void window.nv.records.peek(entry.ref).then(
      (r) => {
        if (!alive) return;
        setData({ key, peek: r });
        if (r) peekNamed(p.at, r.record);
      },
      () => alive && setData({ key, peek: null }),
    );
    return () => {
      alive = false;
    };
  }, [key, revision]);

  // At a wide window the page makes room for the peek (nothing under it out of reach); narrow, it opens over the page.
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.app > .main');
    if (!main) return;
    const fit = () => {
      const wide = window.innerWidth >= 1180;
      const right = document.querySelector<HTMLElement>('.app > .sidebar.right:not(.is-drawer)')?.offsetWidth ?? 0;
      const w = panel.current?.offsetWidth ?? 420;
      main.style.marginRight = p.open && wide ? `${Math.max(0, w - right)}px` : '';
      panel.current?.classList.toggle('is-docked', p.open && wide);
    };
    // Not at once: the page moving under the pointer would make a double-click (edit) land somewhere else (Windows'
    // double-click time is half a second).
    const docked = !!panel.current?.classList.contains('is-docked');
    const t = window.setTimeout(fit, !p.open || docked ? 0 : 600);
    window.addEventListener('resize', fit);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', fit);
      if (!p.open) main.style.marginRight = '';
    };
  }, [p.open, !!data]);

  // Each new record starts at its top.
  useEffect(() => {
    panel.current?.querySelector('.peek-scroll')?.scrollTo({ top: 0 });
  }, [key]);
  // A peeked note summarises (t7-note-window, 8 Nov 2026): its opening words, read through the docs store
  // (live while the peek stands, released with it), never written.
  const leadPath = data && data.key === key && data.peek?.record?.type === 'note' && data.peek.record.page ? data.peek.record.path : null;
  const [lead, setLead] = useState<string | null>(null);
  useEffect(() => {
    if (!leadPath) {
      setLead(null);
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
        setLead(noteLead(t));
        off = docs.subscribe(leadPath, (next) => setLead(noteLead(next)));
      })
      .catch(() => {
        if (alive) setLead(null);
      });
    return () => {
      alive = false;
      off();
      docs.release(leadPath);
    };
  }, [leadPath]);
  // A project record's status set to done asks first (p12-close-and-noise round 2: the shared closer).
  const { closer, requestDone } = useProjectCloser();

  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const inPanel = !!panel.current?.contains(document.activeElement);
      const typing = (document.activeElement as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor');
      if (e.key === 'Escape' && !document.querySelector('.menu, .modal-backdrop, .overlay') && (inPanel || !typing)) {
        e.preventDefault();
        const back = opener.current as HTMLElement | null;
        closePeek();
        if (back?.isConnected) back.focus?.();
        return;
      }
      if (inPanel && e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        peekBack();
      } else if (inPanel && e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        peekForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open]);

  const shown = data && data.key === key ? data.peek : undefined;
  const record = shown?.record;
  // A stop still loading names itself from its ref (t212, 11 Nov 2026: an unread title read '…', the same
  // mark the trail's own gap uses for hidden stops).
  const trail = useMemo(() => p.stack.map((e, i) => ({ i, title: e.title || e.ref.name || e.ref.title || e.ref.path?.split('/').pop()?.replace(/\.md$/i, '') || 'Loading…', type: e.type })), [p.stack]);
  // A record written in its project's own note, with the right to change it: the project as the page reads it, so its
  // facts offer the page's own fields (read again with every revision, as the peek is). Someone named in a project
  // (no page of their own) and a file the project keeps read it from the project's own file.
  const projectPath =
    record && record.project && record.path === record.project && (record.type !== 'file' || record.folderFile)
      ? record.project
      : record && (record.type === 'person' || record.type === 'org') && !record.page && isProjectProps(byPath.get(record.path)?.props)
        ? record.path
        : null;
  const [pview, setPview] = useState<{ key: string; view: ProjectView | null } | null>(null);
  useEffect(() => {
    if (!projectPath || !canEdit) return;
    let alive = true;
    void window.nv.projects.view(projectPath).then(
      (v) => alive && setPview({ key: projectPath, view: v }),
      () => alive && setPview({ key: projectPath, view: null }),
    );
    return () => {
      alive = false;
    };
  }, [projectPath, revision, canEdit]);
  const project = projectPath && pview?.key === projectPath ? pview.view : null;
  /** Undone or made again, the page's way (its message carries the way back). */
  const stepEdit = useCallback((path: string, redo: boolean): void => {
    void (redo ? window.nv.projects.redo(path) : window.nv.projects.undo(path)).then(
      (r) => toast(r.words, (redo ? r.undo : r.redo) ? { label: redo ? 'Undo' : 'Redo', run: () => stepEdit(path, !redo) } : undefined),
      showError,
    );
  }, []);
  /** One fact saved: planned and versioned on the file as it is now, so a file moved since refuses instead of clobbering. */
  const saveFact = useCallback(
    async (fact: string, value: string): Promise<boolean> => {
      if (!record || !projectPath) return false;
      try {
        const v = await window.nv.projects.view(record.path);
        const change = recordFactEdit(v.project, record, fact, value, record.path);
        if (!change) {
          toast('That is not changeable here any more.');
          return false;
        }
        if (wantsDone(change)) {
          requestDone(record.path);
          return true;
        }
        const r = await window.nv.projects.edit(record.path, change, v.version);
        toast(r.words, { label: 'Undo', run: () => stepEdit(record.path, false) });
        return true;
      } catch (err) {
        showError(err);
        return false;
      }
    },
    [record, projectPath, stepEdit],
  );
  /** One of the note's own facts saved (a meeting's, person's or note's own properties). */
  const saveProp = useCallback(
    async (fact: string, value: string): Promise<boolean> => {
      if (!record || !record.page || !/\.md$/i.test(record.path)) return false;
      const label = record.facts.find((f) => f.key === fact)?.label ?? 'fact';
      return saveNoteFact(record.path, record, fact, value, value.trim() ? `Changed the ${label.toLowerCase()}.` : `Took the ${label.toLowerCase()} off.`);
    },
    [record],
  );
  /** A tick box on its own line ticked or given a day, the way Tasks does it, with Undo for the tick. */
  const taskEditing: TaskEditing | null = useMemo(() => {
    if (!record || record.type !== 'action' || record.line === undefined || record.task === undefined || !canEdit) return null;
    if (project && recordFactText(project.project, record, 'done', record.path) !== null) return null;
    const stripBox = (line: string) => line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+/, '');
    return {
      tick: async (done: boolean): Promise<boolean> => {
        try {
          const r = await window.nv.tasks.tick(record.path, record.line!, record.task!, done);
          toast(r.words, { label: 'Undo', run: () => void window.nv.tasks.tick(record.path, record.line!, stripBox(r.line), !done).catch(showError) });
          return true;
        } catch (err) {
          showError(err);
          return false;
        }
      },
      setDue: async (iso: string | null): Promise<boolean> => {
        if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          toast('That isn’t a real day.');
          return false;
        }
        try {
          toast(await window.nv.tasks.setDue(record.path, record.line!, record.task!, iso, null));
          return true;
        } catch (err) {
          showError(err);
          return false;
        }
      },
    };
  }, [record, project, canEdit]);
  const editor = useMemo(
    () => ({
      path: record?.path ?? '',
      canEdit,
      known: project?.known ?? { people: [], tags: [] },
      edit: async (change: ProjectEdit): Promise<boolean> => {
        if (!project || !projectPath) return false;
        try {
          const r = await window.nv.projects.edit(projectPath, change, project.version);
          toast(r.words, { label: 'Undo', run: () => stepEdit(projectPath, false) });
          return true;
        } catch (err) {
          showError(err);
          return false;
        }
      },
    }),
    [record, project, projectPath, canEdit, stepEdit],
  );
  const factEditing: FactEditing | null = useMemo(
    () =>
      project && record
        ? { project: project.project, people: project.known.people.map((x) => ({ value: x.name, hint: x.role })), save: saveFact }
        : null,
    [project, record, saveFact],
  );
  const propEditing = useMemo(() => (record && record.page && /\.md$/i.test(record.path) && canEdit ? saveProp : null), [record, canEdit, saveProp]);
  // A workstream's, milestone's, action's, risk's or decision's name changes where shown. A project's name stays on
  // its page: renaming it moves its files.
  const titleRaw = factEditing && record && (record.type === 'workstream' || record.type === 'milestone' || record.type === 'action' || record.type === 'risk' || record.type === 'decision') ? recordFactText(factEditing.project, record, 'title', record.path) : null;
  if (!p.open || !entry) return null;

  const onOpen = (r: VaultRecord, page: boolean) => (page ? openRecordPage(r, 'tab') : peek({ id: r.id }, { title: r.title, type: r.type }));
  // Written in the project's own note: the project's name as the page shows it ("Lantern Festival 2027: Ashgrove Park").
  const noteTitle = record ? ((record.path === record.project && shown?.projectTitle) || (byPath.get(record.path)?.label ?? record.path.split('/').pop()!.replace(/\.md$/i, ''))) : '';
  const inOwnNote = record ? !!record.page || record.type === 'file' : true;
  // Someone named in a project who has no page of their own yet.
  const pageless = !!record && (record.type === 'person' || record.type === 'org') && !record.page;
  const projectId = record?.project ? `project:${record.project}` : null;
  // The project, unless the note it is written in is the project's own page.
  const showProject = !!projectId && record?.type !== 'project' && !!shown?.projectTitle && (inOwnNote || record?.path !== record?.project);
  const crumbs = trail.length > 3 ? [trail[0], null, ...trail.slice(-2)] : trail;

  return (
    <aside className={`peek rec-kinds${entering ? ' is-entering' : ''}`} ref={panel} role="complementary" aria-label={record ? `${record.kind ?? TYPE_WORDS[record.type]}: ${record.title}` : 'Peek'} tabIndex={-1}>
      <header className="peek-bar">
        <button className="peek-icon-button" title="Back (Alt+←)" aria-label="Back" disabled={p.at <= 0} onClick={peekBack}>
          <Icon name="back" size={14} />
        </button>
        <button className="peek-icon-button" title="Forward (Alt+→)" aria-label="Forward" disabled={p.at >= p.stack.length - 1} onClick={peekForward}>
          <Icon name="forward" size={14} />
        </button>
        <nav className="peek-trail" aria-label="Where you have been" hidden={trail.length < 2}>
          {crumbs.map((c, n) =>
            c === null ? (
              <span key={`gap${n}`} className="peek-trail-gap">
                …
              </span>
            ) : (
              <span key={c.i} className="peek-crumb-wrap">
                {n > 0 && <Icon name="chevron" size={10} className="peek-trail-sep" />}
                <button className={`peek-crumb${c.i === p.at ? ' is-here' : ''}`} aria-current={c.i === p.at ? 'page' : undefined} onClick={() => peekGo(c.i)} title={c.title}>
                  {c.title}
                </button>
              </span>
            ),
          )}
        </nav>
        <button className="peek-icon-button" title="Close (Esc)" aria-label="Close" onClick={closePeek}>
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="peek-scroll">
        {shown === undefined && <div className="peek-loading" aria-busy="true" />}
        {shown === null && entry.ref.type === 'file' && entry.ref.path && !entry.ref.folderFile && (
          // A file the connected vault doesn't list (one linked where it is on the PC, or just arrived): its details alone.
          <>
            <div className="peek-head">
              <span className="peek-kind kind-file">
                <Icon name="file" size={12} />
                File
              </span>
              <h2 className="peek-title">{entry.ref.path.split('/').pop()}</h2>
            </div>
            <FileCard path={entry.ref.path} />
          </>
        )}
        {shown === null && !(entry.ref.type === 'file' && entry.ref.path && !entry.ref.folderFile) && (
          <div className="peek-gone">
            <Icon name="info" size={18} />
            <p>{entry.ref.folderFile ? 'This file isn’t in the project’s folder any more. It may have been moved, renamed or deleted on this PC.' : 'This isn’t in the vault any more. It may have been renamed or taken out of its note.'}</p>
          </div>
        )}
        {record && (
          <EditorContext.Provider value={editor}>
            <div className="peek-head">
              <span className={`peek-kind kind-${record.type}`}>
                <Icon name={TYPE_ICONS[record.type]} size={12} />
                {record.kind ?? TYPE_WORDS[record.type]}
              </span>
              <h2 className={`peek-title${isOpenRecord(record) ? '' : ' is-done'}`}>
                {factEditing && titleRaw !== null ? (
                  <Inline value={titleRaw} label="name" required onSave={(v) => factEditing.save('title', v)}>
                    {record.title}
                  </Inline>
                ) : (
                  record.title
                )}
              </h2>
              {(showProject || !inOwnNote) && (
                <div className="peek-where">
                  {!inOwnNote && (
                    <>
                      <span className="peek-soft">{WHERE_WORDS[record.type] ?? 'In'} </span>
                      <button className="peek-where-link" onClick={() => openRecordPage(record)} title="Open where it is written">
                        {noteTitle}
                      </button>
                    </>
                  )}
                  {showProject && (
                    <>
                      <span className="peek-soft">{inOwnNote ? 'In ' : ' · '}</span>
                      <button className="peek-where-link" onClick={() => peek({ id: projectId! })} title="Open the project">
                        {shown.projectTitle}
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="peek-actions">
                {pageless && record.type === 'person' ? (
                  <button className="peek-button primary" onClick={() => void makePersonPage(record)} title="A page in People for them; everything here stays joined to it">
                    <Icon name="plus" size={13} />
                    Make their page
                  </button>
                ) : (
                  !pageless && (
                    <button className="peek-button primary" onClick={() => openRecordPage(record)}>
                      <Icon name="external" size={13} />
                      {record.type === 'file' ? 'Open' : 'Open full page'}
                    </button>
                  )
                )}
                {record.type !== 'file' && (
                  <button className="peek-button" onClick={() => editRecord(record)} title="Change it where it is written">
                    <Icon name="pencil" size={13} />
                    Edit
                  </button>
                )}
                {record.page && record.type !== 'file' && /\.md$/i.test(record.path) && canEdit && (
                  <button className="peek-button" onClick={() => void addFilesTo(record.path)} title="Files added here are kept beside it, in its Files folder">
                    <Icon name="paperclip" size={13} />
                    Add files
                  </button>
                )}
                {record.page && record.type !== 'project' && record.path && canEdit && (
                  <button className="peek-button peek-button-quiet" title="Delete (to Recently deleted, with Undo)" aria-label={`Delete ${record.title}`} onClick={() => void A.trashPath(record.path).then((gone) => gone && closePeek())}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
            </div>
            {(record.type === 'person' || record.type === 'org') && <PersonSummary record={record} />}
            {record.type === 'file' && !record.folderFile ? <FileCard path={record.path} /> : <Facts r={record} edit={factEditing} propSave={propEditing} task={taskEditing} />}
            {record.type === 'note' && record.page ? (
              // A note summarises (t7-note-window, 8 Nov 2026): its opening words and what connects in counts,
              // the whole page one click away above — never the page's lists again.
              <div className="peek-summary">
                <h3 className="peek-section-head">Summary</h3>
                {lead ? <p className="peek-lead">{lead}</p> : null}
                {shown.groups.length ? (
                  <ul className="peek-summary-counts">
                    {shown.groups.map((g) => {
                      const open = g.items.filter((x) => isOpenRecord(x.record)).length;
                      return (
                        <li key={g.key}>
                          <span>{g.label}</span>
                          <span className="peek-group-count">{g.key === 'actions' && open !== g.items.length ? `${open} open · ${g.items.length}` : String(g.items.length)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="peek-none">Nothing is connected to this yet. Links, people named in it and the meeting it came from show here.</p>
                )}
              </div>
            ) : shown.groups.length ? (
              <div className="peek-groups">
                {/* A peek summarises (5 Nov 2026, rest-quieten F10: it re-listed the page's full lists): three rows
                    a group, the rest behind Show all, the whole page behind Open full page above. */}
                <h3 className="peek-section-head">Connected</h3>
                {shown.groups.map((g) => (
                  <ConnectedGroupList key={`${record.id}:${g.key}`} g={g} onOpen={onOpen} self={record} shownAtFirst={3} />
                ))}
              </div>
            ) : (
              <p className="peek-none">Nothing is connected to this yet. Links, people named in it and the meeting it came from show here.</p>
            )}
          </EditorContext.Provider>
        )}
      </div>
      {closer}
    </aside>
  );
}
