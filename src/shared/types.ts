// Types shared by the main process, the preload bridge and the renderer.
// Everything here crosses IPC, so it must stay plain, serializable data.

import type { Prefs } from './prefs';
import type { FolderPlace, RemoteProblem } from './project-folder';
import type { GraphDelta } from './graph-delta';

export interface VaultInfo {
  path: string;
  name: string;
  /** Whether this is Ironleaf's library (where it keeps its notes) rather than another folder opened from the menu. */
  library?: boolean;
}

export interface LinkRef {
  /** Link target as written, without heading or alias (e.g. "Project X"). */
  target: string;
  heading?: string;
  alias?: string;
  embed: boolean;
  /** 0-based line number in the note. */
  line: number;
}

/** A link in a note's properties (its front matter): which property, the target as written, its kind, its line. */
export interface PropLink {
  key: string;
  target: string;
  kind: string;
  /** 0-based line number in the note. */
  line: number;
}

export interface NoteMeta {
  /** Vault-relative path with forward slashes, e.g. "folder/Note.md". */
  path: string;
  title: string;
  /**
   * The name a person sees: the title, but a project's own notes go by their project ("Windows 11 Upgrade" for its
   * Overview, "Windows 11 Upgrade · Summary"), so twelve notes called Overview never fill a list or the graph.
   */
  label: string;
  mtime: number;
  size: number;
  /** When the file was made on this PC (ms), when the PC says (Today's "Made on this day", src/shared/hub.ts). */
  born?: number;
  links: LinkRef[];
  /** The links in its properties (kept apart from body links: the graph and search read body links only). */
  propLinks: PropLink[];
  tags: string[];
  headings: string[];
  aliases: string[];
  /** The note's properties (its YAML front matter). */
  props: Record<string, unknown>;
}

/** What a file is, by its name: notes, canvases and views Ironleaf edits; the rest it shows. */
export type FileKind = 'note' | 'canvas' | 'view' | 'image' | 'pdf' | 'audio' | 'video' | 'other';

export interface ListedFile {
  rel: string;
  mtime: number;
  size: number;
  kind: FileKind;
}

export interface FileList {
  files: ListedFile[];
  folders: string[];
}

export interface OutgoingLink {
  target: string;
  heading?: string;
  /** The note or file the link reaches, or null when it isn't written yet. */
  resolved: string | null;
  title: string;
  line: number;
  embed: boolean;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface LineContext {
  source: string;
  sourceTitle: string;
  line: number;
  context: string;
  /** Set when the link sits in a property: which one, and the link's kind ('' for unkinded). */
  prop?: string;
  kind?: string;
}

export interface Mention {
  /** Path of the note that the phrase refers to. */
  target: string;
  targetTitle: string;
  /** The exact text in the note being edited that could become a link. */
  phrase: string;
  line: number;
}

export interface RelatedNote {
  path: string;
  title: string;
  score: number;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  /** Matching lines, with where the matched words fall in each ([start, end) in `text`). */
  snippets: { line: number; text: string; ranges: [number, number][] }[];
  matches: number;
  mtime: number;
  /** A paraphrase hit from this PC's meaning index (2 Nov 2026, 10.0): drawn with a "Similar meaning" label. */
  meaning?: boolean;
}

export interface GraphNode {
  id: string;
  title: string;
  exists: boolean;
  kind: 'note' | 'file' | 'missing' | 'tag';
  degree: number;
  tags: string[];
  /** A project's file: drawn larger, in its health's colour. */
  project?: boolean;
  /** A doc (src/shared/doc-file.ts): drawn as a doc, apart from plain notes. */
  doc?: boolean;
  health?: string;
  /** A project: how many notes belong to it (src/shared/relations.ts). */
  notes?: number;
  /** Card words (the graph's card map, src/shared/graph-layout.ts): a project's due day and status as written. */
  due?: string;
  status?: string;
  /** Card words: a one-line summary where the note gives one (a project's Summary, else its first words). */
  summary?: string;
  /** Card words: a person's role and organisation, a meeting's day, where written. */
  role?: string;
  org?: string;
  date?: string;
  /** A note that belongs to a project: the project file's path (the note folds into it). */
  owner?: string;
  /** A note in the templates folder, or a template itself (hidden from the graph unless asked for). */
  template?: boolean;
  /** In a folder the person kept out of view (hidden from the graph unless asked for, like a template). */
  quiet?: boolean;
}

/** How two things in the graph are connected: a link or tag as written, or a relation Ironleaf works out. */
export type GraphLinkKind = 'link' | 'tag' | 'owns' | 'people' | 'mentions' | 'paired' | 'tags';

export interface GraphLink {
  source: string;
  target: string;
  /** The main kind (the first of `kinds`). */
  kind: GraphLinkKind;
  /** Every way the two are connected. */
  kinds?: GraphLinkKind[];
  /** In plain words, one per reason ("Both have Bettina Maddox"). */
  reasons?: string[];
  /** The kind behind each reason, in the same order. */
  reasonKinds?: GraphLinkKind[];
  /** How strongly they belong together, about 0.3 to 2. */
  strength?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  /** The index's generation it was drawn from (5 Nov 2026, v5-vault-speed): the window asks for its delta from this. */
  generation?: number;
}

/** A graph answer: the whole graph, or only what moved since the generation the window holds (src/shared/graph-delta.ts). */
export type GraphSnapshot = { generation: number; full: GraphData } | { generation: number; delta: GraphDelta };

// Models come from the former host app's connections (src/main/providers): a choice names the connection and one of its
// models.
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelChoice {
  provider: string;
  model: string;
  reasoning?: ThinkingLevel;
}

export type ModelConnectionKind = 'anthropic' | 'openai' | 'google' | 'ollama' | 'custom';
export type ModelApiFormat = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';

export interface ModelConnectionView {
  id: string;
  name: string;
  kind: ModelConnectionKind;
  api: ModelApiFormat;
  host: string;
  baseURL: string;
  /** Whether the address is the person's to change (a local server or an OpenAI-compatible service). */
  editableURL: boolean;
  /** Whether Ironleaf has this connection's key: typed here, not needed (a local server), or missing. */
  key: 'here' | 'missing' | 'not-needed';
  /** images: whether the model sees pictures (missing when not known). */
  models: { id: string; name: string; levels: ThinkingLevel[]; images?: boolean }[];
}

export interface ModelsView {
  connections: ModelConnectionView[];
  /** Speech-to-text: the connection and model that write down what was said; null when none is chosen. */
  transcription: { connection: string; model: string } | null;
  /** The person's own choice of model for the chat; null uses the first model of the first connection. */
  choice: ModelChoice | null;
  /** What Ironleaf will use now. */
  effective: ModelChoice | null;
}

/** What Settings › AI sends to add a connection. */
export interface ModelConnectionInput {
  kind: ModelConnectionKind;
  name?: string;
  baseURL?: string;
  api?: ModelApiFormat;
  models?: string[];
  noAuth?: boolean;
}

export interface AppSettings {
  prefs: Prefs;
  about: { version: string; host: 'standalone' | 'embedded'; hostVersion?: string };
  model: ModelChoice | null;
  dailyFolder: string;
  dailyFormat: string;
  dailyTemplate: string;
  /** Whether the AI features can run, and if not, what to do (in words). */
  ai: { ready: boolean; note: string | null; modelName: string | null };
  recentVaults: string[];
  /** Where Ironleaf keeps its notes. */
  library?: string;
  /** On its own (development) or inside the former host app (the product). */
  host?: 'standalone' | 'embedded';
}

export type SettingsPatch = Partial<Pick<AppSettings, 'model' | 'dailyFolder' | 'dailyFormat' | 'dailyTemplate'>> & { library?: string; prefs?: Partial<Prefs> };

/** A copy of a note kept by file recovery. */
export interface Snapshot {
  id: string;
  time: number;
  size: number;
  /** Who made this version (src/shared/versions.ts); copies kept before 5.0.0 have none ("Earlier edit"). */
  by?: string;
  /** A version from the Git backup (Settings › Backup and sync; 21 Oct 2026), with its commit's first line. */
  from?: 'git';
  message?: string;
}

export interface SnapshotFile {
  path: string;
  count: number;
  latest: number;
}

/** What a move or rename did: where the thing is now and how many links were brought up to date. */
export interface MoveResult {
  path: string;
  linksUpdated: number;
  notesUpdated: number;
}

/** Send to the former host app: what to make from a note. */
export type SendKind = 'report' | 'portfolio' | 'pdf' | 'document' | 'slides' | 'website' | 'code' | 'ask' | 'work';
export interface SendRequest {
  kind: SendKind;
  /** Work on a project in the former host app (kind work): where (Cowork, Code or Chat), in the project's folder. */
  surface?: 'cowork' | 'code' | 'chat';
  /** Filled in by Ironleaf's main side for kind work: the project's folder on this PC. */
  folder?: string;
  /** The note's path in the library. */
  note: string;
  /** What the person adds (optional). */
  extra?: string;
  /** A report's form: a PDF, a Word document or slides. */
  format?: 'pdf' | 'docx' | 'slides';
  /** Filled in by Ironleaf's main side: the note's words and the library it is in. */
  content?: string;
  library?: string;
  /** Filled in by Ironleaf's main side for a report: the projects, their notes and folders, the template. */
  report?: ReportContext;
}

/** What the former host app is given to write a report from (src/main/app.ts reportContext). */
export interface ReportContext {
  asOf: string;
  template: string;
  templateText: string;
  projects: { name: string; section: string; notes: string[]; folder?: string; status?: string; health?: string }[];
}
export interface SendResult {
  opened: boolean;
  words?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** What the person attached to this message (src/shared/chat-attach.ts). */
  attachments?: ChatAttachment[];
}

/**
 * A file attached to a chat message: a picture the model sees (sent as a picture, already made a sensible size), a
 * document's words (PDF, Word, Excel, PowerPoint, text…), read when it was attached, or a PDF with no words of its own
 * (a scan) as pictures of its first pages.
 */
export interface ChatAttachment {
  id: string;
  name: string;
  kind: 'image' | 'text' | 'pages';
  /** The file's size as attached, in bytes. */
  size: number;
  /** A picture: its type (image/png, image/jpeg) and its bytes in base64. */
  mediaType?: string;
  data?: string;
  /** A document: its words, and whether they were cut to fit (a scan: whether only its first pages were drawn). */
  text?: string;
  cut?: boolean;
  /** A scan: its first pages as pictures, and how many pages it has. */
  pages?: { mediaType: string; data: string }[];
  pageCount?: number;
}

/** How to answer: from all notes (the parts that match), the open note in full plus what matches, or the
 *  focused the former host app conversation's transcript (one product step 5 part 4: the panel About
 *  this chat). */
export interface ChatOptions {
  scope?: 'all' | 'note' | 'chat';
  /** The note open now. */
  note?: string;
  /** Its text as it is now (it may not be saved yet). */
  noteText?: string;
  /** The the former host app conversation in view while split with a chat focused (its id and title). */
  chat?: { id: string; title?: string };
  /** Its transcript as it is now, asked of the former host app behind the native header (set by the main process, never the
page). */
  chatText?: string;
  /** Why the transcript was withheld instead: a private chat, or a locked one (set by the main process). */
  chatWithheld?: 'private' | 'locked';
  /** The transcript could not be read at all: gone, or not answering (set by the main process, never the page). */
  chatMissing?: boolean;
  /** A model for this answer (else Ironleaf's choice, else the former host app's default). */
  model?: ModelChoice | null;
  /** Folders on this PC the person added to the chat (the assistant may read only these and ones they type). */
  folders?: string[];
}

/** One thing the assistant did while answering (shown as it works). */
export interface PackActionDraft { name: string; args: Record<string, unknown> }

export interface ChatStep {
  packAction?: PackActionDraft;
  packRoot?: string;
  kind: 'say' | 'search' | 'read' | 'list' | 'write' | 'move' | 'pc' | 'error';
  words: string;
  /** A note it read, made or changed (opened from the step). */
  path?: string;
  /** What it is about (a file, a folder, a search), so the same thing again counts on one line (src/shared/chat-steps.ts). */
  about?: string;
  /** How many times it was done in a row (shown "· 12 times"). */
  times?: number;
}

/** What an answer changed in the notes, to undo as one. */
export interface ChatChanges {
  turnId: string;
  /** Notes made and changed (project files not counted: they are projects, below). */
  made: number;
  changed: number;
  moved: number;
  /** Notes taken out to the Bin (never among the paths: they are not in the notes any more). */
  binned?: number;
  /** Folders taken out to the Bin, each with how many notes went with it; folders put back. Said by name, never as notes. */
  binnedFolders?: { title: string; notes: number }[];
  restoredFolders?: { title: string; notes: number }[];
  paths: string[];
  /** Projects set up, and projects brought up to date. */
  projectsMade?: number;
  projectsChanged?: number;
  /** Files made (copies, templates) and changed in projects' folders (shown on their card beside the answer). */
  filesMade?: number;
  filesChanged?: number;
}

export interface ChatStepEvent {
  requestId: string;
  step: ChatStep;
  /** The words streamed so far were the assistant thinking aloud before a step: they move into the steps. */
  clearText: boolean;
}

export interface ChatSource {
  meetingDecision?: { text: string; line: number };
  path: string;
  title: string;
  section: string;
}

export interface ChatResult {
  text: string;
  sources: ChatSource[];
  error?: string;
  steps?: ChatStep[];
  changes?: ChatChanges;
  /** Changes to projects for the person to accept (Catch up). */
  proposals?: ChatProposal[];
  /** The change set one answer's proposals wait in (reviewed once, even after a restart). */
  changeSetId?: string;
  /** What it looked at in a project's folder, as tidy lists (a listing; what changed since a date). */
  folders?: ChatFolderCard[];
  /** Work it handed to the former host app, followed live in the chat (src/main/agent.ts hand_to_neuralspark). */
  jobs?: ChatJob[];
  /** Changes it suggested to notes, waiting in each note for the person to keep or discard (Ask before the assistant
   *  changes a note): the note and how many changes wait there now. */
  suggested?: ChatSuggested[];
}

export interface ChatSuggested {
  path: string;
  count: number;
}

/** The assistant's suggested changes to one note, from the main side (src/main/suggestions.ts): the note's words they
 *  were made against and the note with them all kept; `after` null when none wait any more. */
export interface NoteSuggestionEvent {
  path: string;
  base: string;
  after: string | null;
}

/** A project's conversation in the former host app (its folder's), as its page lists it. */
export interface ProjectConversation {
  id: string;
  title: string;
  updatedAt: number;
  running: boolean;
  /** Chat, Code or Cowork (one product, 9 Nov 2026, DESIGN A.5: each shows its kind). */
  kind: 'chat' | 'code' | 'cowork';
  /** A private chat: titled "Private chat", with no words. */
  private?: boolean;
  /** A locked chat: titled "Locked conversation", with no words (t63 break: its title reached the view). */
  locked?: boolean;
}

/** Work the assistant handed to the former host app: a former host app task, started at once, in the project's folder when it
has one. */
export interface ChatJob {
  /** The the former host app conversation. */
  id: string;
  title: string;
  project?: string;
}

/** How a handed-over job is going: working, then done (its summary and the files it made), failed or stopped. */
export interface ChatJobStatus {
  status: 'working' | 'done' | 'failed' | 'stopped' | 'unknown';
  summary: string;
  files: { name: string; path: string }[];
  why?: string;
}

/** A project's folder (or what changed in it) as the chat shows it beside an answer: folders and files, each with its kind,
 *  size and when it changed; a file opens in Ironleaf's viewer. */
export interface ChatFolderCard {
  /** The project's file. */
  project: string;
  projectName: string;
  /** list: what is in it · changed: what changed since a date · made: the files the assistant made or changed for the person. */
  kind: 'list' | 'changed' | 'made';
  /** "MarketingMachine", "Changed since 12 Oct 2026", "Made for you". */
  title: string;
  /** Where it is: the folder on this PC, or "On fileserver-01 · /home/fileserver-01/MarketingMachine". */
  place: string;
  remote: boolean;
  /** A remote project's computer, by name. */
  computerName?: string;
  /** The folder inside the project's folder it shows ('' for the top). */
  path: string;
  /** The project's folder handle (src/shared/project-folder.ts folderHandle), for the viewer. */
  folder: string;
  entries: { path: string; name: string; kind: 'folder' | 'file'; ext?: string; size?: number; modified?: number }[];
  /** More than are listed. */
  more: number;
}

export interface ChatProposal {
  id: string;
  path: string;
  name: string;
  changes: string[];
}

export interface ChatEvent {
  requestId: string;
  text: string;
}

export interface AiLinkSuggestion {
  target: string;
  targetTitle: string;
  /** Exact phrase from the note to turn into a link; empty means "add as a related link". */
  phrase: string;
  reason: string;
}

export interface AiLinkResult {
  suggestions: AiLinkSuggestion[];
  truncated: boolean;
  error?: string;
}

export interface VaultChange {
  paths: string[];
  /** Moves the window did not start (a repair, a tidy, an agent): old path, new path. Tabs, documents, bookmarks
   *  and the recorder follow these instead of closing or stranding. */
  moves?: [string, string][];
}

/**
 * A guarded save's answer (Nov 2026, nv-save: Ironleaf never loses an edit). `ok`: the words landed.
 * `conflict`: the file changed since it was read — the disk keeps the other change, the incoming words are in the
 * named copy beside it (the PC sync's own "(conflict, …)" name, so the Backup and sync page reviews them the same
 * way), and the editor says so. `missing`: the file is gone since it was read — nothing was recreated.
 * `emptied`: non-empty words were replaced with nothing (the earlier words are kept in File recovery first).
 */
/** A back-link the relations seam wrote while a save landed: which note, in which property. */
export interface SyncedBacklink {
  path: string;
  key: string;
}

export interface CheckedWrite {
  ok: boolean;
  conflict?: string;
  missing?: boolean;
  emptied?: boolean;
  /** The back-links the relations seam wrote for this save (none when nothing relation-shaped changed). */
  synced?: SyncedBacklink[];
  /** Back-links that could not be written (their notes changed mid-save); the window says so. */
  missed?: number;
}

/** Ironleaf's licence, as Settings › Licence shows it (src/main/licence/service.ts). The account block's line 1 reads
 *  accountName and its line 2 reads activated (p11-uniform-account, 4 Nov 2026): the one licence account both apps
 *  read, in the former host app's words. */
export interface LicenceStatus {
  enforcing: boolean;
  canCreate: boolean;
  reason: 'active' | 'activation-required' | 'access-ended' | 'refresh-required' | 'update-not-covered' | 'server-not-ready';
  words: string;
  account: string | null;
  /** The name on the licence account (the name they gave); null when the licence names none. */
  accountName: string | null;
  /** The grant is active (the former host app's own activated: grant status, not the entitlement
reasons). */
  activated: boolean;
  canActivate: boolean;
}

/** Ironleaf on its own: the account sign-in (src/main/standalone-account.ts), for the sign-in and
 *  not-included screens. Inside the former host app this never leaves the defaults (no sign-in there). */
export interface StandaloneAccountView {
  signedIn: boolean;
  entitled: boolean;
  name: string | null;
  email: string | null;
  accountsPage: string;
}

/** One vault, one writer (src/main/vault-lock.ts): who writes now, for the lock notice. */
export interface VaultLockView {
  mode: 'write' | 'read-only';
  words: string | null;
  otherApp: 'neuralspark' | 'neuralvault' | null;
}

// Projects (docs/PROJECTS-DESIGN.md): the Projects home's cards, a project's page, its folder's files.
import type { Project } from './project-file';
import type { LogNote } from './layouts';
export interface ProjectCard {
  path: string;
  name: string;
  status?: string;
  health?: string;
  progress?: number;
  owner?: string;
  due?: string;
  updated?: string;
  folder?: string;
  tags: string[];
  next?: string;
  /** The person's own next step here (29 Oct 2026, redesign: "Next for you" on every project), its day as written
   *  and how many of their own steps here are late, worked out the hub's way (src/shared/project-hub.ts). */
  nextMine?: string;
  nextMineWhen?: string;
  lateMine?: number;
  openNext: number;
  risks: number;
  /** The highest risk's level, for the card's colour. */
  topRisk?: string;
  modified: number;
  /** Its layout (docs/LAYOUTS.md) and the layout's one line ("47 days to opening", "95% · at risk"). */
  layout?: string;
  line?: { words: string; tone: 'ok' | 'warn' | 'bad' | 'none' };
  /** Claimed but unworked: no next step, date, live status, or health, and an empty owned folder (5 Nov 2026,
   *  u3 moving-in — offered back as "Project files to check", never unmade on its own). */
  thin?: boolean;
}

/** A folder that reads like a project but claims nothing: offered once on the Projects home, never made on its own. */
export interface FolderProjectOffer {
  folder: string;
  name: string;
  notes: number;
  tasks: number;
}

export interface ProjectFile {
  /** Path inside the project's folder ("Current/Status.xlsx"). */
  rel: string;
  name: string;
  ext: string;
  size: number;
  modified: number;
  /** When it was made (where the PC knows). */
  created?: number;
}

export interface ProjectFiles {
  /** The folder on this PC, or for a project on a remote computer its handle ("remote:<id>:<folder>": src/shared/project-folder.ts). */
  folder: string;
  exists: boolean;
  /** A remote computer's folder (read through the former host app): the computer as the former host app names it, and the
folder there. */
  remote?: { computer: string; name: string; path: string; os?: string | null };
  /** Why a remote folder couldn't be listed (offline, no longer connected, gone…), in the person's words. */
  problem?: RemoteProblem;
  /** The listing stopped before the end (a very big folder, or a slow computer): the newest found are shown. */
  partial?: boolean;
  /** Subfolders as on disk (the top first), each newest first. */
  groups: { name: string; files: ProjectFile[] }[];
  total: number;
  /** Files beyond what is listed. */
  more: number;
  /** The project has no folder: these are its own Files in Ironleaf (that folder, from the top of the library), where
   *  files its agents made were saved. */
  own?: string;
  /** A remote computer's project: files agents made for it, kept in Ironleaf (its own Files folder) because that
   *  computer's folder is read only. */
  saved?: { rel: string; folder: string; files: ProjectFile[] };
}

export interface ProjectView {
  path: string;
  /** The file's fingerprint (src/shared/project-file.ts textVersion): a change made on an older one is refused. */
  version: string;
  project: Project;
  /** People, owners and tags across every project, for suggestions while editing. */
  known: { people: { name: string; role?: string }[]; tags: string[] };
  /** Its own notes: its folder's, those with a `project` property naming it, and those its file names. Newest first. */
  notes: { path: string; title: string; modified: number }[];
  /** The former host app's task notes (Activity/), newest first. */
  activity: { path: string; title: string; status?: string; modified: number }[];
  /** How many activity notes there are in all, and how many past the thirty shown. */
  activityTotal: number;
  activityMore: number;
  /** Notes elsewhere that link to the project without belonging to it: see-also, never counted. */
  linkedFrom: { path: string; title: string }[];
  /** Its properties as read (a layout's keys among them: docs/LAYOUTS.md). */
  props: Record<string, unknown>;
  /** Its log notes (type: log naming it, or in its folder), read (src/shared/layouts.ts parseLog). */
  logs: LogNote[];
  /** Where its folder is on this PC (src/shared/project-folder.ts placeOf); `project.folder` is that folder. */
  place?: FolderPlace;
}

/** A project's folder chosen on this PC (src/main/project-places.ts): the page now, what was done, folders found. */
export interface FolderHereResult {
  view: ProjectView;
  words: string;
  /** Find it: the folders of the same name on this PC (one is used at once; several are offered). */
  found?: string[];
}

/** What Tidy would do to one project (src/shared/project-tidy.ts): the preview the person approves. */
export interface TidyPreview {
  path: string;
  name: string;
  /** The project file's fingerprint: Tidy is refused when the file changed since this preview. */
  version: string;
  moves: { kind: string; words: string; text: string }[];
  said: string[];
  historyPath: string;
}

/** Tidy done (or its Undo): the project page now, in words, and where its History note is. */
export interface TidyResult extends ProjectEditResult {
  historyPath: string;
  moved: number;
  said: string[];
}

/** A change made on a project's page (or undone, or made again): the page now, in words what happened, moves made. */
export interface ProjectEditResult {
  view: ProjectView;
  words: string;
  /** A new name moves the project's folder and file: [from, to] in order (open tabs follow). */
  moves: [string, string][];
  /** Whether there is still something to undo or redo. */
  undo: number;
  redo: number;
}

/** A project turned into a doc, a doc into a project, or that undone (src/main/docs.ts). */
export interface DocConvertResult {
  /** The file it is now. */
  path: string;
  words: string;
  /** Files that moved ([from, to]): open tabs follow them. */
  moves: [string, string][];
  /** Files sent to the Bin. */
  trashed: string[];
}

/** Text from a file in a project's folder, for its preview (the start of it when long). */
export interface ProjectFileText {
  text: string;
  truncated: boolean;
}

/** Private notes (src/main/private-notes.ts): set up here, open or locked, and how they open on this PC. */
export interface PrivateStatus {
  /** The person has set up private notes in these notes. */
  exists: boolean;
  unlocked: boolean;
  /** Windows Hello is set up for this Windows account (and Ironleaf can ask it). */
  hello: boolean;
  /** This PC opens them with Windows Hello (it was added). */
  thisPc: boolean;
  count: number;
  /** When the remembered unlock ends, in milliseconds (null: until sign-out; absent: not remembered) (8.2). */
  rememberedUntil?: number | null;
}

export interface PrivateEntry {
  /** Where it shows: "Private notes/<folders>/<name>.md". */
  path: string;
  modified: number;
  size: number;
}
