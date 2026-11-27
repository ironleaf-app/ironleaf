import { openMeetingPassage } from '../views/meeting/openMeetingPassage';
// Chat with your notes (the Neural part), on the person's own AI connections (switch model from here), about all notes or just the
// open one. The assistant works with tools (src/main/agent.ts): it looks through the notes before answering, makes and
// changes notes when asked, and reads folders on this PC the person names or adds. Its steps show as it works, and what
// an answer changed can be undone in one click. Each answer can be copied, put into the note, or kept as a note.

import { isPrivatePath } from '../../../shared/private';
import { isProjectProps } from '../../../shared/project-file';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { ChatStep, ModelsView } from '../../../shared/types';
import { foldSteps, stepWords } from '../../../shared/chat-steps';
import { hydrate } from '../lib/hydrate';
import { ASK_SETUP, changeWords, citeAnswer, suggestQuestions } from '../../../shared/search-ask-87';
import { AiSetup } from '../components/AiSetup';
import { fileIcon, Icon, type IconName } from '../components/Icon';
import { formatDate } from '../../../shared/dates';
import { answerHtml } from '../lib/citedAnswer';
import { openMenu, type MenuItem } from '../components/Menu';
import { renderMarkdown, wikilinkFromClick } from '../lib/markdownRender';
import { useSmoothText } from '../lib/smoothText';
import { openProjectFileLink } from '../state/fileSearch';
import { FolderCards } from './ChatFolders';
import * as A from '../state/actions';
import { acceptAllProposals, acceptProposal, addChatFolder, attachFiles, clearChat, dismissProposal, onChatDraft, removeAttachment, removeChatFolder, retryChat, sendChat, setChatScope, setUpProjectsFromFolder, showChanges, stopChat, undoAnswer, undoProposal, useChat, type ChatMessage } from '../state/chat';
import { splitAskScope, splitScopeFor, splitScopeWords } from '../../../shared/split-focus';
import { chatWithheldWords, splitSaveFolder } from '../../../shared/chat-context';
import { useSplitFocus } from '../state/splitFocus';
import type { ChatAttachment } from '../../../shared/types';
import { sizeWords } from '../lib/attach';
import { editorFor, getWorkspace } from '../state/layout';
import { findTab } from '../state/workspace';
import { reviewSuggestions, useSuggestions } from '../state/suggestions';
import { chatModelWords } from '../lib/assistantWords';
import { dictate, fieldTarget } from '../lib/dictation';
import { openModal } from '../state/modals';
import { getState, loadNotes, loadSettings, setState, showError, toast, useApp, usePrefs } from '../state/store';
import { openPassage } from '../state/notebook';
import type { TabState } from '../state/workspace';
import { priorUserText } from '../components/plan/plan';
import { isEnterKey } from '../lib/enterKey';
import '../styles/search-ask-87.css';

/** An answer's words, with its cited passages and links (4 Nov 2026, p9-one-ask: the floating Ask card is gone, so only the panel shows it). */
export function Answer({ message, onOpenLink }: { message: ChatMessage; onOpenLink(target: string, newTab: boolean): void }) {
  // Drawn again when notes change: links to notes the answer itself made are found once they're listed.
  const notes = useApp((s) => s.notes);
  // While the reply streams, bursts ease in over frames instead of landing a line at a time (5 Nov 2026 feel-motion,
  // lib/smoothText.ts); a finished answer shows whole.
  const shown = useSmoothText(message.content, !!message.pending);
  const body = useRef<HTMLDivElement>(null);
  const cited = message.citations?.length ? message.citations : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the notes decide which links are found
  const html = useMemo(() => {
    if (cited) return answerHtml(shown, cited);
    const md = renderMarkdown(shown, {});
    const titles = message.sources?.map((s) => s.title) ?? [];
    // Numbered chips on links to the answer's own sources (the mock-up's inline citations).
    return titles.length ? citeAnswer(md, titles) : md;
  }, [shown, cited, message.sources, notes]);
  // Charts, diagrams and embeds in answers draw like the reading view (5 Nov 2026, v8-vault-assistant: chart blocks
  // showed as blank space — the panel never hydrated them).
  useEffect(() => {
    if (body.current) void hydrate(body.current);
  }, [html]);
  return (
    <div
      ref={body}
      className="markdown chat-answer"
      onClick={(e) => {
        // A cited passage's chip opens where it came from (answers over ticked sources).
        const chip = (e.target as HTMLElement | null)?.closest?.('.nb-chip')?.getAttribute('data-cite');
        if (chip && cited) {
          const c = cited.find((x) => x.n === Number(chip));
          if (c) openPassage(c);
          return;
        }
        const file = (e.target as HTMLElement | null)?.closest?.('a.project-file-link')?.getAttribute('data-file');
        if (file) {
          e.preventDefault();
          void openProjectFileLink(file);
          return;
        }
        const target = wikilinkFromClick(e);
        if (target !== null) {
          e.preventDefault();
          onOpenLink(target, e.ctrlKey || e.metaKey);
        }
      }}
      // Rendered with raw HTML switched off (markdownRender.ts).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const STEP_ICON: Record<ChatStep['kind'], IconName> = { say: 'chat', search: 'search', read: 'file', list: 'folder', write: 'pencil', move: 'merge', pc: 'folderOpen', error: 'warning' };

/** What the assistant did: live while it works (the newest last), then folded into one line to open. */
export function Steps({ steps, pending, onOpen }: { steps: ChatStep[]; pending: boolean; onOpen(path: string, newTab: boolean): void }) {
  const [open, setOpen] = useState(false);
  // Thinking aloud shows live only; a finished answer drops it (5 Nov 2026, v8-vault-assistant: "Let me check…" read
  // above every finished answer, the most mechanical surface in the panel).
  const shown = pending ? steps.filter((s) => s.kind !== 'say' || s.words) : steps.filter((s) => s.kind !== 'say');
  if (!shown.length) return null;
  const rows = (list: ChatStep[], live: boolean) =>
    list.map((s, i) => (
      <div key={i} className={`chat-step kind-${s.kind}${live && i === list.length - 1 ? ' is-working' : ''}`}>
        <Icon name={STEP_ICON[s.kind]} size={12} />
        {s.path && s.kind !== 'say' ? (
          <button className="chat-step-words link" title={s.path} onClick={(e) => onOpen(s.path!, e.ctrlKey || e.metaKey)}>
            {stepWords(s)}
          </button>
        ) : (
          <span className="chat-step-words">{stepWords(s)}</span>
        )}
      </div>
    ));
  if (pending) return <div className="chat-steps live">{rows(shown.slice(-8), true)}</div>;
  // Folded to what was read ("Read 3 notes", "2 searches · 2 reads"), never a bare count hiding the evidence.
  const folded = foldSteps(shown);
  return (
    <div className="chat-steps">
      <button className="chat-steps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={open ? 'Fold the steps away' : 'Show every step'}>
        <Icon name="chevron" size={11} className={open ? 'open' : ''} />
        {/* Folded words in their own span (4 Nov 2026, p15-chat-panel: as anonymous flex text a long line
            overflowed the 22px button up over the head and down over the answer; the span clips without dots,
            the whole opened by the toggle). */}
        <span className="chat-steps-folded">{folded}</span>
      </button>
      {open && rows(shown, false)}
    </div>
  );
}

/** The proposals' head in true words (9.2 uplift F94): distinct projects, never proposal rows. */
export function proposalHead(list: { path: string; name: string }[]): string {
  if (list.length === 1) return 'A change to accept';
  const projects = [...new Map(list.map((p) => [p.path, p.name])).values()];
  return projects.length === 1 ? `Changes to ${projects[0]} to accept` : `Changes to ${projects.length} projects to accept`;
}

/** Changes to projects the assistant proposes (Catch up): what would change in each, to accept or not. */
export function Proposals({ message, onOpen }: { message: ChatMessage; onOpen(path: string, newTab: boolean): void }) {
  const list = message.proposals;
  if (!list?.length) return null;
  const open = list.filter((p) => !p.state).length;
  return (
    <div className="chat-proposals">
      <div className="chat-changes-head">
        <Icon name="refresh" size={13} />
        <span>{proposalHead(list)}</span>
        {message.changeSetId && (
          <button className="chat-action" title="Review every file before and after, in one place" onClick={() => A.openChanges(message.changeSetId)}>
            Review as one set
          </button>
        )}
        {open > 1 && (
          <button className="chat-action" onClick={() => void acceptAllProposals(message.id)}>
            <Icon name="check" size={12} /> Accept all
          </button>
        )}
      </div>
      {list.map((p) => (
        <div key={p.id} className={`chat-proposal${p.state ? ` is-${p.state}` : ''}`}>
          <div className="chat-proposal-top">
            <button className="chat-proposal-name" title={p.path} onClick={(e) => onOpen(p.path, e.ctrlKey || e.metaKey)}>
              {p.name}
            </button>
            <span className="chat-proposal-space" />
            {!p.state ? (
              <>
                <button className="chat-proposal-button primary" onClick={() => void acceptProposal(message.id, p.id)}>
                  Accept
                </button>
                <button className="chat-proposal-button" onClick={() => dismissProposal(message.id, p.id)}>
                  Not now
                </button>
              </>
            ) : (
              <>
                <span className="chat-proposal-state" title={p.words}>
                  {p.state === 'accepted' ? 'Accepted' : p.state === 'dismissed' ? 'Not now' : p.state === 'undone' ? 'Put back' : p.words}
                </span>
                {p.state === 'accepted' && p.turnId && (
                  <button className="chat-action" title="Put the project back as it was" onClick={() => void undoProposal(message.id, p.id)}>
                    <Icon name="undo" size={12} /> Undo
                  </button>
                )}
              </>
            )}
          </div>
          <ul className="chat-proposal-changes">
            {p.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** One note the answer suggested changes in: how many, and Review (the note opens at its first change). Once the person
 *  has kept or discarded them all, the card says so quietly. */
function SuggestedNote({ path, count }: { path: string; count: number }) {
  const entry = useSuggestions(path);
  // Unknown until the suggestion events land (9.2 uplift F159): the answer only just arrived, so waiting —
  // never the done state with the snapshot count.
  const waiting = entry ? entry.hunks.length : count;
  const done = entry !== undefined && waiting === 0;
  const n = waiting || count;
  return (
    <div className={`chat-changes chat-suggested${done ? ' is-done' : ''}`}>
      <div className="chat-changes-head">
        <Icon name={done ? 'check' : 'pencil'} size={13} />
        <span>
          Suggested {n === 1 ? '1 change' : `${n} changes`} in{' '}
          <button className="chat-suggested-note" title={path} onClick={() => void reviewSuggestions(path)}>
            {A.titleOf(path)}
          </button>
          {done && <span className="chat-suggested-done"> · nothing waiting now</span>}
        </span>
        {waiting > 0 && (
          <button className="chat-action chat-suggested-review" title="Open the note at the first change, to keep or discard each one" onClick={() => void reviewSuggestions(path)}>
            Review <Icon name="forward" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Suggested({ message }: { message: ChatMessage }) {
  if (!message.suggested?.length) return null;
  return (
    <>
      {message.suggested.map((s) => (
        <SuggestedNote key={s.path} path={s.path} count={s.count} />
      ))}
    </>
  );
}

/** The ticked-sources footnote its own helper (9.5 polished; 4 Nov 2026, p9-one-ask: the float is gone, so only
 *  the side chat reads it): the "about the ticked sources" line in one place. Names the folder's tail, never the raw path. */
export function scopeNoteWords(chosenFolder: string | undefined): string {
  return `about the ticked sources${chosenFolder ? ` in ${chosenFolder.split('/').pop()}` : ''}`;
}

/** An answer put into the open note at the cursor, from either surface (9.2 uplift F96): one shared message that
 *  names the deed, never the editor's mode names — plus a button that opens the note when one is on show. */
export function insertAnswerIntoNote(tabId: string, text: string): void {
  const ed = editorFor(tabId);
  if (!ed) {
    const path = findTab(getWorkspace(), tabId)?.tab.path;
    toast('Open the note to edit first, then put the answer in it.', path ? { label: 'Open the note', run: () => A.openPath(path, { where: 'current' }) } : undefined);
    return;
  }
  ed.insertAtCursor(`\n${text.trim()}\n`);
  toast('Put into the note at the cursor.');
}

/** Answers already kept as notes this run (the question plus the answer): saving twice opens the note it just made. */
const keptAnswers = new Map<string, string>();

/** An answer kept as a note, from either surface (9.2 uplift F32, F97): found first — saving twice opens the note
 *  it just made instead of keeping a second. A different answer to the same question keeps its own note with the
 *  time in its name. The footer is a plain dateline, never a product stamp. `inFolder` pins the folder (one product
 *  step 5 part 4: Save as note from a chat answer lands in the folder in view); otherwise new notes go where set. */
export async function saveAnswerAsNote(answer: string, question: string, notes: { path: string; title: string }[], inFolder?: string): Promise<string | null> {
  try {
    const key = `${question.trim()}\n${answer.trim()}`;
    const prior = keptAnswers.get(key);
    if (prior && notes.some((n) => n.path === prior)) {
      toast(`Already kept as “${A.titleOf(prior)}”.`, { label: 'Open', run: () => A.openPath(prior, { where: 'tab' }) });
      return prior;
    }
    const base = question.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Answer';
    const folder = inFolder ?? A.newNoteFolder();
    // Found first, across restarts too (W5-10): the note already keeping this answer opens instead.
    const existing = notes.find((n) => A.folderOf(n.path) === folder && n.title.toLowerCase() === base.toLowerCase());
    if (existing) {
      const kept = await window.nv.notes.read(existing.path).catch(() => '');
      if (kept.trimStart().startsWith(answer.trim())) {
        keptAnswers.set(key, existing.path);
        toast(`Already kept as “${A.titleOf(existing.path)}”.`, { label: 'Open', run: () => A.openPath(existing.path, { where: 'tab' }) });
        return existing.path;
      }
    }
    const taken = !!existing;
    // Two different answers in one minute would collide on the minute: fall back to seconds, never a " 2".
    let title = taken ? `${base} ${formatDate('h:mm A')}` : base;
    if (taken && notes.some((n) => A.folderOf(n.path) === folder && n.title.toLowerCase() === title.toLowerCase())) title = `${base} ${formatDate('h:mm:ss A')}`;
    const body = `${answer.trim()}\n\n---\n*Asked in the chat on ${formatDate('D MMM YYYY')}: ${question.trim()}*\n`;
    const path = await window.nv.files.create(folder, title, '.md', body);
    await loadNotes();
    keptAnswers.set(key, path);
    toast(`Saved as “${A.titleOf(path)}”.`, { label: 'Open', run: () => A.openPath(path, { where: 'tab' }) });
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** What an answer changed in the notes: the notes to open, and Undo for all of it (the toast says the same words). */
export function Changes({ message, onOpen, showMe }: { message: ChatMessage; onOpen(path: string, newTab: boolean): void; showMe?: boolean }) {
  const c = message.changes;
  if (!showChanges(c)) return null;
  // Each note once (a project's file is named after the project, so it reads as the project).
  const items = [...new Set(c.paths)].map((path) => ({ path, label: A.titleOf(path) }));
  const words = changeWords(c);
  return (
    <div className={`chat-changes${message.undone ? ' is-undone' : ''}`}>
      <div className="chat-changes-head">
        <Icon name={message.undone ? 'undo' : 'check'} size={13} />
        <span>{message.undone ?? words}</span>
        {!message.undone && (
          <button className="chat-action btn" title="Put back everything this answer changed" onClick={() => void undoAnswer(message.id)}>
            <Icon name="undo" size={12} /> Undo
          </button>
        )}
        {!message.undone && showMe && items[0] && (
          <button className="chat-action btn quiet" title={`Open ${items[0].label} to see it`} onClick={() => onOpen(items[0].path, false)}>
            Open
          </button>
        )}
      </div>
      {!message.undone && items.length > 0 && (
        <div className="chat-changes-notes">
          {items.slice(0, 8).map((item) => (
            <button key={item.path} className="chat-source" title={item.path} onClick={(e) => onOpen(item.path, e.ctrlKey || e.metaKey)}>
              {item.label}
            </button>
          ))}
          {items.length > 8 && <span className="chat-changes-more">and {items.length - 8} more of {items.length}</span>}
        </div>
      )}
    </div>
  );
}

/** What the person attached to a message: pictures as pictures (opened large on a click), documents by name. */
function Attached({ files }: { files: ChatAttachment[] }) {
  const [large, setLarge] = useState<string | null>(null);
  return (
    <div className="chat-attached">
      {files.map((a) =>
        a.kind === 'image' && a.data ? (
          <button key={a.id} className="chat-attached-picture" title={a.name} onClick={() => setLarge(large === a.id ? null : a.id)}>
            <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} className={large === a.id ? 'is-large' : ''} />
          </button>
        ) : a.kind === 'pages' && a.pages?.length ? (
          <span key={a.id} className="chat-attached-file" title={`${a.name}: a scan, sent as pictures of its pages`}>
            <img src={`data:${a.pages[0].mediaType};base64,${a.pages[0].data}`} alt="" className="chat-attached-page" />
            <span>{a.name}</span>
            <span className="chat-attached-size">{pagesWords(a.pages.length, a.pageCount)}</span>
          </span>
        ) : (
          <span key={a.id} className="chat-attached-file" title={a.cut ? `${a.name}: only its first part fitted` : a.name}>
            <Icon name={/\.pdf$/i.test(a.name) ? 'pdf' : /\.(docx?|odt|rtf)$/i.test(a.name) ? 'doc' : /\.(xlsx?|xlsm|csv|ods)$/i.test(a.name) ? 'table' : 'file'} size={13} />
            <span>{a.name}</span>
            <span className="chat-attached-size">{sizeWords(a.size)}{a.cut ? ' · first part' : ''}</span>
          </span>
        ),
      )}
    </div>
  );
}

/** "6 pages as pictures", "first 6 of 40 pages as pictures". */
const pagesWords = (n: number, of?: number) => (of && of > n ? `first ${n} of ${of} pages as pictures` : `${n === 1 ? '1 page' : `${n} pages`} as pictures`);

/** Whether the model answering sees pictures (false only when it is known not to). */
function seesPictures(view: ModelsView | null): boolean {
  if (!view?.effective) return true;
  const m = view.connections.find((c) => c.id === view.effective!.provider)?.models.find((x) => x.id === view.effective!.model);
  return m?.images !== false;
}

export function ChatPanel({ tab }: { tab: TabState }) {
  const chat = useChat();
  const notes = useApp((s) => s.notes);
  const prefsNow = usePrefs();
  const settings = useApp((s) => s.settings);
  const canEdit = useApp((s) => s.canEdit);
  const [draft, setDraft] = useState('');
  const [dictateSaid, setDictateSaid] = useState<string | null>(null);
  const [view, setView] = useState<ModelsView | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // Files dragged over the chat: it shows where they go.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  // The page beside the chat, when one has a file behind it (4 Nov 2026, p9-one-ask: the floating bar's scope moved
  // in here, so a canvas, view, media file, loose file or drawing scopes like a note does). A private note is never
  // the chat's to read (src/main/private-notes.ts).
  const note = tab.path && !isPrivatePath(tab.path) && (tab.type === 'note' || tab.type === 'canvas' || tab.type === 'view' || tab.type === 'media' || tab.type === 'loose' || tab.type === 'drawing') ? tab.path : undefined;
  const busy = chat.requestId !== null;
  // The split focus the former host app's window told the view (one product step 5 part 3): while split, the
  // scope follows the focused side at once — the focused note, or the chat's own — and the bar reads it in one
  // line. Whole, the person's own scope stands, as today. Part 4 scopes a focused chat to that chat ("About
  // this chat"). The box holds the scope it showed when it took focus (t57 panel holds scope: focusing
  // the box pins it until the question sends or a side takes focus back — the blur to the panel flips the strip
  // to the note, and without the pin About this chat could never be asked by mouse). Moves inside the panel
  // keep the pin.
  const liveTold = useSplitFocus();
  const [pinnedTell, setPinnedTell] = useState<typeof liveTold | null>(null);
  const told = pinnedTell ?? liveTold;
  const following = splitScopeFor(told, !!note);
  const scopeWords = following !== null ? (following === 'chat' ? splitScopeWords('chat', told.chat?.title || '') : splitScopeWords(following, note ? A.titleOf(note) : '')) : null;
  useEffect(() => {
    if (following !== null && chat.scope !== following) setChatScope(following);
    // The chat scope only lives in a split: leaving it falls back to the chat's own, as today.
    else if (following === null && chat.scope === 'chat') setChatScope('all');
  }, [following, chat.scope]);
  // Each side's half-typed question, kept while the focus drives the scope: one box, its words stashed per
  // scope and swapped back at once; leaving the split brings back what was typed before it. Outside a split
  // the draft behaves as today. The slot follows what the scope scopes to (t50 break): each note and each chat
  // keeps its own words: two notes never share one boxful.
  const splitDrafts = useRef({ slots: {} as Record<string, string>, pre: '', following: null as string | null });
  const slot = following === null ? null : following === 'note' ? `note:${note ?? ''}` : following === 'chat' ? `chat:${told.chat?.id ?? ''}` : 'all';
  useEffect(() => {
    const stash = splitDrafts.current;
    if (stash.following === slot) return;
    if (stash.following !== null) stash.slots[stash.following] = draft;
    else stash.pre = draft;
    stash.following = slot;
    setDraft(slot !== null ? (stash.slots[slot] ?? '') : stash.pre);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the swap runs on slot changes, stashing the live draft
  }, [slot]);

  useEffect(() => {
    void window.nv.models.view().then(setView, (err) => showError(err));
    return window.nv.on.modelsChanged(setView);
  }, [settings?.model]);

  // The log follows new messages only while the person is at the bottom: scrolled up reading, it stays put.
  const stick = useRef(true);
  useEffect(() => {
    if (stick.current) log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.messages]);

  // Ask from a project page: the message box ready, focused.
  useEffect(
    () =>
      onChatDraft((text) => {
        if (text) setDraft(text);
        input.current?.focus();
      }),
    [],
  );

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [draft]);

  const reading = chat.attachments.some((a) => !a.ready);
  const attachedReady = chat.attachments.some((a) => a.ready);
  const ask = (q: string) => {
    const question = q.trim();
    // No silent drop while an answer streams (9.2 uplift F7): the chat queues the question and says so.
    if ((!question && !attachedReady) || reading) return;
    setDraft('');
    // While split the ask carries the told scope with it (t50 break): the kept scope lagged a render behind a
    // fast switch, so the answer came from the wrong side. Whole, the person's own scope stands, as today.
    // The held scope goes with it (t57): the pin releases as the question sends.
    const askedIn = splitAskScope(told, !!note) ?? undefined;
    setPinnedTell(null);
    void sendChat(question, note, undefined, false, askedIn);
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const pickModel = (anchor: HTMLElement) => {
    if (!view) return;
    const items: MenuItem[] = [
      // The default reads Recommended (uplift-92 pins the literal here); chatModelWords carries the same words elsewhere.
      { label: 'Recommended', checked: !settings?.model, run: () => void choose(null) },
      { separator: true },
      ...view.connections.flatMap((c): MenuItem[] => [
        { heading: c.name },
        ...c.models.map((m) => ({ label: m.name, checked: settings?.model?.provider === c.id && settings?.model?.model === m.id, run: () => void choose({ provider: c.id, model: m.id }) })),
      ]),
      { separator: true },
      { label: 'AI settings…', icon: 'settings', run: () => openModal({ kind: 'settings', section: 'models' }) },
    ];
    openMenu(anchor, items);
  };

  const choose = async (model: { provider: string; model: string } | null) => {
    try {
      setState({ settings: await window.nv.settings.update({ model }) });
      setView(await window.nv.models.view());
    } catch (err) {
      showError(err);
    }
  };

  const insertIntoNote = (text: string) => insertAnswerIntoNote(tab.id, text);
  // Save as note from a chat answer lands in the folder in view (one product step 5 part 4); anywhere else new
  // notes go where set. Nothing is ever kept without the person's press — the button is the only door.
  const saveAsNote = (message: ChatMessage, question: string) => void saveAnswerAsNote(message.content, question, notes, splitSaveFolder(told, note) ?? undefined);

  const notReady = settings && !settings.ai.ready;
  // What to ask depends on where the person is: a project's page, the projects they keep, or a vault with none yet.
  const noteType = note ? notes.find((n) => n.path === note)?.props?.type : undefined;
  const hasProjects = notes.some((n) => isProjectProps(n.props));
  const suggestions: string[] = suggestQuestions({ title: note ? A.titleOf(note) : undefined, type: typeof noteType === 'string' ? noteType : undefined, hasProjects });
  const openNote = (path: string, newTab: boolean) => A.openPath(path, { where: newTab ? 'tab' : 'current' });

  const canAttach = !notReady && canEdit;
  const picturesUnseen = chat.attachments.some((a) => a.ready?.kind === 'image' || a.ready?.kind === 'pages') && !seesPictures(view);
  // The message box's hint (4 Nov 2026, p9-one-ask round 2, the reviewer: "the message box's placeholder wraps
  // to a second line that is clipped"): one line ending with … (the sheet), its full words in the title.
  const boxHint = !canEdit
    ? 'These notes are open for reading only.'
    : chat.scope === 'note' && note
      ? `Ask about “${A.titleOf(note)}”…`
      : chat.scope === 'chat' && told.chat?.title
        ? `Ask about “${told.chat.title}”…`
        : chat.scope === 'chat'
          ? 'Ask about this chat…'
          : 'Ask about your notes…';
  // The box's full words on hover: the short hint fits the column whole (design language, 23 Nov 2026: the longer
  // hint was cut mid-word, "or ask for so", in the side column).
  const boxTitle = boxHint === 'Ask about your notes…' ? 'Ask about your notes, or ask for something done' : boxHint;

  return (
    <div
      className={`chat${dragging ? ' is-dropping' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e) || !canAttach) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e) || !canAttach) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        if (dragDepth.current > 0 && --dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        if (!hasFiles(e) || !canAttach) return;
        e.preventDefault();
        attachFiles(Array.from(e.dataTransfer.files));
        input.current?.focus();
      }}
    >
      {dragging && (
        <div className="chat-drop">
          <Icon name="paperclip" size={22} />
          <span>Drop to attach</span>
          <span className="hint">Pictures, PDFs, Word, Excel, PowerPoint and text files</span>
        </div>
      )}
      {/* The scope and New chat share the one top row (4 Nov 2026, p9-one-ask added 10:40: the model picker moved into the
          composer's foot, where the former host app's composer keeps it). While split the focus reads it in one
          line instead of the buttons, since the focused side is the control. */}
      <div className="chat-bar">
        {scopeWords !== null ? (
          <div className="chat-scope-line" title={scopeWords}>
            {scopeWords}
          </div>
        ) : (
          <div className="segmented small">
            <button className={chat.scope === 'all' ? 'active' : ''} onClick={() => setChatScope('all')}>
              All notes
            </button>
            <button className={chat.scope === 'note' ? 'active' : ''} onClick={() => setChatScope('note')} disabled={!note} title={note ? `Just “${A.titleOf(note)}” (and what it links to)` : 'Open a page first'}>
              This page + linked
            </button>
          </div>
        )}
        <button className="icon-button small" title="New chat" onClick={clearChat} disabled={!chat.messages.length}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {/* A chat the panel cannot read (one product step 5 part 4): one plain line under the scope, always in
          view while it holds. The transcript never crossed, so asking is answered in the same words. */}
      {following === 'chat' && told.chat?.withheld && <div className="chat-cantread">{chatWithheldWords(told.chat.withheld)}</div>}
      <div
        className="chat-log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {notReady && <AiSetup why={settings.ai.note} />}
        {!chat.messages.length && !notReady && (
          <div className="chat-empty">
            <div className="chat-empty-title">Ask your notes</div>
            <p className="hint">
              {chat.scope === 'note' && note
                ? `Answers start from “${A.titleOf(note)}”, with links to anything else used.`
                : chat.scope === 'chat' && !told.chat?.withheld
                  ? 'Answers start from this chat, with links to anything else used.'
                  : chat.scope === 'chat'
                    ? 'Ask about your notes instead.'
                    : 'Ask about your notes, or ask for something done: set up a project, tidy a folder, list what’s in a folder on this PC. Whatever it changes, you can undo.'}
            </p>
            <div className="chat-suggestions">
              {(prefsNow.chatSuggestions ? suggestions : []).map((s) => (
                <button
                  key={s}
                  className="chat-suggestion"
                  onClick={() => {
                    if (s === ASK_SETUP) void setUpProjectsFromFolder();
                    else if (s.endsWith('…')) {
                      setDraft(s.slice(0, -1));
                      input.current?.focus();
                    } else ask(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="chat-turn user">
              {m.attachments && m.attachments.length > 0 && <Attached files={m.attachments} />}
              {m.content && <p>{m.content}</p>}
              {m.scope === 'note' && m.note && <span className="chat-scope-note">about {A.titleOf(m.note)}</span>}
              {m.scope === 'chat' && m.chat && <span className="chat-scope-note">about {m.chat.title || 'this chat'}</span>}
              {m.chosenFolder !== undefined && <span className="chat-scope-note">{scopeNoteWords(m.chosenFolder)}</span>}
            </div>
          ) : (
            <div key={m.id} className="chat-turn assistant">
              {/* No scope head on the answer (5 Nov 2026, v8-vault-assistant: "All notes" read twice — the bar's
                  control and this label. Scope lives in one line now: the bar, with the question's own note). */}
              {m.steps && m.steps.length > 0 && <Steps steps={m.steps} pending={!!m.pending} onOpen={openNote} />}
              {m.content ? <Answer message={m} onOpenLink={(t, n) => void A.openLink(t, note, n ? 'tab' : 'current')} /> : m.pending ? <div className="chat-thinking"><span /><span /><span /></div> : null}
              {!m.pending && <FolderCards cards={m.folders} onOpen={openNote} />}
              {!m.pending && <Proposals message={m} onOpen={openNote} />}
              {!m.pending && <Suggested message={m} />}
              {!m.pending && <Changes message={m} onOpen={openNote} showMe />}
              {m.error && (
                <div className="chat-error">
                  <span>{m.error}</span>
                  {!busy && (
                    <button className="text-button" onClick={() => void retryChat(note)}>
                      Try again
                    </button>
                  )}
                </div>
              )}
              {!m.pending && m.content && (
                <>
                  {m.sources && m.sources.length > 0 && (
                    <div className="chat-sources">
                      <div className="glabel">
                        From · {m.sources.length}
                      </div>
                      {m.sources.map((s) => (
                        <button key={JSON.stringify([s.path, s.meetingDecision?.line])} className="srcrow chat-source-row" onClick={(e) => s.meetingDecision ? void openMeetingPassage(s.path, 'decisions', s.meetingDecision, e.ctrlKey || e.metaKey ? 'tab' : 'current') : A.openPath(s.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title={s.path}>
                          <span className="gtile xs slate">
                            <Icon name={fileIcon(s.path)} size={13} />
                          </span>
                          {/* Two lines (5 Nov 2026, v8-vault-assistant: the title clipped mid-word beside its path):
                              the title whole on the first, the folder and section smaller on the second. */}
                          <span className="chat-source-text">
                            <span className="clip chat-source-title">{s.title}</span>
                            <span className="n clip">{[s.path.includes('/') ? s.path.slice(0, s.path.lastIndexOf('/')) : '', s.section].filter(Boolean).join(' · ')}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="chat-actions-row">
                    <button className="chat-action btn" title="Copy" onClick={() => void navigator.clipboard.writeText(m.content).then(() => toast('Copied.'), () => toast('Couldn’t copy that.'))}>
                      <Icon name="copy" size={13} /> Copy
                    </button>
                    <button className="chat-action btn" title="Put into the open note at the cursor" disabled={!canEdit || !note} onClick={() => insertIntoNote(m.content)}>
                      <Icon name="download" size={13} /> Into the note
                    </button>
                    <button className="chat-action btn" title="Keep as a note of its own" disabled={!canEdit} onClick={() => void saveAsNote(m, priorUserText(chat.messages, i) || 'Answer')}>
                      <Icon name="filePlus" size={13} /> Save as note
                    </button>
                    {i === chat.messages.length - 1 && !busy && (
                      <button className="chat-action" title="Ask again" onClick={() => void retryChat(note)}>
                        <Icon name="refresh" size={13} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ),
        )}
      </div>
      {chat.folders.length > 0 && (
        <div className="chat-folders">
          {chat.folders.map((f) => (
            <span key={f} className="chat-folder" title={`The assistant may read ${f.split(/[\\/]/).filter(Boolean).pop() ?? f}`}>
              <Icon name="folder" size={12} />
              <span>{f.split(/[\\/]/).filter(Boolean).pop() ?? f}</span>
              <button aria-label={`Remove ${f.split(/[\\/]/).filter(Boolean).pop() ?? f}`} title="Remove" onClick={() => removeChatFolder(f)}>
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {chat.attachments.length > 0 && (
        <div className="chat-drafts">
          {chat.attachments.map((a) => (
            <span key={a.id} className={`chat-draft${a.ready ? '' : ' is-reading'}`} title={a.ready?.cut ? `${a.name}: only its first part fits` : a.name}>
              {a.ready?.kind === 'image' && a.ready.data ? <img src={`data:${a.ready.mediaType};base64,${a.ready.data}`} alt="" /> : a.ready?.kind === 'pages' && a.ready.pages?.length ? <img src={`data:${a.ready.pages[0].mediaType};base64,${a.ready.pages[0].data}`} alt="" /> : <Icon name={a.ready ? 'file' : 'refresh'} size={12} />}
              <span>{a.name}</span>
              <span className="chat-draft-size">{!a.ready ? 'Reading…' : a.ready.kind === 'pages' ? pagesWords(a.ready.pages?.length ?? 0, a.ready.pageCount) : `${sizeWords(a.ready.size)}${a.ready.cut ? ' · first part' : ''}`}</span>
              <button aria-label={`Remove ${a.name}`} title="Remove" onClick={() => removeAttachment(a.id)}>
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {picturesUnseen && <div className="chat-attach-note">This model can’t see pictures, only their names. Choose one that can from the model button below.</div>}
      <div className="chat-input">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            attachFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
            input.current?.focus();
          }}
        />
        <button className="chat-attach" title="Attach pictures or documents (or drop them here, or paste a picture)" aria-label="Attach files" disabled={!canAttach} onClick={() => picker.current?.click()}>
          <Icon name="paperclip" size={15} />
        </button>
        <button className="chat-attach" title="Add a folder on this PC for the assistant to read" disabled={!!notReady || !canEdit || busy} onClick={() => void addChatFolder()}>
          <Icon name="folderPlus" size={15} />
        </button>
        <textarea
          ref={input}
          value={draft}
          rows={1}
          disabled={!!notReady || !canEdit}
          placeholder={boxHint}
          title={boxTitle}
          onFocus={() => {
            if (!pinnedTell && liveTold.split) setPinnedTell(liveTold);
          }}
          onBlur={(e) => {
            const to = e.relatedTarget as HTMLElement | null;
            if (to && e.currentTarget.closest('.chat')?.contains(to)) return;
            setPinnedTell(null);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            // A picture or file pasted (a screenshot, files copied in Explorer) is attached; words paste as words.
            const files = Array.from(e.clipboardData?.files ?? []);
            if (!files.length || !canAttach) return;
            e.preventDefault();
            attachFiles(files);
          }}
          onKeyDown={(e) => {
            if (isEnterKey(e) && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
        />
        {prefsNow.dictation && window.nv.dictation?.available && !busy && (
          <>
            <button
              className="chat-mic"
              title={dictateSaid || 'Dictate'}
              aria-label={dictateSaid ? `Dictating: ${dictateSaid}. Press to stop.` : 'Dictate'}
              aria-pressed={!!dictateSaid}
              disabled={!!notReady || !canEdit}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!input.current) return;
                void dictate(fieldTarget(input.current, setDraft), setDictateSaid);
              }}
            >
              <Icon name="mic" size={15} />
            </button>
            {dictateSaid && (
              <span className="dictate-words" role="status">
                {dictateSaid}
              </span>
            )}
          </>
        )}
        {busy ? (
          <button className="chat-send stop" title="Stop" onClick={stopChat}>
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button className="chat-send" title={reading ? 'Reading the attached files…' : 'Send (Enter)'} disabled={(!draft.trim() && !attachedReady) || reading} onClick={() => ask(draft)}>
            <Icon name="send" size={14} />
          </button>
        )}
      </div>
      {/* The model picker in the composer's foot (4 Nov 2026, p9-one-ask added 10:40): the one picker now the panel is the
          one place to ask: a chip and menu (the models of the person's connections, the default marked; the choice
          answers next and is remembered). The bar's Helper only ever opened Model settings, kept as the menu's
          last row. */}
      <div className="chat-modelfoot">
        <button className="chat-model" title={`${chatModelWords(view)} (the model)`} onClick={(e) => pickModel(e.currentTarget)} disabled={!view?.connections.length}>
          <Icon name="sparkle" size={14} />
          <span>{chatModelWords(view)}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      </div>
    </div>
  );
}

/** Keeps the AI status current when the connections or their models change. */
export function refreshAiStatus(): void {
  if (getState().settings) void loadSettings();
}
