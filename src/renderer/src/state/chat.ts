// The chat with your notes: its messages (kept while panels change), one answer at a time streamed in, stop and retry.

import { useSyncExternalStore } from 'react';
import type { ChatAttachment, ChatChanges, ChatFolderCard, ChatJob, ChatProposal, ChatSource, ChatStep, ChatSuggested } from '../../../shared/types';
import { addStep } from '../../../shared/chat-steps';
import { ATTACH_LIMITS } from '../../../shared/chat-attach';
import { changeWords } from '../../../shared/search-ask-87';
import { NOTEBOOK_REFUSAL, type Citation } from '../../../shared/notebook';
import { prepareAttachment } from '../lib/attach';
import { errorMessage } from '../lib/errors';
import { docs } from './docs';
import { showSide } from './fit';
import { splitFocusNow } from './splitFocus';
import { keepThread, threadOf } from './notebook';
import { getState, showError, toast } from './store';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  error?: string;
  pending?: boolean;
  /** What the person attached to it. */
  attachments?: ChatAttachment[];
  /** Which notes it was asked about (or which chat, while split with a chat focused). */
  scope?: 'all' | 'note' | 'chat';
  note?: string;
  /** The the former host app conversation it was asked about (the told chat's id and title). */
  chat?: { id: string; title: string };
  /** What the assistant did while answering. */
  steps?: ChatStep[];
  /** Numbered passages an answer over ticked sources cites (each opens where it came from). */
  citations?: Citation[];
  /** The folder whose ticked sources it was asked over (8.7 w2c: one Ask scope). */
  chosenFolder?: string;
  /** What the answer changed in the notes (to undo as one), and the words once undone. */
  changes?: ChatChanges;
  undone?: string;
  /** Changes to projects the person accepts or not (Catch up), and what became of each. */
  proposals?: ProposalCard[];
  /** The change set the proposals wait in (reviewed once, even after a restart). */
  changeSetId?: string;
  /** What it looked at in a project's folder, as tidy lists (a listing, what changed since a date). */
  folders?: ChatFolderCard[];
  /** Work it handed to the former host app, followed live. */
  jobs?: ChatJob[];
  /** Changes it suggested to notes, waiting in each note for the person (Ask before the assistant changes a note). */
  suggested?: ChatSuggested[];
}

export interface ProposalCard extends ChatProposal {
  state?: 'accepted' | 'dismissed' | 'failed' | 'undone';
  words?: string;
  /** To undo an accepted change. */
  turnId?: string;
}

interface ChatStore {
  messages: ChatMessage[];
  requestId: string | null;
  scope: 'all' | 'note' | 'chat';
  /** Folders on this PC added for the assistant to read (Windows' folder window). */
  folders: string[];
  /** Files attached to the message being written (sent with it, then cleared). */
  attachments: DraftAttachment[];
  /** Questions asked while an answer streams: each sends when the answer lands (9.2 uplift F7). */
  queued: QueuedAsk[];
}

/** A question waiting its turn behind a streaming answer. */
export interface QueuedAsk {
  question: string;
  note?: string;
  attachments?: ChatAttachment[];
  /** Asked over a folder's ticked sources (askChosen) rather than the chat. */
  folder?: string;
  /** The scope it was asked in (t50 break): frozen at ask time, so a switch before it sends never moves it. */
  scope?: 'all' | 'note' | 'chat';
  chat?: { id: string; title: string };
}

/** A file on the message being written: being made ready, then ready to send. */
export interface DraftAttachment {
  id: string;
  name: string;
  ready?: ChatAttachment;
}

// The conversation is kept while Ironleaf runs, so the window closing and opening again brings it back with its job
// cards still following their work (19 Oct 2026). Pictures and documents attached keep their names, not their bytes.
const KEPT = 'nv.chat.v1';
/** The notes the kept conversation is about (another library starts a new chat). */
let keptLibrary = '';
function keptChat(): Pick<ChatStore, 'messages' | 'scope'> | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEPT) ?? 'null');
    keptLibrary = typeof v?.library === 'string' ? v.library : '';
    // A conversation from earlier today comes back; an older one (Ironleaf started again since) does not.
    return v && Array.isArray(v.messages) && Date.now() - Number(v.at || 0) < 12 * 3600_000 ? { messages: v.messages.map((m: ChatMessage) => ({ ...m, pending: false })), scope: v.scope === 'note' ? 'note' : 'all' } : null;
  } catch {
    return null;
  }
}
let keepTimer: ReturnType<typeof setTimeout> | undefined;
function keepChat(): void {
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => {
    try {
      const messages = store.messages.filter((m) => !m.pending).slice(-40).map((m) => ({ ...m, steps: m.steps?.filter(s => !s.packAction), attachments: m.attachments?.map((a) => ({ id: a.id, name: a.name, kind: a.kind, size: a.size, cut: a.cut })) }));
      localStorage.setItem(KEPT, JSON.stringify({ messages, scope: store.scope, library: keptLibrary, at: Date.now() }));
    } catch {
      // Kept only while it fits; the chat works the same without it.
    }
  }, 400);
}

let store: ChatStore = { messages: [], requestId: null, scope: 'all', folders: [], attachments: [], queued: [], ...(keptChat() ?? {}) };
const listeners = new Set<() => void>();
let listening = false;

function set(patch: Partial<ChatStore>): void {
  store = { ...store, ...patch };
  for (const fn of listeners) fn();
  if ('messages' in patch || 'scope' in patch) keepChat();
}

function renameMeetingSources(from: string, to: string) {
  let changed = false;
  const messages = store.messages.map((entry) => {
    if (!entry.sources?.some((s) => s.meetingDecision && (s.path === from || s.path.startsWith(from + '/')))) return entry;
    changed = true;
    return { ...entry, sources: entry.sources.map((s) => s.meetingDecision && (s.path === from || s.path.startsWith(from + '/')) ? { ...s, path: to + s.path.slice(from.length) } : s) };
  });
  if (changed) set({ messages });
}

function listen(): void {
  if (listening) return;
  listening = true;
  docs.onRename(renameMeetingSources);
  window.nv.on.chatDelta(({ requestId, text }) => {
    if (requestId !== store.requestId) return;
    set({ messages: store.messages.map((m) => (m.pending ? { ...m, content: m.content + text } : m)) });
  });
  window.nv.on.chatStep(({ requestId, step, clearText }) => {
    if (requestId !== store.requestId) return;
    set({
      messages: store.messages.map((m) => (m.pending ? { ...m, content: clearText ? '' : m.content, steps: addStep(m.steps ?? [], step) } : m)),
    });
  });
}

// The chat's message box, filled from elsewhere (a project page's Ask): the panel listens.
let draftListener: ((text: string) => void) | null = null;
export function onChatDraft(fn: (text: string) => void): () => void {
  draftListener = fn;
  return () => {
    if (draftListener === fn) draftListener = null;
  };
}

/**
 * Ask the helper in the side chat (4 Nov 2026, p9-one-ask): about a project (its file as the open note) when one
 * is given; with words, they are asked at once (a project page's Catch up); without, the panel waits with
 * suggestions and its message box.
 */
/** Whether the assistant can answer now (a connection, a model and its key are there). */
const aiReady = (): boolean => getState().settings?.ai.ready !== false;

export function askInChat(text: string, note?: string): void {
  // No AI connection yet: the chat opens on its calm "Add an AI connection", with the words kept in the box for after.
  if (!aiReady()) return draftInChat(text, note);
  showSide('right', 'chat');
  set({ scope: note ? 'note' : 'all' });
  if (text.trim()) void sendChat(text, note, []);
}

/** The chat opened on the right with words in its message box, for the person to finish and send (Today's Ask about
 * this; the formatting bar's Ask about this, about the note the words came from): nothing is asked until they press
 * Send. */
export function draftInChat(text: string, note?: string): void {
  showSide('right', 'chat');
  set({ scope: note ? 'note' : 'all' });
  // The panel may only now be opening: its message box listens once it is there.
  let tries = 0;
  const fill = () => (draftListener ? draftListener(text) : ++tries < 20 && setTimeout(fill, 60));
  setTimeout(fill, 60);
}

/** Adds a folder on this PC for the assistant to read (chosen in Windows' own folder window). */
/** A folder on this PC for the assistant to read, chosen in Windows' folder window: the folder, or null when none was chosen. */
export async function addChatFolder(): Promise<string | null> {
  const folder = await window.nv.ai.addFolder();
  if (folder && !store.folders.includes(folder)) set({ folders: [...store.folders, folder] });
  return folder || null;
}

/** Projects set up from a folder the person picks, then the assistant reads it. The one setup flow behind every
 *  suggestion chip (9.2 uplift F52): chips route here by the chip itself, never by matching typed words. */
export async function setUpProjectsFromFolder(): Promise<void> {
  if (!aiReady()) return draftInChat('');
  if (!(await addChatFolder())) return;
  askInChat('Set up my projects from the folder I added: one project for each project in it, read properly, with everything a progress report needs.');
}

/** Files dropped, pasted or chosen for the message being written: each made ready (a picture sized, a document read);
 * one that can't be attached is said in words and left out. */
export function attachFiles(files: File[]): void {
  const room = ATTACH_LIMITS.perMessage - store.attachments.length;
  if (files.length > room) toast(room > 0 ? `Up to ${ATTACH_LIMITS.perMessage} files go with one message: the first ${room} were attached.` : `Up to ${ATTACH_LIMITS.perMessage} files go with one message.`);
  for (const file of files.slice(0, Math.max(0, room))) {
    const id = newId();
    set({ attachments: [...store.attachments, { id, name: file.name || 'Pasted picture' }] });
    prepareAttachment(file).then(
      (ready) => set({ attachments: store.attachments.map((a) => (a.id === id ? { id, name: ready.name, ready } : a)) }),
      (err: unknown) => {
        const was = store.attachments.some((a) => a.id === id);
        set({ attachments: store.attachments.filter((a) => a.id !== id) });
        if (was) toast(`“${file.name || 'The picture'}” wasn’t attached. ${errorMessage(err)}`, undefined, 7000);
      },
    );
  }
}

export function removeAttachment(id: string): void {
  set({ attachments: store.attachments.filter((a) => a.id !== id) });
}

export function removeChatFolder(folder: string): void {
  set({ folders: store.folders.filter((f) => f !== folder) });
}

/** Undoes what one answer changed in the notes. */
function setProposal(messageId: string, id: string, change: Partial<ProposalCard>): void {
  set({ messages: store.messages.map((m) => (m.id === messageId ? { ...m, proposals: m.proposals?.map((p) => (p.id === id ? { ...p, ...change } : p)) } : m)) });
}

/** A proposed change to a project, accepted: written if the project hasn't changed since. */
export async function acceptProposal(messageId: string, id: string): Promise<void> {
  const r = await window.nv.ai.applyProposal(id).catch((err: unknown) => ({ ok: false, words: errorMessage(err), turnId: undefined }));
  setProposal(messageId, id, r.ok ? { state: 'accepted', words: r.words, turnId: r.turnId } : { state: 'failed', words: r.words });
}

export async function acceptAllProposals(messageId: string): Promise<void> {
  for (const p of store.messages.find((m) => m.id === messageId)?.proposals ?? []) if (!p.state) await acceptProposal(messageId, p.id);
}

export function dismissProposal(messageId: string, id: string): void {
  setProposal(messageId, id, { state: 'dismissed', words: 'Not now' });
}

/** An accepted change put back. */
export async function undoProposal(messageId: string, id: string): Promise<void> {
  const p = store.messages.find((m) => m.id === messageId)?.proposals?.find((x) => x.id === id);
  if (!p?.turnId) return;
  // A failed undo is not an undo (fnv3 F42): say so and keep the button, so it can be tried again.
  try { const words = await window.nv.ai.undo(p.turnId); setProposal(messageId, id, { state: 'undone', words }); } catch (err) { showError(err); }
}

export async function undoAnswer(messageId: string): Promise<void> {
  const message = store.messages.find((m) => m.id === messageId);
  if (!message?.changes || message.undone) return;
  try { const words = await window.nv.ai.undo(message.changes.turnId); set({ messages: store.messages.map((m) => (m.id === messageId ? { ...m, undone: words } : m)) }); } catch (err) { showError(err); }
}

export function useChat(): ChatStore {
  listen();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => store,
  );
}

export function setChatScope(scope: 'all' | 'note' | 'chat'): void {
  set({ scope });
}

/** The scope a question is asked in: the chat scope only while split with a told chat (a withheld chat keeps
 *  it, so the answer says plainly why); otherwise the person's scope stands, as today. */
function askScope(note: string | undefined): { scope: 'all' | 'note' | 'chat'; chat?: { id: string; title: string } } {
  if (store.scope === 'note' && note) return { scope: 'note' };
  if (store.scope === 'chat') {
    const told = splitFocusNow();
    if (told.split && told.chat) return { scope: 'chat', chat: { id: told.chat.id, title: told.chat.title } };
  }
  return { scope: 'all' };
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Whether an answer's changes show as a card and a toast (9.2 uplift F156): presence. The one predicate both the
 *  card and the toast call, so they can never disagree again; even an answer that errored keeps its card and Undo
 *  for what it did change. */
export function showChanges(c: ChatChanges | undefined): c is ChatChanges {
  return !!c;
}

/** Stop holds the waiting questions instead of sending them: they run, in order, behind the next one asked. */
let heldAfterStop = false;
/** A ticked-sources answer stopped while waiting: its late result is dropped when it lands. */
let stoppedChosen: string | null = null;

/** The next waiting question, if any, sent now its turn has come. */
function sendQueued(): void {
  if (heldAfterStop) {
    heldAfterStop = false;
    const n = store.queued.length;
    if (n) toast(n === 1 ? 'Stopped. 1 question is still waiting: it sends first when you ask next.' : `Stopped. ${n} questions are still waiting: they send first when you ask next.`);
    return;
  }
  const [next, ...rest] = store.queued;
  if (!next) return;
  set({ queued: rest });
  if (next.folder !== undefined) void askChosen(next.question, next.folder, true);
  else void sendChat(next.question, next.note, next.attachments ?? [], true, next.scope ? { scope: next.scope, ...(next.chat ? { chat: next.chat } : {}) } : undefined);
}

/** Asks the assistant. `attachments`: the files to send with it (else the ones attached to the message being written,
 * which then clear). Asked while an answer streams, the question waits its turn and sends when it lands.
 * `askedIn`: the scope it was asked in (the panel carries the told scope; a waiting question its frozen one). */
export async function sendChat(question: string, note?: string, attachments?: ChatAttachment[], fromQueue = false, askedIn?: { scope: 'all' | 'note' | 'chat'; chat?: { id: string; title: string } }): Promise<void> {
  listen();
  if (!aiReady()) {
    // Never an error for a question asked before a connection is added: the panel says what to do, the words wait.
    draftInChat(question, note);
    return;
  }
  const files = attachments ?? store.attachments.flatMap((a) => (a.ready ? [a.ready] : []));
  if (store.requestId) {
    if (!question.trim() && !files.length) return;
    const asked = askedIn ?? askScope(note);
    set({ queued: [...store.queued, { question, note, attachments: files, scope: asked.scope, ...(asked.chat ? { chat: asked.chat } : {}) }] });
    toast(store.queued.length > 1 ? `Still answering. ${store.queued.length} questions send next, yours last.` : 'Still answering. Your question sends next.');
    return;
  }
  if (!question.trim() && !files.length) return;
  if (store.queued.length && !fromQueue) {
    // Held back by Stop: this one joins behind the waiting questions, which now run in order.
    const asked = askedIn ?? askScope(note);
    set({ queued: [...store.queued, { question, note, attachments: files, scope: asked.scope, ...(asked.chat ? { chat: asked.chat } : {}) }] });
    sendQueued();
    return;
  }
  const asked = askedIn ?? askScope(note);
  const requestId = crypto.randomUUID();
  const history: ChatMessage[] = [...store.messages.filter((m) => !m.error || m.content), { id: newId(), role: 'user', content: question, scope: asked.scope, note, ...(asked.chat ? { chat: asked.chat } : {}), ...(files.length ? { attachments: files } : {}) }];
  const answer: ChatMessage = { id: newId(), role: 'assistant', content: '', pending: true, scope: asked.scope, note, ...(asked.chat ? { chat: asked.chat } : {}) };
  set({ messages: [...history, answer], requestId, ...(attachments ? {} : { attachments: [] }) });
  const turns = history.filter((m) => m.content.trim() || m.attachments?.length).map((m) => ({ role: m.role, content: m.content, ...(m.attachments?.length ? { attachments: m.attachments } : {}) }));
  await runAnswer(answer.id, requestId, turns, { scope: asked.scope, note, ...(asked.chat ? { chat: asked.chat } : {}) });
  sendQueued();
}

/** One answer streamed in for its message: the result settled onto it, its changes undone from its card and from a
 *  toast (8.7 w2c, the ask-undo mock-up): the same words, the same Undo. */
async function runAnswer(answerId: string, requestId: string, turns: { role: 'user' | 'assistant'; content: string; attachments?: ChatAttachment[] }[], opts: { scope: 'all' | 'note' | 'chat'; note?: string; chat?: { id: string; title: string } }): Promise<void> {
  const result = await window.nv.ai
    .chat(requestId, turns, { scope: opts.scope, note: opts.note, noteText: opts.note ? docs.text(opts.note) : undefined, ...(opts.chat ? { chat: opts.chat } : {}), folders: store.folders })
    .catch((err: unknown): ChatResultLike => ({ text: '', sources: [], error: errorMessage(err) }));
  set({
    requestId: null,
    messages: store.messages.map((m) => (m.id === answerId ? { ...m, pending: false, content: result.text || m.content, sources: result.sources, error: result.error ? errorMessage(result.error) : undefined, steps: result.steps ?? m.steps, changes: result.changes, proposals: result.proposals, changeSetId: result.changeSetId, folders: result.folders, jobs: result.jobs, suggested: result.suggested } : m)),
  });
  if (showChanges(result.changes)) {
    toast(`${changeWords(result.changes)}.`, { label: 'Undo', run: () => void undoAnswer(answerId) });
  }
}

/**
 * Asks over a folder's ticked sources only (8.7 w2c: the notebook as one Ask scope): the notebook's own strict asking
 * (nothing outside the ticked sources is read), answered into the chat with numbered passages, and kept in the
 * notebook's thread too, so both places show the same question.
 */
export async function askChosen(question: string, folder: string, fromQueue = false): Promise<void> {
  listen();
  const q = question.trim();
  if (store.requestId) {
    if (!q) return;
    set({ queued: [...store.queued, { question: q, folder }] });
    toast(store.queued.length > 1 ? `${store.queued.length} questions send next, in order.` : 'Still answering. Your question sends next.');
    return;
  }
  if (!q) return;
  if (store.queued.length && !fromQueue) {
    // Held back by Stop: this one joins behind the waiting questions, which now run in order.
    set({ queued: [...store.queued, { question: q, folder }] });
    sendQueued();
    return;
  }
  const history: ChatMessage[] = [...store.messages.filter((m) => !m.error || m.content), { id: newId(), role: 'user', content: q, scope: 'all' as const, chosenFolder: folder }];
  const answer: ChatMessage = { id: newId(), role: 'assistant', content: '', pending: true, scope: 'all', chosenFolder: folder };
  set({ messages: [...history, answer], requestId: 'chosen' });
  const previous = [...threadOf(folder)].reverse().find((t) => t.answer && !t.answer.refused)?.question;
  try {
    const a = await window.nv.notebook.ask(folder, q, previous ?? '');
    // Stopped while waiting: the late result is dropped, like a stopped stream's.
    if (stoppedChosen === answer.id) stoppedChosen = null;
    else {
      keepThread(folder, [...threadOf(folder), { question: q, answer: a }]);
      set({
        requestId: null,
        messages: store.messages.map((m) =>
          m.id === answer.id ? { ...m, pending: false, content: a.refused ? `${NOTEBOOK_REFUSAL} Try other words, or tick more sources.` : a.text, citations: a.citations, sources: a.citations.map((c) => ({ path: c.path, title: c.title, section: '' })) } : m,
        ),
      });
    }
  } catch (err: unknown) {
    if (stoppedChosen === answer.id) stoppedChosen = null;
    else {
      const words = errorMessage(err);
      keepThread(folder, [...threadOf(folder), { question: q, error: words }]);
      set({ requestId: null, messages: store.messages.map((m) => (m.id === answer.id ? { ...m, pending: false, error: words } : m)) });
    }
  }
  sendQueued();
}

export function stopChat(): void {
  if (!store.requestId) return;
  heldAfterStop = true;
  if (store.requestId === 'chosen') {
    // One call, no stream to cancel: settle the waiting answer at once instead.
    const waiting = [...store.messages].reverse().find((m) => m.pending);
    stoppedChosen = waiting?.id ?? 'chosen';
    set({ requestId: null, messages: store.messages.map((m) => (m.pending ? { ...m, pending: false, error: 'Stopped.' } : m)) });
    return;
  }
  void window.nv.ai.cancel(store.requestId);
}

/** The notes now open: a conversation about other notes (or none) starts afresh; the same notes keep theirs. */
export function chatLibrary(library: string | null): void {
  const now = library ?? '';
  if (now && now === keptLibrary) return;
  keptLibrary = now;
  clearChat();
}

export function clearChat(): void {
  stopChat();
  heldAfterStop = false;
  set({ messages: [], requestId: null, folders: [], attachments: [], queued: [] });
  try {
    localStorage.removeItem(KEPT);
  } catch {
    // Nothing kept.
  }
}

type ChatResultLike = { text: string; sources: ChatSource[]; error?: string; steps?: ChatStep[]; changes?: ChatChanges; proposals?: ChatProposal[]; changeSetId?: string; folders?: ChatFolderCard[]; jobs?: ChatJob[]; suggested?: ChatSuggested[] };

/** Asks the last question again (after an error or to get another answer). The earlier answers stay with their
 *  change cards and Undo (9.2 uplift F33): nothing typed away, so retry can never double-apply unseen changes. */
export async function retryChat(note?: string): Promise<void> {
  const lastUser = [...store.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser || store.requestId) return;
  // Asked over ticked sources: retry asks over those sources again (fnv3 F41), never silently over everything.
  if (lastUser.chosenFolder !== undefined) { await askChosen(lastUser.content, lastUser.chosenFolder); return; }
  const told = splitFocusNow();
  const scope: 'all' | 'note' | 'chat' = lastUser.scope === 'note' && (note ?? lastUser.note) ? 'note' : lastUser.scope === 'chat' && told.split && told.chat ? 'chat' : 'all';
  const chat = scope === 'chat' && told.chat ? { id: told.chat.id, title: told.chat.title } : undefined;
  const answer: ChatMessage = { id: newId(), role: 'assistant', content: '', pending: true, scope, note: note ?? lastUser.note, ...(chat ? { chat } : {}) };
  const history = [...store.messages, answer];
  set({ messages: history, requestId: crypto.randomUUID() });
  const turns = history.filter((m) => m.content.trim() || m.attachments?.length).map((m) => ({ role: m.role, content: m.content, ...(m.attachments?.length ? { attachments: m.attachments } : {}) }));
  await runAnswer(answer.id, store.requestId!, turns, { scope, note: note ?? lastUser.note, ...(chat ? { chat } : {}) });
  sendQueued();
}
