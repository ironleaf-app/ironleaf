// A note in a tab: its cover, icon and type, its title (type to rename; links follow), its fields, then the note itself
// in Live Preview, Source or Reading, with hover previews, links that open, tags that search, and Send to the former
// host app at the top.

import { noteFontCss } from '../lib/noteFont';
import { dictate, editorTarget } from '../lib/dictation';
import { dailyPageTitle, dailyTitleWords, hidesFirstLine, noteKindOf, stripRepeatHeading } from '../../../shared/notes-list';
import { displayTitle } from '../../../shared/markdown';
import { setNoteProp } from '../../../shared/views';
import { isProjectProps } from '../../../shared/project-file';
import { typeOfNote } from '../../../shared/note-types';
import { stripTitleHeading } from '../../../shared/note-page';
import { withSpeakerNames } from '../../../shared/meeting-speakers';
import { isPrivatePath } from '../../../shared/private';
import { ProjectPage } from './ProjectPage';
import { DocFactsLine } from '../components/DocFacts';
import { DocHead } from './DocHead';
import { noteFootFor } from '../editor/noteFoot';
import { NoteFoot } from '../components/NoteFoot';
import { TemplateLegend } from '../components/TemplateLegend';
import { refreshPreview } from '../editor/live-preview';
import { DOCS_FOLDER, isDocNote } from '../../../shared/doc-file';
import { setTableLineCell, tableLineCell } from '../../../shared/layouts';
import { setTaskBox } from '../../../shared/tasks';
import { MeetingActions } from './MeetingActions';
import { MeetingDecisions } from './MeetingDecisions';
import { MeetingQuestions } from './MeetingQuestions';
import { MeetingMinutes } from './MeetingMinutes';
import { MeetingRecorder } from './MeetingRecorder';
import { MeetingTop } from './meeting/MeetingTop';
import { noteEditorHost } from './note/editorHost';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from '@codemirror/view';
import { errorMessage } from '../lib/errors';
import { quietScroll } from '../lib/quietScroll';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { Icon } from '../components/Icon';
import type { MenuItem } from '../components/Menu';
import { PageError, PageLoading, Skel } from '../components/PageStates';
import { NoteFields } from '../components/NoteFields';
import { NotePageTop } from '../components/NotePageTop';
import { PageConnections } from '../components/PageConnections';
import { ReadingView } from '../components/ReadingView';
import { ShareButton } from '../components/ShareButton';
import { PublishedMark } from '../components/PublishedMark';
import { NoteEditor } from '../editor/NoteEditor';
import { headerFor } from '../editor/tabCache';
import type { EditorHost } from '../editor/setup';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { usePerson } from '../state/person';
import { editorFor, onReveal, setWorkspace, takeReveal } from '../state/layout';
import { useFit } from '../state/fit';
import { noteMenu } from '../state/menus';
import { openTypePage } from '../state/noteTypes';
import { requestSearch } from '../state/modals';
import { shareMenuItems } from '../state/share';
import { getState, prefs, showError, toast, useApp, usePrefs } from '../state/store';
import * as W from '../state/workspace';
import { ViewHeader } from './ViewHeader';
import { SaveNoticeBar } from './SaveNoticeBar';
import { SuggestionBar } from './SuggestionBar';
import { ContextRail, contextOpenNow } from './note/ContextRail';
import { DailyHead } from './note/DailyHead';
import { getNoteTypes } from '../state/noteTypes';
import { reviewSuggestions } from '../state/suggestions';
import '../styles/w2b.css';

/** A dated head without its stamp ("2026-11-05 Supplier call" → "Supplier call"): the file keeps its date,
 *  the head shows the words (5 Nov 2026, the plan: no raw ISO anywhere). Daily notes keep DailyHead. */
const ISO_HEAD = /^(\d{4})-(\d{2})-(\d{2})\s+(.+)$/;
const bareHead = (title: string) => {
  const m = ISO_HEAD.exec(title.trim());
  if (!m) return title;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? m[4] : title;
};
/** A renamed head with its stamp kept ("Supplier call" → "2026-11-05 Supplier call"): the date stays on the file. */
const keepHeadStamp = (title: string, next: string) => {
  const m = ISO_HEAD.exec(title.trim());
  return m && bareHead(title) !== title && !/^\d{4}-\d{2}-\d{2}\s+/.test(next.trim()) ? `${m[1]}-${m[2]}-${m[3]} ${next}` : next;
};

// The last note's words, kept across opens (t146, 9 Nov 2026): returning to a note re-read it over the
// bridge before the editor could mount. The same path at the same revision is the same words; the open
// below still runs and puts right anything that moved meanwhile. Typing keeps it live while mounted.
let keptText: { path: string; revision: number; text: string } | null = null;

function InlineTitle({ path, full, canEdit, autoFocus, onDone }: { path: string; full: string; canEdit: boolean; autoFocus: boolean; onDone(): void }) {
  const [value, setValue] = useState(() => bareHead(full));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(bareHead(full)), [path, full]);
  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    ref.current.focus();
    ref.current.select();
  }, [autoFocus]);
  // A note whose name lives in its `title:` (a meeting's colon, a copy number on the file) is renamed there, with
  // Undo; the file keeps its safe name. Any other note is renamed as a file, as before.
  const stored = full !== A.titleOf(path);
  const commit = async () => {
    const next = value.replace(/\s+/g, ' ').trim();
    const shown = bareHead(full);
    if (!next || next === shown) {
      setValue(shown);
      return;
    }
    if (stored) {
      const current = docs.text(path);
      if (current === undefined) {
        setValue(shown);
        return;
      }
      const made = setNoteProp(current, 'title', keepHeadStamp(full, next));
      if (made === current) {
        setValue(shown);
        return;
      }
      docs.update(path, made, 'rename');
      setValue(next);
      toast(`Renamed to “${next}”.`, {
        label: 'Undo',
        run: () => {
          if (docs.text(path) !== made) {
            toast('The note changed since, so nothing was undone.');
            return;
          }
          docs.update(path, current, 'undo-rename');
          setValue(shown);
          toast('Undone.');
        },
      });
      return;
    }
    if (/[\\/:*?"<>|]/.test(next)) {
      toast('A note’s name can’t have \\ / : * ? " < > or |.');
      setValue(shown);
      return;
    }
    const moved = await A.renamePath(path, keepHeadStamp(A.titleOf(path), next));
    if (!moved) setValue(shown);
  };
  return (
    <textarea
      ref={ref}
      className="inline-title"
      value={value}
      rows={1}
      spellCheck={false}
      readOnly={!canEdit}
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ''))}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          void commit().then(onDone);
        }
        if (e.key === 'Escape') {
          setValue(bareHead(full));
          onDone();
        }
      }}
    />
  );
}

export function NoteView({ tab, focused }: { tab: W.TabState; focused: boolean }) {
  const path = tab.path!;
  const prefsNow = usePrefs();
  const isProject = useApp((s) => isProjectProps(s.byPath.get(tab.path ?? '')?.props));
  // The note's own font and text size (the formatting bar's Aa menu; lib/noteFont.ts).
  const noteFont = useApp((s) => s.byPath.get(tab.path ?? '')?.props?.font);
  const noteSize = useApp((s) => s.byPath.get(tab.path ?? '')?.props?.['text size']);
  // A doc (src/shared/doc-file.ts): its head under the title, its summary and Changes styled, canvas actions at the top.
  const isDoc = useApp((s) => !!tab.path && isDocNote(tab.path, s.byPath.get(tab.path)?.props, DOCS_FOLDER));
  // A private note (src/main/private-notes.ts): nothing here sends it anywhere.
  const isPrivate = isPrivatePath(path);
  // A daily note (8.7 w2b): the mock-up's daily head instead of the file-name title. The file name stays the ISO
  // day; the head reads the day in words.
  const noteEntry = useApp((s) => s.byPath.get(path));
  const isDaily = useMemo(() => {
    const title = noteEntry?.title ?? A.titleOf(path);
    const typeId = noteEntry ? typeOfNote({ path, props: noteEntry.props }, getNoteTypes(), prefsNow.templatesFolder) : null;
    return noteKindOf({ path, title, typeId, props: noteEntry?.props }) === 'daily';
    // getNoteTypes reads the store outside React; the entry changing is the signal to resolve again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, noteEntry, prefsNow.templatesFolder]);
  const dailyWords = isDaily ? dailyPageTitle(A.titleOf(path)) || dailyTitleWords(A.titleOf(path)) : '';
  const mode = tab.mode === 'page' && !isProject ? prefsNow.defaultMode : (tab.mode ?? prefsNow.defaultMode);
  const canEdit = useApp((s) => s.canEdit);
  const [text, setText] = useState<string | null>(() => (keptText && keptText.path === path && keptText.revision === getState().revision ? keptText.text : null));
  // Whether the context rail is open (5 Nov 2026): a doc's head shows On this page and tags only while shut.
  const [railOpen, setRailOpen] = useState<boolean>(() => contextOpenNow());
  // The rail stands beside the note only while the right side is not docked (t22-note-once, 8 Nov 2026, the :
  // the side carries the outline and tags when open, the rail when shut, never both; on a window too narrow
  // to dock the side, the rail is what is there).
  const railVisible = useFit().right !== 'docked';
  // The shared loading and error states (8.7 wave 2 round 3; the note-loading and note-error mock-ups): a failed
  // open says what happened with a way back, instead of a toast over a note that never arrives.
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [addKey, setAddKey] = useState(0);
  const [dictateSaid, setDictateSaid] = useState<string | null>(null);
  const header = useMemo(() => headerFor(tab.id, path), [tab.id, path]);
  // One mounting of this note's page (t146): the kept editor state is shared across mountings, and a return
  // starts fresh (top of the note, cursor, undo) as before — the token tells a return from a mode switch.
  const mount = useMemo(() => ({}), []);
  const titleFocus = useMemo(() => A.takeTitleFocus(path), [path]);
  const readingScroll = useRef<HTMLDivElement>(null);
  // Reading's scrollbar stays quiet until hovered or scrolling (lib/quietScroll.ts); the editor marks its
  // own scroller (editor/NoteEditor.tsx), so every view of a note and a doc behaves the one way.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the scroller element changes with the mode
  useEffect(() => quietScroll(readingScroll.current), [mode, path]);

  // The note's text for the title, properties, Reading mode and the outline (shared with the editor).
  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    const r0 = getState().revision;
    // The kept words stand until the open below confirms them; another note starts unopened, as before.
    if (!keptText || keptText.path !== path || keptText.revision !== r0) setText(null);
    setFailed(null);
    void docs
      .acquire(path)
      .then((t) => {
        if (!alive) {
          docs.release(path);
          return;
        }
        if (getState().revision === r0) keptText = { path, revision: r0, text: t };
        setText(t);
        // Coalesced (fnv3 F25): the editor is the source of truth while typing, so the page around it
        // re-reads the text at most a few times a second instead of on every keystroke.
        let pending: string | null = null;
        let frame = 0;
        unsubscribe = docs.subscribe(path, (next) => {
          if (keptText && keptText.path === path) keptText.text = next;
          pending = next;
          if (frame) return;
          frame = requestAnimationFrame(() => { frame = 0; if (pending !== null) { setText(pending); pending = null; } });
        });
        const keepUnsubscribe = unsubscribe;
        unsubscribe = () => { if (frame) cancelAnimationFrame(frame); keepUnsubscribe(); };
      })
      .catch((err: unknown) => {
        // Why it wouldn't open, in plain words (F7: too big says so itself); the way back stays below.
        if (alive) setFailed(errorMessage(err));
      });
    return () => {
      alive = false;
      unsubscribe();
      docs.release(path);
    };
  }, [path, attempt]);

  useEffect(() => {
    const onAdd = (e: Event) => {
      if ((e as CustomEvent).detail === tab.id) setAddKey((k) => k + 1);
    };
    window.addEventListener('nv-add-property', onAdd);
    return () => window.removeEventListener('nv-add-property', onAdd);
  }, [tab.id]);

  /** A change from the title area or properties: through the editor when it is open (so Ctrl+Z undoes it). */
  const applyText = useCallback(
    (next: string) => {
      const view = editorFor(tab.id)?.view();
      if (view) {
        const current = view.state.doc.toString();
        let start = 0;
        while (start < current.length && start < next.length && current[start] === next[start]) start++;
        let endA = current.length;
        let endB = next.length;
        while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) {
          endA--;
          endB--;
        }
        view.dispatch({ changes: { from: start, to: endA, insert: next.slice(start, endB) }, userEvent: 'input.properties' });
      } else docs.update(path, next, 'properties');
    },
    [path, tab.id],
  );

  const openLink = useCallback((target: string, newTab: boolean) => void A.openLink(target, path, newTab ? 'tab' : 'current'), [path]);
  const openTag = useCallback((tag: string) => {
    requestSearch(`tag:#${tag}`);
  }, []);

  // One editor host for every note (10.0 papercuts: the daily note the same everywhere): the tab and the day's
  // note on Today open links, tags, pictures and files the same way.
  const callbacks = useMemo<Omit<EditorHost, 'path' | 'version' | 'onChange'>>(() => noteEditorHost(path), [path]);

  const toggleTask = useCallback(
    (line: number) => {
      const current = docs.text(path);
      if (current === undefined || !canEdit) return;
      const lines = current.split('\n');
      const l = lines[line];
      if (l === undefined) return;
      // Only the box moves; the words, owner and date stay as written (src/shared/tasks.ts setTaskBox).
      const next = setTaskBox(l, /^\s*(?:[-*+]|\d+[.)])\s+\[ \]/.test(l));
      if (next === l) return;
      lines[line] = next;
      docs.update(path, lines.join('\n'), 'reading');
    },
    [path, canEdit],
  );

  /** A Reading table cell's words as written, for its field (null when the cell has no source line to write). */
  const readTableCell = useCallback(
    (line: number, col: number): string | null => {
      if (!canEdit) return null;
      const current = docs.text(path);
      if (current === undefined) return null;
      const l = current.split('\n')[line];
      return l === undefined ? null : tableLineCell(l, col);
    },
    [path, canEdit],
  );

  /** A Reading table cell saved: spliced into its source line (pipes and padding kept), said once, with Undo. */
  const saveTableCell = useCallback(
    (line: number, col: number, value: string): boolean => {
      const current = docs.text(path);
      if (current === undefined || !canEdit) return false;
      const lines = current.split('\n');
      const l = lines[line];
      if (l === undefined || tableLineCell(l, col) === null) {
        showError(new Error('That cell cannot be changed here.'));
        return false;
      }
      lines[line] = setTableLineCell(l, col, value);
      const next = lines.join('\n');
      if (next === current) return true;
      // The column and row as the table names them, for the message ("Changed Status of Stalls.").
      let start = line;
      while (start > 0 && tableLineCell(lines[start - 1] ?? '', 0) !== null) start--;
      const head = tableLineCell(lines[start] ?? '', col) || 'the table';
      const name = tableLineCell(lines[line] ?? '', 0);
      docs.update(path, next, 'reading-table');
      toast(value.trim() ? `Changed ${head} of ${name || 'the row'}.` : `Emptied ${head} of ${name || 'the row'}.`, {
        label: 'Undo',
        run: () => {
          if (docs.text(path) !== next) toast('The note changed since, so nothing was undone.');
          else docs.update(path, current, 'reading-table-undo');
        },
      });
      return true;
    },
    [path, canEdit],
  );

  // The editor places the doc's head under its title; it is drawn again when the note becomes (or stops being) a doc.
  useEffect(() => {
    editorFor(tab.id)?.view()?.dispatch({ effects: refreshPreview.of(null) });
  }, [isDoc, tab.id, text === null]);
  const jumpLive = (line: number) => {
    const view = editorFor(tab.id)?.view();
    if (!view) return;
    const l = view.state.doc.line(Math.min(Math.max(line + 1, 1), view.state.doc.lines));
    view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 28 }) });
    // Lines not drawn yet are guessed at: once they are measured, once more so it lands exactly.
    requestAnimationFrame(() => requestAnimationFrame(() => view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 28 }) })));
  };
  /** The context rail's tasks jump to their line: in the editor, or the drawn line in Reading. */
  // Steady (t102, 9 Nov 2026): the rail's rows skip re-rendering while typing, which needs a steady jump.
  const jumpRail = useCallback(
    (line: number) => {
      if (mode === 'reading') readingScroll.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else jumpLive(line);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, tab.id],
  );
  const jumpReading = (heading: string) => {
    const box = readingScroll.current;
    const el = box ? [...box.querySelectorAll('h1, h2, h3')].find((h) => h.textContent?.trim().toLowerCase() === heading.trim().toLowerCase()) : null;
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  // A link to a named section goes there in Reading too (a5 doors, 6 Nov 2026: the tab keeps its mode, so a
  // heading link followed while reading opened in Reading and sat at the top — only the editor took its
  // reveal). A line lands on its drawn line, as the context rail's jumps do; at once, not gliding in.
  const jumpRevealReading = useCallback(() => {
    const where = takeReveal(path);
    if (!where) return;
    requestAnimationFrame(() => {
      if (where.heading) {
        const box = readingScroll.current;
        const el = box ? [...box.querySelectorAll('h1, h2, h3')].find((h) => h.textContent?.trim().toLowerCase() === where.heading!.trim().toLowerCase()) : null;
        el?.scrollIntoView({ block: 'start' });
      } else if (where.line !== undefined) {
        readingScroll.current?.querySelector(`[data-line="${where.line}"]`)?.scrollIntoView({ block: 'start' });
      }
    });
  }, [path]);
  // Which note the shown text belongs to: on the commit where the path changes the text is still the
  // previous note's (its null comes next), and jumping then would spend the reveal on the old headings.
  const textPath = useRef(path);
  useEffect(() => {
    if (mode !== 'reading') return;
    if (text === null) {
      textPath.current = path;
      return;
    }
    if (textPath.current !== path) return;
    jumpRevealReading();
  }, [mode, text, path, jumpRevealReading]);
  useEffect(() => {
    if (mode !== 'reading') return;
    // A section asked for in the note already open (a link to its own heading): gone to now, as the editor is.
    return onReveal((p) => {
      if (p === path) jumpRevealReading();
    });
  }, [mode, path, jumpRevealReading]);
  // Reading mode: a doc's Changes heading and what follows it are marked, to read as a quiet dated list.
  useEffect(() => {
    if (!isDoc || mode !== 'reading') return;
    const id = requestAnimationFrame(() => {
      const body = readingScroll.current?.querySelector('.reading-body');
      if (!body) return;
      let inChanges = false;
      for (const el of [...body.children]) {
        if (el.tagName === 'H2' || el.tagName === 'H1') inChanges = /^(changes|change log|changelog|history)$/i.test(el.textContent?.trim() ?? '');
        el.classList.toggle('doc-changes-head', inChanges && el.tagName === 'H2');
        el.classList.toggle('doc-changes', inChanges && el.tagName !== 'H2');
      }
    });
    return () => cancelAnimationFrame(id);
  }, [isDoc, mode, text]);
  // The foot: what links here, mentions it, or is like it (components/NoteFoot.tsx), after the last line in every mode.
  // A template shows what it can say first (components/TemplateLegend.tsx): the variables are used here, in the editor.
  const templatesFolder = prefsNow.templatesFolder?.trim() ?? '';
  const isTemplate = !!templatesFolder && (path === templatesFolder || path.startsWith(`${templatesFolder}/`));
  const foot = text !== null ? <div className="note-foot-wrap">{isTemplate && <TemplateLegend />}<NoteFoot path={path} onOpen={(p, line, newTab) => A.openPath(p, { line, where: newTab ? 'tab' : 'current' })} /></div> : null;
  // A note whose body starts with a heading that only repeats its title keeps the heading in the file while the view
  // hides that first line (round 2 for the daily note, round 4 for any note). A doc whose heading hides shows its
  // title in its head instead (t239, critic 3 F7: a document opens with its title, in every mode).
  const headShown = bareHead(A.titleOf(path));
  const hideFirst = text !== null && (hidesFirstLine(text, A.titleOf(path)) || hidesFirstLine(text, headShown));
  const docHead = isDoc && text !== null ? <DocHead path={path} text={text} canEdit={canEdit && mode !== 'reading'} withTitle={mode === 'reading' || hideFirst} railOpen={railVisible ? railOpen : true} onChangeText={applyText} onJump={(line, heading) => (mode === 'reading' ? jumpReading(heading) : jumpLive(line))} onTag={openTag} /> : null;

  // A document's kind for its facts line (t239): contracts, quotes and orders always show it, so the status is one
  // click away; any other note shows it once it carries facts or joins a chain.
  const docType = String(noteEntry?.props?.type ?? '').trim().toLowerCase();
  const docKindWord = docType === 'contract' ? 'Contract' : docType === 'quote' ? 'Quote' : docType === 'order' ? 'Order' : 'Note';
  const docKindPlain = docType === 'contract' || docType === 'quote' || docType === 'order';
  // A doc's head reads above its body in every mode but Source (t239, critic 3 F7: a document opens with its
  // title — the editor portal it used in Live Preview never attached, so nothing showed).
  const head = text !== null && isDoc ? (mode === 'source' ? null : <div className={`note-head${prefsNow.readableWidth ? ' readable' : ''}`}>{docHead}</div>) : text !== null && (
    <div className={`note-head${prefsNow.readableWidth ? ' readable' : ''}${isDaily ? ' w2b-is-daily' : ''}`}>
      {/* The page's top (components/NotePageTop.tsx): cover, icon and type, above the title; Reading shows it too. */}
      {mode !== 'source' && <NotePageTop path={path} text={text} canEdit={canEdit && mode !== 'reading'} onChange={applyText} />}
      {dailyWords ? <DailyHead title={A.titleOf(path)} /> : prefsNow.inlineTitle && <InlineTitle path={path} full={displayTitle(path, (noteEntry?.props ?? {}) as Record<string, unknown>)} canEdit={canEdit} autoFocus={titleFocus && focused} onDone={() => editorFor(tab.id)?.focus()} />}
      {/* A document's facts (components/DocFacts.tsx): version, status and signer, at the top. */}
      {mode !== 'source' && !isProject && <DocFactsLine path={path} text={text} kind={docKindWord} canEdit={canEdit && mode !== 'reading'} showWhenPlain={docKindPlain} onChangeText={applyText} />}
      {/* The fields as quiet rows (components/NoteFields.tsx); Source mode, and "As text", show them as the YAML they are. */}
      {mode !== 'source' && prefsNow.propertiesShow === 'shown' && <NoteFields path={path} text={text} readOnly={!canEdit || mode === 'reading'} onChange={applyText} onOpenTag={openTag} onOpenLink={openLink} addKey={addKey} />}
      {/* A person's meetings and projects, a meeting's people (components/PageConnections.tsx). */}
      {mode !== 'source' && <PageConnections path={path} onOpen={(p, newTab) => A.openPath(p, { where: newTab ? 'tab' : 'current' })} onOpenLink={openLink} />}
      {mode !== 'source' && !isProject && !isPrivate && <MeetingTop path={path} canEdit={canEdit} />}
      {/* Record meeting, in a meeting note (views/MeetingRecorder.tsx): the recording, then its notes. */}
      {mode !== 'source' && !isProject && !isPrivate && <MeetingRecorder path={path} canEdit={canEdit} />}
      {/* Minutes ready to send (views/MeetingMinutes.tsx): made from the transcript, checked, then the PDF. */}
      {mode !== 'source' && !isProject && !isPrivate && <MeetingMinutes path={path} text={text} canEdit={canEdit} onChangeText={applyText} />}
      {/* A meeting's Tasks, Decisions and Questions (t248, 12 Nov 2026: the note is the meeting). */}
      {mode !== 'source' && !isProject && <MeetingActions path={path} text={text} canEdit={canEdit} />}
      {mode !== 'source' && !isProject && <MeetingDecisions path={path} text={text} canEdit={canEdit} />}
      {mode !== 'source' && !isProject && <MeetingQuestions path={path} text={text} canEdit={canEdit} />}
    </div>
  );

  // A meeting's named voices read in their names (6 Nov 2026: the Summary still said "Speaker 1/2" after naming);
  // the file keeps its labels, so this changes nothing on disk and no line moves. Read once per text, not once
  // per render, and only for Reading (t102, 9 Nov 2026): every keystroke stripped the whole note's headings,
  // though only Reading shows them. The microphone reads as (t301, 18 Nov 2026).
  const me = usePerson();
  const readingText = useMemo(
    () =>
      mode !== 'reading'
        ? ''
        : withSpeakerNames(text === null ? '' : isDoc ? text.replace(/^((?:---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n)?\s*)#[ \t]+[^\n]*/, '$1') : isDaily && dailyWords ? stripRepeatHeading(text, A.titleOf(path)) : stripTitleHeading(stripTitleHeading(text, A.titleOf(path)), headShown), me ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, text, isDoc, isDaily, dailyWords, path, headShown, me],
  );
  // The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search): the
  // ⋯ menu carries exactly the page buttons the bar hid, in their own order. The header holds Share, Read and
  // the Private mark only (5 Nov 2026, the clean header: Publish, Yesterday/Tomorrow, Project page, the canvas
  // pair, Send and Dictate live in the ⋯ menu itself now). Rows the menu already reaches in its own words stay
  // null (never two rows for one job): the read toggle (Reading, Live Preview and Source switch modes).
  // Round 3: Share yields last (the page's most used action).
  const noteOverflowMenu = (): MenuItem[] => {
    const over = overflowMenuItems(headerOverflowHidden(tab.id), {
      'share': () => ({ label: 'Share', submenu: shareMenuItems(path) }),
      'private': () => ({ label: 'Private note: encrypted, opened only here', icon: 'lock', disabled: true }),
      'read': null,
    });
    const rest = noteMenu(tab);
    return over.length ? [...over, { separator: true } as const, ...rest] : rest;
  };
  return (
    <div className={`note-view w2b-note mode-${mode}${prefsNow.readableWidth ? ' readable' : ''}${isDoc ? ' is-doc' : ''}${hideFirst ? ' w2b-hide-first' : ''}`} style={{ ['--note-size' as string]: `${typeof noteSize === 'number' && noteSize >= 10 && noteSize <= 40 ? noteSize : prefsNow.fontSize}px`, ...(noteFontCss(noteFont) ? { ['--font-text' as string]: noteFontCss(noteFont)!, ['--font-serif' as string]: noteFontCss(noteFont)! } : {}) }}>
      {mode === 'page' ? (
        // The project draws its own top bar (its tab's primary action and ⋯): NoteView only hosts it.
        <ProjectPage path={path} tab={tab} />
      ) : (
      <>
      {/* The bar keeps the folders; the title below keeps the name (t7-note-window, 8 Nov 2026: never the
          name twice). Source mode shows no title below, so the bar keeps the name there. */}
      <ViewHeader tab={tab} menu={noteOverflowMenu} title={noteEntry?.title ?? A.titleOf(path)} hideName={mode !== 'source' && (!!dailyWords || prefsNow.inlineTitle)}>
        {isPrivate && (
          <span className="view-private" data-overflow="private" data-overflow-order={5} title="A private note: encrypted, and opened only here (not by search, the graph, the assistant or any other app)">
            <Icon name="lock" size={13} />
            <span>Private</span>
          </span>
        )}
        {/* Dictating now (5 Nov 2026, the clean header: the microphone left for the ⋯ menu, but while
            recording its stop stays one click away, with the words being heard). */}
        {dictateSaid && (
          <>
            <button
              className="icon-button"
              title={dictateSaid}
              aria-label={`Dictating: ${dictateSaid}. Press to stop.`}
              aria-pressed={true}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const editor = editorFor(tab.id);
                if (!editor) return;
                void dictate(editorTarget(() => editor.view(), () => editor.focus()), setDictateSaid, undefined, isPrivate ? { windowsOnly: true } : undefined);
              }}
            >
              <Icon name="mic" size={16} />
            </button>
            <span className="dictate-words" role="status">
              {dictateSaid}
            </span>
          </>
        )}
        {!isPrivate && <ShareButton path={path} overflow="share" overflowOrder={11} />}
        <button
          className="icon-button"
          data-overflow="read"
          data-overflow-order={10}
          title={mode === 'reading' ? 'Edit (Ctrl+E)' : 'Read (Ctrl+E)'}
          onClick={() => setWorkspace((ws) => W.updateTab(ws, tab.id, { mode: mode === 'reading' ? (prefs().defaultMode === 'reading' ? 'live' : prefs().defaultMode) : 'reading' }))}
        >
          <Icon name={mode === 'reading' ? 'pencil' : 'book'} size={16} />
        </button>
      </ViewHeader>
      {/* The assistant's suggested changes waiting in this note (state/suggestions.ts). */}
      {!isPrivate && <SuggestionBar path={path} reading={mode === 'reading'} canEdit={canEdit} onReview={() => void reviewSuggestions(path)} />}
      {/* A save that couldn't land as usual (changed or gone elsewhere): both kept, the choice here. */}
      <SaveNoticeBar path={path} tabId={tab.id} />
      {/* Published (9.0 w122publish): the sites this page is in, with a link and unpublish. */}
      {!isPrivate && <PublishedMark path={path} />}
      <div className="nv-note-layout">
        <div className="nv-note-main">
          {text === null ? (
            <div style={{ padding: '24px 56px 48px', maxWidth: 880, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
              {failed ? (
                <PageError
                  title="This note couldn’t be opened"
                  explainer={failed}
                  retry={() => setAttempt((a) => a + 1)}
                  back={{ label: 'Back to Notes', run: () => openTypePage('note') }}
                />
              ) : (
                <PageLoading label="Opening the note…">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Skel w={40} h={40} r={10} />
                    <Skel w="min(300px, 60%)" h={34} r={10} />
                  </div>
                  <div style={{ margin: '10px 0 0 54px' }}>
                    <Skel w="min(240px, 55%)" h={15} />
                  </div>
                  <div style={{ margin: '18px 0 0 54px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Skel w="min(260px, 60%)" h={14} />
                    <Skel w="min(200px, 50%)" h={14} />
                    <Skel w="min(230px, 55%)" h={14} />
                  </div>
                  <div style={{ margin: '26px 0 0 54px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Skel w="100%" h={15} />
                    <Skel w="100%" h={15} />
                    <Skel w="70%" h={15} />
                    <Skel w="min(220px, 55%)" h={20} />
                    <Skel w="100%" h={15} />
                    <Skel w="85%" h={15} />
                    <Skel w="100%" h={64} r={10} />
                  </div>
                </PageLoading>
              )}
            </div>
          ) : mode === 'reading' ? (
            <ReadingView text={readingText} path={path} header={head} footer={foot} onOpenLink={openLink} onOpenTag={openTag} onToggleTask={toggleTask} onEditTableCell={readTableCell} onSaveTableCell={saveTableCell} scrollRef={readingScroll} className={prefsNow.readableWidth ? 'readable' : ''} />
          ) : (
            <>
              <NoteEditor key={path} tabId={tab.id} path={path} mode={mode === 'source' ? 'source' : 'live'} header={header} mount={mount} canEdit={canEdit} focusOnOpen={focused && !titleFocus} callbacks={callbacks} />
              {head && createPortal(head, header)}
              {foot && createPortal(foot, noteFootFor(tab.id))}
            </>
          )}
        </div>
        {/* The note's context rail (views/note/ContextRail.tsx): a note stands with the slim strip (round 4, the
            mock-up's On this page / Tags; daily notes stand alone, round 2), and Context opens only when asked,
            from the strip or the View menu. Only while the right side is shut (t22-note-once): open, the side
            carries the outline and tags instead, so each reads once. */}
        {text !== null && !isPrivate && railVisible && <ContextRail path={path} text={text} canEdit={canEdit} onChangeText={applyText} onOpen={(p, newTab) => A.openPath(p, { where: newTab ? 'tab' : 'current' })} onJump={jumpRail} onToggleTask={toggleTask} onTag={openTag} strip={!isDaily} isDoc={isDoc} onOpenChange={setRailOpen} />}
      </div>
      </>
      )}
    </div>
  );
}
