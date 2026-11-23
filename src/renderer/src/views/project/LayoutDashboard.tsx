// A project's layout dashboard (21 Oct 2026, docs/LAYOUTS.md): generic blocks drawn above the page's own sections, from
// what the project file, its tables and its log notes already say (src/shared/layouts.ts works it out). : every block
// adapts to whatever the project holds, redraws the moment a file changes (with a soft mark on what changed), says
// plainly what to add when it's empty and adds it in one click (contract-correct Markdown, through the page's own edit
// with Undo), and a log takes a new entry from a form built from the log's own fields. No `layout:` and no `blocks:`:
// nothing here shows, except a quiet suggestion worked out from the file's structure. Edited in place (22 Oct 2026):
// every value a block shows changes where it is (views/project/LayoutEdit.tsx has the pieces) — the status band's health,
// status, progress, due date, owner, stage and details; a workstream's name, owner, status, progress and next step, and
// its ⋯ (edit every column, move, mark done, delete); milestones' dates, words and status, and the key dates put in date
// order; tick boxes' words, who and when, dragged into order; a register's cells like a spreadsheet (Enter, Tab, Esc,
// arrows; rows added and deleted); a board's cards dragged between stages; contacts; a log's latest entry (and the ones
// before it), a streak's days, a trend's latest figure and target. Each is one edit of the file that keeps every other
// character, drawn at once, with Undo.

import { useEffect, useMemo, useRef, useState } from 'react';
import { applyProjectEdit, type Project } from '../../../../shared/project-file';
import {
  toneWord, addTableRow, addRunSheetItem, addRunSheetPhase, dashboard, dayInStyle, entriesOf, itemParts, keyLabel, layoutInfo, layoutOf, LAYOUTS, liveWorkstream, moveRunSheetItem, moveTableRow, orderTableRows, parseBlocks, parseLog, pluralNoun, readTable, removeRunSheetItem, removeTableRow, renameRunSheetPhase, sectionText, setLogNote, setLogValue, setRunSheetItem, setTableCell, setTableCells, suggestLayout, toggleRunSheetItem,
  type BlockAdd, type BlockModel, type BoardBlock, type CardsBlock, type CountdownBlock, type EntryBlock, type GridBlock, type LiveProject, type ProgressBlock, type ProgressRow, type StatusBlock, type StreakBlock, type TimelineBlock, type TimelineItem, type TrendBlock, type ActionsBlock, type EntryField, type LogEntry, type LogNote, type BoardCard,
} from '../../../../shared/layouts';
import { firstOwnOpen } from '../../../../shared/project-hub';
import { dayFrom, todayDay } from '../../../../shared/timeline';
import type { StripStop } from '../../../../shared/date-strip';
import type { ProjectView } from '../../../../shared/types';
import { plural } from '../../../../shared/words';
import { Icon, type IconName } from '../../components/Icon';
import { DateStrip } from '../../components/DateStrip';
import { peekRow, RecordScope } from '../../components/RecordScope';
import { openMenu, type MenuItem } from '../../components/Menu';
import { initials, personHue, readDate } from '../../lib/projectLook';
import { todayData } from '../../lib/todayData';
import { addLogEntry } from '../../state/layoutLogs';
import { docs } from '../../state/docs';
import { useLayoutDismissed } from '../../state/vaultShared';
import { loadNotes, showError, toast, useApp } from '../../state/store';
import { AddRow, Inline, InlineDate, niceDate, RowAction, RowActions, useEditor } from './Inline';
import { Words } from './parts';
import { isoWords, Ring, Spark, TrendChart } from './LayoutCharts';
import { CheckList, Choice, choicesFrom, DashContext, More, Pct, Popover, same, useDash, type CheckItem, type Dash } from './LayoutEdit';
import { isEnterKey } from '../../lib/enterKey';

const today = () => new Date();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from shared/words above.
const toneOf = (h?: string) => toneWord(h);
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Words quoted for a message: “Northgate (Tessaly 310582)”. */
// Whole words: change words wrap where they show (t207 pass 2).
const q = (s: string) => `“${s}”`;
const dueWords = (days: number) => (days === 0 ? 'Due today' : days > 0 ? `${plural(days, 'day')} to go` : `${plural(-days, 'day')} overdue`);
const keyName = (field: string) => field.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const normKey = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** The property as the file names it (its own case), else the key given. */
const propKey = (props: Record<string, unknown>, key: string) => Object.keys(props).find((k) => keyName(k) === keyName(key)) ?? key;
const DATE_HEAD = /^(date|due|when|deadline|day|target|on)$/i;

// ── The dashboard ────────────────────────────────────────────────────────────────────────────────────────────────────

const ICONS: Record<BlockModel['type'], IconName> = { status: 'flag', countdown: 'clock', progress: 'task', timeline: 'timeline', board: 'board', grid: 'table', trend: 'chart', streak: 'calendar', entry: 'pencil', cards: 'people', actions: 'forward' };
const WIDE = new Set<BlockModel['type']>(['status', 'progress', 'timeline', 'board', 'grid', 'cards']);
const SET_PROPS = new Set(['health', 'status', 'progress', 'owner', 'due', 'started', 'layout']);

type Shown = { project: Project; props: Record<string, unknown>; logs: LogNote[] };

export function LayoutDashboard({ view, path }: { view: ProjectView; path: string }) {
  const editor = useEditor();
  // An edit shows at once (worked out here with the same rules the file is written with), then the file as written.
  const [local, setLocal] = useState<Shown | null>(null);
  const localRef = useRef(local);
  localRef.current = local;
  const viewRef = useRef(view);
  viewRef.current = view;
  const seq = useRef(0);
  useEffect(() => setLocal(null), [view]);
  const shown: ProjectView = useMemo(() => (local ? { ...view, project: local.project, props: local.props, logs: local.logs } : view), [view, local]);
  const models = useMemo(() => dashboard({ project: shown.project, props: shown.props ?? {}, logs: shown.logs ?? [], today: today() }), [shown]);
  // The folio below draws Your next and Key dates as its own sections — the one place for those lists (13 Nov
  // 2026, the pictures: the dashboard's Next actions and Milestones drew the same lists twice on one page).
  // Blocks reading What's next or Key dates step aside here, presets and own blocks alike.
  const drawn = useMemo(() => models.filter((m) => m.type !== 'actions' && !(m.type === 'timeline' && m.source === 'dates')), [models]);
  // What changed since the last time the page was drawn (a log written, a table edited): marked softly for a moment.
  const seen = useRef<Map<string, string>>(new Map());
  const seenFor = useRef(path);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Another project in this tab: start again (nothing is "changed" on a page just opened).
    if (seenFor.current !== path) {
      seenFor.current = path;
      seen.current = new Map();
    }
    const next = new Set<string>();
    drawn.forEach((m, i) => {
      const key = `${i}:${m.type}`;
      const sig = JSON.stringify(m);
      const was = seen.current.get(key);
      if (was !== undefined && was !== sig) next.add(key);
      seen.current.set(key, sig);
    });
    if (!next.size) return;
    setChanged(next);
    const t = setTimeout(() => setChanged(new Set()), 2200);
    return () => clearTimeout(t);
  }, [drawn]);

  const base = (): Shown => localRef.current ?? { project: viewRef.current.project, props: viewRef.current.props ?? {}, logs: viewRef.current.logs ?? [] };
  const dash: Dash = {
    view: shown,
    path,
    canEdit: editor.canEdit,
    people: editor.known.people.map((x) => ({ value: x.name, hint: x.role })),
    edit: async (change) => {
      if (!editor.canEdit) return false;
      const b = base();
      const project = structuredClone(b.project);
      const props = { ...b.props };
      try {
        applyProjectEdit(project, change, '');
        const put = (k: string, v: unknown) => (v === null || v === '' || v === undefined ? delete props[k] : (props[k] = v));
        if (change.kind === 'prop') put(propKey(props, change.key), change.value);
        if (change.kind === 'set' && SET_PROPS.has(change.field)) put(change.field, change.value);
        const n = ++seq.current;
        setLocal({ project, props, logs: b.logs });
        const ok = await editor.edit(change);
        if (n === seq.current) setLocal(null);
        return ok;
      } catch {
        // (a change the rules refuse: the main side says why in words)
        return editor.edit(change);
      }
    },
    section: (heading, fn, words) => {
      const body = sectionText(base().project, heading);
      const next = fn(body);
      if (next === body) return Promise.resolve(true);
      return dash.edit({ kind: 'section', heading, body: next, ...(words ? { words } : {}) });
    },
    log: async (logPath, fn, words) => {
      if (!editor.canEdit) return false;
      try {
        const before = await docs.readThrough(logPath);
        const after = fn(before);
        if (after === before) return true;
        const b = base();
        seq.current++;
        setLocal({ ...b, logs: b.logs.map((l) => (l.path === logPath ? { ...parseLog(after), path: l.path, title: l.title } : l)) });
        await docs.writeThrough(logPath, after, 'log');
        await loadNotes();
        const name = logPath.split('/').pop()!.replace(/\.md$/i, '');
        toast(words, {
          label: 'Undo',
          run: () =>
            void (async () => {
              // Only when nothing else has changed it since.
              if ((await docs.readThrough(logPath)) !== after) return toast(`${name} has changed since, so it was left as it is.`);
              await docs.writeThrough(logPath, before, 'log');
              await loadNotes();
              toast(`Put ${name} back as it was.`);
            })().catch(showError),
        });
        return true;
      } catch (err) {
        setLocal(null);
        showError(err);
        return false;
      }
    },
  };

  if (!drawn.length) return null;
  // Half-width blocks sit in pairs; one left on its own takes the whole row (no empty half beside it).
  // A trend with its measure charted in full reads best across the page.
  const wideOf = (m: BlockModel) => WIDE.has(m.type) || (m.type === 'trend' && (m.series.length === 1 || m.series.some((x) => x.target !== undefined)));
  const halves = drawn.map((m, i) => (!wideOf(m) && drawn.length > 1 ? i : -1)).filter((i) => i >= 0);
  const alone = halves.length % 2 === 1 ? halves[halves.length - 1] : -1;
  return (
    <DashContext.Provider value={dash}>
      <section className={`ly-dash${editor.canEdit ? ' can-edit' : ''}`} aria-label={`${layoutInfo(layoutOf(shown.props))?.name ?? 'Project'} dashboard`}>
        {drawn.map((m, i) => (
          <Block key={`${i}:${m.type}`} m={m} view={shown} path={path} wide={wideOf(m) || drawn.length === 1 || i === alone} changed={changed.has(`${i}:${m.type}`)} />
        ))}
      </section>
    </DashContext.Provider>
  );
}

function Block({ m, view, path, wide, changed }: { m: BlockModel; view: ProjectView; path: string; wide: boolean; changed: boolean }) {
  const [adding, setAdding] = useState(false);
  const { canEdit } = useEditor();
  // A register adds rows in the grid itself (a new row under the others); the other blocks open a small form.
  const action = canEdit && m.add && !m.empty && m.type !== 'status' && m.type !== 'countdown' && m.type !== 'grid' ? <AddButton add={m.add} m={m} onClick={() => setAdding(true)} /> : null;
  return (
    <article className={`ly-block ly-b-${m.type}${wide ? ' wide' : ''}${m.empty ? ' is-empty' : ''}${changed ? ' is-changed' : ''}`} aria-label={m.title}>
      {m.type !== 'status' && (
        <header className="ly-block-head">
          <Icon name={ICONS[m.type]} size={14} />
          <h3>{m.title}</h3>
          <span className="pj-card-space" />
          {!adding && action}
          {!m.empty && <BlockMenu m={m} />}
        </header>
      )}
      {m.empty ? <Empty m={m} view={view} path={path} adding={adding} setAdding={setAdding} /> : <BlockBody m={m} path={path} />}
      {adding && !m.empty && m.add && <AddForm add={m.add} view={view} path={path} m={m} onDone={() => setAdding(false)} />}
    </article>
  );
}

/** A block's own ⋯ when it has something to offer (the key dates put in date order). */
function BlockMenu({ m }: { m: BlockModel }) {
  const dash = useDash();
  if (m.type !== 'timeline') return null;
  const order = timelineOrder(m, dash.view.project);
  if (!order) return null;
  return (
    <More
      label={`More for ${m.title}`}
      className="ly-head-more"
      items={() => [
        {
          label: 'Put in date order',
          icon: 'sort',
          hint: 'In the file too',
          run: () => void (m.source === 'dates' ? dash.edit({ kind: 'order', list: 'dates', order }) : dash.section(m.section, (b) => orderTableRows(b, order), `Put ${m.section} in date order.`)),
        },
      ]}
    />
  );
}

/** The order a timeline's rows take by date (undated last), when the file has them in another order; else null. */
function timelineOrder(m: TimelineBlock, p: Project): number[] | null {
  if (m.source === 'dates') {
    const order = m.items.map((x) => x.index!).filter((x) => x !== undefined);
    return order.length === p.dates.length && order.some((x, i) => x !== i) ? order : null;
  }
  const t = readTable(sectionText(p, m.section));
  if (!t) return null;
  const listed = m.items.map((x) => x.row!).filter((x) => x !== undefined);
  const order = [...listed, ...t.rows.map((_, i) => i).filter((i) => !listed.includes(i))];
  return order.some((x, i) => x !== i) ? order : null;
}

function BlockBody({ m, path }: { m: BlockModel; path: string }) {
  switch (m.type) {
    case 'status':
      return <Status m={m} />;
    case 'countdown':
      return <Countdown m={m} />;
    case 'progress':
      return <Progress m={m} path={path} />;
    case 'timeline':
      return <Timeline m={m} path={path} />;
    case 'board':
      return <Board m={m} path={path} />;
    case 'grid':
      return <Grid m={m} path={path} />;
    case 'trend':
      return <Trend m={m} />;
    case 'streak':
      return <Streak m={m} />;
    case 'entry':
      return <Entry m={m} path={path} />;
    case 'cards':
      return <Cards m={m} />;
    case 'actions':
      return <Actions m={m} path={path} />;
  }
}

// ── Empty blocks: what to add, and adding it ─────────────────────────────────────────────────────────────────────────

const ADD_WORDS: Record<BlockAdd['kind'], string> = { row: 'Add a row', date: 'Add a milestone', phase: 'Add a phase', entry: 'Add an entry', prop: 'Set the date', next: 'Add a next step' };

function addWords(add: BlockAdd, m: BlockModel): string {
  if (add.kind === 'row') {
    const s = add.section.toLowerCase();
    if (/workstream/.test(s)) return 'Add a workstream';
    if (/contact|supplier|people/.test(s)) return 'Add a contact';
    if (/pipeline|campaign/.test(s)) return 'Add an item';
    if (m.type === 'grid' && m.of) return `Add ${/^[aeiou]/i.test(pluralNoun(m.of, 1)) ? 'an' : 'a'} ${pluralNoun(m.of, 1)}`;
    return 'Add a row';
  }
  if (add.kind === 'prop') return add.label;
  return ADD_WORDS[add.kind];
}

function emptyWords(m: BlockModel): string {
  switch (m.type) {
    case 'status':
      return 'Nothing to show yet: give the project a health, progress or due date (at the top of the page), or properties such as a phase or budget.';
    case 'countdown':
      return `No date to count down to yet. Set ${m.what === 'the due date' ? 'a due date' : `the date for ${m.what}`} and the days left show here.`;
    case 'progress':
      return m.add?.kind === 'phase' ? `Add the first phase of ${m.section.toLowerCase()} (for example “Eight weeks out”) with its tick boxes, and progress shows phase by phase.` : m.add?.kind === 'next' ? 'No next steps yet: add one and progress shows as they’re ticked off.' : `Add a row to ${m.section} with a Progress column (a number or %) and each one shows with its bar.`;
    case 'timeline':
      return m.source === 'dates' ? 'No key dates yet. Add a milestone and it shows on the timeline, with today marked.' : `${m.section} has no dated rows yet. Add one with a Due date and it shows here.`;
    case 'board':
      return `${m.section} has nothing in it yet. Add an item with a Stage and the board makes a column for each stage.`;
    case 'grid':
      return `${m.section} has no rows yet. Add one and it shows as a grid you can sort and filter, with totals.`;
    case 'trend':
      return 'No numbers logged yet. Add an entry with a number (a measurement, a count, a score) and it’s charted here.';
    case 'streak':
      return 'Nothing to count yet. Log a yes or no each day (for example “- Done: Y”), or set a streak start, and the days show here.';
    case 'entry':
      return m.logs.length ? 'The log has no entries yet. Add the first one.' : 'This project has no log yet. Start one with what you want to keep track of, and each day’s entry shows here.';
    case 'cards':
      return 'No one listed yet. Add a contact with their role and how to reach them.';
    case 'actions':
      return 'Nothing open. Add a next step and the first five show here.';
  }
}

function Empty({ m, view, path, adding, setAdding }: { m: BlockModel; view: ProjectView; path: string; adding: boolean; setAdding(v: boolean): void }) {
  const { canEdit } = useEditor();
  return (
    <div className="ly-empty">
      <p>{emptyWords(m)}</p>
      {canEdit && m.add && !adding && (
        <button className="button ly-empty-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> {addWords(m.add, m)}
        </button>
      )}
      {adding && m.add && <AddForm add={m.add} view={view} path={path} m={m} onDone={() => setAdding(false)} />}
    </div>
  );
}

function AddButton({ add, m, onClick }: { add: BlockAdd; m: BlockModel; onClick(): void }) {
  return (
    <button className="ly-head-add" onClick={onClick} title={addWords(add, m)}>
      <Icon name="plus" size={12} />
      <span>{add.kind === 'entry' ? 'Add entry' : addWords(add, m).replace(/^Add an? /, 'Add ')}</span>
    </button>
  );
}

interface FormField {
  name: string;
  kind: 'text' | 'date' | 'yes' | 'number';
  unit?: string;
  required?: boolean;
  placeholder?: string;
}

/** One small form for every kind of add (and for editing a row's every column): its fields, Enter to save, Esc to leave it. */
function Form({ fields, submit, onDone, words = 'Add', lead, initial }: { fields: FormField[]; submit(values: Record<string, string>): Promise<boolean>; onDone(): void; words?: string; lead?: React.ReactNode; initial?: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(() => initial ?? Object.fromEntries(fields.filter((f) => f.kind === 'date' && f.name === 'Date').map((f) => [f.name, isoToday()])));
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const missing = fields.some((f) => f.required && !values[f.name]?.trim());
  const go = async () => {
    if (missing || busy) return;
    setBusy(true);
    const ok = await submit(values);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form
      className="ly-form"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      {lead}
      <div className="ly-form-fields">
        {fields.map((f, i) => (
          <label key={f.name} className={`ly-field kind-${f.kind}`}>
            <span className="ly-field-name">
              {f.name}
              {f.unit ? <span className="ly-faint"> ({f.unit})</span> : null}
            </span>
            {f.kind === 'yes' ? (
              <span className="ly-yesno" role="radiogroup" aria-label={f.name}>
                {['Y', 'N'].map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={values[f.name] === v} className={values[f.name] === v ? 'on' : ''} onClick={() => setValues((x) => ({ ...x, [f.name]: x[f.name] === v ? '' : v }))}>
                    {v === 'Y' ? 'Yes' : 'No'}
                  </button>
                ))}
              </span>
            ) : (
              <input
                ref={i === 0 ? first : undefined}
                type={f.kind === 'date' ? 'date' : 'text'}
                inputMode={f.kind === 'number' ? 'decimal' : undefined}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                aria-required={f.required}
                onChange={(e) => setValues((x) => ({ ...x, [f.name]: e.target.value }))}
              />
            )}
          </label>
        ))}
      </div>
      <div className="ly-form-foot">
        <button type="submit" className="button primary" disabled={missing || busy}>
          {words}
        </button>
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * A table row's every column in one form (a card's Edit…): dates with the calendar (written as the column writes days),
 * only the cells changed written.
 */
function RowForm({ section, head, row, title, onDone }: { section: string; head: string[]; row: number; title: string; onDone(): void }) {
  const dash = useDash();
  const t = readTable(sectionText(dash.view.project, section));
  const cells = t?.rows[row] ?? [];
  const isDate = (i: number) => DATE_HEAD.test(head[i]?.trim() ?? '') && (!(cells[i] ?? '').trim() || readDate(cells[i]) !== null);
  const initial = Object.fromEntries(head.map((h, i) => [h, isDate(i) && cells[i]?.trim() ? isoOf(cells[i]) : (cells[i] ?? '')]));
  return (
    <Form
      fields={head.map((h, i) => ({ name: h, kind: isDate(i) ? 'date' : 'text', required: i === 0 }))}
      initial={initial}
      words="Save"
      submit={(v) => {
        const changes: Record<number, string> = {};
        head.forEach((h, i) => {
          const was = initial[h] ?? '';
          const now = (v[h] ?? '').trim();
          if (now === was.trim()) return;
          changes[i] = isDate(i) && now ? dayInStyle(now, (t?.rows ?? []).map((r) => r[i] ?? '')) : now;
        });
        if (!Object.keys(changes).length) return Promise.resolve(true);
        return dash.section(section, (b) => setTableCells(b, row, changes), `Changed ${q(title)}.`);
      }}
      onDone={onDone}
    />
  );
}

/** A day written in a cell as YYYY-MM-DD for the calendar. */
function isoOf(text: string): string {
  const ms = readDate(text);
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function AddForm({ add, view, path, m, onDone }: { add: BlockAdd; view: ProjectView; path: string; m: BlockModel; onDone(): void }) {
  const { edit } = useEditor();
  const p = view.project;
  switch (add.kind) {
    case 'row':
      return (
        <Form
          fields={add.head.map((h, i) => ({ name: h, kind: /^(date|due|when|deadline)$/i.test(h) ? 'date' : 'text', required: i === 0 }))}
          submit={(v) => {
            const values = Object.fromEntries(add.head.map((h) => [h, /^(date|due|when|deadline)$/i.test(h) && v[h] ? isoWords(v[h], true) : (v[h] ?? '')]));
            return edit({ kind: 'section', heading: add.section, body: addTableRow(sectionText(p, add.section), add.head, values) });
          }}
          onDone={onDone}
        />
      );
    case 'date':
      return (
        <Form
          fields={[
            { name: 'Date', kind: 'date', required: true },
            { name: 'Milestone', kind: 'text', required: true },
            { name: 'Status', kind: 'text', placeholder: 'next, done, at risk…' },
          ]}
          submit={(v) => edit({ kind: 'add', list: 'dates', item: { when: isoWords(v.Date, true), what: v.Milestone, status: v.Status ?? '' } })}
          onDone={onDone}
        />
      );
    case 'phase': {
      const phases = m.type === 'progress' ? m.phases : [];
      return (
        <Form
          fields={[
            { name: 'Phase', kind: 'text', required: true, placeholder: phases.length ? phases[phases.length - 1].name : 'Eight weeks out' },
            { name: 'First tick box', kind: 'text', required: true },
          ]}
          submit={(v) => {
            const body = sectionText(p, add.section);
            const next = phases.some((x) => x.name.toLowerCase() === v.Phase.trim().toLowerCase()) ? addRunSheetItem(body, v.Phase, v['First tick box']) : addRunSheetPhase(body, v.Phase, v['First tick box']);
            return edit({ kind: 'section', heading: add.section, body: next });
          }}
          onDone={onDone}
        />
      );
    }
    case 'prop':
      return <Form fields={[{ name: keyLabel(add.key), kind: add.date ? 'date' : 'text', required: true }]} submit={(v) => (add.key === 'due' ? edit({ kind: 'set', field: 'due', value: v[keyLabel(add.key)] }) : edit({ kind: 'prop', key: add.key, value: v[keyLabel(add.key)] }))} words="Set" onDone={onDone} />;
    case 'next':
      return (
        <Form
          fields={[
            { name: 'Next step', kind: 'text', required: true },
            { name: 'Who', kind: 'text' },
            { name: 'By', kind: 'date' },
          ]}
          submit={(v) => edit({ kind: 'add', list: 'next', item: { what: v['Next step'], who: v.Who ?? '', when: v.By ? isoWords(v.By, true) : '' } })}
          onDone={onDone}
        />
      );
    case 'entry':
      return <EntryForm view={view} path={path} onDone={onDone} />;
  }
}

/** A new log entry: the log's own fields (yes/no as a choice, numbers with their unit), a day, and a note. */
function EntryForm({ view, path, onDone }: { view: ProjectView; path: string; onDone(): void }) {
  const entry = dashboardEntry(view);
  const [named, setNamed] = useState<EntryField[] | null>(null);
  // With several logs (a check-in, a weigh-in, a weekly review), the entry goes into the one chosen, in its own fields.
  const [which, setWhich] = useState(0);
  const log = entry.logs[Math.min(which, entry.logs.length - 1)];
  const fields = named ?? (log ? (log.fields.length ? log.fields : entry.fields) : entry.fields);
  const choose =
    entry.logs.length > 1 ? (
      <div className="ly-log-choice" role="radiogroup" aria-label="Which log">
        {entry.logs.map((l, i) => (
          <button key={l.path} type="button" role="radio" aria-checked={l === log} className={`ly-filter${l === log ? ' on' : ''}`} onClick={() => setWhich(i)}>
            {l.title}
          </button>
        ))}
      </div>
    ) : undefined;
  if (!fields.length)
    return (
      <Form
        fields={[{ name: 'What to keep track of', kind: 'text', required: true, placeholder: 'For example: Score, Hours, Done' }]}
        words="Next"
        submit={async (v) => {
          const names = v['What to keep track of'].split(',').map((x) => x.trim()).filter(Boolean);
          // A newly named field is words until its values say otherwise (fnv3 F40): never assumed a number.
          setNamed(names.map((name) => ({ name, kind: 'text', unit: '' })));
          return false;
        }}
        onDone={onDone}
      />
    );
  return (
    <Form
      key={log?.path ?? 'new'}
      lead={choose}
      fields={[{ name: 'Date', kind: 'date', required: true }, ...fields.map((f) => ({ name: f.name, kind: f.kind === 'yes' ? ('yes' as const) : ('text' as const), unit: f.unit, placeholder: f.kind === 'number' ? 'A number' : f.kind === 'text' ? '' : undefined })), { name: 'Note', kind: 'text' as const }]}
      words={entry.logs.length ? 'Add entry' : 'Start the log'}
      submit={(v) => {
        const values: Record<string, string> = {};
        for (const f of fields) {
          const raw = (v[f.name] ?? '').trim();
          if (!raw) continue;
          values[f.name] = f.kind === 'number' && f.unit && /^-?[\d.,]+$/.test(raw) ? `${raw} ${f.unit}` : raw;
        }
        const [y, mo, d] = (v.Date || isoToday()).split('-').map(Number);
        return addLogEntry({
          project: view.project.name,
          projectPath: path,
          log: log?.path,
          entry: { date: new Date(y, mo - 1, d), values, notes: v.Note?.trim() ? [v.Note.trim()] : [] },
          fields: fields.filter((f) => f.kind !== 'text').map((f) => f.name),
        });
      }}
      onDone={onDone}
    />
  );
}

/** The entry block's facts for a project, whether or not the dashboard shows that block. */
function dashboardEntry(view: ProjectView): EntryBlock {
  const m = dashboard({ project: view.project, props: { ...(view.props ?? {}), blocks: ['entry'] }, logs: view.logs ?? [], today: today() })[0];
  return m as EntryBlock;
}

// ── The blocks ───────────────────────────────────────────────────────────────────────────────────────────────────────

const HEALTHS = ['on track', 'at risk', 'off track'];
const STATUSES = ['idea', 'planning', 'active', 'on hold', 'done'];
const AIMS = ['goal', 'objective', 'aim'];

function Status({ m }: { m: StatusBlock }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const p = dash.view.project;
  const props = dash.view.props ?? {};
  const [ring, setRing] = useState(false);
  const tone = toneOf(m.health);
  const set = (field: 'health' | 'status' | 'progress' | 'owner' | 'due', value: string | number | null) => dash.edit({ kind: 'set', field, value: value === '' ? null : value });
  const prop = (key: string, value: string) => dash.edit({ kind: 'prop', key: propKey(props, key), value: value.trim() ? value : null });
  const aimKey = Object.keys(props).find((k) => AIMS.includes(k.toLowerCase()));
  const scrollTo = (item: string) => document.querySelector(`[data-item-card="${item}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return (
    <div className="ly-status-band">
      {(m.progress !== undefined || canEdit) && (
        <div className="ly-ring-wrap">
          <button type="button" className={`ly-ring-button${m.progress === undefined ? ' is-unset' : ''}`} disabled={!canEdit} onClick={() => setRing((x) => !x)} aria-haspopup="dialog" aria-expanded={ring} title={canEdit ? 'Change how far through it is' : undefined}>
            <Ring value={(m.progress ?? 0) / 100} size={84} stroke={7} tone={tone === 'none' ? 'accent' : tone} label={m.progress !== undefined ? `${m.progress}% done` : 'No progress set'}>
              {m.progress !== undefined ? (
                <>
                  <strong>{m.progress}%</strong>
                  <span>done</span>
                </>
              ) : (
                <span className="ly-ring-set">Set progress</span>
              )}
            </Ring>
          </button>
          {ring && (
            <Popover onClose={() => setRing(false)} className="ly-ring-pop">
              <p className="ly-label">How far through</p>
              <Pct value={m.progress ?? 0} label="Progress" tone={tone === 'none' ? 'accent' : tone} onSave={(n) => set('progress', n)} />
              <div className="ly-pop-steps" role="group" aria-label="Quick values">
                {[0, 25, 50, 75, 100].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`ly-filter${m.progress === n ? ' on' : ''}`}
                    onClick={() => {
                      void set('progress', n);
                      setRing(false);
                    }}
                  >
                    {n}%
                  </button>
                ))}
              </div>
              {m.progress !== undefined && (
                <button
                  type="button"
                  className="ly-pop-clear"
                  onClick={() => {
                    void set('progress', null);
                    setRing(false);
                  }}
                >
                  Clear progress
                </button>
              )}
            </Popover>
          )}
        </div>
      )}
      <div className="ly-status-words">
        <div className="ly-status-top">
          <Choice value={p.health ?? ''} options={HEALTHS} label="Health" tone={tone} placeholder="+ Health" onSave={(v) => set('health', v)} />
          <Choice value={p.status ?? ''} options={STATUSES} label="Status" tone="none" dot={false} className="ly-status-word" placeholder="+ Status" onSave={(v) => set('status', v)} />
          <InlineDate value={p.due} iso quiet label="Due date" placeholder="+ Due date" className={`ly-due tone-${m.due ? (m.due.days < 0 ? 'bad' : m.due.days <= 7 ? 'warn' : 'none') : 'none'}`} onSave={(v) => set('due', v)}>
            {m.due ? `${dueWords(m.due.days)} · ${isoWords(m.due.date)}` : p.due ? `Due ${niceDate(p.due)}` : undefined}
          </InlineDate>
          {m.open > 0 && (
            <button type="button" className="ly-count-link" onClick={() => scrollTo('next')}>
              {plural(m.open, 'next step')} open
            </button>
          )}
          {m.risks > 0 && (
            <button type="button" className="ly-count-link" onClick={() => scrollTo('risks')}>
              {plural(m.risks, 'open risk')}
            </button>
          )}
          {canEdit && (
            <div className="ly-add-detail" title="Add a detail of your own (a sponsor, a budget, a phase…)">
              <AddRow
                label="Detail"
                fields={[
                  { key: 'name', placeholder: 'Detail (Sponsor, Budget, Phase…)', required: true },
                  { key: 'value', placeholder: 'What it is', required: true, grow: true },
                ]}
                onAdd={(v) => prop(keyName(v.name), v.value)}
              />
            </div>
          )}
        </div>
        {(m.aim || (canEdit && aimKey)) && aimKey && <Inline value={m.aim ?? ''} label={keyLabel(aimKey)} placeholder={`+ ${keyLabel(aimKey)}`} className="ly-aim" onSave={(v) => prop(aimKey, v)} />}
        {m.steps && (
          <ol className="ly-steps" aria-label={keyLabel(m.steps.key)}>
            {m.steps.names.map((s, i) => {
              const state = i < m.steps!.current ? 'done' : i === m.steps!.current ? 'now' : '';
              const inner = (
                <>
                  <span className="ly-step-dot">{i < m.steps!.current ? <Icon name="check" size={10} /> : null}</span>
                  <span>{s}</span>
                </>
              );
              return (
                <li key={s} className={state} aria-current={i === m.steps!.current ? 'step' : undefined}>
                  {canEdit ? (
                    <button type="button" className="ly-step" title={i === m.steps!.current ? `${keyLabel(m.steps!.key)}: ${s}` : `Move the ${m.steps!.key} to ${s}`} onClick={() => i !== m.steps!.current && void prop(m.steps!.key, /^[a-z]/.test(String(props[propKey(props, m.steps!.key)] ?? '')) ? s.toLowerCase() : s)}>
                      {inner}
                    </button>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <dl className="ly-facts">
          {(p.owner || canEdit) && (
            <div>
              <dt>Owner</dt>
              <dd className="ly-owner">
                {p.owner && (
                  <span className="pj-avatar small" style={{ ['--hue' as string]: personHue(p.owner) }}>
                    {initials(p.owner)}
                  </span>
                )}
                <RecordScope at={p.owner ? { type: 'person', name: p.owner } : null}>
                  <Inline compact value={p.owner ?? ''} label="Owner" placeholder="+ Owner" suggest={dash.people} onSave={(v) => set('owner', v)} />
                </RecordScope>
              </dd>
            </div>
          )}
          {m.facts.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{f.kind === 'date' ? <InlineDate value={f.raw} iso label={f.label} onSave={(v) => prop(f.key, v)}>{f.value}</InlineDate> : f.kind === 'link' ? <LinkFact url={f.value} label={f.label} onSave={(v) => prop(f.key, v)} /> : <Inline value={f.raw} label={f.label} onSave={(v) => prop(f.key, v)} />}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** A web address among the details: opens with a click; its pencil (or Enter) edits it. */
function LinkFact({ url, label, onSave }: { url: string; label: string; onSave(v: string): Promise<boolean> }) {
  const { canEdit } = useEditor();
  const [editing, setEditing] = useState(false);
  if (editing) return <Inline value={url} autoEdit label={label} onDone={() => setEditing(false)} onSave={onSave} />;
  return (
    <span className="ly-link-fact">
      <a href={url} target="_blank" rel="noreferrer" className="ly-link">
        {url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
        <Icon name="external" size={11} />
      </a>
      {canEdit && (
        <button type="button" className="ly-pencil" title={`Change the ${label.toLowerCase()}`} aria-label={`Change the ${label.toLowerCase()}`} onClick={() => setEditing(true)}>
          <Icon name="pencil" size={11} />
        </button>
      )}
    </span>
  );
}

const SITE_KINDS = ['opening', 'close', 'event', 'pop-up'];

function Countdown({ m }: { m: CountdownBlock }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const p = dash.view.project;
  const props = dash.view.props ?? {};
  const d = m.days ?? 0;
  const big = Math.abs(d);
  const raw = (key: string) => (key === 'due' ? String(props[propKey(props, 'due')] ?? p.due ?? '') : String(props[propKey(props, key)] ?? ''));
  // The day shown: the start while it's still ahead (the countdown is to the start), else the key it counts to.
  const startKey = props[propKey(props, 'start')] !== undefined ? propKey(props, 'start') : 'started';
  const setDay = (key: string, v: string) => (key === 'due' || key === 'started' ? dash.edit({ kind: 'set', field: key, value: v || null }) : dash.edit({ kind: 'prop', key: propKey(props, key), value: v || null }));
  const shownKey = m.what === 'the start' ? startKey : m.key;
  const shownRaw = shownKey === 'started' ? (p.started ?? '') : raw(shownKey);
  const kindMenu = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [{ heading: 'What the day is' }, ...SITE_KINDS.map((k) => ({ label: cap(k), checked: same(String(props[propKey(props, 'site_kind')] ?? ''), k), run: () => void dash.edit({ kind: 'prop', key: propKey(props, 'site_kind'), value: k }) }))]);
  const words = d > 0 ? `to ${m.what}` : d === 0 ? `${cap(m.what.replace(/^the /, ''))} is today` : `since ${m.what}`;
  return (
    <div className={`ly-count tone-${m.tone}${m.period ? ' has-period' : ''}`}>
      <div className="ly-count-figure">
        <strong>{d === 0 ? 'Today' : big}</strong>
        {d !== 0 && <span>{big === 1 ? 'day' : 'days'}</span>}
      </div>
      {canEdit && /^go_?live$/i.test(m.key) && m.what !== 'the start' ? (
        <button type="button" className="ly-count-words ly-count-kind" onClick={kindMenu} aria-haspopup="menu" title="What the day is (opening, close, event, pop-up)">
          {words}
          <Icon name="chevronDown" size={11} />
        </button>
      ) : (
        <p className="ly-count-words">{words}</p>
      )}
      <p className="ly-faint ly-count-date">
        <InlineDate value={shownRaw} iso clearable={false} label={keyLabel(shownKey === 'started' ? 'start' : shownKey)} className="ly-count-day" onSave={(v) => setDay(shownKey, v)}>
          {m.date && isoWords(m.date, true)}
        </InlineDate>
        {(m.address || (canEdit && /^go_?live$/i.test(m.key))) && (
          <>
            {m.address ? ' · ' : ' '}
            <Inline value={m.address ?? ''} quiet placeholder="+ Address" label="Address" className="ly-count-address" onSave={(v) => dash.edit({ kind: 'prop', key: propKey(props, 'address'), value: v || null })} />
          </>
        )}
      </p>
      {m.period && (
        <div className="ly-period" title={`${isoWords(m.period.start)} to ${isoWords(m.period.end)}`}>
          <div className="ly-period-words">
            {m.period.week === 0 ? (
              <>
                <span>
                  {m.period.weeks} {m.period.weeks === 1 ? 'week' : 'weeks'}
                </span>
                <span className="ly-faint">
                  <InlineDate value={startKey === 'started' ? (p.started ?? '') : raw(startKey)} iso clearable={false} label="Start" onSave={(v) => setDay(startKey, v)}>
                    {isoWords(m.period.start)}
                  </InlineDate>{' '}
                  to{' '}
                  <InlineDate value={raw(m.key)} iso clearable={false} label={keyLabel(m.key)} onSave={(v) => setDay(m.key, v)}>
                    {isoWords(m.period.end, true)}
                  </InlineDate>
                </span>
              </>
            ) : (
              <>
                <span>
                  Week {m.period.week} of {m.period.weeks}
                </span>
                <span className="ly-faint">{Math.round(m.period.fraction * 100)}% of the way</span>
              </>
            )}
          </div>
          <div className="ly-bar">
            <span style={{ width: `${m.period.week === 0 ? 0 : Math.max(2, m.period.fraction * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ m, path }: { m: ProgressBlock; path: string }) {
  if (m.mode === 'table') return <Streams m={m} path={path} />;
  return <Phases m={m} path={path} />;
}

/** The usual workstream states, after the person's own (the peek's workstream status offers the same). */
export const STREAM_STATUSES = ['Not started', 'On track', 'At risk', 'Off track', 'Done'];

/** A table with a Progress column as cards: every part edited where it is, and each card's ⋯. */
function Streams({ m, path }: { m: ProgressBlock; path: string }) {
  const dash = useDash();
  const [editing, setEditing] = useState<number | null>(null);
  // Live rows (p12-close-and-noise C): every project with the person's own next step in it, read again as the vault
  // changes, so a row named for a project never goes stale. Null while reading: rows show as typed until then.
  const revision = useApp((s) => s.revision);
  const [live, setLive] = useState<LiveProject[] | null>(null);
  useEffect(() => {
    let on = true;
    Promise.all([window.nv.projects.all(), todayData().catch(() => null)]).then(
      ([all, d]) => {
        if (!on) return;
        const day = todayDay();
        setLive(all.map(({ project: p }) => ({ name: p.name, status: p.status, health: p.health, progress: p.progress, firstOwn: firstOwnOpen(p, d?.me ?? p.owner ?? '', day) })));
      },
      () => on && setLive([]),
    );
    return () => void (on = false);
  }, [revision]);
  const c = m.cols!;
  const head = m.head ?? [];
  const t = readTable(sectionText(dash.view.project, m.section));
  // A figure written as the row writes it ("60" or "60%"), else as most of the column does.
  const filled = (t?.rows ?? []).map((r) => (r[c.progress] ?? '').trim()).filter(Boolean);
  const columnPct = filled.filter((x) => /%$/.test(x)).length > filled.length / 2 ? '%' : '';
  const pctOf = (r: ProgressRow) => {
    const own = (t?.rows[r.row]?.[c.progress] ?? '').trim();
    return own ? (/%$/.test(own) ? '%' : '') : columnPct;
  };
  const statuses = choicesFrom(m.rows.map((r) => r.status), STREAM_STATUSES);
  const doneWord = statuses.find((s) => /^(done|complete|completed)$/i.test(s)) ?? 'Done';
  const cell = (r: ProgressRow, col: number, v: string, words: string) => (col >= 0 ? dash.section(m.section, (b) => setTableCell(b, r.row, col, v), words) : undefined);
  const move = (k: number, to: number) => {
    const r = m.rows[k];
    const other = m.rows[to];
    if (!other) return;
    void dash.section(m.section, (b) => moveTableRow(b, r.row, other.row), `Moved ${q(r.name)} ${to < k ? 'up' : 'down'}.`);
  };
  const menu = (r: ProgressRow, k: number): MenuItem[] => [
    { label: 'Edit…', icon: 'pencil', hint: 'Every column', run: () => setEditing(r.row) },
    { label: 'Move up', icon: 'back', disabled: k === 0, run: () => move(k, k - 1) },
    { label: 'Move down', icon: 'forward', disabled: k === m.rows.length - 1, run: () => move(k, k + 1) },
    ...(c.status >= 0 || c.progress >= 0
      ? [{ label: 'Mark done', icon: 'check' as const, disabled: same(r.status, doneWord) && (c.progress < 0 || r.progress === 100), run: () => void dash.section(m.section, (b) => setTableCells(b, r.row, { ...(c.status >= 0 ? { [c.status]: doneWord } : {}), ...(c.progress >= 0 ? { [c.progress]: `100${pctOf(r)}` } : {}) }), `Marked ${q(r.name)} done.`) }]
      : []),
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, run: () => void dash.section(m.section, (b) => removeTableRow(b, r.row), `Deleted ${q(r.name)}.`) },
  ];
  return (
    <>
      {m.overall !== undefined ? (
        <div className="ly-overall">
          <span className="ly-overall-figure">{m.overall}%</span>
          <span className="ly-faint">across {m.rows.length} {/s$/i.test(m.section) && !/\s/.test(m.section.trim()) ? m.section.toLowerCase() : m.rows.length === 1 ? 'row' : 'rows'}</span>
          <div className="ly-bar wide">
            <span style={{ width: `${Math.max(2, m.overall)}%` }} />
          </div>
        </div>
      ) : (
        m.total > 1 &&
        m.done > 0 && (
          // Not every row has a figure: how many are done, never an average of the few that do.
          <div className="ly-overall">
            <span className="ly-overall-figure">
              {m.done} of {m.total}
            </span>
            <span className="ly-faint">done</span>
            <div className="ly-bar wide">
              <span style={{ width: `${Math.max(2, (m.done / m.total) * 100)}%` }} />
            </div>
          </div>
        )
      )}
      <ul className="ly-streams">
        {m.rows.map((r, k) => {
          // A row named for a project reads live (display only: the note's text stays as typed); any part the
          // project doesn't have falls back to the typed row.
          const lv = live ? liveWorkstream(r.name, live) : null;
          const liveTitle = `Live from the ${r.name} project: open it to change`;
          const statusLive = !!(lv && lv.status);
          const progressLive = !!(lv && lv.progress !== undefined);
          const nextLive = !!(lv && lv.next);
          const status = statusLive ? lv!.status : r.status;
          const tone = statusLive ? toneOf(lv!.status) : r.tone;
          const progress = progressLive ? lv!.progress : r.progress;
          const next = nextLive ? lv!.next : r.next;
          return (
          <li
            key={`${r.row}:${r.name}`}
            className={`ly-stream tone-${tone}${editing === r.row ? ' is-editing' : ''}`}
            {...peekRow({ type: 'workstream', path, title: r.name })}
            onKeyDown={(e) => {
              if (!dash.canEdit || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || (e.target as Element).closest('textarea, input')) return;
              e.preventDefault();
              move(k, e.key === 'ArrowUp' ? k - 1 : k + 1);
            }}
          >
            <RecordScope at={{ type: 'workstream', path, title: r.name }}>
              <div className={`ly-stream-top${r.name.length + status.length > 34 ? ' is-long' : ''}`}>
                <Inline value={r.name} required label="Name" className="ly-stream-name" onSave={(v) => cell(r, c.name, v, `Renamed ${q(r.name)} to ${q(v)}.`)}>
                  <Words text={r.name} from={path} />
                </Inline>
                <span className="ly-stream-acts">
                  {c.status >= 0 &&
                    (statusLive ? (
                      <span className={`pj-pill tone-${tone}`} title={liveTitle}>
                        <span className="pj-dot" />
                        {cap(status)}
                      </span>
                    ) : (
                      <Choice value={r.status} options={statuses} label={head[c.status] ?? 'Status'} tone={r.tone} onSave={(v) => cell(r, c.status, v, v ? `Set ${q(r.name)} to ${cap(v)}.` : `Cleared the status of ${q(r.name)}.`)} />
                    ))}
                  <More label={`More for ${r.name}`} items={() => menu(r, k)} />
                </span>
              </div>
              {c.progress >= 0 && progress !== undefined && (
                <div className="ly-stream-bar">
                  {progressLive ? (
                    <span className="ly-pct" title={liveTitle}>
                      <span className="ly-bar">
                        <span style={{ width: `${Math.max(2, progress)}%` }} />
                      </span>
                      <span className="ly-pct-figure">{progress}%</span>
                    </span>
                  ) : (
                    <Pct value={r.progress} label={`${head[c.progress] ?? 'Progress'} of ${r.name}`} tone={r.tone === 'none' ? 'accent' : r.tone} onSave={(n) => cell(r, c.progress, n === null ? '' : `${n}${pctOf(r)}`, n === null ? `Cleared the progress of ${q(r.name)}.` : `Set ${q(r.name)} to ${n}%.`)} />
                  )}
                </div>
              )}
              <div className="ly-stream-foot">
                {(c.owner >= 0 || (c.progress >= 0 && progress === undefined)) && (
                  <span className="ly-stream-who">
                    {c.owner >= 0 && (
                      <span className="ly-person">
                        {r.owner && (
                          <span className="pj-avatar small" style={{ ['--hue' as string]: personHue(r.owner) }}>
                            {initials(r.owner)}
                          </span>
                        )}
                        <RecordScope at={r.owner ? { type: 'person', name: r.owner } : null}>
                          <Inline compact value={r.owner} quiet placeholder="+ Owner" label={head[c.owner] ?? 'Owner'} suggest={dash.people} onSave={(v) => cell(r, c.owner, v, v ? `${v} owns ${q(r.name)}.` : `Took the owner off ${q(r.name)}.`)} />
                        </RecordScope>
                      </span>
                    )}
                    {/* No figure yet: "+ Progress" over the card starts the slider (a figure then shows its bar above). */}
                    {c.progress >= 0 && progress === undefined && <Pct value={undefined} label={`${head[c.progress] ?? 'Progress'} of ${r.name}`} onSave={(n) => cell(r, c.progress, n === null ? '' : `${n}${pctOf(r)}`, `Set ${q(r.name)} to ${n}%.`)} />}
                  </span>
                )}
                {c.next >= 0 && (
                  <span className="ly-stream-next">
                    {next && <span className="ly-faint">Next: </span>}
                    {nextLive ? (
                      <span title={liveTitle}>
                        <Words text={next} from={path} />
                      </span>
                    ) : (
                      <Inline value={r.next} quiet placeholder="+ Next step" label={head[c.next] ?? 'Next step'} onSave={(v) => cell(r, c.next, v, `Changed the next step of ${q(r.name)}.`)}>
                        <Words text={r.next} from={path} />
                      </Inline>
                    )}
                  </span>
                )}
              </div>
            </RecordScope>
            {editing === r.row && <RowForm section={m.section} head={head} row={r.row} title={r.name} onDone={() => setEditing(null)} />}
          </li>
          );
        })}
      </ul>
    </>
  );
}

/** A run sheet's phases (or What's next as one list): tabs, and each phase's tick boxes edited where they are. */
function Phases({ m, path }: { m: ProgressBlock; path: string }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const [open, setOpen] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const shown = Math.min(open ?? m.current, Math.max(0, m.phases.length - 1));
  const phase = m.phases[shown];
  const sec = (fn: (b: string) => string, words: string) => dash.section(m.section, fn, words);
  const sheetItems: CheckItem[] = (phase?.items ?? []).map((it) => {
    const parts = itemParts(it.what);
    return { key: it.line, done: it.done, what: parts.what, who: parts.who, when: parts.when, by: parts.by };
  });
  const lineOf = (i: number) => phase!.items[i].line;
  return (
    <>
      {m.mode === 'phases' && (
        <ol className="ly-phases" role="tablist" aria-label={m.section}>
          {m.phases.map((x, i) => (
            <li key={`${i}:${x.name}`} className={`${x.total && x.done === x.total ? 'done' : ''}${i === m.current ? ' now' : ''}`}>
              {renaming === i ? (
                <span className="ly-phase-rename">
                  <Inline value={x.name} autoEdit required label="Phase name" onDone={() => setRenaming(null)} onSave={(v) => sec((b) => renameRunSheetPhase(b, i, v), `Renamed the phase ${q(x.name)} to ${q(v)}.`)} />
                </span>
              ) : (
                <button
                  role="tab"
                  aria-selected={i === shown}
                  className={i === shown ? 'on' : ''}
                  onClick={() => setOpen(i)}
                  onDoubleClick={() => canEdit && x.line !== undefined && setRenaming(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2' && canEdit && x.line !== undefined) {
                      e.preventDefault();
                      setRenaming(i);
                    }
                  }}
                  title={canEdit && x.line !== undefined ? 'Double-click (or F2) to rename' : undefined}
                >
                  <span className="ly-phase-name">{x.name}</span>
                  <span className="ly-phase-count">
                    {x.done}/{x.total}
                  </span>
                  <span className="ly-bar thin">
                    <span style={{ width: `${x.total ? Math.max(3, (x.done / x.total) * 100) : 0}%` }} />
                  </span>
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {m.mode === 'next' && (
        <div className="ly-overall">
          <span className="ly-overall-figure">
            {m.done}/{m.total}
          </span>
          <span className="ly-faint">ticked off</span>
          <div className="ly-bar wide">
            <span style={{ width: `${Math.max(2, m.overall ?? 0)}%` }} />
          </div>
        </div>
      )}
      {phase && m.mode === 'next' && (
        // The steps themselves read under Your next (13 Nov 2026, the pictures: this checklist drew the
        // same list twice on one page): the block keeps its figure, never the rows.
        <p className="ly-faint ly-more-note">The steps are under Your next.</p>
      )}
      {phase && m.mode === 'phases' && (
        <div role="tabpanel" aria-label={phase.name}>
          <CheckList
            label={phase.name}
            path={path}
            items={sheetItems}
            emptyWords="No tick boxes in this phase yet."
            onTick={(i, done) => void sec((b) => toggleRunSheetItem(b, lineOf(i), done), done ? `Ticked off ${q(sheetItems[i].what)}.` : `Put ${q(sheetItems[i].what)} back on the list.`)}
            onSave={(i, ch) => sec((b) => setRunSheetItem(b, lineOf(i), ch), `Changed ${q(ch.what ?? sheetItems[i].what)}.`)}
            onRemove={(i) => void sec((b) => removeRunSheetItem(b, lineOf(i)), `Deleted ${q(sheetItems[i].what)}.`)}
            onMove={(from, over, after) => void sec((b) => moveRunSheetItem(b, lineOf(from), lineOf(over), after).body, `Moved ${q(sheetItems[from].what)}.`)}
          />
          <AddRow label={`Add a step to ${phase.name}…`} fields={[{ key: 'what', placeholder: 'What needs doing', required: true, grow: true }]} onAdd={(v) => sec((b) => addRunSheetItem(b, phase.name, v.what), `Added ${q(v.what)} to ${phase.name}.`)} />
        </div>
      )}
    </>
  );
}

/** Where a line dropped before or after another lands in the whole list. */
const target = (from: number, over: number, after: boolean) => (after ? (over < from ? over + 1 : over) : over < from ? over : over - 1);

/** The usual key-date states, after the person's own (the peek's milestone status offers the same). */
export const DATE_STATUSES = ['done', 'next', 'at risk', 'late'];

/** A milestone's words without links, for the strip (the rows render the links). */
const plainWhat = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');
const isoDay = (iso: string) => {
  const [y, mo, d] = iso.split('-').map(Number);
  return dayFrom(y, mo - 1, d);
};

function Timeline({ m, path }: { m: TimelineBlock; path: string }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const dated = m.items.filter((x) => x.date);
  const today = todayDay();
  const nextIndex = m.items.findIndex((x) => x.offset !== undefined && x.offset >= 0 && x.tone !== 'ok');
  const nextItem = nextIndex >= 0 ? m.items[nextIndex] : undefined;
  const fromDates = m.source === 'dates';
  // The strip above the rows (components/DateStrip.tsx, v9, 6 Nov 2026): each stop its own room in order, long
  // gaps as marked breaks, Today at its true place. The rows below name every stop, so the strip names none.
  const stops: StripStop[] = dated.map((x) => ({ id: `tl:${fromDates ? 'd' : 's'}:${x.index ?? x.row ?? x.what}`, day: isoDay(x.date!), label: plainWhat(x.what), date: isoWords(x.date!), done: x.tone === 'ok', late: x.tone === 'bad' }));
  // Long lists fold to the rows around today (v10, 6 Nov 2026: 80 rows pushed What's next far down): late, the last
  // done and the next few, with the rest a click away in place, like Key dates. Rows and pills stay.
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onExpand = (e: Event) => {
      if ((e as CustomEvent).detail === path) setOpen(true);
    };
    window.addEventListener('pj-expand', onExpand);
    return () => window.removeEventListener('pj-expand', onExpand);
  }, [path]);
  const keep = useMemo(() => {
    const done = m.items.filter((x) => x.tone === 'ok');
    const lastDone = done.length ? done[done.length - 1] : undefined;
    const coming = m.items.filter((x) => x.offset !== undefined && x.offset >= 0 && x.tone !== 'ok');
    const s = new Set<TimelineItem>();
    for (const x of m.items) if (!x.date || x.tone === 'bad') s.add(x);
    if (lastDone) s.add(lastDone);
    for (const x of coming.slice(0, 5)) s.add(x);
    return s;
  }, [m.items]);
  const shown = open ? m.items : m.items.filter((x) => keep.has(x));
  const openStop = (s: StripStop) => {
    const go = () => {
      const el = document.querySelector<HTMLElement>(`[data-tl-row="${CSS.escape(s.id)}"]`);
      if (!el) return false;
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
      el.classList.remove('tl-revealed');
      void el.offsetWidth;
      el.classList.add('tl-revealed');
      window.setTimeout(() => el.classList.remove('tl-revealed'), 2200);
      return true;
    };
    if (go()) return;
    setOpen(true);
    window.setTimeout(() => go(), 60);
  };
  const whens = m.items.map((x) => x.when);
  const statuses = choicesFrom(m.items.map((x) => x.status), fromDates ? DATE_STATUSES : []);
  const c = m.cols;
  const change = (x: TimelineItem, part: 'when' | 'what' | 'status', v: string, words: string) => {
    if (fromDates) return dash.edit({ kind: 'change', list: 'dates', index: x.index!, item: { [part]: v || null } });
    const col = part === 'when' ? c?.date : part === 'what' ? c?.what : c?.status;
    return col !== undefined && col >= 0 && x.row !== undefined ? dash.section(m.section, (b) => setTableCell(b, x.row!, col, v), words) : undefined;
  };
  const remove = (x: TimelineItem) => (fromDates ? dash.edit({ kind: 'remove', list: 'dates', index: x.index! }) : dash.section(m.section, (b) => removeTableRow(b, x.row!), `Deleted ${q(x.what)}.`));
  return (
    <>
      {dated.length > 0 && <DateStrip stops={stops} today={today} onOpen={openStop} keys={[]} progress />}
      <ol className="ly-dates">
        {shown.map((x) => (
          <li key={`${x.index ?? x.row}:${x.what}`} data-tl-row={`tl:${fromDates ? 'd' : 's'}:${x.index ?? x.row ?? x.what}`} className={`pj-row tone-${x.tone}${x.offset !== undefined && x.offset < 0 && x.tone !== 'bad' ? ' past' : ''}${x === nextItem ? ' next' : ''}`} {...peekRow(fromDates ? { type: 'milestone', path, title: x.what } : null)}>
            <RecordScope at={fromDates ? { type: 'milestone', path, title: x.what } : null}>
              <InlineDate value={x.when} iso clearable={!fromDates} quiet placeholder="+ Date" label="Date" className="ly-date-when" onSave={(v) => change(x, 'when', v ? dayInStyle(v, whens) : '', `Moved ${q(x.what)} to ${v ? isoWords(v) : 'no date'}.`)}>
                {x.date ? isoWords(x.date) : x.when}
              </InlineDate>
              <span className="ly-date-what">
                <Inline value={x.what} required label="Milestone" onSave={(v) => change(x, 'what', v, `Changed ${q(x.what)}.`)}>
                  <Words text={x.what} from={path} />
                </Inline>
                {x.owner ? <span className="ly-faint"> · {x.owner}</span> : null}
              </span>
              <span className="ly-date-state">
                {x === nextItem && x.offset !== undefined && <span className="ly-date-in">{x.offset === 0 ? 'Today' : `In ${plural(x.offset, 'day')}`}</span>}
                {(fromDates || (c && c.status >= 0)) && (canEdit || x.status) ? (
                  <Choice value={x.status} options={statuses} label="Status" tone={x.tone === 'next' ? 'accent' : x.tone} dot={false} className="ly-date-chip" placeholder="+ Status" onSave={(v) => change(x, 'status', v, v ? `Set ${q(x.what)} to ${cap(v)}.` : `Cleared the status of ${q(x.what)}.`)} />
                ) : (
                  x !== nextItem && x.offset !== undefined && x.offset < 0 && <span>Passed</span>
                )}
              </span>
              <RowActions>
                <RowAction icon="trash" title="Delete this date" danger onClick={() => void remove(x)} />
              </RowActions>
            </RecordScope>
          </li>
        ))}
      </ol>
      {m.items.length > shown.length && (
        <button type="button" className="pj-showall" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : `Show all ${m.items.length}`}
        </button>
      )}
    </>
  );
}

const BOARD_SHOWN = 5;

function Board({ m, path }: { m: BoardBlock; path: string }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  // A long column shows its first few cards and the rest a click away, so one busy stage doesn't stretch the page.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<{ row: number; stage: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  // The columns keep their places while the page is open (a card moved never reshuffles the board), and a stage emptied
  // by a move stays as a column to drop back into.
  const seenCols = useRef<{ key: string; cols: { stage: string; value: string }[] }>({ key: '', cols: [] });
  const colKey = `${path}\u0000${m.section}`;
  if (seenCols.current.key !== colKey) seenCols.current = { key: colKey, cols: [] };
  for (const col of m.columns) if (!seenCols.current.cols.some((x) => x.stage === col.stage)) seenCols.current.cols.push({ stage: col.stage, value: col.value });
  const columns = seenCols.current.cols.map((x) => m.columns.find((col) => col.stage === x.stage) ?? { ...x, items: [] as BoardCard[] });
  const c = m.cols!;
  const head = m.head ?? [];
  const all = columns.flatMap((col) => col.items);
  const dues = all.map((x) => x.due);
  const sec = (fn: (b: string) => string, words: string) => dash.section(m.section, fn, words);
  // A board read from the project's lists (Key dates, People) is shown, never edited here (fnv3 F37), as Grid does.
  const synthetic = m.source !== 'section';
  const moveTo = (card: BoardCard, col: BoardBlock['columns'][number]) => (!synthetic && c.stage >= 0 ? sec((b) => setTableCell(b, card.row, c.stage, col.value), `Moved ${q(card.title)} to ${col.stage}.`) : undefined);
  const cell = (card: BoardCard, col: number, v: string, words: string) => (!synthetic && col >= 0 ? sec((b) => setTableCell(b, card.row, col, v), words) : undefined);
  const menu = (card: BoardCard, stage: string): MenuItem[] => [
    { label: 'Edit…', icon: 'pencil', hint: 'Every column', run: () => setEditing(card.row) },
    ...(c.stage >= 0 ? [{ label: 'Move to', icon: 'forward' as const, submenu: columns.map((col) => ({ label: col.stage, checked: col.stage === stage, run: () => void (col.stage === stage ? undefined : moveTo(card, col)) })) }] : []),
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, run: () => void sec((b) => removeTableRow(b, card.row), `Deleted ${q(card.title)}.`) },
  ];
  const editingCard = all.find((x) => x.row === editing);
  return (
    <>
      <div className="ly-board" role="list" aria-label={m.section}>
        {columns.map((col, ci) => {
          const whole = open.has(col.stage) || col.items.length <= BOARD_SHOWN + 1;
          return (
            <section
              key={col.stage}
              className={`ly-col${over === col.stage && drag && drag.stage !== col.stage ? ' is-over' : ''}`}
              role="listitem"
              aria-label={`${col.stage}, ${col.items.length}`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== col.stage) setOver(col.stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === col.stage ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const card = drag ? all.find((x) => x.row === drag.row) : undefined;
                if (card && drag && drag.stage !== col.stage) void moveTo(card, col);
                setDrag(null);
                setOver(null);
              }}
            >
              <header>
                <span>{col.stage}</span>
                <span className="pj-count">{col.items.length}</span>
              </header>
              <ul>
                {!col.items.length && <li className="ly-col-empty">{drag ? 'Drop here' : 'Nothing here now'}</li>}
                {(whole ? col.items : col.items.slice(0, BOARD_SHOWN)).map((it) => (
                  <li
                    key={`${it.row}:${it.title}`}
                    className={`ly-card${it.overdue ? ' overdue' : ''}${drag?.row === it.row ? ' is-dragging' : ''}`}
                    tabIndex={0}
                    draggable={canEdit && !synthetic && c.stage >= 0}
                    aria-label={`${it.title}${canEdit && !synthetic && c.stage >= 0 ? ' (Alt+← or → moves it to the stage beside)' : ''}`}
                    onDragStart={(e) => {
                      if ((e.target as Element).closest?.('textarea, input')) return e.preventDefault();
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', it.title);
                      setDrag({ row: it.row, stage: col.stage });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onKeyDown={(e) => {
                      if (!canEdit || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.target !== e.currentTarget) return;
                      const to = columns[ci + (e.key === 'ArrowLeft' ? -1 : 1)];
                      if (!to) return;
                      e.preventDefault();
                      void moveTo(it, to);
                    }}
                  >
                    <div className="ly-card-top">
                      <Inline value={it.title} required label="Title" className="ly-card-title" onSave={(v) => cell(it, c.title, v, `Renamed ${q(it.title)} to ${q(v)}.`)}>
                        <Words text={it.title} from={path} />
                      </Inline>
                      <More label={`More for ${it.title}`} items={() => menu(it, col.stage)} />
                    </div>
                    {(it.notes || (canEdit && c.notes >= 0)) && <Inline value={it.notes} quiet placeholder="+ Notes" label="Notes" className="ly-card-notes" onSave={(v) => cell(it, c.notes, v, `Changed the notes of ${q(it.title)}.`)} />}
                    {(it.owner || it.due || canEdit) && (
                      <span className="ly-card-foot">
                        {c.owner >= 0 && (
                          <RecordScope at={it.owner ? { type: 'person', name: it.owner } : null}>
                            <Inline compact value={it.owner} quiet placeholder="+ Owner" label="Owner" suggest={dash.people} className="ly-card-owner" onSave={(v) => cell(it, c.owner, v, v ? `${v} has ${q(it.title)}.` : `Took the owner off ${q(it.title)}.`)}>
                              <span className="pj-avatar small" title={it.owner} style={{ ['--hue' as string]: personHue(it.owner) }}>
                                {initials(it.owner)}
                              </span>
                            </Inline>
                          </RecordScope>
                        )}
                        <span className="pj-card-space" />
                        {c.due >= 0 && (
                          <InlineDate value={it.due} iso quiet placeholder="+ Due" label="Due" className={`ly-chip${it.overdue ? ' tone-bad' : ''}`} onSave={(v) => cell(it, c.due, v ? dayInStyle(v, dues) : '', v ? `${q(it.title)} is due ${isoWords(v)}.` : `Took the due date off ${q(it.title)}.`)}>
                            {it.date ? isoWords(it.date) : it.due}
                          </InlineDate>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {col.items.length > BOARD_SHOWN + 1 && (
                <button className="ly-col-more" onClick={() => setOpen((x) => new Set(open.has(col.stage) ? [...x].filter((y) => y !== col.stage) : [...x, col.stage]))}>
                  {open.has(col.stage) ? 'Show fewer' : `${col.items.length - BOARD_SHOWN} more`}
                </button>
              )}
              {canEdit && !synthetic && c.stage >= 0 && head.length > 0 && (
                <div className="ly-col-add">
                  <AddRow label="Add" fields={[{ key: 'title', placeholder: head[c.title] ?? 'Title', required: true, grow: true }]} onAdd={(v) => sec((b) => addTableRow(b, head, { [head[c.title]]: v.title, [head[c.stage]]: col.value }), `Added ${q(v.title)} to ${col.stage}.`)} />
                </div>
              )}
            </section>
          );
        })}
      </div>
      {editingCard && (
        <div className="ly-board-edit">
          <p className="ly-label">Editing {editingCard.title}</p>
          <RowForm section={m.section} head={head} row={editingCard.row} title={editingCard.title} onDone={() => setEditing(null)} />
        </div>
      )}
    </>
  );
}

/**
 * A table as a grid: sorted by any column, filtered by words and status, totals that follow the filter — and edited like a
 * spreadsheet: a click (or Enter, F2, or typing) opens a cell; Enter saves and goes down, Tab right, Shift with either
 * back; Esc leaves it as it was; the arrows move between cells; Delete empties one. A status cell offers its column's
 * words. Rows are added under the others and deleted with their bin (Undo in the message).
 */
function Grid({ m, path }: { m: GridBlock; path: string }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const editable = canEdit && m.source === 'section';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; seed?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const t = m.table;
  const cols = t.head.length;
  // A column of numbers (a currency's letters before, a unit after) lines up on the right; a column of days doesn't.
  const numeric = t.head.map((_, c) => t.rows.length > 0 && t.rows.filter((r) => (r[c] ?? '').trim()).every((r) => /^[A-Z]{0,3}\$?\s*-?[\d,.]+\s*(%|[a-zA-Z]{1,3})?$/.test((r[c] ?? '').trim()) && !/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun)\b/i.test(r[c] ?? '')));
  const qy = query.trim().toLowerCase();
  let rows = t.rows.map((r, i) => ({ r, i })).filter(({ r }) => (!qy || r.some((c) => c.toLowerCase().includes(qy))) && (status === null || (r[m.statusCol] || 'No status').toLowerCase() === status));
  if (sort) {
    const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));
    rows = [...rows].sort((a, b) => (numeric[sort.col] ? num(a.r[sort.col] ?? '') - num(b.r[sort.col] ?? '') : (a.r[sort.col] ?? '').localeCompare(b.r[sort.col] ?? '', undefined, { numeric: true })) * sort.dir);
  }
  const noun = (n: number) => (m.of ? pluralNoun(m.of, n) : n === 1 ? 'row' : 'rows');
  const rowWords = (n: number) => (n === 1 ? 'row' : 'rows');
  // With a quantity column a row holds several of the thing: the count is how many in all, the rows said beside it.
  const units = m.units;
  const howMany = (rs: string[][]) => (units ? rs.reduce((a, r) => a + (Number((r[units.col] ?? '').replace(/[^\d.-]/g, '')) || 0), 0) : rs.length);
  const statuses = m.statusCol >= 0 ? choicesFrom(t.rows.map((r) => r[m.statusCol] ?? ''), []) : [];
  // Keys stay on the cell that has them as the grid redraws (a save, a sort).
  useEffect(() => {
    if (!active || editing) return;
    const td = tableRef.current?.querySelector<HTMLElement>(`tbody tr[data-r="${active.r}"] td[data-c="${active.c}"]`);
    if (td && tableRef.current?.contains(document.activeElement) && document.activeElement !== td) td.focus();
  }, [active, editing, rows.length]);
  const focusCell = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(rows.length - 1, r));
    const cc = Math.max(0, Math.min(cols - 1, c));
    setActive({ r: rr, c: cc });
    requestAnimationFrame(() => tableRef.current?.querySelector<HTMLElement>(`tbody tr[data-r="${rr}"] td[data-c="${cc}"]`)?.focus());
  };
  const nameOf = (orig: number) => t.rows[orig]?.[0] || `row ${orig + 1}`;
  const save = (orig: number, c: number, v: string) => (v.trim() === (t.rows[orig]?.[c] ?? '').trim() ? Promise.resolve(true) : dash.section(m.section, (b) => setTableCell(b, orig, c, v), v.trim() ? `Changed ${t.head[c]} of ${q(nameOf(orig))}.` : `Emptied ${t.head[c]} of ${q(nameOf(orig))}.`));
  const statusMenu = (el: HTMLElement, orig: number) =>
    openMenu(el, [
      { heading: t.head[m.statusCol] },
      ...statuses.map((s) => ({ label: s, checked: same(s, t.rows[orig]?.[m.statusCol] ?? ''), run: () => void save(orig, m.statusCol, s) })),
      { separator: true as const },
      { label: 'Something else…', icon: 'pencil' as const, run: () => setEditing({ r: rows.findIndex((x) => x.i === orig), c: m.statusCol }) },
      { label: 'Clear', disabled: !(t.rows[orig]?.[m.statusCol] ?? '').trim(), run: () => void save(orig, m.statusCol, '') },
    ]);
  const open = (r: number, c: number, el: HTMLElement | null, seed?: string) => {
    if (!editable) return;
    if (c === m.statusCol && seed === undefined && el && statuses.length) return statusMenu(el, rows[r].i);
    setActive({ r, c });
    setEditing({ r, c, seed });
  };
  return (
    <>
      <div className="ly-grid-tools">
        <div className="ly-grid-sum">
          {/* Totals follow the filter (fnv3 F38), as the footer already did. */}
          <strong>{howMany(rows.map(({ r }) => r)).toLocaleString('en-AU')}</strong> <span>{units && !m.of ? (howMany(rows.map(({ r }) => r)) === 1 ? 'item' : 'items') : noun(howMany(rows.map(({ r }) => r)))}</span>
          {units && (
            <span className="ly-faint ly-grid-total">
              · in {rows.length} {rowWords(rows.length)}
            </span>
          )}
          {m.totals.filter((x) => x !== units && x.col !== units?.col).map((x) => (
            <span key={x.col} className="ly-faint ly-grid-total">
              · {x.label} {Math.round(rows.reduce((a, { r }) => a + (Number((r[x.col] ?? '').replace(/[^\\d.-]/g, '')) || 0), 0) * 100) / 100}
            </span>
          ))}
        </div>
        <span className="pj-card-space" />
        <label className="pf-find ly-grid-find">
          <Icon name="search" size={13} />
          <input type="search" value={query} placeholder="Filter" aria-label={`Filter ${m.section}`} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))} />
        </label>
      </div>
      {m.byStatus.length > 1 && (
        <div className="ly-chips" role="group" aria-label="By status">
          <button className={`ly-filter${status === null ? ' on' : ''}`} aria-pressed={status === null} onClick={() => setStatus(null)}>
            All <span>{howMany(t.rows).toLocaleString('en-AU')}</span>
          </button>
          {m.byStatus.map((s) => (
            <button key={s.status} className={`ly-filter tone-${toneOf(s.status)}${status === s.status.toLowerCase() ? ' on' : ''}`} aria-pressed={status === s.status.toLowerCase()} onClick={() => setStatus(status === s.status.toLowerCase() ? null : s.status.toLowerCase())}>
              {s.status} <span>{(s.qty ?? s.count).toLocaleString('en-AU')}</span>
            </button>
          ))}
        </div>
      )}
      <div className="ly-table-wrap">
        <table className={`ly-table${editable ? ' is-editable' : ''}`} ref={tableRef} role={editable ? 'grid' : undefined} aria-label={m.section}>
          <thead>
            <tr>
              {t.head.map((h, c) => (
                <th key={`${c}:${h}`} aria-sort={sort?.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={numeric[c] ? 'num' : ''}>
                  <button onClick={() => setSort(sort?.col === c ? (sort.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 })}>
                    {h}
                    <span className="ly-sort" aria-hidden="true">
                      {sort?.col === c ? (sort.dir === 1 ? '↑' : '↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
              {editable && <th className="ly-row-acts" aria-label="Row actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, i }, ri) => (
              <tr key={i} data-r={ri}>
                {t.head.map((_, c) => {
                  const isEditing = editing?.r === ri && editing.c === c;
                  const isActive = active ? active.r === ri && active.c === c : ri === 0 && c === 0;
                  return (
                    <td
                      key={c}
                      data-c={c}
                      className={`${numeric[c] ? 'num' : ''}${isEditing ? ' is-editing' : ''}${editable && c === m.statusCol ? ' is-choice' : ''}`}
                      tabIndex={editable ? (isActive ? 0 : -1) : undefined}
                      aria-label={editable ? `${t.head[c]}: ${r[c] || 'empty'}` : undefined}
                      title={editable && !isEditing ? (c === m.statusCol ? 'Double-click or Enter to choose' : 'Double-click, Enter or type to edit') : undefined}
                      onFocus={() => editable && (!active || active.r !== ri || active.c !== c) && setActive({ r: ri, c })}
                      // A click picks the cell, as a spreadsheet does; a double-click, Enter, F2 or typing opens it (WS1 part
                      // B: clicking no longer means editing).
                      onClick={(e) => {
                        if (!editable || isEditing || (e.target as Element).closest('a')) return;
                        e.currentTarget.focus();
                      }}
                      onDoubleClick={(e) => {
                        if (!editable || isEditing || (e.target as Element).closest('a')) return;
                        window.getSelection()?.removeAllRanges();
                        open(ri, c, e.currentTarget);
                      }}
                      onKeyDown={(e) => {
                        if (!editable || isEditing || e.target !== e.currentTarget) return;
                        const k = e.key;
                        const go = (dr: number, dc: number) => (e.preventDefault(), focusCell(ri + dr, c + dc));
                        if (k === 'ArrowDown') go(1, 0);
                        else if (k === 'ArrowUp') go(-1, 0);
                        else if (k === 'ArrowRight') go(0, 1);
                        else if (k === 'ArrowLeft') go(0, -1);
                        else if (k === 'Home') go(0, -c);
                        else if (k === 'End') go(0, cols - 1 - c);
                        else if (k === 'Enter' || k === 'F2') {
                          e.preventDefault();
                          open(ri, c, e.currentTarget);
                        } else if ((k === 'Delete' || k === 'Backspace') && (r[c] ?? '').trim() && c > 0) {
                          e.preventDefault();
                          void save(i, c, '');
                        } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                          e.preventDefault();
                          open(ri, c, null, k);
                        }
                      }}
                    >
                      {isEditing ? (
                        <CellField
                          initial={editing!.seed ?? r[c] ?? ''}
                          select={editing!.seed === undefined}
                          label={`${t.head[c]} of ${nameOf(i)}`}
                          numeric={numeric[c]}
                          onDone={(value, move) => {
                            setEditing(null);
                            if (value !== null && !(c === 0 && !value.trim())) void save(i, c, value);
                            if (move) {
                              const [dr, dc] = move;
                              let nr = ri + dr;
                              let nc = c + dc;
                              if (nc >= cols) [nr, nc] = [nr + 1, 0];
                              if (nc < 0) [nr, nc] = [nr - 1, cols - 1];
                              focusCell(nr, nc);
                            } else focusCell(ri, c);
                          }}
                        />
                      ) : c === m.statusCol && r[c] ? (
                        <span className={`ly-chip tone-${toneOf(r[c])}`}>{r[c]}</span>
                      ) : c === 0 ? (
                        <Words text={r[c] ?? ''} from={path} className="ly-cell-main" />
                      ) : /\[\[|\]\(|https?:\/\//.test(r[c] ?? '') ? (
                        // A link written in a cell reads as a link, as it does everywhere else in the notes.
                        <Words text={r[c] ?? ''} from={path} />
                      ) : (
                        (r[c] ?? '')
                      )}
                    </td>
                  );
                })}
                {editable && (
                  <td className="ly-row-acts">
                    <button type="button" className="pj-row-action danger" title={`Delete ${nameOf(i)}`} aria-label={`Delete ${nameOf(i)}`} onClick={() => void dash.section(m.section, (b) => removeTableRow(b, i), `Deleted ${q(nameOf(i))}.`)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={cols + (editable ? 1 : 0)} className="ly-faint ly-none">
                  Nothing matches.
                </td>
              </tr>
            )}
            {adding && <NewRow head={t.head} section={m.section} noun={m.of ? pluralNoun(m.of, 1) : 'row'} extra={editable} onDone={() => setAdding(false)} />}
          </tbody>
          {(rows.length !== t.rows.length || m.totals.length > 0) && rows.length > 0 && (
            <tfoot>
              <tr>
                {t.head.map((_, c) => {
                  const total = m.totals.find((x) => x.col === c);
                  const sum = total ? rows.reduce((a, { r }) => a + (Number((r[c] ?? '').replace(/[^\d.-]/g, '')) || 0), 0) : null;
                  return (
                    <td key={c} className={numeric[c] ? 'num' : ''}>
                      {c === 0 ? `${rows.length} ${units ? rowWords(rows.length) : noun(rows.length)}${rows.length !== t.rows.length ? ' shown' : ''}` : sum !== null ? Math.round(sum * 100) / 100 : ''}
                    </td>
                  );
                })}
                {editable && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {editable && !adding && (
        <button type="button" className="pj-addrow ly-grid-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          <span>{m.of ? `Add ${/^[aeiou]/i.test(pluralNoun(m.of, 1)) ? 'an' : 'a'} ${pluralNoun(m.of, 1)}` : 'Add a row'}</span>
        </button>
      )}
    </>
  );
}

/** A cell being edited: Enter saves and goes down (Shift: up), Tab right (Shift: left), Esc leaves it as it was, clicking away saves. */
function CellField({ initial, select, label, numeric, onDone }: { initial: string; select: boolean; label: string; numeric: boolean; onDone(value: string | null, move?: [number, number]): void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (v: string | null, move?: [number, number]) => {
    if (done.current) return;
    done.current = true;
    onDone(v, move);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (select) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <input
      ref={ref}
      className={`ly-cell-input${numeric ? ' num' : ''}`}
      value={text}
      aria-label={label}
      spellCheck
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        } else if (isEnterKey(e)) {
          e.preventDefault();
          finish(text, [e.shiftKey ? -1 : 1, 0]);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(text, [0, e.shiftKey ? -1 : 1]);
        }
      }}
    />
  );
}

/** A new row under the others: a field per column (Tab between them), Enter adds it and starts another, Esc stops. */
function NewRow({ head, section, noun, extra, onDone }: { head: string[]; section: string; noun: string; extra: boolean; onDone(): void }) {
  const dash = useDash();
  const [values, setValues] = useState<Record<string, string>>({});
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const add = async () => {
    const name = (values[head[0]] ?? '').trim();
    if (!name) return;
    const ok = await dash.section(section, (b) => addTableRow(b, head, values), `Added ${q(name)}.`);
    if (ok) {
      setValues({});
      first.current?.focus();
    }
  };
  return (
    <tr className="ly-new-row">
      {head.map((h, c) => (
        <td key={c}>
          <input
            ref={c === 0 ? first : undefined}
            className="ly-cell-input"
            placeholder={c === 0 ? `New ${noun}` : h}
            aria-label={`${h} of the new ${noun}`}
            value={values[h] ?? ''}
            onChange={(e) => setValues((x) => ({ ...x, [h]: e.target.value }))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (isEnterKey(e)) {
                e.preventDefault();
                void add();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onDone();
              }
            }}
          />
        </td>
      ))}
      {extra && (
        <td className="ly-row-acts is-new">
          <button type="button" className="pj-row-action" title="Add it (Enter)" aria-label="Add it" disabled={!(values[head[0]] ?? '').trim()} onClick={() => void add()}>
            <Icon name="check" size={13} />
          </button>
        </td>
      )}
    </tr>
  );
}

/**
 * The log (and the field as it writes it) an entry's value came from, for editing it there: the last log keeping it that
 * day, as the dashboard shows the last one's value when two logs keep the same field.
 */
function sourceOf(logs: LogNote[], date: string, field?: string): { log: LogNote; name?: string } | null {
  for (const l of [...logs].reverse()) {
    if (!l.path) continue;
    for (const e of l.entries) {
      if (e.date !== date) continue;
      if (!field) return { log: l };
      const name = Object.keys(e.values).find((k) => normKey(k) === normKey(field));
      if (name) return { log: l, name };
    }
  }
  return null;
}
/** The log a new value for a field goes in: the (last) one that keeps the field, else the first. */
function logFor(logs: LogNote[], field: string): LogNote | undefined {
  return [...logs].reverse().find((l) => l.path && l.entries.some((e) => Object.keys(e.values).some((k) => normKey(k) === normKey(field)))) ?? logs.find((l) => l.path);
}
const dayName = (iso: string) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00`).getDay()]} ${isoWords(iso)}`;

function Trend({ m }: { m: TrendBlock }) {
  // The measure with a start or target is charted in full; the others as small lines beside it.
  const main = m.series.length === 1 ? m.series[0] : m.series.find((x) => x.target !== undefined) ?? null;
  const rest = m.series.filter((x) => x !== main);
  return (
    <>
      {main && <TrendMain s={main} />}
      {rest.length > 0 && <Sparks series={rest} />}
    </>
  );
}

/** A figure from the latest entry, edited in that entry of its log. */
function LatestValue({ s, children }: { s: TrendBlock['series'][number]; children: React.ReactNode }) {
  const dash = useDash();
  const last = s.points[s.points.length - 1];
  const src = last ? sourceOf(dash.view.logs ?? [], last.date, s.field) : null;
  const entry = src?.log.entries.find((e) => e.date === last?.date);
  const raw = src?.name && entry ? entry.values[src.name].text : '';
  if (!src || !last) return <>{children}</>;
  return (
    <Inline compact value={raw} required label={`${s.field} on ${dayName(last.date)}`} className="ly-latest" onSave={(v) => dash.log(src.log.path!, (t) => setLogValue(t, last.date, src.name ?? s.field, v), `Changed ${s.field} on ${dayName(last.date)} to ${v}.`)}>
      {children}
    </Inline>
  );
}

function TrendMain({ s }: { s: TrendBlock['series'][number] }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const props = dash.view.props ?? {};
  const change = s.latest !== undefined && s.start !== undefined ? Math.round((s.latest - s.start) * 100) / 100 : undefined;
  const toGo = s.latest !== undefined && s.target !== undefined ? Math.round((s.target - s.latest) * 100) / 100 : undefined;
  const u = s.unit ? ` ${s.unit}` : '';
  const targetKey = propKey(props, `target_${keyName(s.field)}`);
  return (
    <>
      <div className="ly-trend-figures">
        <div>
          <span className="ly-label">Latest</span>
          <strong>
            <LatestValue s={s}>{s.latest !== undefined ? `${s.latest}${u}` : ''}</LatestValue>
          </strong>
        </div>
        {change !== undefined && s.points.length > 1 && (
          <div>
            <span className="ly-label">Since start</span>
            <strong>
              {change > 0 ? '+' : change < 0 ? '−' : ''}
              {Math.abs(change)}
              {u}
            </strong>
          </div>
        )}
        {(s.target !== undefined || canEdit) && (
          <div>
            <span className="ly-label">Target</span>
            <strong>
              <Inline compact value={s.target !== undefined ? String(s.target) : ''} quiet={false} placeholder="+ Set one" label={`Target for ${s.field}${s.unit ? ` (${s.unit})` : ''}`} className="ly-target" onSave={(v) => dash.edit({ kind: 'prop', key: targetKey, value: v.replace(/[^\d.,-]/g, '') || null })}>
                {s.target !== undefined ? `${s.target}${u}` : undefined}
              </Inline>
            </strong>
          </div>
        )}
        {toGo !== undefined && (
          <div>
            <span className="ly-label">To target</span>
            <strong>{toGo === 0 ? 'Reached' : `${Math.abs(toGo)}${u}`}</strong>
          </div>
        )}
      </div>
      <TrendChart s={s} />
    </>
  );
}

function Sparks({ series }: { series: TrendBlock['series'] }) {
  const dash = useDash();
  const props = dash.view.props ?? {};
  return (
    <ul className="ly-sparks">
      {series.map((s) => (
        <li key={s.field}>
          <div className="ly-spark-top">
            <span className="ly-label">{s.field}</span>
            <strong>
              <LatestValue s={s}>
                {s.latest ?? ''}
                {s.unit ? <span className="ly-faint"> {s.unit}</span> : null}
              </LatestValue>
            </strong>
          </div>
          <Spark points={s.points.slice(-14)} height={44} label={`${s.field}: the last ${plural(Math.min(14, s.points.length), 'entry', 'entries')}`} />
          <Inline compact value={s.target !== undefined ? String(s.target) : ''} quiet placeholder="+ Target" label={`Target for ${s.field}${s.unit ? ` (${s.unit})` : ''}`} className="ly-faint ly-spark-target ly-target" onSave={(v) => dash.edit({ kind: 'prop', key: propKey(props, `target_${keyName(s.field)}`), value: v.replace(/[^\d.,-]/g, '') || null })}>
            {s.target !== undefined ? `Target ${s.target}` : undefined}
          </Inline>
        </li>
      ))}
    </ul>
  );
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Streak({ m }: { m: StreakBlock }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const props = dash.view.props ?? {};
  const count = m.day ?? m.run;
  const ringValue = m.next ? (count - m.next.from) / Math.max(1, m.next.days - m.next.from) : m.milestones.length ? 1 : Math.min(1, count / 30);
  const log = m.field ? logFor(dash.view.logs ?? [], m.field) : undefined;
  // A day of the last two weeks set yes, no or not logged, in the log that keeps the field.
  const dayMenu = (el: HTMLElement, iso: string, state: string) => {
    if (!log?.path || !m.field) return;
    const src = sourceOf(dash.view.logs ?? [], iso, m.field);
    const path = src?.log.path ?? log.path;
    const name = src?.name ?? m.field;
    const set = (v: string | null, words: string) => void dash.log(path, (t) => setLogValue(t, iso, name, v), words);
    openMenu(el, [
      { heading: `${m.field} · ${dayName(iso)}` },
      { label: 'Yes', checked: state === 'yes', run: () => set('Y', `${m.field}: yes on ${dayName(iso)}.`) },
      { label: 'No', checked: state === 'no', run: () => set('N', `${m.field}: no on ${dayName(iso)}.`) },
      { separator: true },
      { label: 'Not logged', disabled: state !== 'yes' && state !== 'no', run: () => set(null, `Took ${m.field} off ${dayName(iso)}.`) },
    ]);
  };
  const perKey = Object.keys(props).find((k) => /_per_week$/i.test(k));
  return (
    <div className="ly-streak-body">
      {(m.day !== undefined || m.field) && (
        <div className="ly-streak-top">
          <Ring value={ringValue} size={104} stroke={8} tone="ok" label={`${m.day !== undefined ? `Day ${m.day}` : `${m.run} in a row`}${m.next ? `, ${m.next.left} to the ${m.next.days}-day mark` : ''}`}>
            <span className="ly-ring-small">{m.day !== undefined ? 'Day' : 'In a row'}</span>
            <strong>{count}</strong>
          </Ring>
          <div className="ly-streak-words">
            <p className="ly-streak-label">{m.label}</p>
            {m.next ? (
              <p className="ly-faint">
                {plural(m.next.left, 'day')} to the {m.next.days}-day mark
              </p>
            ) : m.milestones.length ? (
              <p className="ly-faint">Every milestone reached</p>
            ) : null}
            {m.field && m.best > 0 && <p className="ly-faint">Best run {plural(m.best, 'day')}</p>}
            {(m.start || canEdit) && (
              <p className="ly-faint">
                <InlineDate value={String(props[propKey(props, 'streak_start')] ?? '')} iso quiet placeholder="+ Set the day it started" label="Streak start" onSave={(v) => dash.edit({ kind: 'prop', key: propKey(props, 'streak_start'), value: v || null })}>
                  {m.start ? `Since ${isoWords(m.start, true)}` : undefined}
                </InlineDate>
              </p>
            )}
          </div>
        </div>
      )}
      {m.field && (
        <div className="ly-days" role={canEdit && log ? 'group' : 'img'} aria-label={`${m.field}, the last 14 days: ${m.grid.filter((g) => g.state === 'yes').length} yes, ${m.grid.filter((g) => g.state === 'no').length} no`}>
          {m.grid.map((g) => {
            const d = new Date(`${g.date}T00:00:00`);
            const words = `${isoWords(g.date)}: ${g.state === 'yes' ? 'yes' : g.state === 'no' ? 'no' : g.state === 'before' ? 'before the start' : 'not logged'}`;
            return canEdit && log?.path ? (
              <button key={g.date} type="button" className={`ly-day ${g.state}`} title={`${words} (click to change)`} aria-label={words} aria-haspopup="menu" onClick={(e) => dayMenu(e.currentTarget, g.date, g.state)}>
                <i />
                <small>{DAY_LETTERS[d.getDay()]}</small>
              </button>
            ) : (
              <span key={g.date} className={`ly-day ${g.state}`} title={words}>
                <i />
                <small>{DAY_LETTERS[d.getDay()]}</small>
              </span>
            );
          })}
        </div>
      )}
      {m.week && (
        <div className="ly-week">
          <div className="ly-week-words">
            <strong>
              {m.week.count} of{' '}
              {perKey ? (
                <Inline compact value={String(props[perKey] ?? m.week.of)} required label={`${keyLabel(perKey)} (how many a week)`} className="ly-week-of" onSave={(v) => dash.edit({ kind: 'prop', key: perKey, value: v.replace(/[^\d.]/g, '') || null })}>
                  {m.week.of}
                </Inline>
              ) : (
                m.week.of
              )}
            </strong>
            <span className="ly-faint">{m.week.label} this week</span>
          </div>
          <div className="ly-week-days" aria-hidden="true">
            {m.week.days.map((on, i) => (
              <span key={i} className={on ? 'on' : ''}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
              </span>
            ))}
          </div>
        </div>
      )}
      {m.milestones.length > 0 && (
        <ul className="ly-marks">
          {m.milestones.map((x) => (
            <li key={x.days} className={x.reached ? 'reached' : m.next?.days === x.days ? 'next' : ''} title={x.date ? isoWords(x.date, true) : undefined}>
              {x.reached && <Icon name="check" size={11} />}
              {x.days} days
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A value as a tile shows it: Yes or No, a number with its unit (the words written with it beneath), or short words. */
function valueTile(e: LogEntry, k: string, unit: string): { main: string; more?: string } {
  const v = e.values[k];
  if (v.kind === 'yes') {
    const more = v.text.replace(/^\S+\s*/, '').replace(/^[(—–,;:.-]\s*|\)$/g, '').trim();
    return { main: v.yes ? 'Yes' : 'No', ...(more ? { more } : {}) };
  }
  if (v.kind === 'number') {
    const plain = new RegExp(`^[~≈<>]?\\s*-?[\\d.,]+\\s*${unit.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`, 'i').test(v.text) || /^-?[\d.,]+\s*[A-Za-z%°/]{0,6}$/.test(v.text);
    // The words written with the number: what follows it ("88.2 kg (after the run)" → "after the run"), or all of them ("almost 0").
    const lead = /^[~≈<>]?\s*-?[\d.,]+\s*(?:[A-Za-z%°]{1,6}\b|\/\s*\d+)?\s*/.exec(v.text)?.[0] ?? '';
    const more = (lead ? v.text.slice(lead.length) : v.text).replace(/^[(—–,;:.-]\s*|\)$/g, '').trim();
    return { main: `${v.n.toLocaleString('en-AU')}${unit ? (unit.startsWith('/') ? unit : ` ${unit}`) : ''}`, ...(plain || !more ? {} : { more }) };
  }
  return { main: v.text };
}

/**
 * The latest log entry (and, with ‹ ›, the ones before it), every part edited in its log where it is: a tile's value (a
 * yes or no from its choices, a number or words typed), a line, a note.
 */
function Entry({ m, path }: { m: EntryBlock; path: string }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const logs = dash.view.logs ?? [];
  const all = useMemo(() => entriesOf(logs), [logs]);
  const [back, setBack] = useState(0);
  const e = all[Math.max(0, all.length - 1 - back)] ?? m.latest!;
  const d = new Date(`${e.date}T00:00:00`);
  // The log's own fields, and short answers, as tiles; anything written as a sentence reads as a line beneath them.
  const known = new Map(m.fields.map((f) => [f.name.toLowerCase(), f]));
  const keys = Object.keys(e.values);
  const isTile = (k: string) => e.values[k].kind !== 'text' || (e.values[k].text.length <= 28 && (known.has(k.toLowerCase()) || e.values[k].text.length <= 16));
  const tiles = keys.filter(isTile);
  const lines = keys.filter((k) => !isTile(k));
  const day = dayName(e.date);
  const setValue = (k: string, v: string | null) => {
    const src = sourceOf(logs, e.date, k);
    if (!src) return;
    return dash.log(src.log.path!, (t) => setLogValue(t, e.date, src.name ?? k, v), v === null ? `Took ${k} off ${day}.` : `Changed ${k} on ${day}.`);
  };
  // A note's place in its own log (the entry shows the notes of every log kept that day, in order).
  const noteAt = (n: number): { log: LogNote; index: number } | null => {
    let k = n;
    for (const l of logs) {
      if (!l.path) continue;
      const here = l.entries.find((x) => x.date === e.date)?.notes.length ?? 0;
      if (k < here) return { log: l, index: k };
      k -= here;
    }
    return null;
  };
  const yesMenu = (el: HTMLElement, k: string, yes: boolean) =>
    openMenu(el, [{ heading: `${k} · ${day}` }, { label: 'Yes', checked: yes, run: () => void (yes ? undefined : setValue(k, 'Y')) }, { label: 'No', checked: !yes, run: () => void (!yes ? undefined : setValue(k, 'N')) }, { separator: true }, { label: 'Take it off this day', run: () => void setValue(k, null) }]);
  return (
    <div className="ly-entry">
      <div className="ly-entry-head">
        <p className="ly-entry-date">
          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]} {isoWords(e.date)}
          {e.label ? <span className="ly-faint"> · {e.label}</span> : null}
          {back > 0 && <span className="ly-faint"> · {plural(back, 'entry', 'entries')} before the latest</span>}
        </p>
        {all.length > 1 && (
          <span className="ly-entry-nav">
            <button type="button" className="ly-nav" title="The entry before" aria-label="The entry before" disabled={back >= all.length - 1} onClick={() => setBack((b) => Math.min(all.length - 1, b + 1))}>
              <Icon name="back" size={12} />
            </button>
            <button type="button" className="ly-nav" title="The entry after" aria-label="The entry after" disabled={back === 0} onClick={() => setBack((b) => Math.max(0, b - 1))}>
              <Icon name="forward" size={12} />
            </button>
          </span>
        )}
      </div>
      {tiles.length > 0 && (
        <dl className="ly-entry-values">
          {tiles.map((k) => {
            const t = valueTile(e, k, known.get(k.toLowerCase())?.unit ?? '');
            const v = e.values[k];
            return (
              <div key={k} className={`${v.kind === 'yes' ? (v.yes ? 'yes' : 'no') : ''}${canEdit ? ' is-editable' : ''}`} title={v.text}>
                <dt>{k}</dt>
                <dd>
                  {!canEdit ? (
                    t.main
                  ) : v.kind === 'yes' ? (
                    <button type="button" className="ly-tile-choice" aria-haspopup="menu" aria-label={`${k}: ${t.main}. Click to change`} onClick={(ev) => yesMenu(ev.currentTarget, k, v.yes)}>
                      {t.main}
                    </button>
                  ) : (
                    <Inline value={v.text} label={`${k} on ${day}`} className="ly-tile-edit" onSave={(nv) => setValue(k, nv.trim() ? nv : null)}>
                      {t.main}
                    </Inline>
                  )}
                </dd>
                {t.more && <dd className="ly-entry-more">{t.more}</dd>}
              </div>
            );
          })}
        </dl>
      )}
      {(lines.length > 0 || e.notes.length > 0) && (
        <ul className="ly-entry-notes">
          {lines.map((k) => (
            <li key={k}>
              <strong>{k}:</strong>{' '}
              <Inline value={e.values[k].text} label={`${k} on ${day}`} onSave={(nv) => setValue(k, nv.trim() ? nv : null)}>
                <Words text={e.values[k].text} from={path} />
              </Inline>
            </li>
          ))}
          {e.notes.slice(0, Math.max(2, 6 - lines.length)).map((n, i) => (
            <li key={`${i}:${n}`}>
              <Inline
                value={n}
                label={`Note on ${day}`}
                onSave={(nv) => {
                  const at = noteAt(i);
                  return at ? dash.log(at.log.path!, (t) => setLogNote(t, e.date, at.index, nv.trim() ? nv : null), nv.trim() ? `Changed a note on ${day}.` : `Took a note off ${day}.`) : undefined;
                }}
              >
                <Words text={n} from={path} />
              </Inline>
            </li>
          ))}
        </ul>
      )}
      <p className="ly-faint ly-entry-count">
        {plural(m.entries, 'entry', 'entries')} in {m.logs.map((l) => l.title).join(', ')}
      </p>
    </div>
  );
}

function Cards({ m }: { m: CardsBlock }) {
  const dash = useDash();
  const { canEdit } = useEditor();
  const [editing, setEditing] = useState<number | null>(null);
  const c = m.cols;
  const fromPeople = m.source === 'people';
  // Read from Key dates, not a section table: shown, never edited through a section that is not there (fnv3 F37).
  const synthetic = m.source !== 'section' && !fromPeople;
  const t = !fromPeople ? readTable(sectionText(dash.view.project, m.section)) : null;
  const cell = (row: number, col: number | undefined, v: string, words: string) => (!synthetic && col !== undefined && col >= 0 ? dash.section(m.section, (b) => setTableCell(b, row, col, v), words) : undefined);
  const set = (card: CardsBlock['cards'][number], part: 'name' | 'role' | 'company' | 'contact', v: string, words: string) => {
    if (fromPeople) return part === 'name' || part === 'role' ? dash.edit({ kind: 'change', list: 'people', index: card.row, item: { [part]: v || null } }) : undefined;
    return cell(card.row, c?.[part], v, words);
  };
  const remove = (card: CardsBlock['cards'][number]) => (synthetic ? undefined : fromPeople ? dash.edit({ kind: 'remove', list: 'people', index: card.row }) : dash.section(m.section, (b) => removeTableRow(b, card.row), `Deleted ${q(card.name)}.`));
  return (
    <ul className="ly-cards">
      {m.cards.map((card) => {
        const email = /\S+@\S+\.\S+/.exec(card.contact)?.[0];
        const phone = !email && /^[+()\d\s-]{6,}$/.test(card.contact.trim()) ? card.contact.trim() : null;
        const canCompany = !fromPeople && c && c.company >= 0;
        const canContact = !fromPeople && c && c.contact >= 0;
        return (
          <li key={`${card.row}:${card.name}`} className={`ly-contact${editing === card.row ? ' is-editing' : ''}`} {...peekRow({ type: 'person', name: card.name })}>
            <RecordScope at={{ type: 'person', name: card.name }}>
              <span className="pj-avatar" style={{ ['--hue' as string]: personHue(card.name) }}>
                {initials(card.name)}
              </span>
              <div className="ly-contact-words">
                <Inline value={card.name} required label="Name" className="ly-contact-name" onSave={(v) => set(card, 'name', v, `Renamed ${q(card.name)} to ${q(v)}.`)} />
                <p className="ly-faint ly-contact-role">
                  <Inline value={card.role} quiet placeholder="+ Role" label="Role" onSave={(v) => set(card, 'role', v, `Changed the role of ${q(card.name)}.`)} />
                  {canCompany && (card.role || card.company || canEdit) && <span className="ly-sep">{card.role && card.company ? ' · ' : ' '}</span>}
                  {canCompany && <Inline value={card.company} quiet placeholder="+ Company" label="Company" onSave={(v) => set(card, 'company', v, `Changed the company of ${q(card.name)}.`)} />}
                </p>
                {canContact && (card.contact ? <ContactLine contact={card.contact} email={email} phone={phone} onSave={(v) => set(card, 'contact', v, `Changed how to reach ${q(card.name)}.`)} /> : <Inline value="" quiet placeholder="+ Email or phone" label="Contact" onSave={(v) => set(card, 'contact', v, `Added how to reach ${q(card.name)}.`)} />)}
                {editing === card.row && t && c && <RowForm section={m.section} head={t.head} row={card.row} title={card.name} onDone={() => setEditing(null)} />}
              </div>
            </RecordScope>
            <More
              label={`More for ${card.name}`}
              items={() => [...(!fromPeople && t ? [{ label: 'Edit…', icon: 'pencil' as const, hint: 'Every column', run: () => setEditing(card.row) }, { separator: true as const }] : []), { label: 'Delete', icon: 'trash' as const, danger: true, run: () => void remove(card) }]}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** How to reach someone: an email or phone opens; its pencil (or Enter on it) edits it. */
function ContactLine({ contact, email, phone, onSave }: { contact: string; email?: string; phone: string | null; onSave(v: string): Promise<boolean> | undefined }) {
  const { canEdit } = useEditor();
  const [editing, setEditing] = useState(false);
  if (editing) return <Inline value={contact} autoEdit label="Contact" onDone={() => setEditing(false)} onSave={(v) => onSave(v)} />;
  if (!email && !phone) return <Inline value={contact} label="Contact" className="ly-contact-how" onSave={(v) => onSave(v)} />;
  return (
    <span className="ly-link-fact">
      {email ? (
        <a href={`mailto:${email}`} className="ly-link">
          {contact}
        </a>
      ) : (
        <a href={`tel:${phone!.replace(/[^\d+]/g, '')}`} className="ly-link">
          {phone}
        </a>
      )}
      {canEdit && (
        <button type="button" className="ly-pencil" title="Change how to reach them" aria-label="Change how to reach them" onClick={() => setEditing(true)}>
          <Icon name="pencil" size={11} />
        </button>
      )}
    </span>
  );
}

function Actions({ m, path }: { m: ActionsBlock; path: string }) {
  const dash = useDash();
  const items: CheckItem[] = m.items.map((x) => ({ key: x.index, done: false, what: x.what, who: x.who ?? '', when: x.when ?? '' }));
  return (
    <>
      <CheckList
        label="Next actions"
        path={path}
        items={items}
        onTick={(i, done) => void dash.edit({ kind: 'change', list: 'next', index: m.items[i].index, item: { done } })}
        onSave={(i, ch) => dash.edit({ kind: 'change', list: 'next', index: m.items[i].index, item: ch })}
        onRemove={(i) => void dash.edit({ kind: 'remove', list: 'next', index: m.items[i].index })}
        onMove={(from, over, after) => {
          const a = m.items[from].index;
          const b = m.items[over].index;
          void dash.edit({ kind: 'move', list: 'next', from: a, to: target(a, b, after) });
        }}
      />
      {m.open > m.items.length && <p className="ly-faint ly-more-note">{m.open - m.items.length} more under What’s next</p>}
    </>
  );
}

// ── Choosing a layout, and the suggestion ────────────────────────────────────────────────────────────────────────────

/** The layout choices as menu items (in the page's "…" menu, polish 29 Oct 2026 item 2): the standard page or a
 *  preset, written as `layout:` (with Undo). */
export function layoutMenuItems(view: ProjectView, edit: ReturnType<typeof useEditor>['edit']): MenuItem[] {
  const current = layoutOf(view.props);
  const own = parseBlocks(view.props?.blocks).length > 0;
  return [
    { label: 'Standard page', hint: 'The sections only', checked: !current, run: () => void edit({ kind: 'set', field: 'layout', value: null }) },
    { separator: true },
    ...LAYOUTS.map((l) => ({ label: l.name, hint: l.line, checked: current === l.id, run: () => void edit({ kind: 'set', field: 'layout', value: l.id }) })),
    ...(own ? [{ separator: true } as const, { label: 'This project lists its own blocks (blocks: in its properties), so they show whichever layout is chosen.', disabled: true, run: () => undefined }] : []),
  ];
}

/** The Layout pill in the page's facts: the standard page or a preset, written as `layout:` (with Undo). Kept for
 *  any other surface that still shows it; the project page header puts these choices in its "…" menu instead. */
export function LayoutPill({ view }: { view: ProjectView }) {
  const { canEdit, edit } = useEditor();
  const current = layoutOf(view.props);
  const own = parseBlocks(view.props?.blocks).length > 0;
  const name = own ? 'Own blocks' : (layoutInfo(current)?.name ?? 'Standard page');
  if (!canEdit && !current && !own) return null;
  const menu = (e: React.MouseEvent<HTMLElement>) => {
    openMenu(e.currentTarget, [{ heading: 'How this page is laid out' }, ...layoutMenuItems(view, edit)]);
  };
  return canEdit ? (
    <button className="pj-pill tone-none ly-pill" onClick={menu} title="Choose how this project’s page is laid out" aria-haspopup="menu">
      <Icon name="layers" size={12} />
      {name}
      <Icon name="chevronDown" size={11} />
    </button>
  ) : (
    <span className="pj-pill tone-none ly-pill">
      <Icon name="layers" size={12} />
      {name}
    </span>
  );
}

/** A quiet line on a project without a layout whose structure suits one: one click applies it, or it's put away. */
export function LayoutSuggestion({ view, path }: { view: ProjectView; path: string }) {
  const { canEdit, edit } = useEditor();
  // Put away on any PC: kept in the vault (state/vaultShared.ts).
  const [dismissed, dismiss] = useLayoutDismissed(path);
  const s = useMemo(() => suggestLayout(view.project, view.props ?? {}, view.logs ?? []), [view]);
  if (!canEdit || !s || dismissed) return null;
  const info = layoutInfo(s.layout)!;
  return (
    <div className="ly-suggest" role="note">
      <Icon name="bulb" size={14} />
      <p>
        {s.why}. <span className="ly-faint">The {info.name} layout puts it in a dashboard above these sections.</span>
      </p>
      <span className="ly-suggest-acts">
        <button className="button" onClick={() => void edit({ kind: 'set', field: 'layout', value: s.layout })}>
          Use {info.name}
        </button>
        <button
          className="icon-button"
          title="Not for this project"
          aria-label="Not for this project"
          onClick={dismiss}
        >
          <Icon name="close" size={13} />
        </button>
      </span>
    </div>
  );
}
