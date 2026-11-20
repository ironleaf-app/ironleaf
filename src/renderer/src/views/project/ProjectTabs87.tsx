// A project's folio sections (5 Nov 2026, the vault folio: the eight tabs of 8.7 wave 2a became one scrolling page —
// What's next, Waiting, Key dates, People, Decisions, Notes, Files, Risks, Updates, Money, Activity — each the tab
// body it replaces, every row still ticking, editing in place, filing, opening or deleting to the Bin with Undo).
// Nothing is lost: the Overview's tiles moved into their sections (risks, updates and activity below), its layouts,
// lifecycle and dates-gone-by callout head the page (kept in ProjectPage), and every old tab link lands on its
// section (views/project/memory.ts sectionForTab).

import { useRoomy } from '../../components/ListDetail';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Project, ProjectDocument, ProjectList } from '../../../../shared/project-file';
import { splitRiskTail } from '../../../../shared/project-file';
import type { NoteMeta, ProjectFiles, ProjectView } from '../../../../shared/types';
import { docChain, docCountWords, readDocFactsMore, STATUS_WORDS, type DocFacts } from '../../../../shared/doc-versions';
import type { FinanceView } from '../../../../shared/record-modules-api';
import { connectedActionsOf, dayIn, itemKey, ownRole, projectMilestones, riskLevelRank, type Attention, type ConnectedAction, type HubAction, type HubFileIn, type HubMilestone, type HubModel, type ItemRef, type ProjectChange, type WaitingGroup as HubWaiting } from '../../../../shared/project-hub';
import { isMeetingNote, meetingDate } from '../../../../shared/meetings';
import { dayFrom, isoDay, longDay, shortDay } from '../../../../shared/timeline';
import { setRunSheetItem } from '../../../../shared/layouts';
import { setTaskRest, setTaskWho, splitTaskRest, taskEditableRest } from '../../../../shared/tasks';
import { dueDayWords } from '../../../../shared/hub';
import { recordFactEdit, recordFactText } from '../../../../shared/record-edits';
import type { PersonCard } from '../../../../shared/people';
import { noteKindOf, type NoteKindFilter } from '../../../../shared/projects-87';
import { authorWords } from '../../../../shared/versions';
import { plural, showCount } from '../../../../shared/words';
import { Icon } from '../../components/Icon';
import { WhenCell, WhenInner, WhoCell, WhoInner } from '../../components/plan/TaskCells';
import { dateWords, splitTitleOwner, stateReading, visibleWho, whenTone } from '../../components/plan/plan';
import { EmptyState } from '../../components/EmptyState';
import { PageLoading } from '../../components/PageStates';
import { RecordScope } from '../../components/RecordScope';
import { openMenu } from '../../components/Menu';
import { prompt } from '../../components/Dialogs';
import { activityWords } from '../../lib/assistantWords';
import { hashTint, initials, readDate, shortDate, sizeWords, whenAgo } from '../../lib/projectLook';
import { noteChainNodes } from '../../lib/docNodes';
import { renderMarkdown } from '../../lib/markdownRender';
import * as A from '../../state/actions';
import { askInChat } from '../../state/chat';
import { closePeek } from '../../state/peek';
import { showError, toast, useApp } from '../../state/store';
import { workCall, workDid } from '../../state/workModules';
import { billsForProject, moneyWords, projectMoneySummary } from '../../../../shared/finance';
import { setModule } from '../../state/modules';
import { BillRow } from '../modules/RecordModulePage';
import { addBill } from '../modules/recordActions';
import { AddRow, Inline, InlineDate, lineDate, niceDate, RowAction, RowActions, useEditor, type Suggestion } from './Inline';
import { Choice, choicesFrom } from './LayoutEdit';
import { saveNoteFact } from '../../lib/noteFacts';
import { Words } from './parts';
import { KindTile, kindWords } from './FileArt';
import { relKey } from './fileModel';
import { DeliveredRow } from '../../components/DeliveredFile';
import { namedFiles, type DeliveredFile } from '../../../../shared/agent-files';
import { projectWhere, type RemoteProblem } from '../../../../shared/project-folder';

import type { FolioSection } from './memory';

/** One open question asked in the project's meetings (step 1's Questions, step 2 lists them): what was asked,
 *  who asked and who owns the answer, and the meeting it waits in. */
export interface ProjectQuestion {
  path: string;
  meeting: string;
  date: string;
  line: number;
  raw: string;
  what: string;
  askedBy?: string;
  owner?: string;
}

export interface TabsCtx {
  view: ProjectView;
  files: ProjectFiles | null | undefined;
  /** Its meetings' open questions, longest waiting first (step 2: asked, open until answered, never lost). */
  questions: ProjectQuestion[];
  path: string;
  me: string | null;
  hub: HubModel;
  /** The connected vault's actions written in meetings and notes, filed ones included and unfolded (a meeting's
   *  card reads its own whole, the same rows the meeting reads). */
  connected: ConnectedAction[];
  today: number;
  go(ref: ItemRef, title?: string): (e?: React.MouseEvent) => void;
  /** Jump to another folio section (the old tabs' links, now scrolls). */
  goSection(id: FolioSection): void;
  refreshFiles(): void;
  noteMenu(anchor: HTMLElement): void;
  changes: ProjectChange[];
  fileList: HubFileIn[];
  /** Files agents delivered here lately (newest first), and what agents did here. */
  delivered: DeliveredFile[];
  agentLines: { title: string; modified: number; status?: string; kind: string; open(): void }[];
  /** The project's file names, so an update naming one links to it. */
  fileNames: string[];
  /** Money's bills switch and reading (t12, 8 Nov 2026: read once on the page, shared by the Money section and
   *  the visibility rule, so the section and the rule never disagree). */
  money: { on: boolean; data: FinanceView | null };
}

export const plain = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');

/** A signer's day as the file row reads it ("3 Nov"); as written when the vault can't read it. */
const signerDay = (iso: string): string => {
  const ms = readDate(iso.trim());
  return ms === null ? iso.trim() : shortDate(ms);
};

/** An avatar's tint, steady per name, from the kit's five. */
function Avatar({ name, big }: { name: string; big?: boolean }) {
  return (
    <i className={big ? `pava ${hashTint(name)}` : `miniava ${hashTint(name)}`} aria-hidden="true" title={name}>
      {initials(name)}
    </i>
  );
}

/** A change to one line of a list (the Details cards' own way, kept). */
function useLine(list: ProjectList) {
  const { edit } = useEditor();
  return {
    change: (index: number, item: Record<string, unknown>) => edit({ kind: 'change', list, index, item }),
    remove: (index: number) => edit({ kind: 'remove', list, index }),
    add: (item: Record<string, unknown>) => edit({ kind: 'add', list, item }),
    move: (from: number, to: number) => edit({ kind: 'move', list, from, to }),
  };
}

function usePeople(): Suggestion[] {
  const { known } = useEditor();
  return useMemo(() => known.people.map((p) => ({ value: p.name, hint: p.role })), [known]);
}

/** A tick-box line's words without its box (an Undo holding the old words finds nothing). */
const stripBox = (line: string) => line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+/, '');

/** A hub action ticked where it is written: its own line in a meeting or note, a next step, or a run-sheet box. */
function tickAction(ctx: TabsCtx, edit: (e: Parameters<ReturnType<typeof useEditor>['edit']>[0]) => Promise<boolean>, a: HubAction): void {
  if (a.ref.kind === 'record') {
    if (a.task === undefined || a.ref.line === undefined) return;
    const done = !a.done;
    const atPath = a.ref.path;
    const atLine = a.ref.line;
    void window.nv.tasks
      .tick(atPath, atLine, a.task, done)
      .then((r) => toast(r.words, { label: 'Undo', run: () => void window.nv.tasks.tick(atPath, atLine, stripBox(r.line), !done).catch(showError) }), showError);
    return;
  }
  if (a.ref.kind === 'next') return void edit({ kind: 'change', list: 'next', index: a.ref.index, item: { done: !a.done } });
  if (a.ref.kind === 'run') {
    const x = ctx.view.project.extra.find((e) => e.heading === (a.ref as { section: string }).section);
    if (!x) return;
    const lines = x.body.split('\n');
    const l = lines[a.ref.line];
    if (!l || !/^\s*[-*+]\s+\[[ xX]\]/.test(l)) return;
    lines[a.ref.line] = l.replace(/\[([ xX])\]/, a.done ? '[ ]' : '[x]');
    void edit({ kind: 'section', heading: x.heading, body: lines.join('\n'), words: a.done ? `Put “${a.what.slice(0, 48)}” back on the list.` : `Ticked off “${a.what.slice(0, 48)}”.` });
  }
}

/** One fact of a hub action saved where it is written (p17-editable, Nov 2026): a next step through the project's
 *  edit, a run-sheet box through its section's words (src/shared/layouts.ts setRunSheetItem), a task line in
 *  another note through the tasks writes. Every save says once, with Undo; a fact with nowhere to write (a record
 *  that is not a tick box) refuses. */
function useActionEdits(ctx: TabsCtx) {
  const { edit } = useEditor();
  return async (a: HubAction, change: { what?: string; who?: string; when?: string }): Promise<boolean> => {
    if (a.ref.kind === 'next') return edit({ kind: 'change', list: 'next', index: a.ref.index, item: change });
    if (a.ref.kind === 'run') {
      const x = ctx.view.project.extra.find((e) => e.heading === (a.ref as { section: string }).section);
      if (!x) return false;
      const body = setRunSheetItem(x.body, a.ref.line, change);
      if (body === x.body) return false;
      const name = `“${a.what.slice(0, 44)}”`;
      const words =
        change.what !== undefined ? `Changed ${name}.` : change.who !== undefined ? (change.who.trim() ? `Gave ${name} to ${change.who.trim()}.` : `Took ${name} back.`) : `Moved ${name}.`;
      return edit({ kind: 'section', heading: x.heading, body, words });
    }
    if (a.ref.kind === 'record') {
      if (a.task === undefined || a.ref.line === undefined) return false;
      const { path, line } = a.ref;
      const task = a.task;
      try {
        if (change.what !== undefined || change.who !== undefined) {
          const rest = taskEditableRest(`- [ ] ${task}`);
          if (rest === null) return false;
          let text = `- [ ] ${task}`;
          if (change.what !== undefined) text = setTaskRest(text, `${change.what.trim()}${splitTaskRest(taskEditableRest(text) ?? '').tail}`);
          if (change.who !== undefined) text = setTaskWho(text, change.who.trim());
          const next = taskEditableRest(text);
          if (next === null || next === rest) return true;
          const r = await window.nv.tasks.edit(path, line, task, next);
          const words = change.what !== undefined ? 'Changed the words.' : change.who!.trim() ? `Gave it to ${change.who!.trim()}.` : 'Took the owner off.';
          toast(words, { label: 'Undo', run: () => void window.nv.tasks.edit(path, line, stripBox(r.line), rest).catch(showError) });
          return true;
        }
        const iso = (change.when ?? '').trim() || null;
        const back = a.due !== undefined ? isoDay(a.due) : null;
        const w = await window.nv.tasks.setDue(path, line, task, iso, null);
        const todayIso = isoDay(ctx.today);
        const words = iso ? `Due ${dueDayWords(iso, todayIso).toLowerCase().replace(/^(mon|tue|wed|thu|fri|sat|sun)/, (d) => d[0].toUpperCase() + d.slice(1))}.` : w;
        toast(words, { label: 'Undo', run: () => void window.nv.tasks.setDue(path, line, task, back, null).then(() => toast('Undone.'), showError) });
        return true;
      } catch (err) {
        showError(err);
        return false;
      }
    }
    return false;
  };
}

/** A hub action's day as its calendar edits it: the day read from it (a record's line is written the one plain way),
 *  else its words as written. */
const actionWhen = (a: HubAction) => (a.ref.kind === 'record' ? (a.due !== undefined ? isoDay(a.due) : '') : a.when);

/** A row that opens its item, but never from inside an open field (its values edit there instead). */
const openUnlessEditing = (open: (e?: React.MouseEvent) => void) => (e: React.MouseEvent) => {
  if ((e.target as Element).closest('input, textarea, select, .pj-ed-input, .pj-suggest, .pj-date-input, button, a')) return;
  open(e);
};

/** A chase drafted in the side chat (never sent from here). */
function chase(ctx: TabsCtx, person: string, items: HubAction[]): void {
  closePeek();
  askInChat(
    `Draft a short, friendly chase message to ${person} about the project “${ctx.view.project.name}”, asking where these stand:\n${items.map((a) => `- ${plain(a.what)}${a.when ? ` (${a.when})` : ''}`).join('\n')}\n\nUse what the project says about each one. Write it ready to paste into an email or Teams; do not send anything and do not change any notes.`,
    ctx.path,
  );
}

/** Files an update names that the project has: each opens with a click. */
function NamedFiles({ path, words, names }: { path: string; words: string; names: string[] }) {
  const named = namedFiles(words, names.map((n) => n.split('/').pop()!));
  if (!named.length) return null;
  const rels = new Map(names.map((n) => [n.split('/').pop()!.toLowerCase(), n]));
  return (
    <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
      {named.map((n) => (
        <button key={n} className="w2a-tilelink" title={`Open ${n}`} onClick={() => A.openFolderFile(path, rels.get(n.toLowerCase()) ?? n)}>
          <Icon name="file" size={11} /> {n}
        </button>
      ))}
    </span>
  );
}

/** How many rows a section shows before it folds (long lists fold with "Show all"). */
const FOLD_N = 5;

/** Inside one of the page's own tabs (t255, 13 Nov 2026): each tab shows its whole list at the page's full
 *  width (no folding; a long list gets its own Find instead), so folds below read through it. */
const Tabbed = createContext(false);
export const useTabbed = () => useContext(Tabbed);
export const TabbedOn = ({ children }: { children: ReactNode }) => <Tabbed.Provider value={true}>{children}</Tabbed.Provider>;

/** One folio section: its head (the sticky line's words, plus its one action) and its rows. */
function Section({ id, title, action, children }: { id: FolioSection; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="pj-folio-sec" data-section={id} aria-label={title}>
      <div className="pj-folio-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A folded list's opener: "Show all N", back to "Show less". */
function ShowAll({ total, expanded, onToggle }: { total: number; expanded: boolean; onToggle(): void }) {
  return (
    <button type="button" className="pj-showall" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? 'Show less' : `Show all ${total}`}
    </button>
  );
}

/** A revealed line opens every fold (deep links land on the row, not the card): the page shouts, folds open. */
function useExpandAll(path: string, ...sets: ((open: boolean) => void)[]) {
  useEffect(() => {
    const onExpand = (e: Event) => {
      if ((e as CustomEvent).detail !== path) return;
      sets.forEach((s) => s(true));
    };
    window.addEventListener('pj-expand', onExpand);
    return () => window.removeEventListener('pj-expand', onExpand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
}

// ── One page, nothing twice, nothing empty (t12, 8 Nov 2026) ──

/** The dates gone by on the page: the hub's dates to confirm that are key dates. Key dates counts them and
 *  marks each where it sits (step 2: the banner above the sections folded in here, its words kept). */
export function wentByDates(hub: HubModel): Attention[] {
  return hub.toConfirm.filter((a) => a.ref.kind === 'date');
}

/** Key dates split for reading: the gone-by dates asking on their own rows, what is coming, the past folded.
 *  Key dates and the Overview read the one split, so each date reads once in both. */
export function keyDatesModel(p: Project, hub: HubModel, today: number): { asked: HubMilestone[]; coming: HubMilestone[]; past: HubMilestone[]; wentBy: Map<string, string> } {
  const miles = projectMilestones(p, today);
  const wentBy = new Map(wentByDates(hub).map((a) => [itemKey(a.ref), a.detail]));
  return {
    asked: miles.filter((m) => wentBy.has(itemKey(m.ref))),
    coming: miles.filter((m) => (m.day === undefined || m.day >= today) && !wentBy.has(itemKey(m.ref))),
    past: miles.filter((m) => m.day !== undefined && m.day < today && !wentBy.has(itemKey(m.ref))),
    wentBy,
  };
}

/** Open risks, highest first (t141, 9 Nov 2026: a short ranked list, whatever order the file holds; step 2:
 *  a bullet's tail level ranks it too). Risks and the Overview read the one ranking. */
export function openRisksRanked(p: Project): (Project['risks'][number] & { i: number })[] {
  return p.risks
    .map((r, i) => ({ ...r, i }))
    .filter((r) => !r.closed)
    .sort((a, b) => riskLevelRank(a.level ?? splitRiskTail(a.what).level) - riskLevelRank(b.level ?? splitRiskTail(b.what).level));
}

/** Actions filed from the project's notes and meetings that show nowhere else in the plan: an open filed action
 *  already shows under Your next (its own) or Waiting on others (someone else's), so Decisions keeps the rest (done, or
 *  with no home) — including a member meeting's done ones, which also read at that meeting (t12 keeps them here). */
export function decisionsFlowed(hub: HubModel): HubAction[] {
  const shown = new Set<string>();
  for (const a of [...hub.plan.late, ...hub.plan.week, ...hub.plan.later, ...hub.plan.undated]) shown.add(a.id);
  for (const g of hub.waiting) for (const a of g.items) shown.add(a.id);
  return hub.actions.filter((a) => a.from && a.ref.kind === 'record' && !shown.has(a.id));
}

export interface NoteRow {
  path: string;
  title: string;
  modified: number;
  kind: Exclude<NoteKindFilter, 'all'>;
}

/** The project's own notes, newest first (project, hub and people pages left out, as the section shows;
 *  meetings left out too: they read in their own group below, in meeting order with their actions). */
export function folioNoteRows(notes: ProjectView['notes'], byPath: Map<string, NoteMeta>): NoteRow[] {
  const seen = new Set<string>();
  const out: NoteRow[] = [];
  for (const n of notes) {
    if (seen.has(n.path)) continue;
    seen.add(n.path);
    const meta = byPath.get(n.path);
    const type = String(meta?.props?.type ?? '');
    if (/^(project|hub|person|people)$/i.test(type)) continue;
    if (isMeetingNote(n.path, meta?.props ?? {})) continue;
    // Daily notes by their type, or the vault's daily folder (a top folder called Daily, any case).
    const daily = /(^|\/)daily(\/|$)/i.test(n.path);
    out.push({ path: n.path, title: n.title, modified: n.modified || meta?.mtime || 0, kind: daily ? 'daily' : noteKindOf(n.path, type || undefined, '') });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export interface FolioMeeting {
  path: string;
  title: string;
  /** The meeting's own day (its date, a date in its name, else when it was touched), as a timeline day. */
  day: number;
}

/** The project's meetings, newest first (t141, 9 Nov 2026: meetings read in order, with their actions — by the
 *  meeting's own day, never the file's age, through the app's own meeting reading). */
export function folioMeetingRows(notes: ProjectView['notes'], byPath: Map<string, NoteMeta>): FolioMeeting[] {
  const seen = new Set<string>();
  const out: FolioMeeting[] = [];
  for (const n of notes) {
    if (seen.has(n.path)) continue;
    seen.add(n.path);
    const meta = byPath.get(n.path);
    if (!isMeetingNote(n.path, meta?.props ?? {})) continue;
    const d = meetingDate(n.path, meta?.props ?? {}, new Date(n.modified || meta?.mtime || 0));
    out.push({ path: n.path, title: n.title, day: dayFrom(d.getFullYear(), d.getMonth(), d.getDate()) });
  }
  return out.sort((a, b) => b.day - a.day || a.title.localeCompare(b.title));
}

/** Notes elsewhere that link here without belonging to it (5 Nov 2026, v9-vault-truth): every one of them.
 *  Project, hub and people pages never read as notes (t141, 9 Nov 2026: eight people showed as "notes" alongside
 *  the People section naming them — the same rule the member rows read). */
export function folioSeeAlso(view: Pick<ProjectView, 'notes' | 'linkedFrom'>, byPath: Map<string, NoteMeta>): NoteRow[] {
  const member = new Set(view.notes.map((n) => n.path));
  return view.linkedFrom
    .filter((l) => !member.has(l.path))
    .filter((l) => !/^(project|hub|person|people)$/i.test(String(byPath.get(l.path)?.props?.type ?? '')))
    .map((l) => {
      const meta = byPath.get(l.path);
      const type = String(meta?.props?.type ?? '');
      const daily = /(^|\/)daily(\/|$)/i.test(l.path);
      return { path: l.path, title: l.title, modified: meta?.mtime || 0, kind: daily ? 'daily' : noteKindOf(l.path, type || undefined, '') } as NoteRow;
    })
    .sort((a, b) => b.modified - a.modified);
}

export interface FolioFileRow {
  /** The folder file, or '' for a Documents entry naming a note (its notePath opens instead). */
  rel: string;
  name: string;
  ext: string;
  size: number;
  modified: number;
  /** A Documents entry's note, resolved (null when it names no note). */
  notePath: string | null;
  facts: DocFacts;
  /** Listed but not in the folder now (opens to the words saying so). */
  missing: boolean;
}

/** The project's files as rows (t239, one list): its folder's files, the files kept in Ironleaf, and its
 *  Documents entries — even with no folder linked, so a listed contract reads here (critic 2 F02). Newest first. */
export function folioFileRows(p: Project, files: ProjectFiles | null | undefined, byPath: Map<string, NoteMeta>, vaultRels: readonly string[] = []): FolioFileRow[] {
  const out: FolioFileRow[] = [];
  const seen = new Set<string>();
  const folderFiles = files?.groups.flatMap((g) => g.files) ?? [];
  const savedFiles = files?.saved?.files ?? [];
  const vaultByRel = new Map(vaultRels.map((r) => [relKey(r), r] as const));
  const entryFor = (rel: string): ProjectDocument | undefined => {
    const key = relKey(rel);
    return p.documents.find((d) => relKey(d.path) === key);
  };
  // A Documents entry naming a note (a link without a file's ending): the note, by path or title. A file kept
  // in the vault itself (a PDF in Docs) resolves by its vault path first, whatever its ending, so its row
  // opens through the vault's own viewer (t248, 12 Nov 2026, structure N2/F02).
  const noteFor = (entry: ProjectDocument): string | null => {
    const target = entry.link ? entry.link.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim() : entry.path;
    const vault = vaultByRel.get(relKey(target)) ?? vaultByRel.get(relKey(`${target}.md`));
    if (vault) return vault;
    if (/\.[a-z0-9]{2,5}$/i.test(target) && !/\.md$/i.test(target)) return null;
    const bare = target.replace(/\.md$/i, '').toLowerCase();
    const direct = byPath.has(target) ? target : byPath.has(`${target}.md`) ? `${target}.md` : null;
    if (direct) return direct;
    const ending = [...byPath.keys()].filter((k) => `/${k.toLowerCase()}`.endsWith(`/${bare}.md`) || k.toLowerCase().replace(/\.md$/i, '') === bare);
    if (ending.length === 1) return ending[0];
    if (ending.length > 1) return null;
    const titled = [...byPath.values()].filter((n) => n.title.toLowerCase() === target.toLowerCase());
    return titled.length === 1 ? titled[0].path : null;
  };
  for (const f of [...folderFiles, ...savedFiles.filter((s) => !folderFiles.some((x) => relKey(x.rel) === relKey(s.rel)))]) {
    if (seen.has(relKey(f.rel))) continue;
    seen.add(relKey(f.rel));
    const entry = entryFor(f.rel);
    out.push({ rel: f.rel, name: f.name, ext: f.ext, size: f.size, modified: f.modified, notePath: null, facts: readDocFactsMore(entry?.more), missing: false });
  }
  for (const d of p.documents) {
    if (seen.has(relKey(d.path))) continue;
    seen.add(relKey(d.path));
    const notePath = noteFor(d);
    const meta = notePath ? byPath.get(notePath) : undefined;
    const base = d.path.replace(/\\/g, '/').split('/').pop() ?? d.path;
    const baseExt = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
    out.push({
      rel: notePath ? '' : d.path.replace(/\\/g, '/'),
      name: d.what?.trim() || (notePath ? (meta?.title ?? base) : base),
      ext: meta ? 'md' : baseExt,
      size: 0,
      modified: meta?.mtime ?? 0,
      notePath,
      facts: readDocFactsMore(d.more),
      missing: !notePath,
    });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** What the Notes and files list shows, counted (step 2: the badge counts what its list shows): the member notes
 *  and file rows as one list — the All list the badge heads — latest versions only, a Documents note already listed
 *  read once. The same merge the section draws, without its rows. See-also notes are never counted (not its notes),
 *  and the file's own prose (Your notes, Other notes) is words, not rows. Meetings read under their own head with
 *  their own count, never here (t249: never Notes 13 by All 10). */
export function notesListCount(view: Pick<ProjectView, 'notes' | 'linkedFrom'>, p: Project, files: ProjectFiles | null | undefined, byPath: Map<string, NoteMeta>): number {
  const rows = folioNoteRows(view.notes, byPath);
  const meetings = folioMeetingRows(view.notes, byPath);
  const seeAlso = folioSeeAlso(view, byPath);
  const fileRows = folioFileRows(p, files, byPath);
  const listed = new Set([...rows.map((r) => r.path), ...meetings.map((m) => m.path), ...seeAlso.map((r) => r.path)]);
  const fileNodes = new Map<string, { path: string; title: string; facts: DocFacts }>();
  for (const f of fileRows) fileNodes.set(f.notePath ?? f.rel, { path: f.notePath ?? f.rel, title: f.name, facts: f.facts });
  for (const n of noteChainNodes()) fileNodes.set(n.path, n);
  const all = [...fileNodes.values()];
  let n = 0;
  for (const r of rows) if (docChain(all, r.path).latest) n++;
  for (const f of fileRows) {
    if (f.notePath && listed.has(f.notePath)) continue;
    if (docChain(all, f.notePath ?? f.rel).latest) n++;
  }
  return n;
}

export interface FolioActivityItem {
  words: ReactNode;
  meta: string;
  open?: () => void;
}

/** The latest changes, notes, agent work and other notes (the Activity section's one list). */
export function folioActivityItems(changes: ProjectChange[], view: ProjectView, agentLines: TabsCtx['agentLines']): FolioActivityItem[] {
  const out: FolioActivityItem[] = [];
  for (const c of changes.slice(0, 4)) out.push({ words: <>{c.words[0] ?? 'Changed'}{c.words.length > 1 ? ` (+${c.words.length - 1} more)` : ''}</>, meta: `${c.by ? `${authorWords(c.by)} · ` : ''}${whenAgo(c.time)}` });
  for (const n of view.notes.slice(0, 4)) out.push({ words: n.title, meta: whenAgo(n.modified), open: () => A.openPath(n.path) });
  for (const a of view.activity.slice(0, 3)) out.push({ words: a.title, meta: `${activityWords()} · ${whenAgo(a.modified)}`, open: () => A.openPath(a.path) });
  for (const a of agentLines) out.push({ words: a.title, meta: `${a.kind}${a.status ? ` · ${a.status}` : ''} · ${whenAgo(a.modified)}`, open: a.open });
  return out.slice(0, 8);
}

/** The folio's sections holding nothing: quiet, each tab offering to start its own. Reading, problems and
 *  warnings are not emptiness (a loading Money or Files, a remote problem, a moved folder still show). */
export function folioEmptySections(ctx: TabsCtx, byPath: Map<string, NoteMeta>): Set<FolioSection> {
  const empty = new Set<FolioSection>();
  const p = ctx.view.project;
  if (!ownOpen(ctx.hub).length && !p.next.some((n) => n.done) && !ctx.hub.waiting.length) empty.add('whats-next');
  if (!ctx.hub.waiting.length) empty.add('waiting');
  if (!ctx.questions.length) empty.add('questions');
  if (!projectMilestones(p, ctx.today).length) empty.add('key-dates');
  if (!ctx.hub.people.length) empty.add('people');
  const meetings = folioMeetingRows(ctx.view.notes, byPath);
  if (!p.decisions.length && !decisionsFlowed(ctx.hub).length) empty.add('decisions');
  const extras = p.extra.some((x) => x.heading.trim().toLowerCase() !== 'stage checklist');
  const f = ctx.files;
  // Notes and files share one section (t239): it hides only when both parts hold nothing. 'files' stays in the set
  // as the files marker, with the old meaning: nothing attached and nothing asked or wrong.
  const filesEmpty = folioFileRows(p, f, byPath).length === 0 && f !== undefined && !f?.problem && (!!f?.exists || !projectWhere(p));
  if (!meetings.length && !folioNoteRows(ctx.view.notes, byPath).length && !folioSeeAlso(ctx.view, byPath).length && !p.notes.trim() && !extras && filesEmpty) empty.add('notes');
  if (filesEmpty) empty.add('files');
  if (!p.risks.length) empty.add('risks');
  if (!p.updates.length && !ctx.delivered.length) empty.add('updates');
  // Bills off holds nothing either (the quiet Money tab switches on and starts one); loading still shows.
  if (!ctx.money.on || (ctx.money.data && !billsForProject(ctx.money.data.bills, ctx.path).length)) empty.add('money');
  if (!folioActivityItems(ctx.changes, ctx.view, ctx.agentLines).length) empty.add('activity');
  return empty;
}

/** Bills on, where they sit (5 Nov 2026, folio merge: "Open Finance" opened nothing while the pack was off).
 *  The pack first, since waking the part alone never wakes the pack. */
export function switchBillsOn(): Promise<unknown> {
  return setModule('finance', true).then(() => setModule('finance', true, 'bills')).catch(showError);
}

/** Files dropped or picked land in the project's folder on this PC (copied, never moved). */
export async function attachProjectFiles(path: string, picked: FileList | File[], refresh: () => void): Promise<void> {
  const list = [...picked];
  if (!list.length) return;
  const paths = list.map((f) => window.nv.files.pathOf(f)).filter(Boolean);
  if (!paths.length) return void toast('Those files have no place on this PC to copy from (dragged from a browser). Save them first, then drop them here.');
  try {
    const names = await window.nv.projects.addFiles(path, paths);
    toast(names.length === 1 ? `Attached ${names[0]}.` : `Attached ${names.length} files.`);
    refresh();
  } catch (err) {
    showError(err);
  }
}

/** The project's folder on this PC, chosen (the Files starter when none is linked yet). */
export function chooseProjectFolder(ctx: TabsCtx): void {
  void window.nv.projects.folderHere(ctx.path, 'choose').then((r) => (r.words && toast(r.words), ctx.refreshFiles())).catch(showError);
}

/** The folder door stands open when the project has nothing on this PC to attach to (t267, 13 Nov 2026: the tabs
 *  left a project with no folder no way to link one, where the foot's Files entry used to choose it): no
 *  listing and no folder reading. Never while reading, never for a remote project (its files come through the
 *  former host app, read only), and never once this PC works without a folder (its Change door sits in the ⋯
 *  menu). The Notes head and the quiet Notes tab ask the one rule. */
export function needsFolderChoice(ctx: Pick<TabsCtx, 'view' | 'files'>): boolean {
  if (ctx.view.place?.state === 'without') return false;
  if (projectWhere(ctx.view.project)?.kind === 'remote') return false;
  const f = ctx.files;
  if (f === undefined) return false;
  return !f || !f.exists;
}

/** Files attach when the project's folder reads on this PC (t267: the merged head hid Attach until a file
 *  listed, stranding an empty folder, where the foot's Files entry always picked while a folder was linked). */
export function canAttachHere(ctx: Pick<TabsCtx, 'view' | 'files'>): boolean {
  if (projectWhere(ctx.view.project)?.kind === 'remote') return false;
  const f = ctx.files;
  return !!f && f.exists && !f.problem;
}

type Edit = ReturnType<typeof useEditor>['edit'];

/** The first row of a missing section, in the section head's own words (the quiet tabs and the empty start share them). */
export async function startTask(edit: Edit): Promise<void> {
  const what = await prompt('Add a step', { message: 'What needs doing? Who and by when can be set on the row.', ok: 'Add it' });
  if (what?.trim()) void edit({ kind: 'add', list: 'next', item: { what: what.trim() } });
}

export async function startMilestone(edit: Edit): Promise<void> {
  const what = await prompt('Add a milestone', { message: 'What happens? When can be set on the row.', ok: 'Next' });
  if (!what?.trim()) return;
  const when = await prompt('When?', { message: 'Like 20 Nov or Friday. Leave it empty for no date yet.', ok: 'Add it' });
  if (when === null) return;
  void edit({ kind: 'add', list: 'dates', item: when.trim() ? { what: what.trim(), when: when.trim() } : { what: what.trim() } });
}

export async function startPerson(edit: Edit): Promise<void> {
  const name = await prompt('Add a person', { message: 'Who is part of this project? Their part can be set on the row.', ok: 'Add them' });
  if (name?.trim()) void edit({ kind: 'add', list: 'people', item: { name: name.trim() } });
}

export async function startDecision(edit: Edit): Promise<void> {
  const what = await prompt('Log a decision', { message: 'What was decided? Why can be set on the row.', ok: 'Log it' });
  if (what?.trim()) void edit({ kind: 'add', list: 'decisions', item: { date: lineDate(Date.now()), what: what.trim() } });
}

export async function startRisk(edit: Edit): Promise<void> {
  const what = await prompt('Add a risk', { message: 'What could go wrong? How much it matters can be set on the row.', ok: 'Add it' });
  if (what?.trim()) void edit({ kind: 'add', list: 'risks', item: { what: what.trim() } });
}

export async function startUpdate(edit: Edit): Promise<void> {
  const what = await prompt('Add an update', { message: 'What happened?', ok: 'Add it' });
  if (what?.trim()) void edit({ kind: 'add', list: 'updates', item: { what: what.trim() } });
}

/** Sections a quiet tab can start: Questions and Activity are derived, so they read no Add and appear on
 *  their own; everything else is one click from its tab. */
/** A step for someone else: a next step naming them, reading under Waiting on others until done. */
export async function startWaiting(edit: Edit): Promise<void> {
  const what = await prompt('Add a step for someone else', { message: 'What are they doing? It reads under Waiting on others until it is done.', ok: 'Next' });
  if (!what?.trim()) return;
  const who = await prompt('Who is doing it?', { message: 'Their name, as your notes write it.', ok: 'Add it' });
  if (who === null) return;
  void edit({ kind: 'add', list: 'next', item: { what: what.trim(), ...(who.trim() ? { who: who.trim() } : {}) } });
}

const FOLIO_STARTERS: { id: FolioSection; noun: string; label: string }[] = [
  { id: 'whats-next', noun: 'task', label: 'Add a task' },
  { id: 'waiting', noun: 'waiting step', label: 'Add a step for someone else' },
  { id: 'key-dates', noun: 'key date', label: 'Add a key date' },
  { id: 'people', noun: 'person', label: 'Add a person' },
  { id: 'decisions', noun: 'decision', label: 'Log a decision' },
  { id: 'notes', noun: 'note', label: 'Add a note' },
  { id: 'files', noun: 'files', label: 'Attach files' },
  { id: 'risks', noun: 'risk', label: 'Add a risk' },
  { id: 'updates', noun: 'update', label: 'Add an update' },
  { id: 'money', noun: 'bill', label: 'Add a bill' },
];

/** Every tab's count (t249: each tab's count equals its rows): open steps of yours, waiting items, open
 *  questions, every key date, the Notes-and-files All list, everyone named, decisions with their flowed rows,
 *  open risks, updates with agent deliveries, the project's bills, activity rows. Done, Past and dealt
 *  with keep their own counts where they fold. */
export function tabCounts(ctx: Pick<TabsCtx, 'view' | 'files' | 'questions' | 'path' | 'hub' | 'today' | 'changes' | 'delivered' | 'agentLines' | 'money'>, byPath: Map<string, NoteMeta>): Record<string, number> {
  const p = ctx.view.project;
  return {
    'whats-next': ownOpen(ctx.hub).length,
    waiting: ctx.hub.waiting.reduce((n, g) => n + g.items.length, 0),
    questions: ctx.questions.length,
    'key-dates': projectMilestones(p, ctx.today).length,
    notes: notesListCount(ctx.view, p, ctx.files, byPath),
    people: ctx.hub.people.length,
    decisions: p.decisions.length + decisionsFlowed(ctx.hub).length,
    risks: p.risks.filter((r) => !r.closed).length,
    updates: p.updates.length + ctx.delivered.length,
    money: ctx.money.on && ctx.money.data ? billsForProject(ctx.money.data.bills, ctx.path).length : 0,
    activity: folioActivityItems(ctx.changes, ctx.view, ctx.agentLines).length,
  };
}

/** Start a tab's first row from its quiet empty state (t255: every tab carries its own Add). Questions and
 *  Activity are derived or automatic, so they offer none. */
export function startSection(id: FolioSection, ctx: TabsCtx, edit: Edit, anchor: HTMLElement): void {
  switch (id) {
    case 'whats-next': return void startTask(edit);
    case 'waiting': return void startWaiting(edit);
    case 'key-dates': return void startMilestone(edit);
    case 'people': return void startPerson(edit);
    case 'decisions': return void startDecision(edit);
    case 'notes': return ctx.noteMenu(anchor);
    case 'risks': return void startRisk(edit);
    case 'updates': return void startUpdate(edit);
    case 'money': {
      const name = ctx.view.project.name;
      if (!ctx.money.on) return void switchBillsOn().then(() => addBill(null, { project: name }));
      return addBill(ctx.money.data, { project: name });
    }
    default: return undefined;
  }
}

/** A tab starter's words for its quiet empty state (the starters' own words, shared). */
export function tabStarter(id: FolioSection): { noun: string; label: string } | undefined {
  return FOLIO_STARTERS.find((s) => s.id === id);
}

/** A brand-new empty project is never a blank page: a short helpful start. */
export function FolioEmpty({ ctx }: { ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  return (
    <div className="pj-start" data-folio-empty>
      <h2>Start this project</h2>
      <p>Add the first task, a note, or a key date. The rest gathers here as you work.</p>
      {canEdit && (
        <div className="pj-start-actions">
          <button type="button" className="btn pri" data-add="whats-next" onClick={() => void startTask(edit)}>Add task</button>
          <button type="button" className="btn" data-add="notes" onClick={(e) => ctx.noteMenu(e.currentTarget)}>Add note</button>
          <button type="button" className="btn" data-add="key-dates" onClick={() => void startMilestone(edit)}>Add key date</button>
        </div>
      )}
    </div>
  );
}

// ── Risks ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function RisksSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit } = useEditor();
  const tabbed = useTabbed();
  const p = ctx.view.project;
  const people = usePeople();
  const risks = useLine('risks');
  const openRisks = useMemo(() => openRisksRanked(p), [p]);
  const shutRisks = p.risks.map((r, i) => ({ ...r, i })).filter((r) => r.closed);
  const levels = useMemo(() => [{ value: 'High' }, { value: 'Medium' }, { value: 'Low' }], []);
  const [open, setOpen] = useState(false);
  useExpandAll(ctx.path, setOpen);
  const shown = tabbed || open ? openRisks : openRisks.slice(0, FOLD_N);
  if (!p.risks.length) return null;
  return (
    <Section id="risks" title="Risks">
      <div className="card" data-item-card="risks" style={{ padding: '14px 18px' }}>
          {shown.map((r) => {
            // No file syntax (step 2): a bullet's "(owner: X, level: Y)" tail reads as its owner and level, and an
            // edit keeps the tail on the line (a list writes no owner, so dropping it would lose it).
            const tail = splitRiskTail(r.what);
            const level = r.level ?? tail.level ?? '';
            const owner = r.owner ?? tail.owner;
            const keepTail = (what: string) => (tail.tail && what.trim() && !/\(.*\)\s*$/.test(what) ? `${what.trim()} (${tail.tail})` : what);
            return (
            <div className="trow compact" key={r.i} data-item={`risks:${r.i}`}>
              <span className="t">
                <Inline value={r.what} required label="Risk" onSave={(what) => risks.change(r.i, { what: keepTail(what) })}>
                  <Words text={tail.what} from={ctx.path} />
                </Inline>
              </span>
              <Choice value={level} options={choicesFrom(p.risks.map((x) => x.level ?? ''), ['High', 'Medium', 'Low'])} onSave={(level) => risks.change(r.i, { level })} label="How much it matters" tone={/high|critical|severe/i.test(level) ? 'bad' : /medium|moderate/i.test(level) ? 'warn' : 'none'} placeholder="+ Level" />
              {/* A risk's owner opens that person and changes where it shows (merged p17-editable + p17-connected):
                  the value belongs to the person (RecordScope), so one click opens them in the peek and double-click,
                  E or the pencil changes it — the app's own gesture, which also keeps a double-click from opening
                  first. An owner only where one's own column keeps it (a risks table): a risks list writes no owner,
                  so there the name only opens, never an edit that would take it and lose it. Its level writes in
                  both (a list prefixes it). */}
              {p.risksHead?.length ? (
                <RecordScope at={r.owner ? { type: 'person', name: r.owner } : null}>
                  <Inline value={r.owner ?? ''} label="Owner" placeholder="+ Owner" quiet suggest={people} compact className="meta" onSave={(owner) => risks.change(r.i, { owner })} />
                </RecordScope>
              ) : (
                owner && <button type="button" className="meta" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={ctx.go({ kind: 'person', name: owner }, owner)} title={`Everything about ${owner}`}>{owner}</button>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {canEdit && <button className="btn quiet" style={{ height: 28 }} title="Dealt with: kept, shown apart" onClick={() => void risks.change(r.i, { closed: true })}>Close</button>}
                <RowActions>
                  <RowAction icon="trash" title="Remove this risk" danger onClick={() => void risks.remove(r.i)} />
                </RowActions>
              </span>
            </div>
            );
          })}
          {!tabbed && openRisks.length > FOLD_N && <ShowAll total={openRisks.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
          {canEdit && <AddRow label="Add a risk…" fields={[{ key: 'what', placeholder: 'What could go wrong', required: true, grow: true }, { key: 'level', placeholder: 'How much it matters', suggest: levels }]} onAdd={(v) => risks.add(v)} />}
          {shutRisks.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>{shutRisks.length} dealt with</summary>
              {shutRisks.map((r) => (
                <div className="trow compact" key={r.i}>
                  <span className="t" style={{ color: 'var(--text-faint)' }} title={plain(splitRiskTail(r.what).what)}>{plain(splitRiskTail(r.what).what)}</span>
                  {canEdit && <button className="btn quiet" style={{ marginLeft: 'auto', height: 28 }} onClick={() => void risks.change(r.i, { closed: false })}>Reopen</button>}
                </div>
              ))}
            </details>
          )}
      </div>
    </Section>
  );
}

// ── Updates ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function UpdatesSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit } = useEditor();
  const tabbed = useTabbed();
  const p = ctx.view.project;
  const updates = useLine('updates');
  const [open, setOpen] = useState(false);
  useExpandAll(ctx.path, setOpen);
  const shown = tabbed || open ? p.updates : p.updates.slice(0, FOLD_N);
  if (!p.updates.length && !ctx.delivered.length) return null;
  return (
    <Section id="updates" title="Updates">
      <div className="card" data-item-card="updates" style={{ padding: '14px 18px' }}>
        {ctx.delivered.length > 0 && (
          <div aria-label="Delivered by agents">
            {ctx.delivered.map((f) => (
              <DeliveredRow key={f.id} f={f} />
            ))}
          </div>
        )}
        {shown.map((u, i) => (
            <div className="trow compact" key={`${i}:${u.what}`} data-item={`updates:${i}`}>
              <span className="meta" style={{ flex: 'none' }}>
                <InlineDate value={u.date} label="Date" placeholder="+ Date" quiet onSave={(date) => updates.change(i, { date })} />
              </span>
              <span className="t">
                <Inline value={u.what} required label="Update" onSave={(what) => updates.change(i, { what })}>
                  <Words text={u.what} from={ctx.path} />
                </Inline>
                <NamedFiles path={ctx.path} words={u.what} names={ctx.fileNames} />
              </span>
              <RowActions>
                <RowAction icon="trash" title="Remove this update" danger onClick={() => void updates.remove(i)} />
              </RowActions>
            </div>
          ))}
          {!tabbed && p.updates.length > FOLD_N && <ShowAll total={p.updates.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
          {canEdit && <AddRow label="Add an update…" fields={[{ key: 'what', placeholder: 'What happened', required: true, grow: true }]} onAdd={(v) => updates.add(v)} />}
      </div>
    </Section>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ActivitySection({ ctx }: { ctx: TabsCtx }) {
  const activity = useMemo(() => folioActivityItems(ctx.changes, ctx.view, ctx.agentLines), [ctx.changes, ctx.view, ctx.agentLines]);
  const tabbed = useTabbed();
  const [open, setOpen] = useState(false);
  useExpandAll(ctx.path, setOpen);
  const shown = tabbed || open ? activity : activity.slice(0, FOLD_N);
  if (!activity.length) return null;
  return (
    <Section id="activity" title="Activity">
      <div className="card" style={{ padding: '14px 18px' }}>
          {shown.map((x, i) => (
            <div className="trow compact" key={i}>
              <span className="t clip-2">
                {x.open ? (
                  <button style={{ border: 0, background: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }} onClick={x.open} title={typeof x.words === 'string' ? x.words : undefined}>{x.words}</button>
                ) : (
                  x.words
                )}
              </span>
              <span className="meta" style={{ marginLeft: 'auto' }}>{x.meta}</span>
            </div>
          ))}
        {!tabbed && activity.length > FOLD_N && <ShowAll total={activity.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
      </div>
    </Section>
  );
}

// ── Your next ────────────────────────────────────────────────────────────────────────────────────────────────────────

function StepRow({ ctx, index, what, who, when, done, people }: { ctx: TabsCtx; index: number; what: string; who?: string; when?: string; done: boolean; people: Suggestion[] }) {
  const { canEdit } = useEditor();
  const line = useLine('next');
  const due = when ? dayIn(when, ctx.today)?.day : undefined;
  // An owner written in the title's words shows in who (display only; the stored who wins, the note's words stay).
  // A trailing owner that matches the stored who strips from the title too, so setting who never shows it twice.
  const rawTitle = plain(what);
  const split = splitTitleOwner(rawTitle);
  const displayWho = who?.trim() ? who : split.owner;
  const tailMatchesWho = !!split.owner && !!displayWho && split.owner.toLowerCase() === displayWho.trim().toLowerCase();
  const displayTitle = ((!who?.trim() && !!split.owner) || tailMatchesWho) ? split.title : rawTitle;
  // A day reads coral when late or today, quiet when future; a bare state reads quietly; "Open" reads as nothing.
  const state = due === undefined && when?.trim() ? stateReading(when) : null;
  const whenWords = due !== undefined ? dateWords(due, ctx.today) : state?.words ?? null;
  const whenTitle = due !== undefined ? longDay(due) : whenWords ?? undefined;
  return (
    <div className="trow tkrow" data-item={`next:${index}`}>
      <button className={`check${done ? ' done' : ''}`} role="checkbox" aria-checked={done} aria-label={`${done ? 'Put back' : 'Tick'} “${plain(what)}”`} disabled={!canEdit} onClick={() => void line.change(index, { done: !done })}>
        {done ? <Icon name="check" size={12} /> : null}
      </button>
      <span className={`tkrow-title${done ? ' is-done' : ''}`}>
        <span className="clip-2" title={plain(what)}>
          <Inline value={what} required label="Next step" onSave={(v) => line.change(index, { what: v })}>
            <Words text={displayTitle} from={ctx.path} />
          </Inline>
        </span>
      </span>
      {/* The cell stays the grid item even when the edit box renders nothing (read-only and empty). The box
          edits the display owner (a title's "- Name" confirms into who with one save); the title keeps the words. */}
      <span className="tkrow-who">
        <Inline value={displayWho ?? ''} quiet placeholder="+ Who" label="Who does it" suggest={people} compact onSave={(v) => line.change(index, { who: v })}>
          {/* Your own name never heads your own rows (t249: Today hides it through visibleWho; Your next does too). */}
          <WhoInner name={visibleWho(displayWho, ctx.hub.me) || undefined} />
        </Inline>
      </span>
      <span className="tkrow-when">
        <InlineDate value={when} quiet placeholder={canEdit ? '+ By when' : ''} label="By when" onSave={(v) => line.change(index, { when: v })}>
          <WhenInner words={whenWords} tone={done ? (whenWords ? 'quiet' : null) : due !== undefined ? whenTone(due - ctx.today) : state ? 'quiet' : null} title={whenTitle} />
        </InlineDate>
      </span>
      <RowActions>
        <RowAction icon="trash" title="Remove this step" danger onClick={() => void line.remove(index)} />
      </RowActions>
    </div>
  );
}

/** One Waiting row: the same grid as a step (tick | title | who | when). Who it is with sits in who, never
 *  trailing the title; when is its day, else how long it has waited, else where it was written. Every cell edits
 *  where it shows, through the line it came from (a click still opens it). The box ticks it done like every
 *  other box (t248, item 9: it opened the same page the row opens, so it answered nothing); a line with no box
 *  to tick stays off, and the row still opens it. */
function WaitingRow({ ctx, action: a }: { ctx: TabsCtx; action: HubAction }) {
  const { canEdit, edit } = useEditor();
  const saveAction = useActionEdits(ctx);
  const people = usePeople();
  const dueWords = a.due !== undefined ? dateWords(a.due, ctx.today) : a.since !== undefined ? `${plural(ctx.today - a.since, 'day')} waiting` : a.from ? `from ${a.from}` : null;
  const dueTone = a.due !== undefined ? whenTone(a.due - ctx.today) : dueWords ? 'quiet' as const : null;
  const editable = a.ref.kind === 'next' || a.ref.kind === 'run' || (a.ref.kind === 'record' && a.task !== undefined && a.ref.line !== undefined);
  return (
    <div className="trow tkrow" key={a.id} data-action={a.id} role="button" tabIndex={0} aria-label={plain(a.what)} title={`${plain(a.what)} (open it)`} onClick={openUnlessEditing(ctx.go(a.ref, a.what))} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); ctx.go(a.ref, a.what)(); } }}>
      <button className={`check${a.done ? ' done' : ''}`} style={{ borderStyle: 'dashed' }} role="checkbox" aria-checked={a.done} aria-label={`Tick “${plain(a.what)}”`} title={editable ? `Tick “${plain(a.what)}”` : 'Tick it where it is written'} disabled={!canEdit || !editable} onClick={(e) => (e.stopPropagation(), tickAction(ctx, edit, a))}>
        {a.done ? <Icon name="check" size={12} /> : null}
      </button>
      <span className="tkrow-title">
        <span className="clip-2" title={plain(a.what)}>
          {editable ? (
            <Inline value={a.what} required label="Step" onSave={(v) => saveAction(a, { what: v })}>
              {plain(a.what)}
            </Inline>
          ) : (
            plain(a.what)
          )}
        </span>
      </span>
      <span className="tkrow-who">
        {editable ? (
          <Inline value={a.who || a.person} quiet placeholder="+ Who" label="Who does it" suggest={people} compact onSave={(v) => saveAction(a, { who: v })}>
            <WhoInner name={a.person || a.who} />
          </Inline>
        ) : (
          <WhoCell name={a.person} />
        )}
      </span>
      <span className="tkrow-when">
        {editable ? (
          <InlineDate value={actionWhen(a)} iso={a.ref.kind === 'record'} quiet placeholder={dueWords ?? '+ By when'} label="By when" onSave={(v) => saveAction(a, { when: v })}>
            <WhenInner words={dueWords} tone={dueTone} title={a.due !== undefined ? longDay(a.due) : dueWords ?? undefined} />
          </InlineDate>
        ) : (
          <WhenCell words={dueWords} tone={dueTone} title={a.due !== undefined ? longDay(a.due) : dueWords ?? undefined} />
        )}
      </span>
    </div>
  );
}

/** One of the person's own actions written outside the file (a meeting's action, a note's tick box): ticked and
 *  changed where it shows, through the line it came from (the Overview's tile showed them; the rows never did).
 *  The same grid as a step (t208, 11 Nov 2026, second look at real content: it read bespoke — no who, its day
 *  pushed right, a smaller title). */
function ElsewhereRow({ ctx, action: a }: { ctx: TabsCtx; action: HubAction }) {
  const { canEdit, edit } = useEditor();
  const saveAction = useActionEdits(ctx);
  const today = ctx.today;
  const whenWords = a.due !== undefined ? dateWords(a.due, today) : null;
  return (
    <div className="trow tkrow" data-action={a.id} role="button" tabIndex={0} aria-label={plain(a.what)} title={`${plain(a.what)} (open it)`} onClick={openUnlessEditing(ctx.go(a.ref, a.what))} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); ctx.go(a.ref, a.what)(); } }}>
      <button className={`check${a.done ? ' done' : ''}`} role="checkbox" aria-checked={a.done} aria-label={`Tick “${plain(a.what)}”`} disabled={!canEdit} onClick={(e) => (e.stopPropagation(), tickAction(ctx, edit, a))}>
        {a.done ? <Icon name="check" size={12} /> : null}
      </button>
      <span className={`tkrow-title${a.done ? ' is-done' : ''}`}>
        <span className="clip-2" title={plain(a.what)}>
          <Inline value={a.what} required label="Next step" onSave={(v) => saveAction(a, { what: v })}>
            {plain(a.what)}
          </Inline>
        </span>
      </span>
      {/* Your own name never heads your own rows (t249, as StepRow above). */}
      <WhoCell name={visibleWho(a.person || a.who, ctx.hub.me) || undefined} />
      <span className="tkrow-when">
        <InlineDate value={actionWhen(a)} iso={a.ref.kind === 'record'} quiet placeholder={canEdit ? '+ By when' : ''} label="By when" onSave={(v) => saveAction(a, { when: v })}>
          <WhenInner words={whenWords} tone={a.done ? (whenWords ? 'quiet' : null) : a.due !== undefined ? whenTone(a.due - today) : null} title={a.due !== undefined ? longDay(a.due) : whenWords ?? undefined} />
        </InlineDate>
      </span>
    </div>
  );
}

/** A date gone by asks on its own row, answered in one click (13 Nov 2026, the picture: the nudge had no row to
 *  answer it, only "Past 2"). */
function WentByAsk({ index, today, detail }: { index: number; today: number; detail: string }) {
  const line = useLine('dates');
  return (
    <span className="pj-ask" title={detail}>
      <span className="pj-ask-q">Did it happen?</span>
      <button type="button" className="btn quiet" style={{ height: 28 }} onClick={() => void line.change(index, { status: 'Happened' })}>It happened</button>
      <button type="button" className="btn quiet" style={{ height: 28 }} onClick={() => void line.change(index, { when: isoDay(today) })}>Not yet</button>
    </span>
  );
}

/** One key date's row: its day and words edit, it opens. A date gone by is marked where it sits (t12, 8 Nov 2026:
 *  the one naming, beside the top callout's count) and asks through WentByAsk above. */
function KeyDateRow({ ctx, m, wentBy }: { ctx: TabsCtx; m: HubMilestone; wentBy?: string }) {
  const { canEdit } = useEditor();
  const line = useLine('dates');
  const today = ctx.today;
  if (m.ref.kind !== 'date') return null;
  const index = m.ref.index;
  const isToday = m.day === today;
  return (
    <div className="trow compact" data-item={`dates:${index}`} data-milestone={m.id} role="button" tabIndex={0} aria-label={plain(m.what)} title={`${plain(m.what)} (open it)`} onClick={openUnlessEditing(ctx.go(m.ref, m.what))} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); ctx.go(m.ref, m.what)(); } }}>
      <span style={{ fontSize: 13, fontWeight: 700, flex: 'none' }}>
        <InlineDate value={m.when} label="Date" placeholder="+ Date" quiet={!m.when} onSave={(when) => line.change(index, { when })}>
          {m.day !== undefined ? (isToday ? 'Today' : shortDay(m.day, today)) : undefined}
        </InlineDate>
      </span>
      <span className="t" title={plain(m.what)}>
        <Inline value={m.what} required label="Key date" onSave={(what) => line.change(index, { what })}>
          <Words text={m.what} from={ctx.path} />
        </Inline>
      </span>
      {wentBy !== undefined && <span className="tag is-plain is-attention" title={`${wentBy}. Open it to confirm.`}>Went by</span>}
      {wentBy !== undefined && canEdit && <WentByAsk index={index} today={today} detail={wentBy} />}
      <RowActions>
        <RowAction icon="trash" title="Remove this date" danger onClick={() => void line.remove(index)} />
      </RowActions>
    </div>
  );
}

/** How many of yours read before the fold ("Your next 3, then All N of yours", step 2). */
const NEXT3 = 3;

/** The person's own open work on the project, in the hub's order (late, this week, later, no date): steps and
 *  the actions written in meetings and notes. Run-sheet boxes are their layout's door, never listed here — the
 *  standing line counts this same list, so the badge and the rows never disagree. */
export function ownOpen(hub: HubModel): HubAction[] {
  return [...hub.plan.late, ...hub.plan.week, ...hub.plan.later, ...hub.plan.undated].filter((a) => a.ref.kind === 'next' || a.ref.kind === 'record');
}

/** Your next 3, then all of yours (vault rebuild step 2, 12 Nov 2026 — one flat list of the person's own open
 *  work, late first, then by day; one view, no Find. Someone else's rows read under Waiting on others,
 *  never here. Done folds below. */
export function WhatsNextSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  const tabbed = useTabbed();
  const [all, setAll] = useState(false);
  const [allDone, setAllDone] = useState(false);
  useExpandAll(ctx.path, setAll);
  const p = ctx.view.project;
  const people = usePeople();
  const mine = useMemo(() => ownOpen(ctx.hub), [ctx.hub]);
  const done = p.next.map((n, i) => ({ ...n, i })).filter((n) => n.done);
  const waiting = ctx.hub.waiting.reduce((n, g) => n + g.items.length, 0);
  const addStep = () => void startTask(edit);
  if (!mine.length && !done.length && !waiting) return null;
  const shown = tabbed || all ? mine : mine.slice(0, NEXT3);
  const doneShown = allDone ? done : done.slice(0, FOLD_N);
  // The head reads once (t249: "Your next" holding "Your next 3" said it twice): the folded head names its
  // three, the opened head its whole, a short list needs no number. In a tab the tab carries the count.
  const head = tabbed ? 'Your next' : mine.length > NEXT3 ? (all ? `Your next ${mine.length}` : 'Your next 3') : 'Your next';
  return (
    <Section
      id="whats-next"
      title={head}
      action={canEdit ? <button className="btn pri" onClick={() => void addStep()}><Icon name="plus" size={14} /> Add task</button> : undefined}
    >
      <div className="card tklist" data-item-card="next" style={{ padding: '8px 20px', marginTop: 12 }}>
        {mine.length === 0 ? (
          // Every open step is with someone else: one quiet pointer, never an apology.
          <p className="pj-faint" style={{ fontSize: 14, margin: '12px 0' }}>Every step is with someone else. <button type="button" className="w2a-tilelink" style={{ marginLeft: 6 }} onClick={() => ctx.goSection('waiting')}>Waiting on others <Icon name="forward" size={12} /></button></p>
        ) : (
          <>
            {shown.map((a) => (a.ref.kind === 'next' ? <StepRow key={a.id} ctx={ctx} index={a.ref.index} what={p.next[a.ref.index].what} who={p.next[a.ref.index].who} when={p.next[a.ref.index].when} done={false} people={people} /> : <ElsewhereRow key={a.id} ctx={ctx} action={a} />))}
            {!tabbed && mine.length > NEXT3 && (
              <button type="button" className="pj-showall" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                {all ? 'Show less' : `All ${mine.length} of yours`}
              </button>
            )}
          </>
        )}
        {done.length > 0 && (
          <details className="tkdone">
            <summary>Done <span className="n">{done.length}</span></summary>
            {doneShown.map((n) => (
              <StepRow key={n.i} ctx={ctx} index={n.i} what={n.what} who={n.who} when={n.when} done people={people} />
            ))}
            {done.length > FOLD_N && <ShowAll total={done.length} expanded={allDone} onToggle={() => setAllDone((v) => !v)} />}
          </details>
        )}
      </div>
    </Section>
  );
}

// ── Waiting ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function WaitingSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  const groups = ctx.hub.waiting;
  if (!groups.length) return null;
  return (
    <Section
      id="waiting"
      title="Waiting on others"
      // Every tab carries its own Add (t255's rule; t266 break job: this tab was the one without — a full
      // Waiting tab offered no way to add a step for someone else). The empty tab's same starter.
      action={canEdit ? <button className="btn pri" onClick={(e) => startSection('waiting', ctx, edit, e.currentTarget)}><Icon name="plus" size={14} /> Add a step for someone else</button> : undefined}
    >
      {groups.map((g) => <WaitingPerson key={g.person} ctx={ctx} group={g} />)}
    </Section>
  );
}

// ── Open questions ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The project's open questions (step 1's Questions, asked in its meetings; step 2 lists them here and on Today):
 *  what was asked, who asked and who owns the answer, and the meeting it waits in. Answered where it shows. */
export function QuestionsSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit } = useEditor();
  const tabbed = useTabbed();
  const [all, setAll] = useState(false);
  useExpandAll(ctx.path, setAll);
  const list = ctx.questions;
  if (!list.length) return null;
  const shown = tabbed || all ? list : list.slice(0, FOLD_N);
  const answer = async (q: ProjectQuestion) => {
    const said = await prompt('Answer it', { message: q.what, placeholder: 'The answer, in plain words', ok: 'Answer' });
    if (!said?.trim()) return;
    await workDid(workCall<string>('meetings', 'answer-question', q.path, q.line, q.raw, said.trim()));
  };
  return (
    <Section id="questions" title="Open questions">
      <div className="card" data-item-card="questions" style={{ padding: '8px 20px' }}>
        {shown.map((q) => (
          <div className="trow compact" key={`${q.path}:${q.line}`}>
            <span className="t clip-2" title={plain(q.what)}>{plain(q.what)}</span>
            <span className="meta" style={{ marginLeft: 'auto' }}>
              {[q.askedBy ? `asked by ${q.askedBy}` : '', q.owner ? `for ${q.owner}` : '', `in ${q.meeting}`].filter(Boolean).join(' · ')}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              {canEdit && <button className="btn quiet" style={{ height: 28 }} onClick={() => void answer(q)}>Answer it</button>}
              <button className="btn quiet" style={{ height: 28 }} onClick={() => A.openPath(q.path)} title={`Open ${q.meeting}`}>Open meeting</button>
            </span>
          </div>
        ))}
        {!tabbed && list.length > FOLD_N && <ShowAll total={list.length} expanded={all} onToggle={() => setAll((v) => !v)} />}
      </div>
    </Section>
  );
}

/** One person's waiting items: their head (who, how many, how many late — the items name themselves once in
 *  the rows, never twice in the head; t141, 9 Nov 2026) and every item editable where it shows. */
function WaitingPerson({ ctx, group: g }: { ctx: TabsCtx; group: HubWaiting }) {
  const tabbed = useTabbed();
  const [open, setOpen] = useState(false);
  useExpandAll(ctx.path, setOpen);
  const shown = tabbed || open ? g.items : g.items.slice(0, FOLD_N);
  const late = g.items.filter((a) => !a.done && a.due !== undefined && a.due < ctx.today).length;
  return (
    <div className="card tklist" style={{ padding: '8px 20px', marginTop: 12 }}>
      <div className="trow compact" data-find-skip>
        <Avatar name={g.person} />
        {/* The head opens the top waiting item in the peek (p17-connected, 4 Nov 2026): the same
            go the Waiting rows use. Chase still only drafts a message. */}
        <button className="t clip-2" style={{ border: 0, background: 'none', fontFamily: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }} onClick={g.items[0] ? ctx.go(g.items[0].ref, g.items[0].what) : undefined} title={`${g.person} · opens ${plain(g.items[0]?.what ?? '')}`}>
          {g.person} · {g.items.length} open{late > 0 ? ` · ${late} late` : ''}
        </button>
        <button className="btn quiet" style={{ marginLeft: 'auto', height: 28 }} title={`Draft a message to ${g.person} (nothing is sent)`} onClick={() => chase(ctx, g.person, g.items)}>
          Chase
        </button>
      </div>
      {shown.map((a) => (
        <WaitingRow key={a.id} ctx={ctx} action={a} />
      ))}
      {!tabbed && g.items.length > FOLD_N && <ShowAll total={g.items.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
    </div>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One action written in a meeting: ticked, renamed, handed over and re-dated where it shows, through the line it
 *  came from (the Waiting row's cells, with a tick that ticks — the Overview's tiles showed them, the rows never
 *  did). Its words open it. */
function MeetingActionRow({ ctx, action: a }: { ctx: TabsCtx; action: HubAction }) {
  const { canEdit, edit } = useEditor();
  const saveAction = useActionEdits(ctx);
  const people = usePeople();
  const words = a.due !== undefined ? dateWords(a.due, ctx.today) : a.since !== undefined ? `${plural(ctx.today - a.since, 'day')} waiting` : null;
  // Done reads quiet, whatever its day was (the step rows' rule: a ticked action is never late).
  const tone = a.done ? (words ? ('quiet' as const) : null) : a.due !== undefined ? whenTone(a.due - ctx.today) : words ? ('quiet' as const) : null;
  const editable = a.ref.kind === 'record' && a.task !== undefined && a.ref.line !== undefined;
  return (
    <div className="trow tkrow" key={a.id} data-action={a.id} role="button" tabIndex={0} aria-label={plain(a.what)} title={`${plain(a.what)} (open it)`} onClick={openUnlessEditing(ctx.go(a.ref, a.what))} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); ctx.go(a.ref, a.what)(); } }}>
      <button className={`check${a.done ? ' done' : ''}`} role="checkbox" aria-checked={a.done} aria-label={`Tick “${plain(a.what)}”`} disabled={!canEdit || !editable} onClick={(e) => (e.stopPropagation(), tickAction(ctx, edit, a))}>
        {a.done ? <Icon name="check" size={12} /> : null}
      </button>
      <span className={`tkrow-title${a.done ? ' is-done' : ''}`}>
        <span className="clip-2" title={plain(a.what)}>
          {editable ? (
            <Inline value={a.what} required label="Action" onSave={(v) => saveAction(a, { what: v })}>
              {plain(a.what)}
            </Inline>
          ) : (
            plain(a.what)
          )}
        </span>
      </span>
      <span className="tkrow-who">
        {editable ? (
          <Inline value={a.who || a.person} quiet placeholder="+ Who" label="Who does it" suggest={people} compact onSave={(v) => saveAction(a, { who: v })}>
            <WhoInner name={visibleWho(a.person || a.who, ctx.hub.me) || undefined} />
          </Inline>
        ) : (
          <WhoCell name={visibleWho(a.person, ctx.hub.me) || undefined} />
        )}
      </span>
      <span className="tkrow-when">
        {editable ? (
          <InlineDate value={actionWhen(a)} iso={a.ref.kind === 'record'} quiet placeholder={words ?? '+ By when'} label="By when" onSave={(v) => saveAction(a, { when: v })}>
            <WhenInner words={words} tone={tone} title={a.due !== undefined ? longDay(a.due) : words ?? undefined} />
          </InlineDate>
        ) : (
          <WhenCell words={words} tone={tone} title={a.due !== undefined ? longDay(a.due) : words ?? undefined} />
        )}
      </span>
    </div>
  );
}

/** One of the project's meetings, newest first, with the actions written in it (t141, 9 Nov 2026): its day, its
 *  title (opens it), how many actions are open and done, and each action where it shows. */
function MeetingRow({ ctx, meeting: m }: { ctx: TabsCtx; meeting: FolioMeeting }) {
  // Its own actions whole, unfolded (t248, 12 Nov 2026, structure N3: the hub's fold dropped near-duplicates
  // Tasks keeps, so the card read "nothing open" while the meeting listed its task open). One source of truth
  // for what is open: the meeting's own reading, ticked the same way everywhere.
  const actions = useMemo(() => connectedActionsOf([], ctx.connected.filter((c) => c.path === m.path), ctx.me ?? '', ctx.today, false), [ctx.connected, ctx.me, ctx.today, m.path]);
  const tabbed = useTabbed();
  const [all, setAll] = useState(false);
  useExpandAll(ctx.path, setAll);
  const openCount = actions.filter((a) => !a.done).length;
  const doneCount = actions.length - openCount;
  const shownActions = tabbed || all ? actions : actions.slice(0, FOLD_N);
  const isToday = m.day === ctx.today;
  // The day already reads beside it: a date leading the title would say it twice.
  const displayTitle = m.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, '') || m.title;
  return (
    <div data-meeting={m.path}>
      <div className="trow compact" data-find-skip>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 'none' }}>{isToday ? 'Today' : shortDay(m.day, ctx.today)}</span>
        <button className="t" style={{ border: 0, background: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0, display: 'block', maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'break-word' }} onClick={(e) => A.openPath(m.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} onAuxClick={(e) => e.button === 1 && A.openPath(m.path, { where: 'tab' })} title={m.title}>
          {displayTitle}
        </button>
        <span className="meta" style={{ marginLeft: 'auto', flex: 'none' }}>{openCount > 0 ? `${openCount} open` : 'nothing open'}{doneCount > 0 ? ` · ${doneCount} done` : ''}</span>
      </div>
      {shownActions.map((a) => (
        <MeetingActionRow key={a.id} ctx={ctx} action={a} />
      ))}
      {!tabbed && actions.length > FOLD_N && <ShowAll total={actions.length} expanded={all} onToggle={() => setAll((v) => !v)} />}
    </div>
  );
}

export function NotesSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  const tabbed = useTabbed();
  const byPath = useApp((s) => s.byPath);
  const revision = useApp((s) => s.revision);
  const [kind, setKind] = useState<NoteKindFilter | 'files'>('all');
  const [open, setOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [seeOpen, setSeeOpen] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  useExpandAll(ctx.path, setOpen, setMeetingsOpen, setSeeOpen);
  const p = ctx.view.project;
  const files = ctx.files;
  const where = projectWhere(p);
  const isRemote = where?.kind === 'remote';
  const rows = useMemo(() => folioNoteRows(ctx.view.notes, byPath), [ctx.view, byPath]);
  // Its meetings, newest first (t141, 9 Nov 2026): in order, with their actions — never mixed through the notes.
  const meetings = useMemo(() => folioMeetingRows(ctx.view.notes, byPath), [ctx.view, byPath]);
  const meetingsShown = tabbed || meetingsOpen ? meetings : meetings.slice(0, FOLD_N);
  // Notes elsewhere that link here without belonging to it (5 Nov 2026, v9-vault-truth): shown below the project's
  // own, every one of them, never counted and never filtered.
  const seeAlso = useMemo(() => folioSeeAlso(ctx.view, byPath), [ctx.view, byPath]);
  const seeShown = tabbed || seeOpen ? seeAlso : seeAlso.slice(0, FOLD_N);
  // Notes, documents and files in ONE list (t239, their decision 4): the member notes plus the folder's files and
  // the Documents entries, latest versions only (a superseded version reads on its latest's page, never here),
  // newest first. A Documents entry naming a note already listed reads once, as the note. Vault-kept files resolve
  // by the vault's file list, so their rows open in the vault's viewer.
  const vaultFiles = useApp((s) => s.files);
  const fileRows = useMemo(() => folioFileRows(p, files, byPath, vaultFiles.map((f) => f.rel)), [p, files, byPath, vaultFiles]);
  const listed = useMemo(() => new Set([...rows.map((r) => r.path), ...meetings.map((m) => m.path), ...seeAlso.map((r) => r.path)]), [rows, meetings, seeAlso]);
  const merged = useMemo(() => {
    // Chain nodes: every note plus every file row (a version without facts still chains); a note's own front
    // matter wins over a Documents entry naming it.
    const fileNodes = new Map<string, { path: string; title: string; facts: DocFacts }>();
    for (const f of fileRows) fileNodes.set(f.notePath ?? f.rel, { path: f.notePath ?? f.rel, title: f.name, facts: f.facts });
    for (const n of noteChainNodes()) fileNodes.set(n.path, n);
    const all = [...fileNodes.values()];
    const list: { key: string; title: string; modified: number; kind: NoteKindFilter | 'files'; note: string | null; rel: string; ext: string; sub: string; file: string; signer: string; size: string; status: DocFacts['status']; count: string; missing: boolean }[] = [];
    for (const r of rows) {
      const chain = docChain(all, r.path);
      if (!chain.latest) continue;
      list.push({ key: `note:${r.path}`, title: r.title, modified: r.modified, kind: r.kind, note: r.path, rel: '', ext: '', sub: `${r.kind === 'docs' ? 'Doc · ' : r.kind === 'daily' ? 'Daily · ' : ''}${r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : ''}`, file: '', signer: '', size: '', status: chain.facts.status, count: docCountWords(chain.all.length), missing: false });
    }
    for (const f of fileRows) {
      if (f.notePath && listed.has(f.notePath)) continue;
      const chain = docChain(all, f.notePath ?? f.rel);
      if (!chain.latest) continue;
      // The row names its file and its signer (t248, 12 Nov 2026, structure F02/F08): the file's own name
      // beside the description, and "Signed by June Park, 3 Nov" when it is signed.
      const at = f.notePath ?? f.rel;
      const base = at.includes('/') ? at.slice(at.lastIndexOf('/') + 1) : at;
      const file = f.notePath && f.ext === 'md' ? '' : base !== f.name ? base : '';
      const signer = chain.facts.status === 'signed' && chain.facts.signer ? `Signed by ${chain.facts.signer}${chain.facts.signedOn ? `, ${signerDay(chain.facts.signedOn)}` : ''}` : '';
      const sub = f.notePath && f.ext === 'md' ? `Note · ${f.notePath.includes('/') ? f.notePath.slice(0, f.notePath.lastIndexOf('/')) : ''}` : f.notePath ? `${kindWords(f.ext)} · kept in the vault` : f.missing ? 'Not in the folder' : `${kindWords(f.ext)}${f.rel.includes('/') ? ` · in ${f.rel.slice(0, f.rel.lastIndexOf('/'))}` : ''}`;
      list.push({ key: `file:${f.notePath ?? f.rel}`, title: f.name, modified: f.modified, kind: 'files', note: f.notePath, rel: f.rel, ext: f.ext, sub, file, signer, size: f.size ? sizeWords(f.size) : '', status: chain.facts.status, count: docCountWords(chain.all.length), missing: f.missing });
    }
    return list.sort((a, b) => b.modified - a.modified);
  }, [rows, fileRows, listed, byPath, p, files, revision]); // eslint-disable-line react-hooks/exhaustive-deps -- the cached chain nodes turn with the revision
  const kept = merged.filter((r) => kind === 'all' || r.kind === kind);
  const shown = tabbed || open ? kept : kept.slice(0, FOLD_N);
  const weekAgo = Date.now() - 7 * 86400000;
  const fresh = shown.filter((r) => r.modified >= weekAgo);
  const earlier = shown.filter((r) => r.modified < weekAgo);
  const kinds: { id: NoteKindFilter | 'files'; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: merged.length },
    { id: 'site', label: 'Notes', n: merged.filter((r) => r.kind === 'site').length },
    { id: 'docs', label: 'Docs', n: merged.filter((r) => r.kind === 'docs').length },
    { id: 'daily', label: 'Daily', n: merged.filter((r) => r.kind === 'daily').length },
    { id: 'files', label: 'Files', n: merged.filter((r) => r.kind === 'files').length },
  ];
  /** A file row's menu: open it, pin it to the project's Documents, show or copy it. */
  const fileMenu = (e: React.MouseEvent, rel: string) => {
    e.preventDefault();
    const isPinned = p.documents.some((d) => d.path.toLowerCase() === rel.toLowerCase());
    openMenu(e, [
      { label: 'Open', icon: 'eye' as const, run: () => A.openFolderFile(ctx.path, rel) },
      ...(isRemote ? [] : [{ label: 'Show in folder', icon: 'reveal' as const, run: () => void window.nv.projects.showFile(ctx.path, rel).catch(showError) }]),
      ...(canEdit ? [{ separator: true } as const, { label: isPinned ? 'Unpin' : 'Pin to the top', icon: 'pin' as const, run: () => void edit({ kind: 'pin', path: rel, pinned: !isPinned }) }] : []),
      { separator: true } as const,
      { label: 'Copy its path', icon: 'copy' as const, run: () => void navigator.clipboard.writeText(rel).then(() => toast('Copied.')) },
    ]);
  };
  /** One row of the list: a note or a file, opening itself; the file's name, the signer, the status chip
   *  and the version count read on it. Titles wrap whole, never cut. */
  const row = (r: { key: string; title: string; modified: number; kind: NoteKindFilter | 'files'; note: string | null; rel: string; ext: string; sub: string; file: string; signer: string; size: string; status: DocFacts['status']; count: string; missing?: boolean }) => {
    // A gone vault PDF opens in the vault's viewer, which says plainly it isn't in the notes, with Back
    // (t250, 12 Nov 2026: it opened the folder view saying the project has no folder). Certain when the
    // project has no folder on this PC; otherwise when its folder still holds vault files beside it.
    const dirOf = (x: string) => (x.includes('/') ? x.slice(0, x.lastIndexOf('/')).toLowerCase() : '');
    // Only a row that is really missing (13 Nov 2026, the picture: an existing PDF in the project's folder said
    // "That file isn't in your notes any more", because its folder path was compared with the vault's paths).
    const vaultGonePdf = !!r.missing && !r.note && r.ext === 'pdf' && (!files?.exists || vaultFiles.some((f) => dirOf(f.rel) === dirOf(r.rel)));
    const openIt = (newTab: boolean) => (r.note || vaultGonePdf ? A.openPath(r.note ?? r.rel, { where: newTab ? 'tab' : 'current' }) : A.openFolderFile(ctx.path, r.rel, newTab ? 'tab' : 'current'));
    const words = [r.sub, r.file].filter(Boolean).join(' · ');
    return (
      <div className="trow compact" key={r.key} onContextMenu={r.kind === 'files' && !r.note ? (e) => fileMenu(e, r.rel) : undefined}>
        {r.kind === 'files' && (r.ext !== 'md' || !r.note) ? (
          <KindTile ext={r.ext} />
        ) : (
          <span className={`gtile xs ${r.kind === 'docs' ? 'blue' : r.kind === 'daily' ? 'green' : 'slate'}`} aria-hidden="true"><Icon name={r.kind === 'docs' ? 'doc' : r.kind === 'daily' ? 'calendar' : 'notes'} size={14} /></span>
        )}
        <div style={{ minWidth: 0 }}>
          <button className="t" style={{ border: 0, background: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0, display: 'block', maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'break-word' }} onClick={(e) => openIt(e.ctrlKey || e.metaKey)} onAuxClick={(e) => e.button === 1 && openIt(true)} title={r.title}>
            {r.title}
          </button>
          <div className="meta">
            {words}
            {r.status ? (
              <>
                {words ? ' · ' : ''}<span className="tag slate">{STATUS_WORDS[r.status]}</span>
              </>
            ) : null}
            {r.signer ? ` · ${r.signer}` : ''}
            {r.count ? ` · ${r.count}` : ''}
            {r.size ? ` · ${r.size}` : ''}
          </div>
        </div>
        <span className="meta" style={{ marginLeft: 'auto' }}>{r.modified ? whenAgo(r.modified) : ''}</span>
      </div>
    );
  };
  const seeRow = (r: NoteRow) => row({ key: `see:${r.path}`, title: r.title, modified: r.modified, kind: r.kind, note: r.path, rel: '', ext: '', sub: `${r.kind === 'docs' ? 'Doc · ' : r.kind === 'daily' ? 'Daily · ' : ''}${r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : ''}`, file: '', signer: '', size: '', status: null, count: '' });
  const extras = p.extra.map((x, i) => ({ ...x, i })).filter((x) => (x.body.trim() || canEdit) && x.heading.trim().toLowerCase() !== 'stage checklist');
  const notesEmpty = !meetings.length && !rows.length && !seeAlso.length && !p.notes.trim() && !p.extra.some((x) => x.heading.trim().toLowerCase() !== 'stage checklist');
  // The files' part is empty when nothing lists and nothing is asked or wrong (reading, a remote problem and a moved
  // folder show, as the old Files section did).
  const filesEmpty = fileRows.length === 0 && files !== undefined && !files?.problem && (!!files?.exists || !where);
  const picker = useRef<HTMLInputElement>(null);
  const attach = (picked: FileList | File[]) => void attachProjectFiles(ctx.path, picked, () => ctx.refreshFiles());
  if (notesEmpty && filesEmpty) return null;
  return (
    <Section
      id="notes"
      title="Notes and files"
      action={canEdit ? (
        <>
          <button className="btn pri" onClick={(e) => ctx.noteMenu(e.currentTarget)}><Icon name="plus" size={14} /> Add note</button>
          {canAttachHere(ctx) && (
            <>
              <button className="btn" title="Attach files from this PC (copied into the project's folder)" onClick={() => picker.current?.click()}><Icon name="plus" size={14} /> Attach</button>
              <input ref={picker} type="file" multiple hidden onChange={(e) => (e.target.files && void attach(e.target.files), (e.target.value = ''))} />
            </>
          )}
          {needsFolderChoice(ctx) && (
            <button className="btn" title="Link a folder on this PC to this project" onClick={() => chooseProjectFolder(ctx)}><Icon name="folderOpen" size={14} /> Choose its folder on this PC…</button>
          )}
        </>
      ) : undefined}
    >
      {meetings.length > 0 && (
        <>
          <div className="glabel" style={{ margin: '4px 0 8px' }}>Meetings · {meetings.length}</div>
          <div className="card" style={{ padding: '8px 20px' }}>
            {meetingsShown.map((m) => (
              <MeetingRow key={m.path} ctx={ctx} meeting={m} />
            ))}
            {!tabbed && meetings.length > FOLD_N && <ShowAll total={meetings.length} expanded={meetingsOpen} onToggle={() => setMeetingsOpen((v) => !v)} />}
          </div>
        </>
      )}
      {files?.problem && <RemoteCallout problem={files.problem} busy={false} onRetry={() => ctx.refreshFiles()} path={ctx.path} />}
      {files && !files.exists && where && (
        // The folder moved or is not on this PC: named, never empty quotes (p14, 4 Nov 2026).
        <EmptyState size="panel" icon="folder" title="No folder here" line={`The folder “${where.kind === 'local' ? where.folder : `${where.folderName} on ${where.computerName}`}” isn’t on this PC (it may have moved).`} />
      )}
      <div className="chips" style={meetings.length > 0 ? { marginTop: 16 } : undefined}>
        {kinds.map((k) => (
          <button key={k.id} className={`chip${kind === k.id ? ' on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            {k.label}{showCount(k.n) ? <> <span className="n">{k.n}</span></> : null}
          </button>
        ))}
      </div>
      <div className="card" data-item-card="files" style={{ padding: '8px 20px', marginTop: 12 }}>
        {kept.length === 0 ? (
          <p className="pj-faint" style={{ fontSize: 14, margin: '12px 0' }}>{files === undefined ? 'Reading the folder…' : 'Nothing here yet.'}</p>
        ) : (
          <>
            {fresh.length > 0 && <div className="glabel" style={{ paddingTop: 8 }}>This week</div>}
            {fresh.map(row)}
            {earlier.length > 0 && <div className="glabel" style={{ paddingTop: 10 }}>Earlier</div>}
            {earlier.map(row)}
            {!tabbed && kept.length > FOLD_N && <ShowAll total={kept.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
          </>
        )}
      </div>
      {canEdit && canAttachHere(ctx) && (
        <div
          className={`card w2a-drop${dropOver ? ' is-over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setDropOver(true))}
          onDragLeave={() => setDropOver(false)}
          onDrop={(e) => (e.preventDefault(), setDropOver(false), void attach(e.dataTransfer.files))}
        >
          Drop files or photos here to attach them to this project
        </div>
      )}
      {seeAlso.length > 0 && (
        <>
          <div className="glabel" style={{ margin: '18px 0 8px' }}>See also</div>
          <div className="card" style={{ padding: '8px 20px' }}>
            {seeShown.map(seeRow)}
            {!tabbed && seeAlso.length > FOLD_N && <ShowAll total={seeAlso.length} expanded={seeOpen} onToggle={() => setSeeOpen((v) => !v)} />}
          </div>

        </>
      )}
      {(p.notes.trim() || canEdit) && (
        <div className="card" style={{ padding: '14px 18px', marginTop: 16 }}>
          <div className="w2a-tilehead"><h3>Your notes</h3></div>
          <Inline value={p.notes} multiline label="Your notes" placeholder="Your own notes on this project: they’re kept word for word…" onSave={(v) => edit({ kind: 'set', field: 'notes', value: v })}>
            <div className="markdown" style={{ fontSize: 14 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(p.notes, { from: ctx.path }) }} />
          </Inline>
        </div>
      )}
      {extras.length > 0 && (
        <details className="pj-other-notes" style={{ marginTop: 16 }}>
          <summary>Other notes</summary>
          {extras.map((x) => (
            <div className="card" key={`${x.i}:${x.heading}`} style={{ padding: '14px 18px', marginTop: 12 }}>
              <div className="w2a-tilehead"><h3>{x.heading}</h3></div>
              <Inline value={x.body} multiline label={x.heading} placeholder="Nothing written here yet…" onSave={(body) => edit({ kind: 'extra', index: x.i, body })}>
                <div className="markdown" style={{ fontSize: 14 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(x.body, { from: ctx.path }) }} />
              </Inline>
            </div>
          ))}
        </details>
      )}
    </Section>
  );
}

// The merged section above shows a remote problem where the old Files section did.

function RemoteCallout({ problem, busy, onRetry, path }: { problem: RemoteProblem; busy: boolean; onRetry(): void; path: string }) {
  void path;
  const hint = problem.kind === 'standalone' ? 'Open the project’s folder on that computer to see its files.' : problem.hint;
  return (
    <div className="callout amber" role="status">
      <span aria-hidden="true"><Icon name="computer" size={16} /></span>
      <span><b>{problem.words}</b>{hint ? ` ${hint}` : ''}</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {problem.kind !== 'standalone' && <button className="btn" onClick={onRetry} disabled={busy}>{busy ? 'Trying…' : 'Try again'}</button>}
      </span>
    </div>
  );
}

// ── People ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Someone's role changed where the People tab shows it (p17-editable, Nov 2026, kept in the merge): in their
 *  note when they have one (the peek's rule: someone with their own page changes there, never the project's list),
 *  else their role in this project's list. */
async function savePersonRole(ctx: TabsCtx, edit: ReturnType<typeof useEditor>['edit'], name: string, card: PersonCard | null | undefined, v: string): Promise<boolean> {
  if (card?.path) return saveNoteFact(card.path, { type: card.type, page: true }, 'role', v, v.trim() ? 'Changed the role.' : 'Took the role off.');
  const record = { type: 'person' as const, title: name, path: ctx.path, page: false as const };
  const change = recordFactEdit(ctx.view.project, record, 'role', v, ctx.path);
  if (!change || recordFactText(ctx.view.project, record, 'role', ctx.path) === null) {
    toast('That is not changeable here any more.');
    return false;
  }
  return edit(change);
}

/** The line under a People name (merged p17-editable + p17-connected, Nov 2026): their role and organisation change
 *  where they are true, then what they owe and what is late, in the tab's own words. While their card loads the
 *  role reads plainly: the control appears with the route it saves. */
function personBits(ctx: TabsCtx, canEdit: boolean, edit: ReturnType<typeof useEditor>['edit'], x: HubModel['people'][number], card: PersonCard | null | undefined): ReactNode[] {
  // The role reads as the person's own, once (13 Nov 2026, the picture: one row repeated its own name, another
  // held other people's lines): the hub already reads the project's list that way, and a role from their own page
  // reads through the same rule. The edit box opens on the words as written — the file keeps the person's words
  // until they change them.
  const raw = card?.path ? (card.role ?? '') : (x.roleRaw ?? x.role);
  const role = card?.path ? ownRole(raw, x.name, ctx.hub.people.map((p) => p.name)) : x.role;
  const company = card?.path ? (card.orgName ?? '') : x.company;
  const roleInList = card !== undefined && !card?.path && recordFactText(ctx.view.project, { type: 'person', title: x.name, path: ctx.path, page: false }, 'role', ctx.path) !== null;
  const bits: ReactNode[] = [];
  if (canEdit && card !== undefined && (card?.path || roleInList)) bits.push(<Inline key="role" value={raw} label="role" placeholder="+ Role" quiet={!role} compact onSave={(v) => savePersonRole(ctx, edit, x.name, card, v)}>{role || undefined}</Inline>);
  else if (role) bits.push(role);
  if (company && canEdit && card?.path) bits.push(<Inline key="org" value={company} label="organisation" compact onSave={(v) => saveNoteFact(card.path!, { type: card.type, page: true }, 'org', v, v.trim() ? 'Changed the organisation.' : 'Took the organisation off.')} />);
  else if (company) bits.push(company);
  bits.push(x.open > 0 ? `${x.open} open task${x.open === 1 ? '' : 's'}` : 'nothing open');
  if (x.overdue > 0) bits.push(`${x.overdue} late`);
  return bits;
}

export function PeopleSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  const tabbed = useTabbed();
  const hub = ctx.hub;
  const people = [...hub.people].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const [open, setOpen] = useState(false);
  useExpandAll(ctx.path, setOpen);
  const shown = tabbed || open ? people : people.slice(0, FOLD_N);
  const addPerson = () => void startPerson(edit);
  // Their own pages, so a role and organisation change where they are true (p17-editable): in their note when they
  // have one, else their role in this project's list. personBits above renders that line.
  const [cards, setCards] = useState<Record<string, PersonCard | null>>({});
  // Keyed on the names, not their count order (t102, 9 Nov 2026): the open counts arrive in stages, and each
  // reorder read every card again. The fetch below keeps its own display order.
  const names = [...people.map((x) => x.name)].sort().join('\n');
  useEffect(() => {
    let live = true;
    void (async () => {
      // Together, not one by one (t102, 9 Nov 2026): fifteen cards read in a row kept the project waiting.
      const list = names.split('\n').filter(Boolean);
      const got = await Promise.all(list.map((name) => window.nv.life.people.card(name).then((c) => [name, c] as const, () => [name, null] as const)));
      if (live) setCards(Object.fromEntries(got));
    })();
    return () => {
      live = false;
    };
  }, [names]);
  if (!people.length) return null;
  return (
    <Section
      id="people"
      title="People"
      action={canEdit ? <button className="btn pri" onClick={() => void addPerson()}><Icon name="plus" size={14} /> Add person</button> : undefined}
    >
      <div className="card" data-item-card="people" style={{ padding: '8px 20px' }}>
        {shown.map((x) => (
          <div className="trow compact" key={x.name} data-person={x.name} data-item={`person:${x.name}`}>
            <Avatar name={x.name} big />
            <div style={{ minWidth: 0 }}>
              {/* The name opens the card it names (p17-connected): the same go as Open card, so a person opens
                  from their name on every tab. Their role below still changes where it shows. */}
              <button type="button" className="t" style={{ border: 0, background: 'none', fontFamily: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }} onClick={ctx.go({ kind: 'person', name: x.name }, x.name)} title={`Open ${x.name}'s card`}>
                {x.name}
                {ctx.view.project.owner?.trim().toLowerCase() === x.name.trim().toLowerCase() && <span className="tag slate" style={{ marginLeft: 8 }}>owner</span>}
              </button>
              <div className="meta">
                {personBits(ctx, canEdit, edit, x, cards[x.name]).map((b, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {b}
                  </span>
                ))}
              </div>
            </div>
            <button className="btn quiet" style={{ marginLeft: 'auto', flex: 'none' }} onClick={ctx.go({ kind: 'person', name: x.name }, x.name)}>Open card <Icon name="forward" size={12} /></button>
          </div>
        ))}
        {!tabbed && people.length > FOLD_N && <ShowAll total={people.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
      </div>

    </Section>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A project's Money section (10.0 papercuts): the bills that belong to it, still due first, each marked paid where
 *  it sits; a new bill made here belongs to it. */
export function MoneySection({ ctx }: { ctx: TabsCtx }) {
  const canEdit = useApp((s) => s.canEdit);
  const tabbed = useTabbed();
  const { on, data: f } = ctx.money;
  const p = ctx.view.project;
  const mine = useMemo(() => (f ? billsForProject(f.bills, ctx.path) : []), [f, ctx.path]);
  const { due, rest, monthly, overdue } = useMemo(() => projectMoneySummary(mine), [mine]);
  const [openDue, setOpenDue] = useState(false);
  const [openRest, setOpenRest] = useState(false);
  useExpandAll(ctx.path, setOpenDue, setOpenRest);
  const dueShown = tabbed || openDue ? due : due.slice(0, FOLD_N);
  const restShown = tabbed || openRest ? rest : rest.slice(0, FOLD_N);
  // Bills off holds nothing either: quiet, with the tab switching on and starting one.
  if (!on || (f && !mine.length)) return null;
  if (!f)
    return (
      <Section id="money" title="Money">
        <PageLoading label="Reading the bills…">Reading the bills…</PageLoading>
      </Section>
    );
  const cur = f.currency;
  const head = `${due.length} still due${overdue ? `, ${overdue} late` : ''} · ${moneyWords(monthly, cur)} a month`;
  return (
    <Section
      id="money"
      title="Money"
      action={canEdit ? <button type="button" className="btn pri" onClick={() => addBill(f, { project: p.name })}><Icon name="plus" size={14} /> New bill</button> : undefined}
    >
      <div className="card" data-item-card="money" style={{ padding: '8px 20px' }}>
        <div className="trow" data-find-skip style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="meta">{head}</span>
        </div>
        {dueShown.map((b) => (
          <BillRow key={b.path} b={b} currency={cur} today={f.today} tile accounts={f.accounts.map((a) => a.name)} />
        ))}
        {!tabbed && due.length > FOLD_N && <ShowAll total={due.length} expanded={openDue} onToggle={() => setOpenDue((v) => !v)} />}
        {rest.length > 0 && <div className="glabel" style={{ marginTop: 8 }}>Paid and paused</div>}
        {restShown.map((b) => (
          <BillRow key={b.path} b={b} currency={cur} today={f.today} tile accounts={f.accounts.map((a) => a.name)} />
        ))}
        {!tabbed && rest.length > FOLD_N && <ShowAll total={rest.length} expanded={openRest} onToggle={() => setOpenRest((v) => !v)} />}
      </div>
      {/* p14, 4 Nov 2026 at 3456 wide: the first sentence restated the tab ("Bills… that belong to X"); the brief: no help that
explains the obvious. The sync note stays: it is the non-obvious part. In the page's own faint voice, never the explainer
class t242 bans. */}
      <p className="pj-faint" style={{ marginTop: 10 }}>Marking one paid here marks it paid everywhere.</p>
    </Section>
  );
}

// ── Decisions ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function DecisionsSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  const tabbed = useTabbed();
  const line = useLine('decisions');
  const p = ctx.view.project;
  const logDecision = () => void startDecision(edit);
  const list = p.decisions.map((d, i) => ({ ...d, i })).reverse();
  const [open, setOpen] = useState(false);
  const [flowedOpen, setFlowedOpen] = useState(false);
  useExpandAll(ctx.path, setOpen, setFlowedOpen);
  const shown = tabbed || open ? list : list.slice(0, FOLD_N);
  // Actions filed from the project's notes and meetings that show nowhere else in the plan (open ones already
  // read under What's next or Waiting): newest first.
  const flowed = decisionsFlowed(ctx.hub);
  const openFlowed = (a: HubAction) => {
    if (a.ref.kind === 'record' && a.task !== undefined && a.ref.line !== undefined) {
      const done = !a.done;
      const atPath = a.ref.path;
      const atLine = a.ref.line;
      return void window.nv.tasks
        .tick(atPath, atLine, a.task, done)
        .then((r) => toast(r.words, { label: 'Undo', run: () => void window.nv.tasks.tick(atPath, atLine, stripBox(r.line), !done).catch(showError) }), showError);
    }
    if (a.ref.kind === 'record') return A.openAtLine(a.ref.path, a.ref.line ?? 0);
  };
  const flowedShown = tabbed || flowedOpen ? flowed : flowed.slice(0, FOLD_N);
  if (!list.length && !flowed.length) return null;
  return (
    <Section
      id="decisions"
      title="Decisions"
      action={canEdit ? <button className="btn pri" onClick={() => void logDecision()}><Icon name="plus" size={14} /> Log decision</button> : undefined}
    >
      {list.length > 0 && (
      <div className="card" data-item-card="decisions" style={{ padding: '8px 20px' }}>
          {shown.map((d) => (
            <div className="trow compact" key={d.i} data-item={`decisions:${d.i}`}>
              <span className="check done" aria-hidden="true"><Icon name="check" size={12} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="t">
                  <Inline value={d.what} required label="Decision" onSave={(what) => line.change(d.i, { what })}>
                    <Words text={d.what} from={ctx.path} />
                  </Inline>
                </div>
                <div className="meta">
                  <Inline value={d.why ?? ''} quiet placeholder="+ Why" label="Why" onSave={(why) => line.change(d.i, { why })}>
                    {d.why ? <Words text={d.why} from={ctx.path} /> : undefined}
                  </Inline>
                  {(d.date || canEdit) && (
                    <>
                      {d.why?.trim() && d.date?.trim() ? ' · ' : null}
                      <InlineDate value={d.date} label="Date" placeholder="+ Date" quiet={!d.date} onSave={(date) => line.change(d.i, { date })}>
                        {d.date ? niceDate(d.date) : undefined}
                      </InlineDate>
                    </>
                  )}
                </div>
              </div>
              <span className="tag green" style={{ marginLeft: 'auto' }}>settled</span>
              <RowActions>
                <RowAction icon="trash" title="Remove this decision" danger onClick={() => void line.remove(d.i)} />
              </RowActions>
            </div>
          ))}
        {!tabbed && list.length > FOLD_N && <ShowAll total={list.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
      </div>
      )}
      {flowed.length > 0 && (
        <>
          <div className="glabel" style={{ margin: '18px 0 8px' }}>Actions filed from its notes and meetings</div>
          <div className="card w2a-tworows" style={{ padding: '8px 20px' }}>
            {flowedShown.map((a) => (
              <div className="trow compact" key={a.id}>
                <button className={`check${a.done ? ' done' : ''}`} aria-label={a.task !== undefined ? `Tick “${plain(a.what)}”` : `Open “${plain(a.what)}” in ${a.from}`} onClick={() => openFlowed(a)}>
                  {a.done ? <Icon name="check" size={12} /> : null}
                </button>
                {/* The words open the action they name in the peek (p17-connected, 4 Nov 2026): a record
                    ref through the same go the Waiting rows use, so a flowed action opens back to what
                    it joins. The tick still only ticks. */}
                <button className="t clip-2" style={{ border: 0, background: 'none', fontFamily: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }} onClick={ctx.go(a.ref, a.what)} title={plain(a.what)}>
                  {plain(a.what)}
                </button>
                {/* Your own name never ends your own rows (t253, 13 Nov 2026, fourth picture: rows ended in their own name):
                    through visibleWho, as the step rows read. */}
                <span className="meta" style={{ marginLeft: 'auto' }}>from {a.from}{(() => { const who = visibleWho(a.person || a.who, ctx.hub.me); return who ? ` · ${who}` : ''; })()}</span>
              </div>
            ))}
            {!tabbed && flowed.length > FOLD_N && <ShowAll total={flowed.length} expanded={flowedOpen} onToggle={() => setFlowedOpen((v) => !v)} />}
          </div>

        </>
      )}
    </Section>
  );
}

// ── Key dates ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Key dates and milestones are one list (folio F5): what is coming first, what went by folded, each row editable.
 *  Gone-by dates are marked where they sit (t12, 8 Nov 2026): the one naming, beside the top callout's count. Each
 *  date reads once: a date gone by asks its question on its own row above, never folded in Past with the rest. */
export function KeyDatesSection({ ctx }: { ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  const tabbed = useTabbed();
  const p = ctx.view.project;
  const today = ctx.today;
  const { asked, coming, past, wentBy } = useMemo(() => keyDatesModel(p, ctx.hub, today), [p, ctx.hub, today]);
  const [open, setOpen] = useState(false);
  useExpandAll(ctx.path, setOpen);
  const comingShown = tabbed || open ? coming : coming.slice(0, FOLD_N);
  const addMilestone = () => void startMilestone(edit);
  if (!asked.length && !coming.length && !past.length) return null;
  return (
    <Section
      id="key-dates"
      title="Key dates"
      action={canEdit ? <button className="btn pri" onClick={() => void addMilestone()}><Icon name="plus" size={14} /> Milestone</button> : undefined}
    >
      <div className="card" data-item-card="dates" style={{ padding: '8px 20px' }}>
        {wentBy.size > 0 && (
          <p className="pj-faint" style={{ fontSize: 14, margin: '12px 0' }}>{wentBy.size === 1 ? '1 date went by. Did it happen?' : `${wentBy.size} dates went by. Did they happen?`}</p>
        )}
        {asked.map((m) => (
          <KeyDateRow key={m.id} ctx={ctx} m={m} wentBy={wentBy.get(itemKey(m.ref))} />
        ))}
        {comingShown.map((m) => (
          <KeyDateRow key={m.id} ctx={ctx} m={m} wentBy={wentBy.get(itemKey(m.ref))} />
        ))}
        {!tabbed && coming.length > FOLD_N && <ShowAll total={coming.length} expanded={open} onToggle={() => setOpen((v) => !v)} />}
        {past.length > 0 && (
          <details className="tkdone">
            <summary>Past <span className="n">{past.length}</span></summary>
            {past.map((m) => (
              <KeyDateRow key={m.id} ctx={ctx} m={m} wentBy={wentBy.get(itemKey(m.ref))} />
            ))}
          </details>
        )}
      </div>
    </Section>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One of your next steps on the Overview: a tick that ticks, the words opening their tab and row, the day
 *  in the step rows' own words. Compact (the full step grid squeezes vertical in a narrow column); the who,
 *  when and words change in the tab, a click away. */
function OvNextRow({ ctx, action: a }: { ctx: TabsCtx; action: HubAction }) {
  const { canEdit, edit } = useEditor();
  const line = useLine('next');
  const p = ctx.view.project;
  const isNext = a.ref.kind === 'next';
  const n = isNext ? p.next[(a.ref as { index: number }).index] : undefined;
  const title = plain(n?.what ?? a.what);
  const due = n?.when ? dayIn(n.when, ctx.today)?.day : a.due;
  const state = due === undefined && n?.when?.trim() ? stateReading(n.when) : null;
  const words = due !== undefined ? dateWords(due, ctx.today) : state?.words ?? null;
  const tick = () => {
    if (isNext && n) return void line.change((a.ref as { index: number }).index, { done: true });
    return tickAction(ctx, edit, a);
  };
  return (
    <div className="trow compact">
      <button className="check" role="checkbox" aria-checked={false} aria-label={`Tick “${title}”`} disabled={!canEdit} onClick={tick} />
      <button type="button" className="t clip-2 pj-ov-open" onClick={ctx.go(a.ref, title)} title={title}>
        {title}
      </button>
      {words && (
        <span className="meta" style={{ marginLeft: 'auto' }}>
          <WhenInner words={words} tone={due !== undefined ? whenTone(due - ctx.today) : 'quiet'} title={due !== undefined ? longDay(due) : words} />
        </span>
      )}
    </div>
  );
}

/** One key date on the Overview: the day, the words opening their tab and row, a gone-by date asking its
 *  question with its one-click answers, as in the tab. */
function OvDateRow({ ctx, m, wentBy }: { ctx: TabsCtx; m: HubMilestone; wentBy?: string }) {
  const { canEdit } = useEditor();
  const index = m.ref.kind === 'date' ? (m.ref as { index: number }).index : -1;
  // A gone-by date's question drops under its words in a narrow column, never squeezing them.
  const wrap = wentBy !== undefined && canEdit && index >= 0;
  return (
    <div className="trow compact" style={wrap ? { flexWrap: 'wrap' } : undefined}>
      <span className="meta" style={{ flex: 'none' }}>{m.day === undefined ? '' : m.day === ctx.today ? 'Today' : shortDay(m.day, ctx.today)}</span>
      <button type="button" className="t clip-2 pj-ov-open" onClick={ctx.go(m.ref, m.what)} title={plain(m.what)}>
        {plain(m.what)}
      </button>
      {wentBy !== undefined && <span className="tag is-plain is-attention" title={`${wentBy}. Open it to confirm.`}>Went by</span>}
      {wrap && <WentByAsk index={index} today={ctx.today} detail={wentBy!} />}
    </div>
  );
}

/** The ten-second read (t255, 13 Nov 2026): your next 3, waiting one line per person, the next 3 key dates
 *  with a past one asking its question, the latest 3 updates and decisions, open risks by rank, the people
 *  as a compact row of names. Each block ends in "All N" for its tab (the kit arrow); the standing
 *  already reads in the fixed head above, never twice. Ticks and gone-by answers work where they show; the
 *  rest changes in its tab. */
export function OverviewSection({ ctx, shown = true }: { ctx: TabsCtx; /** Whether the Overview is the tab showing (its panel stays mounted, hidden, under the other tabs). */ shown?: boolean }) {
  const p = ctx.view.project;
  const byPath = useApp((s) => s.byPath);
  const mine = useMemo(() => ownOpen(ctx.hub), [ctx.hub]);
  const kd = useMemo(() => keyDatesModel(p, ctx.hub, ctx.today), [p, ctx.hub, ctx.today]);
  const decisions = useMemo(() => p.decisions.map((d, i) => ({ ...d, i })).reverse(), [p]);
  const updates = useMemo(() => p.updates.map((u, i) => ({ ...u, i })), [p]);
  // A roomy window (round 3) shows every block whole in window-tall panes; a smaller one keeps three rows each.
  const roomy = useRoomy();
  // Tall and wide enough (a user's 3440x1400), the panes fill the window to its foot; shorter, they stand a
  // fixed height under the blocks and the page scrolls to them.
  const fills = useRoomy('(min-width: 2300px) and (min-height: 1250px)');
  const cap = roomy ? 50 : 3;
  const latestUpdates = updates.slice(-cap).reverse();
  const risks = useMemo(() => openRisksRanked(p), [p]);
  const names = useMemo(() => [...ctx.hub.people].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)), [ctx.hub]);
  const counts = useMemo(() => tabCounts(ctx, byPath), [ctx, byPath]);
  const all = (id: FolioSection, n: number) =>
    n > 0 ? (
      <button type="button" className="pj-ov-all" onClick={() => ctx.goSection(id)}>
        All {n} <Icon name="forward" size={12} />
      </button>
    ) : null;
  const waitingCount = ctx.hub.waiting.reduce((n, g) => n + g.items.length, 0);
  return (
    <>
    <div className={`pj-ov${roomy ? ' is-roomy' : ''}`}>
      <section className="pj-ov-block" aria-label="Your next">
        <h2>Your next</h2>
        {mine.length === 0 ? (
          <p className="pj-faint">{waitingCount > 0 ? 'Every step is with someone else.' : 'Nothing of yours is open.'}</p>
        ) : (
          <>
            {mine.slice(0, cap).map((a) => (
              <OvNextRow key={a.id} ctx={ctx} action={a} />
            ))}
            {all('whats-next', counts['whats-next'])}
          </>
        )}
      </section>
      <section className="pj-ov-block" aria-label="Waiting on others">
        <h2>Waiting on others</h2>
        {ctx.hub.waiting.length === 0 ? (
          <p className="pj-faint">Nothing with others.</p>
        ) : (
          <>
            {ctx.hub.waiting.map((g) => {
              const late = g.items.filter((a) => !a.done && a.due !== undefined && a.due < ctx.today).length;
              return (
                <button type="button" key={g.person} className="trow compact pj-ov-wait" onClick={() => ctx.goSection('waiting')} title={`${g.person}: open Waiting on others`}>
                  <Avatar name={g.person} />
                  <span className="t clip">{g.person}</span>
                  <span className="meta" style={{ marginLeft: 'auto' }}>
                    {g.items.length} open{late > 0 ? ` · ${late} late` : ''}
                  </span>
                </button>
              );
            })}
            {all('waiting', counts.waiting)}
          </>
        )}
      </section>
      <section className="pj-ov-block" aria-label="Key dates">
        <h2>Key dates</h2>
        {kd.asked.length + kd.coming.length === 0 ? (
          <p className="pj-faint">No key dates.</p>
        ) : (
          <>
            {kd.asked.map((m) => (
              <OvDateRow key={m.id} ctx={ctx} m={m} wentBy={kd.wentBy.get(itemKey(m.ref))} />
            ))}
            {kd.coming.slice(0, cap).map((m) => (
              <OvDateRow key={m.id} ctx={ctx} m={m} wentBy={kd.wentBy.get(itemKey(m.ref))} />
            ))}
            {all('key-dates', counts['key-dates'])}
          </>
        )}
      </section>
      <section className="pj-ov-block" aria-label="Latest updates">
        <h2>Latest updates</h2>
        {latestUpdates.length === 0 ? (
          <p className="pj-faint">No updates yet.</p>
        ) : (
          <>
            {latestUpdates.map((u) => (
              <div className="trow compact" key={u.i}>
                <span className="meta" style={{ flex: 'none' }}>{u.date ? niceDate(u.date) : ''}</span>
                <button type="button" className="t clip-2 pj-ov-open" onClick={ctx.go({ kind: 'update', index: u.i }, u.what)} title={plain(u.what)}>
                  <Words text={u.what} from={ctx.path} />
                </button>
              </div>
            ))}
            {all('updates', counts.updates)}
          </>
        )}
      </section>
      <section className="pj-ov-block" aria-label="Latest decisions">
        <h2>Latest decisions</h2>
        {decisions.length === 0 ? (
          <p className="pj-faint">No decisions yet.</p>
        ) : (
          <>
            {decisions.slice(0, cap).map((d) => (
              <div className="trow compact" key={d.i}>
                <button type="button" className="t clip-2 pj-ov-open" onClick={ctx.go({ kind: 'decision', index: d.i }, d.what)} title={plain(d.what)}>
                  <Words text={d.what} from={ctx.path} />
                </button>
                <span className="meta" style={{ marginLeft: 'auto' }}>{d.date ? niceDate(d.date) : ''}</span>
              </div>
            ))}
            {all('decisions', counts.decisions)}
          </>
        )}
      </section>
      <section className="pj-ov-block" aria-label="Open risks">
        <h2>Open risks</h2>
        {risks.length === 0 ? (
          <p className="pj-faint">No open risks.</p>
        ) : (
          <>
            {risks.map((r) => {
              const tail = splitRiskTail(r.what);
              const level = r.level ?? tail.level ?? '';
              return (
                <div className="trow compact" key={r.i}>
                  <button type="button" className="t clip-2 pj-ov-open" onClick={ctx.go({ kind: 'risk', index: r.i }, tail.what)} title={plain(tail.what)}>
                    <Words text={tail.what} from={ctx.path} />
                  </button>
                  {level && <span className="meta" style={{ marginLeft: 'auto' }}>{level}</span>}
                </div>
              );
            })}
            {all('risks', counts.risks)}
          </>
        )}
      </section>
      <section className="pj-ov-block pj-ov-people" aria-label="People">
        <h2>People</h2>
        {names.length === 0 ? (
          <p className="pj-faint">No one named yet.</p>
        ) : (
          <>
            <div className="pj-ov-names">
              {names.map((x) => (
                <button type="button" key={x.name} className="pj-ov-name" onClick={ctx.go({ kind: 'person', name: x.name }, x.name)} title={`Open ${x.name}'s card`}>
                  <Avatar name={x.name} />
                  {x.name}
                </button>
              ))}
            </div>
            {all('people', counts.people)}
          </>
        )}
      </section>
    </div>
    {/* A roomy window (round 3, at 3440x1400: the overview ended a third of the way down): the project's notes and files,
        what is waiting on whom, and its activity fill the rest of the window as panes that scroll inside
        themselves. */}
    {/* Panes only while the Overview shows (21 Nov 2026): its panel stays mounted, hidden, under the other tabs, and
        a panes root anywhere in the page's scroller turns that scroller's own scrolling off (panes.css 1). Kept on,
        Notes and files and every other tab of a big project would not scroll at all on a tall wide window. */}
    {roomy && (
      <div className={`pj-ov-more${fills && shown ? ' nv-panes-root' : ''}`}>
        <div className="pj-ov-pane">
          <NotesSection ctx={ctx} />
        </div>
        <div className="pj-ov-pane">
          <WaitingSection ctx={ctx} />
        </div>
        <div className="pj-ov-pane">
          <ActivitySection ctx={ctx} />
        </div>
      </div>
    )}
    </>
  );
}


