// A project's page (docs/PROJECTS-DESIGN.md; t255, 13 Nov 2026: the folio's one long page became real tabs —
// Overview first, then Your next, Waiting, Open questions, Key dates, Notes and files, People, Decisions, Risks,
// Updates, Money and Activity — under a fixed head with the name, the standing and the status). The hub, workspace
// and record layouts fold into it as before (the workspace still opens from the buttons, the layouts head the
// Overview), and nothing the person could do is lost: every old tab link lands on its tab. Every value on it is the
// person's to change, where it is (views/project/Inline.tsx): each change goes to the main side as one ProjectEdit
// (src/shared/project-file.ts), is written back keeping every line the page doesn't understand, and can be undone
// (the Undo in its message, or Ctrl+Z on the page), the assistant's changes and the person's in one history.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isOwnName } from '../components/plan/plan';
import { isFinished } from '../../../shared/finished';
import { parseSayOverride, projectStanding, standingLine } from '../../../shared/project-standing';
import { weekdayDate } from '../../../shared/due-words';
import { isShelved } from '../../../shared/today-count';
import { dropDecisionItem, looseEndsWords, openProjectTasks, wantsDone } from '../../../shared/project-close';
import type { ProjectEdit } from '../../../shared/project-file';
import type { FolderHereResult, ProjectEditResult, ProjectFiles, ProjectView } from '../../../shared/types';
import { openMenu, type MenuItem } from '../components/Menu';
import { prompt } from '../components/Dialogs';
import { dueWords, hashTint, initials, readDate, shortDate } from '../lib/projectLook';
import { errorMessage } from '../lib/errors';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { todayData } from '../lib/todayData';
import { renderInline } from '../lib/markdownRender';
import * as A from '../state/actions';
import { bookmarksRenamed } from '../state/bookmarks';
import { askInChat } from '../state/chat';
import { noteMenu as noteTabMenu } from '../state/menus';
import { shareMenuItems } from '../state/share';
import { DesignButton } from '../components/DesignButton';
import { openTemplates, templateMenuItems } from '../state/templates';
import { docs } from '../state/docs';
import { setWorkspace } from '../state/layout';
import { loadFiles, loadNotes, prefs, showError, toast, useApp, usePrefs } from '../state/store';
import { ViewHeader } from './ViewHeader';
import * as W from '../state/workspace';
import { useModules } from '../state/modules';
import { useFinance } from '../state/recordModules';
import { shows } from '../../../shared/prefs';
import { partOn } from '../../../shared/life-modules';
import { projectWhere } from '../../../shared/project-folder';
import { FolderHere, chooseFolderHere, forgetFolderHere } from './project/FolderHere';
import { EditorContext, Inline, InlineDate, lineDate, useEditor, type Editor, type Suggestion } from './project/Inline';
import { Pill, Progress } from './project/parts';
import { hubFiles } from './project/ProjectHub';
import { hubModel, itemKey, type ItemRef } from '../../../shared/project-hub';
import { isoDay, todayDay } from '../../../shared/timeline';
import { PROP_STATUS_WORDS, propStatus, propStatusEdits, type PropStatus } from '../../../shared/projects-87';
import { PageProps } from '../components/PageHead';
import { PublishedMark } from '../components/PublishedMark';
import { BoardSkeleton, PageError, PageLoading, Skel } from '../components/PageStates';

export { Pill, Progress };
import { showItemSoon, takeItem } from './timeline/reveal';
import { openProjectCanvas } from './canvas/projectBoards';
import { useAgents } from '../state/agents';
import { openModal } from '../state/modals';
import type { MeetingsView } from './modules/work/MeetingsPage';
import { useWork } from '../state/workModules';
import { newNoteOfType } from '../state/noteTypes';
import { openWorkspace, runEditBatch } from '../state/projectWorkspace';
import { CloseDialog, type CloseTarget } from './project/CloseDialog';
import { TidyDialog } from './project/TidyDialog';
import { PortableExportDialog } from '../components/PortableExport';
import { openHubItem, type OpenContext } from './project/hubOpen';

import { ProjectChecksBanner } from './project/ProjectChecks';
import { PROJECT_TABS, isProjectTabId, moveProjectMemory, sectionForTab, useProjectMemory, useProjectMemoryReady, type FolioSection, type ProjectTabId } from './project/memory';
import { PageTabs, TabFind, usePageTabs } from '../components/PageTabs';
import { ActivitySection, DecisionsSection, FolioEmpty, KeyDatesSection, MoneySection, NotesSection, OverviewSection, PeopleSection, QuestionsSection, RisksSection, TabbedOn, UpdatesSection, WaitingSection, WhatsNextSection, attachProjectFiles, canAttachHere, chooseProjectFolder, folioEmptySections, needsFolderChoice, ownOpen, startSection, tabCounts, tabStarter, type TabsCtx } from './project/ProjectTabs87';

/** Each folio section's body, by id (the page draws the head first, the tail streams after). */
const FOLIO_BODY: Record<FolioSection, (p: { ctx: TabsCtx }) => ReactNode> = {
  'whats-next': WhatsNextSection,
  waiting: WaitingSection,
  questions: QuestionsSection,
  'key-dates': KeyDatesSection,
  people: PeopleSection,
  decisions: DecisionsSection,
  notes: NotesSection,
  // Files answer in Notes and files now (t239, their decision 4): the split is gone, and nothing renders this
  // alone.
  files: NotesSection,
  risks: RisksSection,
  updates: UpdatesSection,
  money: MoneySection,
  activity: ActivitySection,
};
import { LayoutDashboard, LayoutSuggestion, layoutMenuItems } from './project/LayoutDashboard';
import { Lifecycle } from './project/Lifecycle';
import { RecordFormHost } from './modules/RecordForm';


const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
/** An avatar's tint, steady per name, from the kit's five. */

const typing = (el: EventTarget | null) => !!(el as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor');

/** The page last clicked (Ctrl+Z goes to it when nothing has the keys). */
let lastPage: HTMLElement | null = null;

/** Which folio section holds an item (hub clicks land on the section, at the item; null is the top of the page). */
function sectionForRef(ref: ItemRef): FolioSection | null {
  switch (ref.kind) {
    case 'next':
    case 'run':
      return 'whats-next';
    case 'date':
      return 'key-dates';
    case 'risk':
      return 'risks';
    case 'update':
      return 'updates';
    case 'workstream':
      return null;
    case 'decision':
      return 'decisions';
    case 'person':
      return 'people';
    case 'file':
      return 'notes';
    case 'due':
      return null;
    case 'section': {
      const h = ref.heading.toLowerCase();
      if (['actions', 'tasks', 'next', 'unowned'].includes(h)) return 'whats-next';
      if (h === 'waiting') return 'waiting';
      if (h === 'dates') return 'key-dates';
      if (h === 'people') return 'people';
      if (h === 'decisions') return 'decisions';
      if (h === 'files') return 'notes';
      if (h === 'risks') return 'risks';
      if (h === 'updates') return 'updates';
      if (h === 'money') return 'money';
      return null;
    }
    default:
      return null;
  }
}

/** Which tab holds an opened-at line (t255): a step of someone else's reads in Waiting on others, not Your
 *  next — read from the hub, never guessed from what is drawn, so a reveal lands right on a half-mounted page. */
function tabForKey(key: string, id: FolioSection | null, hub: TabsCtx['hub']): ProjectTabId {
  if (key.startsWith('next:') || key.startsWith('run:')) {
    if (ownOpen(hub).some((a) => itemKey(a.ref) === key)) return 'whats-next';
    if (hub.waiting.some((g) => g.items.some((a) => itemKey(a.ref) === key))) return 'waiting';
    return 'whats-next';
  }
  return id ?? 'overview';
}

/** Which folio section holds an opened-at line ("dates:2", "next:0", "due"); null is the top of the page. */
function sectionForKey(key: string): FolioSection | null {
  const head = key.split(':')[0];
  if (head === 'next' || head === 'run') return 'whats-next';
  if (head === 'dates') return 'key-dates';
  if (head === 'decisions') return 'decisions';
  if (head === 'risks') return 'risks';
  if (head === 'updates') return 'updates';
  if (head === 'person') return 'people';
  if (head === 'file') return 'notes';
  if (head === 'money') return 'money';
  return null;
}

/** Frontmatter keys that are not the person's own facts (the page's own fields and the layout's). */
const KNOWN_PROPS = new Set(['type', 'status', 'health', 'progress', 'owner', 'folder', 'repository', 'started', 'due', 'updated', 'tags', 'title', 'name', 'date', 'stage', 'lifecycle', 'layout', 'template', 'area', 'id']);

const propWords = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export function ProjectPage({ path, tab: wtab }: { path: string; tab: W.TabState }) {
  // Who the person is (Today's own reading), so their own name never heads their own project (8.0, 29 Oct 2026).
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { let live = true; void todayData().then((d) => live && setMe(d.me), () => undefined); return () => void (live = false); }, []);
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const prefsNow = usePrefs();
  const agents = useAgents();
  const [view, setView] = useState<ProjectView | null>(null);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Closing with open tasks (p12-close-and-noise A): the shared dialog instead of a silent done. closingRef lets the
  // dialog's own done through the intercept in edit() below; allDoneRef stops the auto-finish below from marking done
  // (and saying so) a second time when All done already did it as one undoable change.
  const [closeAsk, setCloseAsk] = useState<null | { mode: 'closing' | 'loose'; blocked?: ProjectEdit[] }>(null);
  const [closeTargets, setCloseTargets] = useState<CloseTarget[]>([]);
  const [closeBusy, setCloseBusy] = useState(false);
  const closingRef = useRef(false);
  const allDoneRef = useRef(false);
  const [files, setFiles] = useState<ProjectFiles | null | undefined>(undefined);
  const [error, setError] = useState('');
  const page = useRef<HTMLDivElement>(null);
  const pathRef = useRef(path);
  const versionRef = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const hadView = useRef(false);
  pathRef.current = path;
  // The facts panel (round 2, 30 Oct 2026, the reviewer: the mock-up's title row carries the pill and the summary,
  // and the facts are edited from project-props): Facts… under ⋯ opens it, Escape or ⋯ goes back. Nothing lost.
  const [factsOpen, setFactsOpen] = useState(false);
  useEffect(() => {
    if (!factsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.overlay, .menu')) setFactsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [factsOpen]);

  const load = useCallback(() => {
    const asked = pathRef.current;
    return window.nv.projects.view(asked).then(
      (v) => {
        if (asked !== pathRef.current) return;
        versionRef.current = v.version;
        hadView.current = true;
        setView(v);
        setError('');
      },
      // A page already showing keeps showing while its file moves (a new name); a tab whose file went is emptied.
      (e) => !hadView.current && setError(errorMessage(e)),
    );
  }, []);
  // Refresh (fresh) keeps the files showing while they're read again (a remote computer can take a moment).
  const loadFolder = (fresh = false) => {
    const asked = pathRef.current;
    if (!fresh) setFiles(undefined);
    return window.nv.projects.files(asked, fresh).then(
      (f) => asked === pathRef.current && setFiles(f),
      () => asked === pathRef.current && setFiles(null),
    );
  };
  useEffect(() => void load(), [path, revision]);
  useEffect(() => void loadFolder(), [path, view?.project.folder, view?.project.key, view?.place?.state]);
  // An agent delivered a file here: the Files list shows it (read again, keeping the list while it does).
  const newestHere = agents?.delivered.find((f) => f.project?.path === path)?.id;
  const seenNewest = useRef(newestHere);
  useEffect(() => {
    if (newestHere && newestHere !== seenNewest.current) void loadFolder(true);
    seenNewest.current = newestHere;
  }, [newestHere]);
  /** A change's result: the page as it is now, and tabs (and the page) following a new name. */
  const applyResult = async (r: ProjectEditResult) => {
    versionRef.current = r.view.version;
    if (r.moves.length) {
      for (const [from, to] of r.moves) {
        await docs.renamed(from, to);
        moveProjectMemory(from, to);
        setWorkspace((ws) => W.renamed(ws, from, to));
        bookmarksRenamed(from, to);
      }
      pathRef.current = r.view.path;
      void Promise.all([loadNotes(), loadFiles()]);
    }
    setView(r.view);
  };
  /** Changes go one at a time, each on the file as the last one left it. */
  const queued = <T,>(job: () => Promise<T>) => {
    const run = queue.current.then(job, job);
    queue.current = run.catch(() => undefined);
    return run;
  };
  const step = (redo: boolean) =>
    queued(async () => {
      try {
        const r = await (redo ? window.nv.projects.redo(pathRef.current) : window.nv.projects.undo(pathRef.current));
        await applyResult(r);
        toast(r.words, redo ? (r.undo ? { label: 'Undo', run: () => void step(false) } : undefined) : r.redo ? { label: 'Redo', run: () => void step(true) } : undefined);
      } catch (err) {
        showError(err);
        void load();
      }
    });
  // One change or one batch (9.2 uplift F34): several writes from one user action apply together, say once,
  // and undo together — through the one queue, so they never interleave with other writes.
  const edit = (change: ProjectEdit | ProjectEdit[], words?: string) => {
    // Marking done with open tasks asks first (p12-close-and-noise A): every path on the page here (the Status
    // control, the layout's status band, the lifecycle stepper — moving to done writes the status too) opens the
    // shared dialog instead of closing silently. The blocked edits are kept: once every task is answered they run as
    // asked (a stepper move still moves the stepper, not just the status).
    const asked = Array.isArray(change) ? change : [change];
    if (wantsDone(asked) && !closingRef.current && view && !isFinished(view.project.status) && openProjectTasks(view.project).length) {
      setCloseAsk({ mode: 'closing', blocked: asked });
      return Promise.resolve(false);
    }
    return queued(async () => {
      if (!canEdit) return false;
      const edits = Array.isArray(change) ? change : [change];
      const first = edits[0];
      if (!first) return true;
      if (edits.length === 1 && words === undefined) {
        try {
          if (first.kind === 'set' && first.field === 'name') await docs.settle();
          const r = await window.nv.projects.edit(pathRef.current, first, versionRef.current);
          await applyResult(r);
          toast(r.words, { label: 'Undo', run: () => void step(false) });
          return true;
        } catch (err) {
          showError(err);
          void load();
          return false;
        }
      }
      if (edits.some((e) => e.kind === 'set' && e.field === 'name')) await docs.settle();
      const ok = await runEditBatch({
        edits,
        words,
        apply: async (e) => {
          const r = await window.nv.projects.edit(pathRef.current, e, versionRef.current);
          await applyResult(r);
          return r.words;
        },
        rollbackOne: async () => {
          const r = await window.nv.projects.undo(pathRef.current);
          await applyResult(r);
        },
        undoAll: () =>
          void queued(async () => {
            for (let i = edits.length - 1; i >= 0; i--) {
              try {
                const r = await window.nv.projects.undo(pathRef.current);
                await applyResult(r);
              } catch (err) {
                showError(err);
                return;
              }
            }
            toast(`Undid ${edits.length === 1 ? 'the change' : `all ${edits.length} changes`}.`);
          }),
      });
      if (!ok) void load();
      return ok;
    });
  };
  // The dialog's move targets (every project but this one), read when it opens.
  useEffect(() => {
    if (!closeAsk) return;
    let live = true;
    window.nv.projects
      .list()
      .then(
        (cards) => live && setCloseTargets(cards.filter((c) => c.path !== pathRef.current).map((c) => ({ path: c.path, name: c.name }))),
        () => live && setCloseTargets([]),
      );
    return () => void (live = false);
  }, [closeAsk]);
  // Every task answered: closing marks done (through the intercept above), loose ends just shut the dialog. All done
  // already marked done in its own batch: the dialog just shuts, keeping that one message and its Undo.
  useEffect(() => {
    if (!closeAsk || !view || openProjectTasks(view.project).length) return;
    if (allDoneRef.current || closeAsk.mode === 'loose' || isFinished(view.project.status)) {
      allDoneRef.current = false;
      setCloseAsk(null);
    } else {
      closingRef.current = true;
      const finish: ProjectEdit[] = closeAsk.blocked?.length ? closeAsk.blocked : [{ kind: 'set', field: 'status', value: 'done' }];
      void edit(finish).finally(() => {
        closingRef.current = false;
        setCloseAsk(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeAsk, view]);
  /** One task done from the dialog (the project's own edit: Undo takes it back). */
  const closeDone = (index: number) => void edit({ kind: 'change', list: 'next', index, item: { done: true } });
  /** One task dropped: off the next steps, kept under Decisions with the date, as one undoable change. */
  const closeDrop = (index: number) => {
    const t = view && openProjectTasks(view.project).find((x) => x.index === index);
    if (!t) return;
    const edits: ProjectEdit[] = [
      { kind: 'remove', list: 'next', index },
      { kind: 'add', list: 'decisions', item: dropDecisionItem(t.what, lineDate(Date.now())) },
    ];
    void edit(edits, `Dropped “${t.what}”. Kept under Decisions.`);
  };
  /** One task moved to another project: added there, taken off here, undone as one (both sides go back). */
  const closeMove = (index: number, target: string) => {
    const t = view && openProjectTasks(view.project).find((x) => x.index === index);
    if (!t || !canEdit) return;
    const targetName = closeTargets.find((x) => x.path === target)?.name ?? 'the other project';
    setCloseBusy(true);
    void queued(async () => {
      try {
        await window.nv.projects.edit(target, { kind: 'add', list: 'next', item: { what: t.what, ...(t.who ? { who: t.who } : {}), ...(t.when ? { when: t.when } : {}) } });
        const r = await window.nv.projects.edit(pathRef.current, { kind: 'remove', list: 'next', index }, versionRef.current);
        await applyResult(r);
        toast(`Moved “${t.what}” to ${targetName}.`, {
          label: 'Undo',
          run: () =>
            void queued(async () => {
              try {
                await window.nv.projects.undo(target);
                const u = await window.nv.projects.undo(pathRef.current);
                await applyResult(u);
                toast(`Moved “${t.what}” back.`);
              } catch (err) {
                showError(err);
                void load();
              }
            }),
        });
      } catch (err) {
        showError(err);
        void load();
      } finally {
        setCloseBusy(false);
      }
    });
  };
  /** Every remaining task done, then done itself when closing (one undoable change). */
  const closeAllDone = () => {
    if (!view) return;
    const open = openProjectTasks(view.project);
    if (!open.length) return;
    const edits: ProjectEdit[] = open.map((t): ProjectEdit => ({ kind: 'change', list: 'next', index: t.index, item: { done: true } }));
    if (closeAsk?.mode === 'closing') {
      edits.push(...(closeAsk.blocked?.length ? closeAsk.blocked : [{ kind: 'set', field: 'status', value: 'done' } as ProjectEdit]));
      allDoneRef.current = true;
    }
    closingRef.current = true;
    void edit(edits, closeAsk?.mode === 'closing' ? 'Marked every task done and the project done.' : 'Marked every task done.')
      .then((ok) => {
        if (!ok) allDoneRef.current = false;
      })
      .finally(() => {
        closingRef.current = false;
      });
  };
  const editor: Editor = useMemo(() => ({ path, canEdit, known: view?.known ?? { people: [], tags: [] }, edit }), [path, canEdit, view?.known]);
  // (edit reads the refs, so the editor can stay the same object between changes)

  // Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) on the page, when no field has the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canEdit || !(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target) || document.querySelector('.overlay, .menu')) return;
      const inside = page.current?.contains(document.activeElement) || (document.activeElement === document.body && lastPage === page.current);
      if (!inside) return;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        e.stopPropagation();
        void step(k === 'y' || e.shiftKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);

  // The shared loading and error states (8.7 wave 2 round 3; the project-loading and project-error mock-ups):
  // the head, facts and board in their real shapes while the project opens, and what happened with a way back
  // when its file went missing.
  if (error || !view)
    return (
      <>
        <ViewHeader tab={wtab} />
        <div className="vscroll">
          <div className="pj-page">
            {/* The Projects column (p11 vault-care): the page sits centred at 980, like the Projects list. */}
            <div className="vpage wide" style={{ maxWidth: 980, width: '100%', boxSizing: 'border-box' }}>
              {error ? (
                <PageError
                  title="This project couldn’t be opened"
                  explainer="Its file was renamed or moved outside your notes. Look in the Bin, or pick another project. Nothing else is affected."
                  retry={() => void load()}
                  back={{ label: 'Open the Bin', run: () => A.openBin() }}
                />
              ) : (
                <PageLoading label="Opening the project…">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Skel w={40} h={40} r={10} />
                    <Skel w="min(340px, 60%)" h={34} r={10} />
                  </div>
                  <div style={{ margin: '10px 0 0 54px' }}>
                    <Skel w="min(280px, 55%)" h={15} />
                  </div>
                  <div style={{ margin: '18px 0 0 54px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Skel w="min(220px, 50%)" h={14} />
                    <Skel w="min(180px, 45%)" h={14} />
                    <Skel w="min(200px, 48%)" h={14} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 12px 54px' }}>
                    <Skel w={90} h={24} />
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                      <Skel w={70} h={26} r={999} />
                      <Skel w={70} h={26} r={999} />
                      <Skel w={90} h={26} r={999} />
                    </span>
                  </div>
                  <div style={{ marginLeft: 54 }}>
                    <BoardSkeleton cols={3} />
                  </div>
                </PageLoading>
              )}
            </div>
          </div>
        </div>
      </>
    );
  const applyView = (v: ProjectView) => {
    versionRef.current = v.version;
    setView(v);
  };
  return (
    <>
      <ProjectShell
        wtab={wtab} view={view} files={files} canEdit={canEdit} prefsNow={prefsNow} me={me} page={page} edit={edit} applyResult={applyResult} applyView={applyView} editor={editor} path={path} tidyOpen={tidyOpen} setTidyOpen={setTidyOpen} exportOpen={exportOpen} setExportOpen={setExportOpen} loadFolder={loadFolder} factsOpen={factsOpen} setFactsOpen={setFactsOpen}
        loose={openProjectTasks(view.project).length} onLoose={() => setCloseAsk({ mode: 'loose' })}
      />
      {closeAsk && (
        <CloseDialog name={view.project.name} tasks={openProjectTasks(view.project)} targets={closeTargets} mode={closeAsk.mode} busy={closeBusy} onDone={closeDone} onDrop={closeDrop} onMove={closeMove} onAllDone={closeAllDone} onClose={() => setCloseAsk(null)} />
      )}
    </>
  );
}

function ProjectShell({
  wtab, view, files, canEdit, prefsNow, me, page, edit, applyResult, applyView, editor, path, tidyOpen, setTidyOpen, exportOpen, setExportOpen, loadFolder, factsOpen, setFactsOpen, loose, onLoose,
}: {
  wtab: W.TabState;
  view: ProjectView;
  files: ProjectFiles | null | undefined;
  canEdit: boolean;
  prefsNow: ReturnType<typeof usePrefs>;
  me: string | null;
  page: React.RefObject<HTMLDivElement | null>;
  edit(change: ProjectEdit | ProjectEdit[], words?: string): Promise<boolean>;
  applyResult(r: ProjectEditResult): Promise<void>;
  applyView(v: ProjectView): void;
  editor: Editor;
  path: string;
  tidyOpen: boolean;
  setTidyOpen(v: boolean): void;
  exportOpen: boolean;
  setExportOpen(v: boolean): void;
  loadFolder(fresh?: boolean): unknown;
  factsOpen: boolean;
  setFactsOpen(v: boolean): void;
  /** Open tasks still to answer for (p12 A): a finished project shows them as one quiet line. */
  loose: number;
  onLoose(): void;
}) {
  const byPath = useApp((s) => s.byPath);
  const agents = useAgents();
  const p = view.project;
  const place = view.place;
  const elsewhere = place?.state === 'elsewhere' ? place : null;
  const onFolderHere = (r: FolderHereResult) => applyView(r.view);
  const due = dueWords(p.due, p.status);
  // The hub's reading of the project (shared with the Overview and the tabs): its actions, waiting, milestones,
  // people and decisions, with the connected vault's actions written in meetings and notes.
  const [connected, setConnected] = useState<{ me: string | null; elsewhere: { id: string; path: string; line?: number; what: string; who?: string; when?: string; due?: string; done: boolean; from?: string; task?: string }[]; filedElsewhere: { id: string; path: string; line?: number; what: string; who?: string; when?: string; due?: string; done: boolean; from?: string; task?: string }[] } | null>(null);
  const revision = useApp((s) => s.revision);
  useEffect(() => {
    let live = true;
    window.nv.records.attention(path).then(
      (a) => live && setConnected({ me: a?.me ?? null, elsewhere: a?.elsewhere ?? [], filedElsewhere: a?.filedElsewhere ?? [] }),
      () => live && setConnected({ me: null, elsewhere: [], filedElsewhere: [] }),
    );
    return () => void (live = false);
  }, [path, revision]);
  const today = todayDay();
  // Whose the page reads as: Today's own reading first, the owner only when nobody is known (step 2: "yours"
  // means yours on every screen, never the owner's by guess).
  const who = connected?.me ?? me;
  const hub = useMemo(() => hubModel({ project: p, props: view.props, today, ...(who ? { me: who } : {}), connected: connected?.elsewhere ?? [] }), [p, view.props, today, who, connected]);
  // The one standing (one fact, one value, 8 Nov 2026): the pill, tile and bar read what the Projects page
  // and the Graph read — Overdue past its due day, On hold for a paused project, never On track when finished —
  // with your late steps weighed as Projects home weighs them (step 2: the chip reads the same here and there,
  // never contradicting its rows). The menu below still writes the stored status and health, so its tick is the
  // stored one.
  const standing = projectStanding({ status: p.status, health: p.health, overdue: due?.tone === 'bad', lateMine: hub.plan.late.length });
  const tone = standing.tone;
  // The header tile reads the one set (p13-vault-status): neutral unless the health needs attention.
  const tileTint = tone === 'warn' || tone === 'bad' ? 'red' : 'slate';
  const set = (field: Extract<ProjectEdit, { kind: 'set' }>['field'], value: string | number | null) => edit({ kind: 'set', field, value });
  const status: PropStatus = propStatus(p);
  // The pills read the standing's words (uniform with every page); the menu ticks the stored status above.
  const pillCls = tone === 'bad' ? 'is-attention is-strong' : tone === 'warn' ? 'is-attention' : 'is-muted';
  const heroTint = tone === 'bad' || tone === 'warn' ? 'red' : 'slate';
  const heroStrong = tone === 'bad';
  // The hero reads the summary's lead (its first line) until asked (v9, 6 Nov 2026): a long summary is never a wall.
  const leadLines = p.summary.split('\n').filter((l) => l.trim());
  const lead = leadLines[0] ?? '';
  const [leadMore, setLeadMore] = useState(false);
  useEffect(() => setLeadMore(false), [path]);
  // Read more only when something actually hides (n3, 6 Nov 2026: it showed at 3456 where the lead fit whole):
  // more lines below the lead, or the lead overflowing its two-line clamp — measured, never guessed by length.
  const leadRef = useRef<HTMLSpanElement>(null);
  const [leadClipped, setLeadClipped] = useState(false);
  useEffect(() => {
    if (leadMore) return;
    const el = leadRef.current;
    if (!el) return;
    const read = () => setLeadClipped(el.scrollHeight > el.clientHeight + 1);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lead, leadMore, path]);
  const leadRest = leadLines.length > 1 || leadClipped;
  // One user action, one batch (9.2 uplift F34): a status change applies its writes together, says once, undoes all.
  const chooseStatus = (anchor: HTMLElement) =>
    openMenu(anchor, (['active', 'at-risk', 'off-track', 'on-track', 'on-hold', 'idea', 'finished'] as PropStatus[]).map((v) => ({ label: PROP_STATUS_WORDS[v], checked: status === v, run: () => void edit(propStatusEdits(v, p).map((e): ProjectEdit => ({ kind: 'set', field: e.field, value: e.value })), `Status set to ${PROP_STATUS_WORDS[v]}.`) })));
  // A note for this project, from a template (Templates page): it goes in the project's folder and shows on this page.
  const noteMenu = async (anchor: HTMLElement) => {
    const items = await templateMenuItems({ project: path });
    openMenu(anchor, [
      { heading: `New note in ${p.name}` },
      ...items,
      { separator: true },
      { label: 'Blank note', icon: 'filePlus', run: () => void newNoteOfType('note', { folder: A.folderOf(path), where: 'tab' }) },
      { label: 'All templates…', icon: 'template', run: () => openTemplates(path) },
    ]);
  };
  const people: Suggestion[] = view.known.people.map((x) => ({ value: x.name, hint: x.role }));
  const agentLines = (agents?.activity ?? [])
    .filter((e) => e.project?.path === path)
    .slice(0, 8)
    .map((e) => ({
      title: e.words,
      modified: e.at,
      status: e.undone ? 'undone' : e.outcome === 'denied' || e.outcome === 'expired' ? 'refused' : undefined,
      kind: e.agentName,
      open: e.file?.exists ? () => (e.file!.place === 'folder' && e.file!.project ? A.openFolderFile(e.file!.project.path, e.file!.path) : A.openPath(e.file!.path)) : () => openModal({ kind: 'settings', section: 'agents' }),
    }));
  // Files agents delivered here lately: as cards above the Updates (newest first).
  const delivered = (agents?.delivered ?? []).filter((f) => f.project?.path === path && f.exists).slice(0, 3);
  const started = readDate(p.started);
  const fileNames = [...(files?.groups.flatMap((g) => g.files.map((f) => f.rel)) ?? []), ...(files?.saved?.files.map((f) => f.rel) ?? [])];

  const fileList = useMemo(() => hubFiles(view, files, byPath as Map<string, { mtime: number; props: Record<string, unknown> }>), [view, files, byPath]);
  const [changes, setChanges] = useState<{ time: number; by?: string; words: string[] }[]>([]);
  useEffect(() => {
    let live = true;
    window.nv.projects.changes(path).then((c) => live && setChanges(c), () => live && setChanges([]));
    return () => void (live = false);
  }, [path, view.version, revision]);
  // Money's bills, read once for the page (t12, 8 Nov 2026): the Money section and the visibility rule share it.
  const billsOn = partOn(useModules(), 'finance', 'bills');
  const { data: finance } = useFinance(billsOn);
  // Its meetings' open questions, longest waiting first (step 2: asked in a meeting, open until answered).
  const { data: meetingsView } = useWork<MeetingsView>('meetings');
  const questions = useMemo(() => {
    const mine = p.name.trim().toLowerCase();
    return (meetingsView?.meetings ?? [])
      .filter((m) => m.project.trim().toLowerCase() === mine)
      .flatMap((m) =>
        m.questions
          .filter((q) => !q.answered)
          .map((q) => ({ path: m.path, meeting: m.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, '') || m.title, date: m.date, line: q.line, raw: q.raw, what: q.what, ...(q.askedBy ? { askedBy: q.askedBy } : {}), ...(q.owner ? { owner: q.owner } : {}) })),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [meetingsView, p.name]);
  // The page's own tabs (t255): history, memory and reveal through the one shared hook. History first,
  // then the remembered tab, then Overview; an old remembered tab lands on its section, as old links do.
  const [memory, remember] = useProjectMemory(path);
  const memReady = useProjectMemoryReady();
  const counts = useMemo(
    () => tabCounts({ view, files, questions, path, hub, today, changes, delivered, agentLines, money: { on: billsOn, data: finance } }, byPath),
    [view, files, questions, path, hub, today, changes, delivered, agentLines, billsOn, finance, byPath],
  );
  const tabs = useMemo(() => PROJECT_TABS.map((t) => (t.id === 'overview' ? { id: t.id, title: t.title } : { id: t.id, title: t.title, count: counts[t.id] ?? 0 })), [counts]);
  const remembered = isProjectTabId(memory.section) ? memory.section : memory.tab !== undefined ? (sectionForTab(memory.tab) ?? undefined) : undefined;
  const rememberTab = useCallback((id: string) => remember((m) => ({ ...m, section: id })), [remember]);
  const { active, openTab, reveal, isMounted, focusSignal } = usePageTabs({ tabId: wtab.id, pageKey: path, tabs, defaultTab: 'overview', section: wtab.section, remembered, ready: memReady, remember: rememberTab });
  // Opened at one of its lines: the due and start dates live in the Facts panel, so it opens first then the
  // line is waited for and flashed; anything else opens its tab and flashes there (t248), leaving Facts shut.
  const jumped = useRef('');
  const flashKey = (key: string) => (page.current ? showItemSoon(page.current, key) : Promise.resolve(false));
  const showKey = (key: string, id: FolioSection | null, push: boolean): Promise<HTMLElement | null> => {
    if (key === 'due' || key === 'start') {
      setFactsOpen(true);
      return flashKey(key).then(() => page.current);
    }
    setFactsOpen(false);
    window.dispatchEvent(new CustomEvent('pj-expand', { detail: path }));
    const target = tabForKey(key, id, hub);
    if (push) {
      openTab(target, { push: true, focus: true });
      return flashKey(key).then(() => page.current);
    }
    reveal(target, key, (item) => void flashKey(item));
    return Promise.resolve(page.current);
  };
  const openCtx: OpenContext = {
    path,
    details: () => {
      openTab('overview', { push: true });
      return Promise.resolve(page.current);
    },
    show: (ref) => showKey(itemKey(ref), sectionForRef(ref), true),
    openFolderFile: (rel) => A.openFolderFile(path, rel),
  };
  const go = (ref: ItemRef, title?: string) => (e?: React.MouseEvent) => void openHubItem(openCtx, ref, title, e);
  const goSection = (id: FolioSection) => openTab(id === 'files' ? 'notes' : id, { push: true, focus: true });
  const ctx: TabsCtx = { view, files, questions, path, me: who, hub, connected: [...(connected?.elsewhere ?? []), ...(connected?.filedElsewhere ?? [])], today, go, goSection, refreshFiles: () => void loadFolder(true), noteMenu: (a) => void noteMenu(a), changes, fileList, delivered, agentLines, fileNames, money: { on: billsOn, data: finance } };
  // A tab with nothing in it reads quietly, never hidden (t255): the empty set marks quiet tabs and their quiet
  // panels, so the order never shifts. A brand-new project starts from the Overview's empty start.
  const empty = folioEmptySections(ctx, byPath);
  const allEmpty = PROJECT_TABS.every((t) => t.id === 'overview' || empty.has(t.id as FolioSection));
  // Ctrl+K "go to" still finds each tab (t255): the palette names the tab, the page opens it.
  useEffect(() => {
    const onGoto = (e: Event) => {
      const d = (e as CustomEvent).detail as { path?: string; section?: string } | undefined;
      if (!d || d.path !== path || !isProjectTabId(d.section)) return;
      setFactsOpen(false);
      openTab(d.section, { push: true, focus: true });
    };
    window.addEventListener('pj-goto', onGoto);
    return () => window.removeEventListener('pj-goto', onGoto);
  }, [path, openTab]);
  // Opened from elsewhere at one of its lines (from the Timeline, a peek, search): its tab opens and the line
  // flashes there, once per project, without pushing (Back returns past the landing).
  useEffect(() => {
    if (jumped.current === path) return;
    const item = takeItem(path);
    if (item) {
      jumped.current = path;
      void showKey(item, sectionForKey(item), false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  // The standing in two lines, worked out from the dates (step 2: "5 of yours open, 3 late. 11 with others, 2
  // late. Next milestone Fri 20 Nov."). Your own "I say" line reads as yours when you disagree.
  const standingCounts = standingLine(hub);
  const said = parseSayOverride(p.health);
  const milestoneIso = standingCounts.nextDay !== null ? isoDay(standingCounts.nextDay) : null;
  const milestoneAt = milestoneIso ? new Date(Number(milestoneIso.slice(0, 4)), Number(milestoneIso.slice(5, 7)) - 1, Number(milestoneIso.slice(8, 10))) : null;
  const standingWords = `${standingCounts.mineOpen === 0 ? 'Nothing of yours is open' : `${standingCounts.mineOpen} of yours open, ${standingCounts.mineLate ? `${standingCounts.mineLate} late` : 'none late'}`}. ${standingCounts.othersOpen === 0 ? 'Nothing with others' : `${standingCounts.othersOpen} with others, ${standingCounts.othersLate ? `${standingCounts.othersLate} late` : 'none late'}`}.${milestoneAt ? ` Next milestone ${weekdayDate(milestoneAt, new Date())}.` : ''}`;
  const sayIt = async () => {
    const cur = said ? `${said.claim}${said.reason ? `, because ${said.reason}` : ''}` : '';
    const v = await prompt('I say where this stands', { value: cur, message: 'Your own line, shown as yours. The worked-out standing stays underneath. Leave it empty to go back to the worked-out standing.', placeholder: 'At risk, because ShadeCo may lapse', ok: 'Say it' });
    if (v === null) return;
    const t = v.trim();
    await set('health', t ? `I say: ${t}` : null);
  };

  // The page's own facts: the person's custom properties (go_live, budget…), the page's own fields left out.
  const customFacts = useMemo(() => Object.entries(view.props ?? {}).filter(([k, v]) => !KNOWN_PROPS.has(k.toLowerCase()) && (typeof v === 'string' || typeof v === 'number') && String(v).trim()).map(([k, v]) => ({ key: k, words: propWords(v) })), [view.props]);
  const addFact = () =>
    void (async () => {
      const key = await prompt('Add a fact', { message: 'Its name, in a word or two (Budget, Rego number…).', ok: 'Next' });
      if (!key?.trim()) return;
      const value = await prompt(key.trim(), { message: `What is ${p.name}’s ${key.trim()}?`, ok: 'Add it' });
      if (value === null || !value.trim()) return;
      await edit({ kind: 'prop', key: key.trim().toLowerCase().replace(/\s+/g, '_'), value: value.trim() });
    })().catch(showError);
  const fieldsMenuItems = (): MenuItem[] => {
    const items: MenuItem[] = [
      { label: 'Page layout', icon: 'layers' as const, submenu: layoutMenuItems(view, edit) },
      {
        label: typeof p.progress === 'number' ? 'Change progress' : 'Set progress',
        icon: 'chart' as const,
        submenu: [
          ...[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => ({ label: `${n}%`, checked: p.progress === n, run: () => void set('progress', n) })),
          ...(typeof p.progress === 'number' ? [{ separator: true } as const, { label: 'Clear progress', run: () => void set('progress', null) }] : []),
        ],
      },
      { separator: true } as const,
      { label: 'Add a fact…', icon: 'plus' as const, run: addFact },
    ];
    if (customFacts.length)
      items.push({
        label: 'Remove a fact…',
        icon: 'trash' as const,
        submenu: customFacts.map((f) => ({ label: `${cap(f.key.replace(/_/g, ' '))}: ${f.words}`, run: () => void edit({ kind: 'prop', key: f.key, value: null }) })),
      });
    return items;
  };
  const fieldsMenu = (anchor: HTMLElement) => openMenu(anchor, fieldsMenuItems());

  const coreFacts: { k: string; v: React.ReactNode; mark?: string }[] = [
    {
      k: 'Status',
      v: canEdit ? (
        <button type="button" className="w2a-factbtn" onClick={(e) => chooseStatus(e.currentTarget)} aria-haspopup="menu" title="Change the status">
          <span className={`pill is-plain ${pillCls}`}>{standing.words} ▾</span>
        </button>
      ) : (
        <span className={`pill is-plain ${pillCls}`}>{standing.words}</span>
      ),
    },
    {
      k: 'Due',
      mark: 'due',
      v: (
        <InlineDate value={p.due} iso label="Due date" placeholder="Set a due date" className={`pj-due tone-${due?.tone ?? 'none'}`} onSave={(v) => set('due', v)}>
          {due?.words}
        </InlineDate>
      ),
    },
    ...(!(p.owner && isOwnName(p.owner, me))
      ? [
          {
            k: 'Owner',
            v: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {p.owner && (
                  <i className="miniava blue" aria-hidden="true">
                    {initials(p.owner)}
                  </i>
                )}
                <Inline compact value={p.owner ?? ''} label="Owner" placeholder="Add an owner" quiet={!canEdit} suggest={people} onSave={(v) => set('owner', v)} />
              </span>
            ),
          } as { k: string; v: React.ReactNode },
        ]
      : []),
    ...((p.started || canEdit)
      ? [
          {
            k: 'Started',
            mark: 'start',
            v: (
              <InlineDate value={p.started} iso label="Start date" placeholder="Set a start" quiet className="pj-faint pj-started" onSave={(v) => set('started', v)}>
                {started !== null ? shortDate(started) : p.started}
              </InlineDate>
            ),
          } as { k: string; v: React.ReactNode; mark?: string },
        ]
      : []),
    ...(typeof p.progress === 'number'
      ? [
          {
            k: 'Progress',
            v: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Progress value={p.progress} tone={tone} />
                <Inline
                  compact
                  value={String(p.progress)}
                  label="Progress"
                  onSave={async (v) => {
                    const n = Number(v.replace(/%$/, '').trim());
                    if (!Number.isFinite(n)) {
                      showError('Give a number from 0 to 100.');
                      return false;
                    }
                    return set('progress', n);
                  }}
                >
                  <span className="meta" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{p.progress}%</span>
                </Inline>
              </span>
            ),
          } as { k: string; v: React.ReactNode },
        ]
      : []),
    ...(p.tags.length || canEdit ? [{ k: 'Tags', v: <Tags tags={p.tags} known={view.known.tags} /> } as { k: string; v: React.ReactNode }] : []),
    ...(p.repository
      ? [
          {
            k: 'Code',
            v: <Inline compact value={p.repository} label="Where its code is kept" onSave={(v) => set('repository', v)} />,
          } as { k: string; v: React.ReactNode },
        ]
      : []),
  ];
  const customRows: { k: string; v: React.ReactNode }[] = customFacts.map((f) => ({
    k: cap(f.key.replace(/_/g, ' ')),
    v: (
      <Inline compact value={f.words} label={cap(f.key.replace(/_/g, ' '))} onSave={(v) => edit({ kind: 'prop', key: f.key, value: v || null })}>
        {f.words}
      </Inline>
    ),
  }));
  // The facts panel shows every fact (the folio's title row carries the status line and the summary).
  const facts = [...coreFacts, ...customRows];
  // Each section carries its own one primary action in its head (+ Add task, + Add note, + Attach, + Add person,
  // + Log decision, + Milestone): the same prompts the tab bodies had, where the rows are. Share (8.8): a clean
  // copy of the project's page, the same four ways as every page (state/share.ts). Copying its path, showing it
  // in File Explorer and sending it to the former host app stay in the ⋯ menu.
  const shareMenu = (anchor: HTMLElement) => openMenu(anchor, [{ heading: `Share ${p.name}` }, ...shareMenuItems(path)]);
  // The template picker opens at this page's own ⋯ button (or the templates window when it cannot be found).
  const noteTemplateHere = () => {
    const anchor = page.current?.closest('.note-view, .group-body')?.querySelector<HTMLElement>('.topbar button[aria-label="More"]');
    if (anchor) void noteMenu(anchor);
    else openTemplates(path);
  };
  // The page's ⋯ menu: first the header buttons the bar hid (the header contract, Round 2, 4 Nov 2026, the
  // reviewer: nothing may ever overlap the centred search), then work, report and a new note at the top, the
  // rest of the project under Project, then the note's own grouped menu. Grouped 4 Nov 2026 (the menu ran
  // to 35 flat rows). No Send to an agent row here: the note's menu below already sends.
  const projectMenu = (): MenuItem[] => {
    const publishItem = (): MenuItem => ({ label: 'Publish this project…', icon: 'globe' as const, run: () => openModal({ kind: 'publish', source: { kind: 'project', path } }) });
    const over = overflowMenuItems(headerOverflowHidden(wtab.id), {
      'fields': () => ({ label: 'Fields', icon: 'properties' as const, submenu: fieldsMenuItems() }),
      'share': () => ({ label: 'Share', submenu: shareMenuItems(path) }),
      'design': () => ({ label: 'Design with AI…', icon: 'palette', run: () => openModal({ kind: 'design', path }) }),
      'publish': publishItem,
      'people': () => ({ label: 'Everyone on this project', icon: 'people' as const, run: () => goSection('people') }),
    });
    const projectSub: MenuItem[] = [
      { label: 'Workspace', icon: 'layers' as const, run: () => openWorkspace(path) },
      ...(canEdit ? [{ label: 'Facts…', icon: 'properties' as const, run: () => setFactsOpen(true) }] : []),
      { label: 'Edit as a note', icon: 'pencil' as const, run: () => setWorkspace((ws) => W.updateTab(ws, wtab.id, { mode: prefs().defaultMode === 'reading' ? 'live' : prefs().defaultMode })) },
      { label: 'Catch up from its folder', icon: 'refresh' as const, run: () => askInChat(`Catch up “${p.name}”: what’s new or changed in its folder since it was last updated? Propose the changes.`, path) },
      ...(shows(prefsNow, 'project:canvas') ? [{ label: 'See it on a canvas', icon: 'canvas' as const, run: () => void openProjectCanvas(path) }] : []),
      ...(canEdit ? [{ label: 'Tidy this project…', icon: 'sparkle' as const, run: () => setTidyOpen(true) }] : []),
      { label: 'Export this project…', icon: 'download' as const, run: () => setExportOpen(true) },
      ...(p.folder ? [{ label: 'Open the folder', icon: 'folderOpen' as const, hint: p.folder, run: () => void window.nv.projects.openFolder(path).catch(showError) }] : []),
      // No folder on this PC yet (t267: the tabs left no way to link one): Choose sits between Open and
      // Change. Elsewhere keeps its card and Work doors; without keeps Change; remote reads through The
      // former host app, so no local door.
      ...(!p.folder && place?.state !== 'without' && place?.state !== 'elsewhere' && place?.state !== 'chosen' && projectWhere(p)?.kind !== 'remote' ? [{ label: 'Choose its folder on this PC…', icon: 'folderOpen' as const, run: () => chooseFolderHere(path, onFolderHere) }] : []),
      ...(place?.state === 'chosen' || place?.state === 'without' ? [{ label: 'Change its folder on this PC…', icon: 'computer' as const, hint: place.state === 'without' ? 'Working without a folder here' : place.folder, run: () => forgetFolderHere(path, onFolderHere) }] : []),
    ];
    return [
    ...(over.length ? [...over, { separator: true } as const] : []),
    ...(factsOpen ? [{ label: 'Back to the project', icon: 'back' as const, run: () => setFactsOpen(false) }, { separator: true } as const] : []),
    ...(canEdit ? [{ label: 'New note for this project…', icon: 'filePlus' as const, run: () => noteTemplateHere() }] : []),
    { label: 'Project', icon: 'briefcase' as const, submenu: projectSub },
    { separator: true } as const,
    ...noteTabMenu(wtab),
    ];
  };

  // The top bar's right side: the facts panel gets Fields, Share and Publish; the folio gets the people,
  // Share and Publish (each section carries its own primary action in its head).
  // A name reads once, however the file writes it (t208, 11 Nov 2026, second look at real content: the owner
  // read twice — "Alex Chen" beside "Alex Chen (owner)" — and the stack collided into "ACACSO").
  const headPeople = [p.owner?.trim(), ...hub.people.map((x) => x.name)]
    .map((n) => n?.replace(/\s*\(owner\)\s*$/i, '').trim())
    .filter((n): n is string => !!n && !isOwnName(n, me))
    .filter((n, i, all) => all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i)
    .slice(0, 3);
  const headPeopleLabel = `${headPeople.join(', ')}. Everyone is under People below.`;
  const headActions = factsOpen ? (
    <>
      {canEdit && <button className="btn" data-overflow="fields" data-overflow-order={2} title="Page layout, progress, add or remove a fact" onClick={(e) => fieldsMenu(e.currentTarget)}>Fields</button>}
      <DesignButton path={path} overflow="design" overflowOrder={4} />
      <button className="btn" data-overflow="share" data-overflow-order={3} title="Share this project" onClick={(e) => shareMenu(e.currentTarget)}>Share</button>
      <button className="btn" data-overflow="publish" data-overflow-order={1} title="Publish this project as a website" onClick={() => openModal({ kind: 'publish', source: { kind: 'project', path } })}>Publish</button>
    </>
  ) : (
    <>
      {headPeople.length > 0 && (
        <button className="avatars w2a-ava" data-overflow="people" data-overflow-order={2} title={headPeopleLabel} aria-label={headPeopleLabel} onClick={() => goSection('people')}>
          {headPeople.map((n) => (
            <i key={n} className={`miniava ${hashTint(n)}`} aria-hidden="true">{initials(n)}</i>
          ))}
        </button>
      )}
      <DesignButton path={path} overflow="design" overflowOrder={4} />
      <button className="btn" data-overflow="share" data-overflow-order={3} title="Share this project" onClick={(e) => shareMenu(e.currentTarget)}>Share</button>
      <button className="btn" data-overflow="publish" data-overflow-order={1} title="Publish this project as a website" onClick={() => openModal({ kind: 'publish', source: { kind: 'project', path } })}>Publish</button>
    </>
  );
  const [lifeOpen, setLifeOpen] = useState(false);

  return (
    <EditorContext.Provider value={editor}>
      <ViewHeader tab={wtab} menu={projectMenu}>
        {headActions}
      </ViewHeader>
      {/* Published (9.0 w122publish): the sites this project is in, with a link and unpublish. */}
      <PublishedMark path={path} />
      <div className="vscroll">
        {/* pj-page only: pj-head is the old header's flex row, and it squeezed this page into a centred column. */}
        <div className="pj-page" ref={page} tabIndex={-1} onPointerDown={() => (lastPage = page.current)} style={{ outline: 'none' }}>
          {factsOpen ? (
            <div className="vpage">
              <div className="w2a-phead">
                <span className={`gtile ${tileTint}`} aria-hidden="true">◧</span>
                <h1 className="w2a-title" style={{ margin: 0 }}>
                  <Inline value={p.name} required label="Project’s name" className="w2a-ptitle" maxLength={120} onSave={(name) => set('name', name)} />
                </h1>
              </div>
              <p className="w2a-psub">Choose any fact to change it where it sits. It saves itself.</p>
              {elsewhere && <FolderHere path={path} place={elsewhere} onDone={onFolderHere} />}
              <div style={{ marginLeft: 54 }}>
                <PageProps facts={facts} />
                {canEdit && (
                  <button className="w2a-addfact" onClick={addFact} title="Add a fact of your own">
                    <span className="k">+ Add a fact</span>
                    <span className="v">due date, amount, rego number…</span>
                  </button>
                )}
              </div>
              <div className="callout blue" style={{ margin: '20px 0 0 54px' }}>
                <span aria-hidden="true">◧</span>
                <span>The <b>Fields</b> button up top adds or removes these facts.</span>
              </div>
            </div>
          ) : (
          <div className="vpage wide pj-folio is-tabs">
            {/* The head stays fixed (t255): the name, the standing line, the status and the tabs. */}
            <div className="pj-stickhead">
              {/* The hero is back (v9, 6 Nov 2026: the folio "gone away from looking polished like it use to"): the tile, the name,
                  the status pill and the summary's lead, as the tabs page had it. A long summary reads as its lead
                  until asked (one quiet Read more; the words unchanged, still edited where they sit). The status
                  line is gone with the pill back: owner and due date live in the status band below (and Facts), each
                  shown once. */}
              <div className="nv-hero" key={path}>
                <div className="w2a-phead">
                  <span className={`gtile ${tileTint}`} aria-hidden="true">◧</span>
                  <h1 className="w2a-title" style={{ margin: 0 }}>
                    <Inline value={p.name} required label="Project’s name" className="w2a-ptitle" maxLength={120} onSave={(name) => set('name', name)} />
                  </h1>
                  {canEdit ? (
                    <button type="button" className="w2a-factbtn" style={{ marginLeft: 6 }} onClick={(e) => chooseStatus(e.currentTarget)} aria-haspopup="menu" title="Change the status">
                      <span className={`pill ${heroTint}`} style={heroStrong ? { fontWeight: 700 } : undefined}>{standing.words}</span>
                    </button>
                  ) : (
                    <span className={`pill ${heroTint}`} style={{ marginLeft: 6, ...(heroStrong ? { fontWeight: 700 } : undefined) }}>{standing.words}</span>
                  )}
                </div>
                {(p.summary.trim() || canEdit) && (
                  <div className="w2a-psub">
                    <Inline value={p.summary} multiline label="Summary" placeholder="Add a one-line summary…" onSave={(v) => set('summary', v)}>
                      {lead ? <span ref={leadRef} className={!leadMore ? 'w2a-clip' : undefined} dangerouslySetInnerHTML={{ __html: renderInline(!leadMore ? lead : p.summary, { from: path }) }} /> : undefined}
                    </Inline>
                    {leadRest && (
                      <button type="button" className="w2a-readmore" aria-expanded={leadMore} onClick={() => setLeadMore(!leadMore)}>
                        {leadMore ? 'Read less' : 'Read more'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* The standing, worked out from the dates (step 2): yours open and late, others open and late, the
                  next milestone. The chip above reads the one standing, as Projects home does; your own "I say"
                  line reads as yours when you disagree. */}
              <div className="w2a-standing">
                <p>{standingWords}{canEdit && <> <button type="button" className="pj-saybtn" onClick={() => void sayIt()} title="Say where this stands, in your own words">I say…</button></>}</p>
                {said && <p className="pj-say">You say: {said.claim}{said.reason ? `, because ${said.reason}` : ''}.</p>}
              </div>
              <PageTabs tabs={tabs} active={active} onOpen={(id) => openTab(id, { push: true })} label="Project sections" focusSignal={focusSignal} idPrefix="pj" />
            </div>

            <TabbedOn>
              {PROJECT_TABS.map(
                // data-section reads once per tab (the section or its quiet empty carries it; the
                // Overview panel carries its own, having no section inside).
                (t) =>
                  isMounted(t.id) && (
                    <section key={t.id} role="tabpanel" id={`pj-panel-${t.id}`} aria-labelledby={`pj-tab-${t.id}`} tabIndex={0} data-section={t.id === 'overview' ? t.id : undefined} style={{ display: active === t.id ? undefined : 'none' }}>
                      {t.id === 'overview' ? (
                        <>
                          {elsewhere && <FolderHere path={path} place={elsewhere} onDone={onFolderHere} />}

                          {/* Catch-up (10.0 item 19): what waits from the notes, re-checked as the notes change. */}
                          <ProjectChecksBanner version={view.version} onOpen={(ref) => void openHubItem(openCtx, ref)} />

                          {isFinished(p.status) && loose > 0 && (
                            <button type="button" className="pj-loose" onClick={onLoose} title="Answer for the tasks still open">
                              {looseEndsWords(loose)}
                            </button>
                          )}
                          {/* A shelved (on hold or idea) project still holding open steps (Nov 2026, b6 break job: they count
                              nowhere — the page says plainly how many, landing on Your next where they wait). */}
                          {!isFinished(p.status) && isShelved(p.status) && loose > 0 && (
                            <button type="button" className="pj-loose" onClick={() => goSection('whats-next')} title="Show them in Your next">
                              {loose} open task{loose === 1 ? '' : 's'}
                            </button>
                          )}

                          <LayoutSuggestion view={view} path={path} />
                          <LayoutDashboard view={view} path={path} />
                          <Lifecycle view={view} files={fileList} open={lifeOpen} onOpen={setLifeOpen} />

                          {allEmpty ? <FolioEmpty ctx={ctx} /> : <OverviewSection ctx={ctx} shown={active === 'overview'} />}
                        </>
                      ) : empty.has(t.id as FolioSection) ? (
                        <TabEmpty id={t.id as FolioSection} ctx={ctx} />
                      ) : (
                        <>
                          <TabFind id={t.id} open={active === t.id} />
                          {(() => {
                            const Body = FOLIO_BODY[t.id as FolioSection];
                            return <Body ctx={ctx} />;
                          })()}
                        </>
                      )}
                    </section>
                  ),
              )}
            </TabbedOn>
          </div>
          )}
        </div>
      </div>
      {tidyOpen && (
        <TidyDialog
          path={path}
          onClose={() => setTidyOpen(false)}
          onTidied={(r) => {
            void applyResult(r as unknown as ProjectEditResult);
            toast(r.words, {
              label: 'Undo',
              run: () =>
                void window.nv.projects
                  .tidyUndo(path)
                  .then(async (u) => {
                    await applyResult(u as unknown as ProjectEditResult);
                    toast(u.words);
                  })
                  .catch(showError),
            });
          }}
        />
      )}
      {exportOpen && <PortableExportDialog path={path} name={p.name} onClose={() => setExportOpen(false)} />}
      {/* The record form's host (5 Nov 2026, folio merge: Money's New bill opens a record form, and with no host
          on this page the click silently did nothing — the sweep's New bill died this way). */}
      <RecordFormHost />
    </EditorContext.Provider>
  );
}

/** A tab with nothing in it (t255): quiet words and its own Add, never hidden. Questions and Activity are
 *  derived or automatic, so they read with no Add. */
function TabEmpty({ id, ctx }: { id: FolioSection; ctx: TabsCtx }) {
  const { canEdit, edit } = useEditor();
  const picker = useRef<HTMLInputElement>(null);
  const title = PROJECT_TABS.find((t) => t.id === id)?.title ?? id;
  const starter = tabStarter(id);
  const words: Record<string, string> = {
    'whats-next': 'Nothing of yours is open.',
    waiting: 'Nothing with others.',
    questions: 'No open questions.',
    'key-dates': 'No key dates.',
    people: 'No one named yet.',
    decisions: 'No decisions yet.',
    notes: 'No notes or files yet.',
    risks: 'No risks named.',
    updates: 'No updates yet.',
    money: ctx.money.on ? 'No bills for this project yet.' : 'Bills are off.',
    activity: 'Nothing yet.',
  };
  return (
    <section className="pj-folio-sec" data-section={id} aria-label={title}>
      <div className="pj-folio-head">
        <h2>{title}</h2>
      </div>
      <p className="pj-faint">{words[id] ?? 'Nothing here yet.'}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {canEdit && starter && (
          <button type="button" className="btn pri" data-add={id} onClick={(e) => startSection(id, ctx, edit, e.currentTarget)}>
            {starter.label}
          </button>
        )}
        {/* The files half of the quiet Notes tab (t267): Choose while no folder is linked, Attach once
            one reads, the same doors as the list's head. */}
        {canEdit && id === 'notes' && needsFolderChoice(ctx) && (
          <button type="button" className="btn" data-add="files" title="Link a folder on this PC to this project" onClick={() => chooseProjectFolder(ctx)}>
            Choose its folder on this PC…
          </button>
        )}
        {canEdit && id === 'notes' && canAttachHere(ctx) && (
          <>
            <button type="button" className="btn" data-add="files" title="Attach files from this PC (copied into the project's folder)" onClick={() => picker.current?.click()}>
              Attach files
            </button>
            <input ref={picker} type="file" multiple hidden onChange={(e) => (e.target.files && void attachProjectFiles(ctx.path, e.target.files, () => ctx.refreshFiles()), (e.target.value = ''))} />
          </>
        )}
      </div>
    </section>
  );
}

/** The project's tags as small chips on the facts (each still taken off with its ×, new ones typed). */
function Tags({ tags, known }: { tags: string[]; known: string[] }) {
  const { canEdit, edit } = useEditor();
  const [adding, setAdding] = useState(false);
  if (!tags.length && !canEdit) return <span className="pj-faint">None yet</span>;
  const others = known.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => ({ value: t }));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <span key={t} className="minichip slate">
          #{t}
          {canEdit && (
            <button style={{ border: 0, background: 'none', cursor: 'pointer', padding: '0 0 0 2px', font: 'inherit', color: 'inherit' }} title={`Take off #${t}`} aria-label={`Take off #${t}`} onClick={() => void edit({ kind: 'tags', tags: tags.filter((x) => x !== t) })}>
              ✕
            </button>
          )}
        </span>
      ))}
      {canEdit &&
        (adding ? (
          <Inline
            autoEdit
            compact
            value=""
            label="New tag"
            placeholder="tag"
            maxLength={40}
            suggest={others}
            onDone={() => setAdding(false)}
            onSave={(t) => edit({ kind: 'tags', tags: [...tags, t.replace(/^#/, '')] })}
          />
        ) : (
          <button className="minichip blue" style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => setAdding(true)}>
            + add
          </button>
        ))}
    </span>
  );
}
