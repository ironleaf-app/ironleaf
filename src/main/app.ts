import { resolveChatAsk, MAX_CHAT_CHARS } from '../shared/chat-context';
import { notePage } from '../shared/note-passage';
// Ironleaf's main side: its window, the notes it keeps (its library), the index and the AI. The same code runs on its
// own (the development build, src/main/index.ts) and inside the former host app (the product, src/main/embed.ts): the
// host says where its data and library are, gives it its models and its licence, and how to reach the former host app.
// The renderer is sandboxed and talks to this side only through the handlers below, every channel named nv:… so they
// never meet The former host app's own.

import { SkillLibrary, skillsHome } from './skills';
import { packFrom } from './skill-import';
import { skillText, skillTitleOf, type SkillsView } from '../shared/skills';
import { RECORD_TYPES, findRecords, meetingItems, personOpenItems, projectAttention, type RecordRef, type RecordType } from '../shared/records';
import { peekWithFolderFiles } from './folder-file-peek';
import { HIDEABLE_ITEMS, type Prefs } from '../shared/prefs';
import { PdfThumbs } from './pdf-thumbs';
import { FileIndex } from './file-index';
import { MeaningBuilder } from './meaning-build';
import { defaultModelDirs, findModelDir, loadOrtModule, MeaningEmbedder, ortSessionFactory, type MeaningEmbedderLike } from './meaning-embed';
import { applyRerank, defaultRerankModelDirs, MeaningReranker, ortPairSessionFactory, type MeaningRerankerLike } from './meaning-rerank';
import { WorkerMeaningRunner, type MeaningWorkerHost } from './meaning-worker-client';
import { embedShortTexts } from './meaning-service';
import { MEANING_STATUS_QUIET, RERANK_MAX, RERANK_MAX_TEXT_CHARS, type MeaningStatus } from '../shared/meaning';
import { OcrQueue, OcrStore, WindowsOcrEngine, ocrFileText, ocrPageState, searchOcr, type OcrEngine, type OcrQueueFile } from './ocr';
import { isOcrImage, OCR_LIMITS } from '../shared/ocr';
import { attachmentText, PdfReader, readFileText, type PdfJsFiles } from './doc-text';
import { registerNotebook } from './notebook';
import { calendarList, calendarRange, calendarToday, calendarWrite } from './calendar';
import type { CalendarList, CalendarRange, CalendarToday, CalendarWrite } from '../shared/calendar';
import { registerBrief } from './brief';
import { allowRecording, registerRecorder, type RecorderDeps } from './meeting-recorder';
import { registerSpeakerEngine } from './meeting-speakers';
import { registerBackup } from './backup';
import { registerSync, type SyncService } from './sync/service';
import { registerTeams } from './teams/service';
import { ATTACH_LIMITS, cleanAttachments } from '../shared/chat-attach';
import { NO_CONNECTION } from './providers';
import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, session, shell, utilityProcess, webContents, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type OpenDialogOptions, type OpenDialogReturnValue, type SaveDialogOptions, type SaveDialogReturnValue, type WebContents } from 'electron';
import { osProtect } from './os-protect-app';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Worker } from 'node:worker_threads';
import { constants as fsConstants, existsSync, mkdirSync, promises as fsp, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiService } from './ai';
import { VaultIndex } from './indexer';
import { LibraryState, libraryKey } from './library-state';
import type { ModelsService } from './models';
import { Recovery } from './recovery';
import { NoteSuggestions } from './suggestions';
import { askerWords, ChangeSetStore } from './change-sets';
import { changeSetSummary } from '../shared/change-sets';
import { cleanAuthor, type VersionAuthor } from '../shared/versions';
import { isMachineryTop, movedFolder, movedFolderList, type MachineryCtx } from '../shared/fewer-folders';
import { SettingsStore } from './settings';
import { confirmedMissing, kindOf, setVaultBin, Vault, type ListedFile } from './vault';
import { WELCOME_NOTE } from './welcome';
import { reportError } from './error-log';
import { detectPlaces, findVaults, holdsOnlyOwn, isInside, isNewVault, lookAtVault, moveTargets, moveVault, placeOf, planMove, reopenMoved, switchLibrary, systemDeps, vaultCards, WELCOME_NAME, type Places } from './vault-place';
import { isRefusal, isWelcomeName, type FoundVault, type MoveDone, type MovePlan, type MoveRefusal, type PlaceStatus } from '../shared/vault-place';
import { HOME_FOLDERS } from '../shared/vault-home';
import { createVaultHomeService } from './vault-home-service';
import { registerPortableExport } from './portable-export';
import { registerSitePublish, type HostPublishRequest, type SitePublishDeps } from './site-publish';
import { MODULE_TYPES, MODULES, moduleFolder, moduleTypeInputs } from '../shared/module-records';
import { createPairing } from './pairing/service';
import { cleanPcs, holdsIdentity, readIdentity } from './vault-home';
import { createVaultSync } from './vault-sync';
import { BUILT_INS, builtInPath, ensureBuiltIns, listTemplates, missingBuiltIns, type TemplateRecord, type TemplateStore } from './templates';
import { folderFiles, insideFolder, ProjectHistory, Projects } from './projects';
import { createProjectChecks } from './project-checks';
import { Docs } from './docs';
import { DOCS_FOLDER, isDocNote } from '../shared/doc-file';
import { cleanNotices, mergeNotices, MIRRORED_KINDS, type HostNotices, type NoticesView } from '../shared/notices';
import { Reminders } from './reminders';
import { WeeklyTidy } from './weekly-tidy';
import { Hub } from './hub';
import { TasksService } from './tasks';
import { SharedSpacesService } from './shared-spaces';
import { writeFileSafely } from './office-edit';
import { FolderProblem, ProjectFolders, RemoteFolders, type RemoteFolderAsk } from './project-folders';
import { parseRemoteKey, projectWhere, recordedFolder, type RemoteWhere } from '../shared/project-folder';
import { hereProject, ProjectPlaces, setProjectPlaces } from './project-places';
import { ownFilesFolder } from '../shared/agent-files';
import { changedFiles, todayData } from './today';
import { sidebarTodayCount } from '../shared/today';
import { Reviews } from './reviews';
import { previewVault, tidyCopyTo } from './vault-tidy';
import { planNextAdds, plannedEdits, plannedWords, writeNoteUpdates } from './task-write';
import { PrivateNotes, type PrivateHello } from './private-notes';
import { watchLockEvents, watchSignOutEvents } from './lock-events';
import { Sensitivity } from './sensitivity';
import { SecretsStore } from './secrets';
import { registerSensitive, SensitiveWork } from './sensitive';
import { makeGate } from './agent-gate';
import { readTypes, resolveTypes } from '../shared/note-types';
import { countsOnNotes } from '../shared/notes-list';
import { allowDictationMic, dictationHandlers, startDictation, type DictationDeps } from './dictation';
import { QuickCapture } from './capture';
import { ClipperService, outsideAsar } from './clipper';
import { canonicalClipUrl } from '../shared/clipper';
import type { FullHost } from './agent-full';
import { forgetFact, rememberFact, type AssistantMemory } from '../shared/assistant-memory';
import { applyProjectEdit, claimFolderText, isProjectProps, isProjectText, parseProject, projectPath, projectsFolder, safeName, serializeProject, textVersion, unclaimProjectText, type ProjectEdit } from '../shared/project-file';
import { formatDate } from '../shared/dates';
import { dailyFolderHint, dayShapedByFolder } from '../shared/days';
import { AI_FIELDS_SYSTEM, aiFieldsPrompt, cleanAnswers, readAiFields, takeCursor, templateFields } from '../shared/template-fields';
import { PRIVATE_DIR, isPrivatePath } from '../shared/private';
import { coerceSplitFocus, type SplitFocus } from '../shared/split-focus';
import { personCards, quietBriefPeople } from '../shared/people';
import type { LockedStatus } from '../shared/secrets';
import { emlDraft, withoutPrivate, withoutSecrets } from '../shared/share';
import { captureToFlow } from './capture-flows';
import { keyStep, mainTakesZoomKey, nearestSize, stepSize } from '../shared/interface-size';
import { GROUPS, noteFromTemplate, projectFromTemplate, starterTemplate, templateFromNote, templateKind, type TemplateGroup, type TemplateInfo } from '../shared/templates';
import { applyItemEdit, copyTarget, relinkBoardText } from '../shared/project-canvas';
import { followFolder } from '../shared/views';
import { readProps } from '../shared/frontmatter';
import { diffRelationProps, relinkPropsInText } from '../shared/relation-links';
import { applyRelationWrites, planSyncAfterWrite, planUnlinkForTrash, templateNote, withoutTemplates } from './relation-sync';
import { readViewFile, writeViewFile } from '../shared/base-file';
import { readTypesFile, typesWords, writeTypesFile } from './note-types';
import { followMoves, listViews, loadWorkspace, removeView, saveView, saveWorkspace } from './workspaces';
import { purposefulCard, purposefulPeek, purposefulPersonItems, purposefulRelatedSkip, registerLife, type LifeDeps } from './life';
import { Modules } from './modules';
import { LIFE_MODULES, moduleInfo, moduleOn, modulesOn, withSwitch } from '../shared/life-modules';
import { MODULE_TOOLS } from '../shared/module-tools';
/** Modules only the person switches on: never turned on because an assistant asked for one of their tools. */
const OWN_SWITCH = new Set(['health', 'family']);
import { strayModuleFolders } from '../shared/module-records';
import { RecordModules, registerRecordModules } from './record-modules';
import { WorkModules, registerWorkModules } from './work-modules';
import { LIFE_RECORDS_GROUP } from './life-records';
import { maybeResumeMove } from './life-records/system-move';
import { makeRowResolver } from './life-records/system-tables';
import { PERSONAL_GROUP, personalInbox } from './personal-modules';
import { Publications, registerPublications, type PublicationsDeps } from './publications';
import { createBrandPrinter } from './brand-print';
import { DesignStudio } from './design-studio';
import { fileUrlPath } from './file-url-guard';
import { cleanBrand } from '../shared/assets';
import { DESIGN_FORMATS, isDesignFormat, kindInfo as designKindInfo, type DesignStartIn } from '../shared/design-doc';
import { createEditionPrinter } from './edition-print';
import { pathToFileURL } from 'node:url';
import type { Project } from '../shared/project-file';
import { projectChanges, type ProjectChange } from '../shared/project-hub';
import { todayDay } from '../shared/timeline';
import { AssetStore } from './assets';
import { BIG_FILE, registerVaultFiles, VaultFiles } from './vault-files';
import { namesAsk, namesDecide, namesDecision, namesPending, namesTold, namesUndoneLatest, namesUndoPairs, thinNotice, type CheckResult } from './vault-check';
import { writeZip } from './zip';
import { AREAS_FILE, areaOf as areaOfPath, readAreas, type Area } from '../shared/areas';
import { AgentAccess } from './agent-access';
import { ExternalEntry } from './external';
import { takesPlaces } from './windows-entry';
import { McpHttpServer } from './mcp-http';
import { askBeforeChangesUnderPolicy } from './policy';
import type { LocalMcpHttpView } from '../shared/agent-access';
import { MCP_HTTP_PORT } from '../shared/mcp-local';
import { PluginManager } from './plugins';
import { newDrawingText } from '../shared/drawing';
import { catalogueFor, sparkDefs, sparkServed, VAULT_TOOLS, type SparkVaultHost } from '../shared/vault-tools';
import { encodeLinkPath, findUnlinkedPhrase, normalizeTarget, replaceMarkdownLinks, replaceWikilinks, titleFromPath } from '../shared/markdown';
import { cleanFileName as sharedCleanFileName, folderOfPath, inFolder, isRelativeTarget, isReservedName, joinPath, relativePath } from '../shared/paths';
import { cascadeForStep, closedStepOf } from './one-task';
import { ownerNamesKept, type MatchStep } from '../shared/one-task';
import { historyNoteText, historyPathFor, planTidy } from '../shared/project-tidy';
import type { ChatOptions, ChatTurn, CheckedWrite, ModelConnectionInput, ProjectConversation, FolderHereResult, ModelChoice, ModelsView, MoveResult, ProjectEditResult, ProjectFileText, SettingsPatch, SyncedBacklink, TidyPreview, TidyResult, VaultInfo, VaultLockView } from '../shared/types';
import { closeHandshake } from './save-guard';
import type { TrayHost, TrayPorts } from './tray';
import { VaultLock, holderWords, type LockApp, type LockState } from './vault-lock';
import { CLOSE_READY, CLOSE_REQUEST, VIEW_FLUSH_MS, vaultWindowSuppressed, viewWebPreferences } from './vault-view';
import { noteBefore, recordingWrites } from './module-writes';
import { KEEP_DAYS, createVaultBin, type BinItem, type BinListed, type BinRestored } from './bin';
import { filesFolderFor, ownsFolder } from '../shared/file-records';
import { DueToday } from './due-today';
import { cleanHits, readPage } from './web-read';
import { openAbout } from './update-about';
import { installFileGuard } from './file-url-guard';

export interface IronleafHost {
  kind: 'standalone';
  /** Ironleaf's own data (settings): never the notes. */
  dataDir: string;
  /** The library Ironleaf keeps its notes in when none has been chosen. */
  defaultLibrary: string;
  preload: string;
  renderer: { file: string; devUrl?: string };
  icon: string;
  /** Ironleaf's identity on the Windows taskbar. */
  appId: string;
  /** A --test-identity build (src/main/test-build.ts): it keeps to its own notes and takes no places in Windows. */
  testBuild?: boolean;
  models: ModelsService;
  /** Inside the former host app: Windows Hello (a PIN, face or fingerprint), which opens Private notes on this PC. */
  hello?: PrivateHello;
  /** Inside the former host app: The former host app brought forward on one of its conversations (a task note's "Open in the
former host app"). */
  openConversation?(id: string): void;
  /** Inside the former host app: the bell's notices, the former host app's own (finished tasks, approvals waiting, automations
that ran). */
  notices?: HostNotices;
  /** Inside the former host app: the one bin both apps use (8.0 U13; the former host app's
   *  native-runtime/plugins/desktop/bin.mjs). `put` keeps a deleted thing 30 days in Recently deleted: files are moved
   *  in; `ref` points at what Ironleaf keeps itself. */
  bin?: {
    put(item: { kind: string; title: string; detail?: string; files?: string[]; ref?: unknown }): Promise<unknown>;
    /** A note, file or folder into the vault's own Bin (the former host app's vault-bin.mjs, .neuralvault/bin), by the person. */
    putVault?(item: { rel: string; library: string }): Promise<unknown>;
    /** Recently deleted, the one list (conversations, the former host app's things, the vault's Bin): list, restore, purge,
empty. */
    call?(input: { action: string; id?: string; type?: string; sessionId?: string }): Promise<unknown>;
  };
  /** Inside the former host app: a document's words by the former host app's readers (Word, Excel, PowerPoint, PDF, emails…);
null: not one. */
  readDocument?(absolutePath: string): Promise<string | null>;
  /** Inside the former host app: the person's mailboxes (Gmail, Outlook) through the connection they already have. */
  mail?: {
    mailboxes(): Promise<{ id: string; label: string; address: string }[]>;
    list(mailbox: string, limit: number): Promise<{ uid: number; from: string; date: string; subject: string; words: string; unread: boolean }[]>;
    /** One mail whole, as its MIME bytes (parsed in the vault, as a saved .eml is). */
    read(mailbox: string, uid: number): Promise<{ raw: Uint8Array }>;
  };
  /** Inside the former host app: a project's folder on a remote computer the former host app connects to, read through its
   *  connection (read only: info, list, changed, find, read, bytes; src/main/project-folders.ts). Rejects with `kind`
   *  saying why. */
  remoteFolder?: RemoteFolderAsk;
  /** Inside the former host app: The former host app brought forward at Settings › Connections › Remote
computers. */
  openRemoteComputers?(): void;
  /** On its own: keys typed in Ironleaf for the former host app's connections (inside the former host app the keys stay the
former host app's). */
  keys?: { set(connectionId: string, key: string): Promise<void>; remove(connectionId: string): Promise<void> };
  /** The app's secret store on this PC, for live pairing tokens (V10, V11): read only inside the main process. */
  pairTokens?: { get(id: string): string | undefined; set(id: string, token: string): Promise<void>; remove(id: string): Promise<void> };
  /** On its own: the application menu (keys such as zoom and reload in development). */
  menu?: boolean;
  /** Inside the former host app: a job the side chat hands over (a former host app task, unattended), and how it is
going. */
  neuralSparkJob?(request: { agent: { agentId: string; agentName: string; level: string; where: string }; brief: string; project?: { name: string; note: string; folder: string | null }; files?: string[]; from?: 'assistant' }): Promise<{ conversationId: string; status: string }>;
  /** Inside the former host app: a project's conversations there, newest first: those in its folder on this PC ({folder}), on
   *  its remote computer's folder ({remote}), and any that worked on it in Ironleaf ({note}: its file), My workspace
   *  included. */
  projectWork?(where: { folder?: string; remote?: { computer: string; path: string }; note?: string }): Promise<{ conversations?: { id: string; title: string; updatedAt: number; running: boolean; kind?: string; private?: boolean }[] }>;
  /** Inside the former host app: a conversation's transcript there while a chat is focused (one product step 5 part 4),
   *  asked of the runtime behind the native header: {title, text}; {private:true} or {locked:true} when its words
   *  may not cross; null when it is gone. */
  chatTranscript?(id: string): Promise<{ title: string; text: string } | { private: true } | { locked: true } | null>;
  /** One strip (one product, 9 Nov 2026): the view's tabs, told for the one above (opening, closing, active).
   *  Each tab carries what it is (a place, a Notes folder, a note) so one place opens one tab above. */
  vaultTabs?(report: { tabs: { id: string; title: string; target?: { place?: string; folder?: string; note?: string } }[]; active: string | null }): void;
  neuralSparkJobStatus?(conversationId: string): Promise<{ status: string; files?: { path: string; name: string }[]; words?: string; summary?: string; why?: string }>;
  /** Inside the former host app (21 Oct 2026): today's events from the person's Google Calendar, as the former host app's
   *  runtime answers GET /native-desktop/google/calendar/today (asked from the former host app's main process with the
   *  runtime's origin and token, as its other Ironleaf calls are): {connected:false, reason} or {connected:true, date,
   *  timeZone, updated, events, error?}. Ironleaf checks it (src/shared/calendar.ts) and shows it on Today; it never
   *  writes events into notes. */
  calendarToday?(): Promise<unknown>;
  /** Inside the former host app (8.9 two-way sync): the person's calendars, events across days, and making, moving and
   *  removing events, through the former host app's own calendar connections (never a second sign-in). Each asked from
   *  the former host app's main process like calendarToday; each answer checked here. Missing on older former host app:
   *  the Vault says plainly it needs the former host app for now. */
  calendarList?(): Promise<unknown>;
  calendarRange?(args: { from: string; to: string }): Promise<unknown>;
  calendarWrite?(args: { op: 'create' | 'update' | 'delete'; calendarId: string; eventId?: string; event?: { title: string; start: string; end: string; allDay: boolean; location: string } }): Promise<unknown>;
  /** Inside the former host app (8.0 V6): its own free web search (src/web-search-page.cjs: its browser on this PC), {results:
   *  [{title, url, snippet}]}, for the side chat's web_search. */
  webSearch?(query: string, max?: number): Promise<unknown>;
  /** Inside the former host app (c3 item 2): whether its Models web-search switch is off (live: read for each question, so
   *  the side chat offers no web tools while it is off). Missing on older former host app: the web tools are
   *  offered. */
  webSearchOff?(): boolean;
  /** Inside the former host app (8.0 V1): its own vault tools (views, bulk changes, the Bin, records, clips, charts, imports,
   *  receipts; its runtime's vault-served.mjs), served in the one catalogue to the side chat and outside agents. tools()
   *  is the last list known (sync); call() runs one as who asked ('side-chat' or 'agent:<id>'), each changed file with
   *  its text before. */
  sparkVault?: SparkVaultHost;
  /** Inside the former host app (21 Oct 2026, gap G18): one piece of a meeting recording written down — a WAV of about a
   *  minute (16 kHz, one channel, under 4 MB) — by the former host app's speech code with the person's own OpenAI or
   *  Gemini key (native-runtime/plugins/desktop/voice-talk.mjs, the way Talk listens). Answers {text, segments?:
   *  [{start, text}]} (start in seconds into the piece) or {error} in plain words. Ironleaf never sees a key. */
  transcribeAudio?(audio: Uint8Array, mime: string, hints?: string[], opts?: { signal?: AbortSignal; language?: string }): Promise<unknown>;
  /** Inside the former host app (22 Oct 2026): where recordings would be written down now, asked before a meeting starts, as
   *  its transcribe route plans it: {ready, route, provider?, error?} (error in plain words: what to set up, and where). */
  transcribeStatus?(): Promise<unknown>;
  /** Inside the former host app (8.6 voice, second pass): live transcription while dictating (its dictate route, the
   *  same sessions the former host app's message box dictates through): {op:'begin', route, hear, accent, words}
   *  → {id, rate, provider}; {op:'chunk', id, audio, last} → {partial, final?}; {op:'end', id} → {ended:true}. */
  dictate?(request: Record<string, unknown>): Promise<unknown>;
  /** Inside the former host app (21 Oct 2026, gap G20): what its automations found overnight, for Today's brief, as its
   *  runtime answers GET /native-desktop/brief: {generatedAt, items: [{id?, kind, title, detail?, link?, action?:
   *  {label, ask? | url?}, source?, priority?, at?}]}. Checked by src/shared/brief.ts cleanFound; left out of the brief
   *  when absent. */
  briefItems?(): Promise<unknown>;
  /** Inside the former host app (21 Oct 2026, gap G28): its git and the environment its Git sign-in needs
   *  (src/git-service.cjs env(): the bundled Git, and the broker that answers with the person's the former host app
   *  Git accounts), for Settings › Backup and sync's Git backup. null: not available now. Ironleaf never sees a token
   *  from it. */
  git?(): Promise<{ exe: string; env: Record<string, string> } | null>;
  /** A Windows notice of the host's own (else Ironleaf shows Electron's); clicking it opens the request. */
  notify?(note: { title: string; body: string; onClick?: () => void }): void;
  /** Inside the former host app (23 Oct 2026): the person's PCs and the vault each has open, from the former host app's
   *  computer list (native-runtime/plugins/work/bot-computers.mjs: each PC says its open vault, sealed, to the others): a
   *  list of {id, name, me, online, lastSeen, vault: {id, name, path?, place, placeName} | null}, checked by
   *  src/main/vault-home.ts cleanPcs. For Settings › Files and links › Your PCs and the warning when this PC's vault
   *  isn't theirs. */
  pcVaults?(): Promise<unknown>;
  /** Inside the former host app (24 Oct 2026, Publications): an edition's PDF sent by a chat bot to the person's paired chat
   *  ({channel: 'telegram', file, caption}), or from a chat bot's email address ({channel: 'email', file, caption,
   *  subject, to}). Answers {ok, words}: words in plain English when it couldn't be sent (Telegram not paired, no bot
   *  email). */
  deliver?(request: { channel: 'telegram' | 'email'; file?: string; text?: string; caption: string; subject?: string; to?: string[] }): Promise<{ ok: boolean; words: string }>;
  /** Inside the former host app (9.0 w122publish): a built site folder through its Publish destinations (Netlify,
   *  Cloudflare Pages, GitHub Pages, the person's own server): hosts, connect, options, publish, status, unpublish.
   *  Missing standalone, where a site goes to a folder only. */
  sitePublish?(request: { op: string; [key: string]: unknown }): Promise<unknown>;
  /** Inside the former host app (5.2.0): the look both apps share: the light palette and the accent, and since one
   *  product step 4 (8 Nov 2026) light or dark, the interface size and density too (one shared row in Settings
   *  writes both stores). Ironleaf takes them at start and when they change there, and hands its own changes back. */
  appearance?: {
    get(): { palette?: string; accent?: string; theme?: string; zoom?: number; density?: string } | null;
    set(look: { palette?: string; accent?: string; theme?: string; zoom?: number; density?: string }): void;
    onChange(fn: (look: { palette?: string; accent?: string; theme?: string; zoom?: number; density?: string }) => void): void;
  };
  /** Inside the former host app (one product step 1, 8 Nov 2026): Vault's page shown in the former host app's window as
   *  a view — the window prompts parent to, and the shared interface size stepped by the view's zoom keys. */
  viewParent?(): BrowserWindow | null;
  viewZoomStep?(step: -1 | 0 | 1): void;
  /** Inside the former host app (one product step 6, 9 Nov 2026): the former host app hosts Vault's page, so no
   *  path makes Vault's window — links, reminders, health and agents land in the former host app's one
   *  window instead. Absent on its own. */
  inWindow?(): boolean;
  /** Inside the former host app (one product step 6): show the former host app's one window on this target instead of a
window. */
  showInWindow?(target?: { note?: string; line?: number; place?: string; folder?: string; newNote?: boolean }): Promise<unknown>;
  /** Ironleaf's version, and inside the former host app, the former host app's. */
  version?: string;
  hostVersion?: string;
  /** What the host's program needs to be started with to open Ironleaf, for Ironleaf's places in Windows (links, Open with,
   *  the ironleaf command; src/main/windows-entry.ts). Inside the former host app ['--neuralvault'] unless given. */
  launchArgs?: string[];
  /** On its own: the tray icon (src/main/tray.ts), asked once a close has saved every edit. */
  tray?: TrayHost;
  log?(message: string): void;
}

export interface IronleafApp {
  /** What the tray icon needs from inside (src/main/tray.ts). */
  tray: TrayPorts;
  /** This window opened at one of its Settings sections (the former host app › Settings › Ironleaf), on the named row when one
is given. */
  openSettingsAt?(section: string, row?: string): Promise<void>;
  /** Life modules (Wave 5) for the former host app and a chat bot: the module tools on now, and one called as
   *  'neuralspark', 'neuralbot' or 'bot:<id>' through that agent's gate (src/main/modules.ts). */
  modules?: {
    /** Each tool's own step words (what the former host app's step row says while it runs) and its module's id and name. */
    tools(): { name: string; title: string; description: string; level: string; input: Record<string, unknown>; required: string[]; step: string; module: string; moduleName: string }[];
    call(who: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean; done?: { words: string } }>;
    /** The former host app's Recently deleted (8.0 U13): a Health entry Ironleaf keeps sealed, put back or let go. */
    bin?(action: 'restore' | 'forget', kind: unknown, ref: unknown): Promise<{ done: boolean; words: string }>;
    /** A caller's top results re-scored by real relevance (10.0 m10rerank): the same mix as Vault search (exact
     *  titles first). {ok:false} when the model is not for this ask — the caller keeps its own order. Caller-given
     *  texts only; no vault notes are read, so no gate is needed. */
    rerank?(query: string, items: { id: string; title: string; text: string }[]): Promise<{ ok: true; order: string[] } | { ok: false }>;
    /** Short texts to the on-device model's vectors (10.0 reuse, 2 Nov 2026): The former host app's sender matching
     *  asks through the asks seam (`embed`). Capped (at most 20 texts of 500 characters): a note body cannot
     *  pass, so nothing private is ever embedded here. `{ok: false, words}` when the model is not started. */
    embed?(texts: unknown): Promise<{ ok: true; vectors: number[][] } | { ok: false; words: string }>;
  };
  /** Inside the former host app: a brand kit the former host app saved, kept as Ironleaf's own when it has
none yet. */
  adoptBrand(kit: { name?: string; colours?: { name?: string; hex?: string; use?: string }[]; fonts?: { name?: string; use?: string }[]; logo?: string }): Promise<{ adopted: boolean; words: string }>;
  /** Several edits proposed as one change set (10.0, v2changes): The former host app or a bot's door to the waiting set the
   *  side chat offers. Nothing is written until the person accepts in Ironleaf. */
  proposeChangeSet?(who: string, input: { askWords?: string; entries: { path: string; name?: string; base: string | null; after: string; changes?: string[] }[] }): Promise<{ text: string; isError?: boolean; setId?: string }>;
  /** A page matched to the person's example kept as a publication's layout (Publications keepLayout). */
  keepLayout(o: { publication?: string; page: string }): Promise<{ kept: boolean; words: string }>;
  /** The whole vault checked and put right where there is one right answer (src/main/vault-check.ts). */
  checkVault(o?: { repair?: boolean }): Promise<CheckResult & { at: number }>;
  /** Opens (or brings forward) Ironleaf's window, at a note when one is named (a path in the library), and at a line of it
   *  when one is given (a reminder's notice in the former host app's bell). */
  open(target?: { note?: string; line?: number }): Promise<void>;
  /** A place through the same seam (one product step 2: today, inbox, projects, tasks, meetings, notes, people,
   *  graph, with a folder for Notes) opens that page instead. Step 3 adds a new note through the same seam. */
  open(target?: { note?: string; line?: number; place?: string; folder?: string; newNote?: boolean }): Promise<void>;
  /** Inside the former host app (one product step 1): Vault's side in the former host app's window — its page's webContents
   *  attached and detached, shown at a note without ever making a window, and its edits saved before the former host
   *  app closes. */
  attachView(contents: WebContents): void;
  detachView(): void;
  openInView(target?: { note?: string; line?: number }): Promise<void>;
  /** A place through the same seam (one product step 2): the view shows that page without ever making a window. */
  openInView(target?: { note?: string; line?: number; place?: string; folder?: string; newNote?: boolean; settings?: string; row?: string }): Promise<void>;
  /** Whether the main area is split and which side has focus (one product step 5 part 3): told to the view
   *  alone, so the chat panel re-scopes at once. */
  splitFocus(told: unknown): void;
  /** One strip (one product, 9 Nov 2026): show this Vault tab, told to the view alone. */
  tabsActivate(id: unknown): void;
  /** One strip: close this Vault tab, told to the view alone. */
  tabsClose(id: unknown): void;
  /** A Settings section through the same seam (one product step 4): the view shows Vault's own page for it (its whole
   *  sub-screens: the keyboard editor, plugins, publish), on its row when one is named, without ever making a window. */
  /** One Settings (one product step 4): the former host app's Settings reads Vault's settings and models through the host,
   *  and writes them back the same way the window does, so Vault's sections there show the same controls over the same
   *  settings. The packs and the hideable buttons ride along as catalogues (their names live here, not in the prefs). */
  vaultSettings(): { prefs: Prefs; model: ModelChoice | null; about: { version: string; host: 'standalone' | 'embedded'; hostVersion?: string }; ai: { ready: boolean; note: string | null; modelName: string | null }; dailyFolder: string; dailyFormat: string; dailyTemplate: string; library: string; packs: { id: string; name: string; words: string }[]; hideable: { id: string; group: string; label: string }[] };
  vaultModels(): ModelsView;
  updateVaultSettings(patch: SettingsPatch): Promise<{ prefs: Prefs; model: ModelChoice | null; about: { version: string; host: 'standalone' | 'embedded'; hostVersion?: string }; ai: { ready: boolean; note: string | null; modelName: string | null }; dailyFolder: string; dailyFormat: string; dailyTemplate: string; library: string; packs: { id: string; name: string; words: string }[]; hideable: { id: string; group: string; label: string }[] }>;
  flushView(ms?: number): Promise<boolean>;
  /** One window (one product step 6): private notes as the second window's close leaves them, for the one window's close. */
  closePrivate: () => void;
  window(): BrowserWindow | null;
  library(): string | null;
  /** The person's own name as the notes know it (shared/today.ts whoIsMe over the open notes), for the former
   *  host app's account block (p11-uniform-account round 2); null until the notes are open or with no
   *  clear owner. */
  person(): string | null;
  /** Today's count for the former host app's one side bar (one product step 3): the person's own steps late or due
today. */
  todayCount(): Promise<number>;
  /** The Notes tree in the former host app's one side bar (one window): the top folders with note counts, most
   *  notes first, through the same machinery rule Notes reads — the app's own folders and kept-out folders
   *  hide. */
  topFolders(): Promise<{ name: string; prefix: string; count: number }[]>;
  /** Ironleaf's window closed: for the host to decide what happens next. */
  onClosed(fn: () => void): () => void;
  /** Quick capture's box over whatever the person is doing (src/main/capture.ts): for a host's own entry to it. */
  capture(): Promise<void>;
  /** Ironleaf running without its window: its notes opened and Quick capture's key held (inside the former host app, at start). */
  start(): Promise<void>;
  stop(): void;
  /** What a second start of the host's program asked for (21 Oct 2026, gap G26): ironleaf:// links and Markdown files
   *  ("Open with"). Ironleaf listens for Electron's second-instance itself; a host calls this only for arguments it
   *  took first (the former host app's start before Ironleaf had started). */
  launch(argv: readonly string[]): Promise<void>;
}

const CHANNEL = (name: string) => 'nv:' + name;

/** This PC, for Private notes (each PC that opens them with Windows Hello is one entry): an id kept in Ironleaf's data. */
function deviceOf(dataDir: string): { id: string; name: string } {
  const file = path.join(dataDir, 'device.json');
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as { id?: unknown };
    if (typeof v.id === 'string' && /^[0-9a-f-]{36}$/.test(v.id)) return { id: v.id, name: os.hostname() };
  } catch {
    // Not made yet.
  }
  const id = randomUUID();
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ id }));
  } catch {
    // It is made again next time; this PC is added again then.
  }
  return { id, name: os.hostname() };
}

export async function createIronleaf(host: IronleafHost): Promise<IronleafApp> {
  // Deletes go to the former host app's Recently deleted when Ironleaf runs inside it (8.0 U13; vault.ts
  // setVaultBin).
  const hostBin = host.bin;
  setVaultBin(
    hostBin
      ? async ({ rel, library }) => {
          // The vault's own Bin (inside the vault, so it travels with the notes): The former host app lists it in
          // Recently deleted.
          if (!hostBin.putVault) return false;
          await hostBin.putVault({ rel, library });
          return true;
        }
      : null,
  );
  const settings = new SettingsStore(host.dataDir);
  settings.about = { version: host.version ?? app.getVersion(), host: host.kind, ...(host.hostVersion ? { hostVersion: host.hostVersion } : {}) };
  const index = new VaultIndex();
  const state = new LibraryState(host.dataDir);
  // The same vault on every PC (24 Oct 2026, src/shared/vault-settings.ts): the vault's settings and what Ironleaf
  // remembers about it are kept in the vault (.neuralvault/settings.json, .neuralvault/state/), the person's preferences
  // in personal.json (the former host app carries them to their other PCs), this PC's own here; each change is stamped
  // with this PC.
  const thisPc = deviceOf(host.dataDir);
  settings.device = state.device = () => thisPc.id;
  settings.mayWriteVault = state.mayWriteVault = () => requireCreate().then(() => true, () => false);
  settings.log = state.log = (m) => host.log?.(m);
  const recovery = new Recovery(host.dataDir, () => ({ minutes: settings.raw.prefs.recoveryMinutes, days: settings.raw.prefs.recoveryDays }));
  // Settings › Backup and sync (src/main/backup.ts; 21 Oct 2026, gap G28): made with the window's handlers (registerIpc).
  let backup: ReturnType<typeof registerBackup> | null = null;
  // Ironleaf Sync (src/main/sync/, docs/SYNC.md): made with the window's handlers too.
  let syncService: SyncService | null = null;
  // Settings › Teams (src/main/teams/): the team, its shared vaults (through Sync) and its policy.
  let teamsService: ReturnType<typeof registerTeams> | null = null;
  // Who is writing now, for the earlier versions' credit (19 Oct 2026, 5.0.0): an agent's call runs inside its name
  // (the side chat's catalogue below), so every note it writes, by whichever step, says so. Outside one, a write is the person's.
  const writer = new AsyncLocalStorage<VersionAuthor>();
  /** The author a write is credited to: the one given, else the agent whose call this is, else the person. */
  const authorNow = (by?: VersionAuthor): VersionAuthor => by ?? writer.getStore() ?? 'you';
  const exported = new Set<string>();
  let filesTimer: NodeJS.Timeout | undefined;
  const models = host.models;
  const ai = new AiService(settings, index, models);
  // A project's folder is per PC (src/main/project-places.ts): this PC's choices are kept in its own settings.
  const projectPlaces = new ProjectPlaces({ choices: settings });
  setProjectPlaces(projectPlaces);
  const projects = new Projects(index);
  const projectChecks = createProjectChecks(projects, index);
  // Docs (src/main/docs.ts): a project turned into a doc and back, a new doc, Undo — through the same writes, moves and
  // Bin as everything else.
  const docsService = new Docs({
    content: (rel) => index.content(rel),
    notes: () => index.allMeta().map((m) => ({ path: m.path, title: m.title, props: m.props ?? {}, links: m.links })),
    resolve: (target, from) => index.resolveAny(target, from),
    listing: async () => {
      const all = await requireVault().listAll();
      return { files: all.files.map((f) => ({ rel: f.rel, kind: f.kind })), folders: all.folders, skipped: all.skipped };
    },
    exists: async (rel) => requireVault().any(rel),
    write: (rel, text) => writeNote(rel, text),
    readText: (rel) => requireVault().readText(rel),
    writeText: async (rel, text) => {
      await requireCreate();
      const v = requireVault();
      await v.writeText(rel, text);
      void recovery.keep(rel, text, { by: authorNow() });
      notifyChanged([rel]);
    },
    move: async (from, to) => (await movePath(from, to, true)).path,
    trash: async (rel) => {
      await trashRel(rel);
    },
    today: () => formatDate('D MMM YYYY'),
    isoToday: () => formatDate('YYYY-MM-DD'),
    docsFolder: () => DOCS_FOLDER,
  });
  /** Each project's changes (the person's and the assistant's), to undo from its page. */
  const projectHistory = new ProjectHistory();
  /** Thumbnails Windows makes for PDFs and slides in a project's folder, by file and time changed. */
  const thumbs = new Map<string, string | null>();
  /** First-page pictures of PDFs the window draws (src/main/pdf-thumbs.ts), kept in Ironleaf's own data. */
  const pdfThumbs = new PdfThumbs(path.join(host.dataDir, 'pdf-thumbnails'));
  // Searching inside project files (src/main/file-index.ts): the words of each project folder's documents, kept in
  // Ironleaf's own data. PDFs are read with the PDF.js the window ships (found beside the window's files).
  let pdfJs: PdfJsFiles | null | undefined;
  const findPdfJs = (): PdfJsFiles | null => {
    if (pdfJs !== undefined) return pdfJs;
    pdfJs = null;
    for (const dir of [path.join(path.dirname(host.renderer.file), 'assets'), path.join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'pdfjs')]) {
      try {
        const names = readdirSync(dir);
        const lib = names.find((n) => /^pdf\.min(-[\w-]+)?\.mjs$/.test(n));
        const worker = names.find((n) => /^pdf\.worker\.min(-[\w-]+)?\.mjs$/.test(n));
        if (lib && worker) {
          pdfJs = { lib: path.join(dir, lib), worker: path.join(dir, worker) };
          break;
        }
      } catch {
        // Not here.
      }
    }
    return pdfJs;
  };
  // One PDF reader for the file search and the chat's attachments.
  const pdfReader = new PdfReader(findPdfJs);
  const fileIndex = new FileIndex({
    dir: path.join(host.dataDir, 'file-index'),
    pdf: pdfReader,
    ...(host.readDocument ? { bridge: (abs: string) => host.readDocument!(abs) } : {}),
    // A project with no folder on this PC: its own Files in Ironleaf (what its agents saved) are searched instead.
    projects: () => (vault ? projects.list().map((c) => ({ path: c.path, name: c.name, folder: c.folder ?? ownFilesAt(c.path) ?? undefined })) : []),
    prefs: () => ({ on: settings.raw.prefs.fileSearch, off: settings.raw.prefs.fileSearchOff }),
    onStatus: (status) => send('fileindex:status', status),
    log: (m) => host.log?.(m),
  });
  // A project's folder wherever it is: on this PC, or on a remote computer through the former host app
  // (src/main/project-folders.ts).
  const remoteFolders = new RemoteFolders(host.remoteFolder);
  const projectFolders = new ProjectFolders(remoteFolders, (project, rel) => fileIndex.read(project, rel));
  /** The project's own Files folder in the library, on this PC, when it is there: where files agents make for a project
   *  with no folder on this PC are saved (src/shared/agent-files.ts ownFilesFolder). */
  const ownFilesAt = (rel: string): string | null => {
    if (!vault) return null;
    try {
      const abs = vault.absolute(ownFilesFolder(rel));
      return statSync(abs, { throwIfNoEntry: false })?.isDirectory() ? abs : null;
    } catch {
      return null;
    }
  };
  /** A project as its files are reached: one with no folder (here or on a remote computer) whose own Files folder is
   *  there is read from that folder, as if it were its folder on this PC (its project file is never changed). */
  const withFiles = <T extends { folder?: string; key?: string }>(rel: string, p: T): T => {
    if ((p.folder && p.folder.trim()) || parseRemoteKey(p.key)) return p;
    const own = ownFilesAt(rel);
    return own ? { ...p, folder: own } : p;
  };
  /** A project's file and where its files are. */
  const projectAt = (rel: unknown) => {
    const file = cleanRel(rel);
    const p = withFiles(file, projects.view(file).project);
    return { p, where: projectWhere(p) };
  };
  /** A project's folder on this PC to open, show and read files from (its own Files folder when it has no folder). */
  const pcFolderOf = (rel: unknown): string | undefined => {
    const file = cleanRel(rel);
    return withFiles(file, projects.view(file).project).folder;
  };
  /** A remote project's folder, or null for one on this PC (or none). */
  const remoteOf = (rel: unknown): RemoteWhere | null => {
    const { where } = projectAt(rel);
    return where?.kind === 'remote' ? where : null;
  };
  const READ_ONLY = (w: RemoteWhere) => `This project’s folder is on ${projectFolders.remote.nameOf(w)}: Ironleaf shows its files in its own viewer, read only.`;
  /** The projects' files last seen: a change to one of them (or a new one) brings the files index in line. */
  let knownProjects = new Set<string>();
  let fileSyncTimer: NodeJS.Timeout | undefined;
  const syncFileIndex = () => {
    clearTimeout(fileSyncTimer);
    fileSyncTimer = setTimeout(() => {
      knownProjects = new Set(vault ? projects.list().map((c) => c.path) : []);
      void fileIndex.sync();
    }, 600);
  };
  // Words in pictures and scans (src/main/ocr.ts): Windows' own recogniser reads pictures among the notes and scanned
  // PDF pages in the background, kept per vault in Ironleaf's own data. Off Windows the engine says so, and search
  // simply has no picture words. NV_OCR_TESTWORDS=1 (tools/shots-w123ocr.mjs only, never in the product) pretends the
  // recogniser is there with made-up languages, so the Settings row can be pictured on this machine.
  const ocrEngine: OcrEngine =
    !app.isPackaged && process.env.NV_OCR_TESTWORDS === '1'
      ? {
          available: async () => ({ ok: true }),
          languages: async () => [
            { tag: 'en-AU', name: 'English (Australia)' },
            { tag: 'en-GB', name: 'English (United Kingdom)' },
          ],
          readImage: async () => ({ width: 0, height: 0, lines: [] }),
          readPdfPage: async () => ({ width: 0, height: 0, lines: [] }),
        }
      : new WindowsOcrEngine();
  let ocrStore: OcrStore | null = null;
  let ocrQueue: OcrQueue | null = null;
  // Real find-by-meaning (10.0 Wave 2): the on-device model and each library's embeddings, kept in Ironleaf's own
  // data. The model starts beside the open, never holding it; the hashed fallback answers until it runs. Off the main
  // thread (9 Nov 2026, the stutters): in the worker when its file stands, in-process as before when missing.
  let meaningEmbedder: MeaningEmbedderLike | null = null;
  let meaningBuilder: MeaningBuilder | null = null;
  // The on-device reranker (10.0 m10rerank): re-scores the top results of Vault search by real relevance, and answers
  // the former host app's conversation and Library searches through modules.rerank below (one model, asked through
  // one seam).
  let meaningReranker: MeaningRerankerLike | null = null;
  /** A PDF's pages, and which hold no words (scans): read with the file search's PDF reader. */
  const ocrPdfPages = async (abs: string): Promise<{ pages: number; empty: boolean[] }> => {
    const buf = await fsp.readFile(abs);
    const text = await pdfReader.read(new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), OCR_LIMITS.pages, OCR_LIMITS.fileChars);
    const parts = text.split(/^\fpage (\d+)$/gm).slice(1);
    let pages = 0;
    const empty: boolean[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const n = Number(parts[i]);
      if (!Number.isFinite(n) || n < 1 || n > OCR_LIMITS.pages) continue;
      pages = Math.max(pages, n);
      empty[n - 1] = !parts[i + 1].replace(/\s+/g, '');
    }
    return { pages, empty: Array.from({ length: pages }, (_, i) => empty[i] ?? true) };
  };
  /** Pictures and PDFs among the notes, as the words-in-pictures queue takes them. */
  function ocrFilesOf(v: Vault, files: ListedFile[]): OcrQueueFile[] {
    return files
      .filter((f) => f.kind === 'pdf' || (f.kind === 'image' && isOcrImage(/\.([^.\\/]+)$/.exec(f.rel)?.[1] ?? '')))
      .map((f) => ({ rel: f.rel, abs: v.absolute(f.rel), mtime: f.mtime, size: f.size, kind: f.kind === 'pdf' ? ('pdf' as const) : ('image' as const) }));
  }
  // Private notes: encrypted on disk, opened with Windows Hello on this PC or the recovery password; locked after a while
  // unused, when another folder of notes opens, and when the window closes.
  // The remembered unlock (8.2) is sealed by Windows on this PC and kept in Ironleaf's own data, never in the vault.
  const rememberedFile = path.join(host.dataDir, 'remembered-unlock.json');
  const privateNotes = new PrivateNotes({
    root: () => vault?.root ?? null,
    hello: host.hello ?? null,
    device: deviceOf(host.dataDir),
    lockAfter: () => settings.raw.prefs.privateLockMinutes,
    keepUnlocked: () => settings.raw.prefs.secretsKeepUnlocked,
    rememberedSeal: {
      available: () => osProtect.available(),
      // Its words are made before anything waits: a lock meanwhile wipes the key it was handed.
      protect: (plain) => osProtect.seal(plain.toString('base64')),
      unprotect: async (sealed) => Buffer.from(await osProtect.open(sealed), 'base64'),
    },
    rememberedStore: {
      read: async () => { try { return await fsp.readFile(rememberedFile, 'utf8'); } catch { return null; } },
      write: async (text) => { await fsp.mkdir(host.dataDir, { recursive: true }); const tmp = `${rememberedFile}.tmp`; await fsp.writeFile(tmp, text, 'utf8'); await fsp.rename(tmp, rememberedFile); },
      clear: async () => { await fsp.rm(rememberedFile, { force: true }).catch(() => {}); },
    },
    onLocked: () => send('private:locked', null),
    trash: (abs) => toTrash(abs),
  });
  // Sensitivity levels, the audit trail and Secrets (Wave 4, src/main/sensitivity.ts, src/main/secrets.ts): levels from
  // the vault's own file and each note's property; Secrets in the same locked store as Private notes (one lock).
  const sensitivity = new Sensitivity({ root: () => vault?.root ?? null, props: (rel) => index.get(rel)?.props, pc: os.hostname(), log: (m) => host.log?.(m) });
  const secrets = new SecretsStore({ store: privateNotes, trash: (abs) => toTrash(abs), clipboard: { write: (t) => clipboard.writeText(t), read: () => clipboard.readText(), clear: () => clipboard.clear() } });
  let vault: Vault | null = null;
  ai.vaultRoot = () => vault?.root;
  // The window's file: requests (security review, 20 Nov 2026; src/main/file-url-guard.ts): only the open vault,
  // Ironleaf's own folders and this PC's project folders; never another computer (a
  // picture naming \\host\share or file://host/… would send this PC's sign-in to it).
  let guardFolders: { at: number; folders: string[] } = { at: 0, folders: [] };
  const fileRoots = () => {
    if (Date.now() - guardFolders.at > 5000) {
      let folders: string[] = [];
      try {
        folders = projects.list().map((p) => p.folder ?? '').filter((f): f is string => !!f && path.isAbsolute(f));
      } catch {}
      guardFolders = { at: Date.now(), folders };
    }
    const own = [host.dataDir, app.getAppPath(), process.resourcesPath, path.dirname(process.execPath), path.dirname(host.renderer.file), os.tmpdir(), app.getPath('temp')];
    return { roots: [...(vault?.root ? [vault.root] : []), ...own.filter(Boolean), ...guardFolders.folders] };
  };
  installFileGuard(session.defaultSession.webRequest, fileRoots, { platform: process.platform, realpath: (p) => fsp.realpath(p), log: (m) => host.log?.(m) });
  /** One vault, one writer (16 Nov 2026): this vault's lock while open, and who holds it when another app does. */
  let vaultLock: VaultLock | null = null;
  let lockHeld: LockState = { held: false };
  const lockApp: LockApp = 'neuralvault';
  const lockView = (): VaultLockView => (lockHeld.held ? { mode: 'read-only', words: holderWords(lockHeld.lock, lockApp), otherApp: lockHeld.lock.app } : { mode: 'write', words: null, otherApp: null });
  let win: BrowserWindow | null = null;
  /** Vault's page in the former host app's window (one product step 1): its webContents while attached, else
null. */
  let viewContents: WebContents | null = null;
  // The asset store (src/main/assets.ts): the library's Assets folder and pasted files, their index, thumbnails kept in
  // Ironleaf's own data.
  const assets = new AssetStore({
    root: () => vault?.root ?? null,
    listAll: () => requireVault().listAll(),
    absolute: (rel) => requireVault().absolute(rel),
    notes: () => index.allMeta(),
    resolve: (target, from) => index.resolveAny(target, from),
    folders: () => ({ assets: settings.raw.prefs.assetsFolder, attachments: settings.raw.prefs.attachmentsFolder }),
    // Each area of life's own asset library, and files kept beside their notes (Wave 4 part c).
    areaAssets: () => ({ folders: areasNow().map((a) => `${a.folder}/Assets`), withRecord: settings.raw.prefs.filesWithRecord !== false }),
    areaOf: (rel) => areaOfPath({ path: rel }, areasNow())?.id,
    level: (rel) => sensitivity.level(rel),
    areaFolder: (id) => {
      const a = areasNow().find((x) => x.id === id);
      return a ? `${a.folder}/Assets` : undefined;
    },
    cacheDir: path.join(host.dataDir, 'asset-thumbnails'),
    added: async () => {
      if (vault) await refreshFiles(vault);
      filesChanged();
    },
    today: () => formatDate('YYYY-MM-DD'),
  });
  // Files done properly (Wave 4 part c, src/main/vault-files.ts): every file beside its record with its small record (what
  // it is for, what it says, where it came from, its versions), big imports that carry on after a break, files on the PC
  // linked where they are, and the move of the flat attachments folder into place.
  let areasCache: { root: string; mtime: number; areas: Area[] } | null = null;
  const areasNow = (): Area[] => {
    const root = vault?.root;
    if (!root) return [];
    try {
      const abs = path.join(root, ...AREAS_FILE.split('/'));
      const mtime = statSync(abs).mtimeMs;
      if (areasCache?.root === root && areasCache.mtime === mtime) return areasCache.areas;
      const areas = readAreas(readFileSync(abs, 'utf8')).config?.areas ?? [];
      areasCache = { root, mtime, areas };
      return areas;
    } catch {
      return [];
    }
  };
  // The last time the vault checked itself (src/main/vault-check.ts), for the side chat and the former
  // host app.
  let lastCheck: (CheckResult & { at: number }) | null = null;
  // A Systems list row a link names (records as data, 5 Nov 2026): a link to a folded record is not broken.
  // Rebuilt when the index moves on.
  let rowResolveGen = -1;
  let rowResolveFn: ((t: string) => string | null) | null = null;
  const rowResolve = (t: string): string | null => {
    const gen = index.generation?.() ?? -1;
    if (!rowResolveFn || rowResolveGen !== gen) {
      rowResolveGen = gen;
      rowResolveFn = makeRowResolver(index);
    }
    return rowResolveFn(t);
  };
  const vaultFiles = new VaultFiles({
    root: () => vault?.root ?? null,
    // This PC's record of the vault's linked files is kept under the vault's identity (src/main/vault-files.ts › LinkedRefs).
    vaultKey: async () => {
      const id = vault?.root ? (await readIdentity(vault.root).catch(() => null))?.id : null;
      return id ? `id:${id}` : '';
    },
    listAll: async () => (await requireVault().listAll()).files.map((f) => ({ rel: f.rel, mtime: f.mtime, size: f.size })),
    notes: () => index.allMeta().map((m) => ({ path: m.path, props: m.props, links: m.links })),
    resolve: (target, from) => index.resolveAny(target, from) ?? rowResolve(target),
    readNote: async (rel) => index.content(rel) ?? (await requireVault().read(rel)),
    writeNote: (rel, text) => writeNote(rel, text),
    movePath: (from, to, updateLinks) => movePath(from, to, updateLinks),
    added: async (rels) => {
      const v = requireVault();
      for (const rel of rels) if (kindOf(rel) === 'note') await indexFile(v, rel);
      await refreshFiles(v);
      if (rels.length) notifyChanged(rels);
      filesChanged();
    },
    dataDir: host.dataDir,
    readText: (abs, ext, size) => readFileText(abs, ext, size, { pdf: pdfReader, ...(host.readDocument ? { bridge: (file: string) => host.readDocument!(file) } : {}) }),
    level: (rel) => sensitivity.level(rel),
    assistantMay: (rel) => {
      const d = sensitivity.decide('side-chat', rel, 'The side chat');
      return d.ok ? { ok: true } : { ok: false, why: d.why.replace(/ Don’t guess at what it says\..*$/, '') };
    },
    askJson: async (system, user, timeoutMs, maxTokens) => {
      const r = await ai.askJson(system, user, timeoutMs, maxTokens);
      if (r.error) throw new Error(r.error);
      return r.reply;
    },
    levelsMoved: async (pairs) => {
      const moved = new Map(pairs.map(([a, b]) => [a.toLowerCase(), b]));
      const store = sensitivity.store();
      if (!Object.keys(store.items).some((k) => moved.has(k.toLowerCase()))) return;
      await sensitivity.update((st) => {
        for (const [k, level] of Object.entries(st.items)) {
          const to = moved.get(k.toLowerCase());
          if (!to) continue;
          delete st.items[k];
          st.items[to] = level;
        }
      });
    },
    prefs: () => ({ attachmentsFolder: settings.raw.prefs.attachmentsFolder, templatesFolder: settings.raw.prefs.templatesFolder, dailyFolder: settings.raw.dailyFolder, filesWithRecord: settings.raw.prefs.filesWithRecord }),
    setFilesWithRecord: async (on) => {
      if (settings.raw.prefs.filesWithRecord === on) return;
      await settings.update({ prefs: { filesWithRecord: on } });
      send('settings:changed', { ...settings.view(), host: host.kind, library: libraryPath() });
    },
    areaOf: (rel) => areaOfPath({ path: rel }, areasNow())?.id,
    areaFilesFolders: () => areasNow().map((a) => `${a.folder}/Files`),
    progress: (state) => send('vfiles:progress', state),
    writeZip: (dest, sources) => writeZip(dest, sources),
    log: (m) => host.log?.(m),
  });
  let pendingNote: string | null = null;
  // A deep link's place waiting for the notes to open (one product step 2): sent with vault:opened, like a note.
  // Step 3 carries a new note through the same seam.
  let pendingPlace: { place: string; folder?: string; newNote?: boolean } | null = null;
  // A Settings section waiting for the notes to open (one product step 4): the view shows Vault's own page for it.
  let pendingSettings: { section: string; row?: string } | null = null;
  const chatControllers = new Map<string, AbortController>();
  /** Folders the person added to the chat with its folder button (the assistant may read them). */
  const chatFolders = new Set<string>();
  // Jobs the assistant handed to the former host app, with the files each made: only these open from the chat. Their ids
  // are kept in Ironleaf's data (the newest 100), so a kept chat's job cards still show how each ended after a restart
  // (19 Oct 2026: they showed only "In the former host app", with no file, once Ironleaf had started again).
  const assistantJobs = new Map<string, Set<string>>();
  const jobsFile = path.join(host.dataDir, 'assistant-jobs.json');
  try {
    const kept = JSON.parse(readFileSync(jobsFile, 'utf8')) as unknown;
    if (Array.isArray(kept)) for (const id of kept.slice(-100)) if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) assistantJobs.set(id, new Set());
  } catch {
    // None kept yet.
  }
  const keepJobs = () => {
    while (assistantJobs.size > 100) assistantJobs.delete(assistantJobs.keys().next().value!);
    try {
      writeFileSync(jobsFile, JSON.stringify([...assistantJobs.keys()]));
    } catch {
      // Followed while Ironleaf runs; the cards show less after a restart.
    }
  };
  // Conversations a project's page listed (only these open from it).
  const projectConversations = new Set<string>();
  const closedListeners = new Set<() => void>();
  /** The window-close handshake's waiter (F2): the renderer's "saved everything" resolves it. */
  let closeReady: (() => void) | null = null;
  /** The view-flush handshake's waiter (one product step 1): the view's page resolves it the same way. */
  let viewReady: (() => void) | null = null;
  let pendingChanges = new Set<string>();
  let pendingMoves = new Map<string, string>();
  let changeTimer: NodeJS.Timeout | undefined;

  const send = (channel: string, payload: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(CHANNEL(channel), payload);
    if (viewContents && !viewContents.isDestroyed()) viewContents.send(CHANNEL(channel), payload);
  };
  /** To the view's page alone (one product step 1): view-only navigation, never the window too. */
  const sendToView = (channel: string, payload: unknown) => {
    if (viewContents && !viewContents.isDestroyed()) viewContents.send(CHANNEL(channel), payload);
  };
  /** The assistant's suggested changes waiting in notes (Ask before the assistant changes a note; src/main/suggestions.ts). */
  const suggestions = new NoteSuggestions((event) => send('suggestions:changed', event));
  /** Proposed change sets waiting for review as one (10.0, v2changes; src/main/change-sets.ts): kept on disk per library. */
  const changeSets = new ChangeSetStore(
    host.dataDir,
    {
      read: async (p) => index.content(p) ?? (vault ? await vault.read(p).catch(() => null) : null),
      write: async (rel, text, by) => {
        const before = index.content(rel);
        await writeNote(rel, text, by ?? writer.getStore() ?? 'assistant');
        // A project an accepted change touched: in the project's history with the person's own changes (Undo on its page).
        if (before !== undefined && (isProjectText(text) || isProjectText(before))) projectHistory.record(rel, { before, after: text, words: 'An accepted change to the project.', by: 'assistant' });
      },
    },
    () => send('change-sets:changed', { waiting: changeSets.waitingCount() }),
  );

  /** The lock notice's "Open it there": the other app brought forward (its single lock focuses a running copy). */
  async function openOtherApp(): Promise<void> {
    if (!lockHeld.held) return;
    const other = lockHeld.lock.app;
    throw new Error(other === 'neuralvault' ? 'Another Ironleaf window has these notes open. Switch to it, or close it first.' : 'Another app has these notes open. Close it first.');
  }

  /** Creating, editing and AI need the licence once it is enforced (without a licence, read and export only). */
  async function requireCreate(): Promise<void> {
    // One vault, one writer (16 Nov 2026): while the other app writes, this side reads only. Each write tries the
    // lock again first, so the first save after the other app closes lands without asking.
    if (lockHeld.held && vaultLock) {
      const again = await vaultLock.acquire().catch((): LockState => lockHeld);
      if (again.held) throw new Error(holderWords(again.lock, lockApp));
      lockHeld = again;
      send('vault-lock:changed', lockView());
    }
  }

  // Plugins, a first small door (8.9): the vault's .neuralvault/plugins/, each a manifest and one script in a sandbox
  // (src/main/plugins.ts). Started for each vault as it opens (openVault below); Settings › Plugins lists them.
  const plugins = new PluginManager({
    dataDir: host.dataDir,
    vaultRoot: () => vault?.root ?? null,
    listNotes: async () => index.allMeta().map((m) => m.path),
    readNote: async (rel) => index.content(rel) ?? (await requireVault().read(rel)),
    writeNote: (rel, text) => writeNote(rel, text),
    existsNote: async (rel) => !!index.get(rel),
    canWrite: () => requireCreate(),
    trashPath: (abs) => shell.trashItem(abs),
    send,
    log: (m) => host.log?.(m),
  });
  plugins.load();

  /** Whether the AI features can run with this choice, and if not, what to do, in words. */
  function aiStatus(choice: ModelChoice | null): { ready: boolean; note: string | null; modelName: string | null } {
    const view = models.view();
    const picked = models.effectiveChoice(choice);
    if (!picked) return { ready: false, note: view.connections.length ? 'Choose a model for your AI connection in Settings › AI.' : NO_CONNECTION, modelName: null };
    const conn = view.connections.find((c) => c.id === picked.provider);
    const name = conn ? `${conn.models.find((m) => m.id === picked.model)?.name ?? picked.model} (${conn.name})` : picked.model;
    if (conn?.key === 'missing') return { ready: false, note: `${conn.name} needs its key: add it in Settings › AI.`, modelName: name };
    return { ready: true, note: null, modelName: name };
  }
  settings.aiStatus = aiStatus;
  ai.modelName = (choice) => aiStatus(choice ?? null).modelName;

  function modelsView(): ModelsView {
    const view = models.view();
    return { ...view, choice: settings.raw.model, effective: models.effectiveChoice(settings.raw.model) };
  }

  function requireVault(): Vault {
    if (!vault) throw new Error('Ironleaf’s notes are not open yet.');
    return vault;
  }

  /**
   * The vault checked with the names ask honoured (Nov 2026 break audit: names Windows cannot keep are planned,
   * asked about once, and only then repaired). A look first; an approved plan applies (approved here or on another
   * PC) and is told once, quietly; anything undecided asks once when `ask` (the vault open), otherwise waits. Records
   * and links keep their own repair either way.
   */
  async function runCheckWithNames(o: { repair: boolean; ask: boolean }): Promise<{ r: CheckResult; applied: [string, string][]; failed: string[] }> {
    const v = requireVault();
    const templatesFolder = settings.raw.prefs.templatesFolder;
    const look = await vaultFiles.check({ repair: false, templatesFolder });
    let apply: [string, string][] | null = null;
    if (look.renames.length || look.nameLeft.length) {
      const decision = await namesDecision(v.root, look.renames, look.nameLeft).catch(() => null);
      if (decision === 'approved') {
        const pending = await namesPending(v.root, look.renames, look.nameLeft).catch(() => []);
        if (pending.length) apply = pending;
      } else if (decision === null && o.ask) {
        const ask = namesAsk(look.renames, look.nameLeft);
        reminders.post([{ key: ask.key, kind: ask.kind, title: ask.title, body: ask.body, path: '' }], { quiet: true });
      }
    }
    if (!o.repair) return { r: look, applied: [], failed: [] };
    const r = await vaultFiles.check({ repair: true, names: apply !== null, ...(apply ? { plan: apply } : {}), receipt: true, templatesFolder });
    let applied: [string, string][] = [];
    let failed: string[] = [];
    if (apply) {
      const rest = await namesPending(v.root, look.renames, look.nameLeft).catch(() => []);
      applied = apply.filter(([a, b]) => !rest.some(([x, y]) => x === a && y === b));
      failed = r.nameLeft.filter((l) => /couldn’t be renamed/.test(l));
      if (applied.length || failed.length) {
        const told = namesTold(applied, failed);
        reminders.post([{ key: told.key, kind: told.kind, title: told.title, body: told.body, path: told.path }], { quiet: true });
      }
    }
    return { r, applied, failed };
  }

  function isTrustedSender(event: IpcMainInvokeEvent): boolean {
    const fromWindow = !!win && !win.isDestroyed() && event.sender === win.webContents;
    const fromView = !!viewContents && !viewContents.isDestroyed() && event.sender === viewContents;
    if (!fromWindow && !fromView) return false;
    const url = event.senderFrame?.url ?? '';
    return host.renderer.devUrl ? url.startsWith(host.renderer.devUrl) : url.startsWith('file://');
  }

  /** The window a prompt parents to (one product step 1): in the view, the former host app's window from the host; else
   *  Vault's own window; null when neither is there (the prompt shows unparented, as with no window today). With
   *  both open (t17 break, 8 Nov 2026: the view's window owned every prompt, so one asked from Vault's own window
   *  opened behind it): the surface in use owns it — the focused one — else the view's window as before. */
  function promptOwner(): BrowserWindow | null {
    const viewOpen = !!viewContents && !viewContents.isDestroyed();
    const winOpen = !!win && !win.isDestroyed();
    if (viewOpen && winOpen) {
      try {
        if (win!.isFocused()) return win;
      } catch {}
      try {
        if (viewContents!.isFocused()) {
          const w = host.viewParent?.() ?? null;
          if (w && !w.isDestroyed()) return w;
        }
      } catch {}
    }
    if (viewOpen) {
      try {
        const w = host.viewParent?.() ?? null;
        if (w && !w.isDestroyed()) return w;
      } catch {}
      return null;
    }
    return winOpen ? win : null;
  }

  /** Every file or folder prompt in this file goes through these two, so each parents to the right window. */
  function showOpen(options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
    const o = promptOwner();
    return o ? dialog.showOpenDialog(o, options) : dialog.showOpenDialog(options);
  }
  function showSave(options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
    const o = promptOwner();
    return o ? dialog.showSaveDialog(o, options) : dialog.showSaveDialog(options);
  }

  /** Focus back on Vault's surface: its window, else its view in the former host app's window. */
  function focusSurface(): void {
    if (win && !win.isDestroyed()) {
      win.focus();
      return;
    }
    try {
      viewContents?.focus();
    } catch {}
  }

  /** The page's webContents, whichever surface shows it: the window's, else the view's. */
  function pageContents(): WebContents | null {
    if (win && !win.isDestroyed()) return win.webContents;
    if (viewContents && !viewContents.isDestroyed()) return viewContents;
    return null;
  }

  /** Registers a handler that only answers Ironleaf's own pages (its window and, one product step 1, its view).
   *  With `sender`, the handler also gets the answering page's event first, so it can tell the two apart. */
  function handle(channel: string, fn: (...args: any[]) => unknown, opts?: { sender?: boolean }): void {
    ipcMain.handle(CHANNEL(channel), async (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Request refused.');
      return opts?.sender ? fn(event, ...args) : fn(...args);
    });
  }

  function notifyChanged(paths: string[], moves: [string, string][] = []): void {
    // Every changed note is embedded again when its words moved (private and left-out notes are refused inside).
    meaningBuilder?.notesChanged(paths);
    for (const p of paths) pendingChanges.add(p);
    for (const [a, b] of moves) pendingMoves.set(a, b);
    clearTimeout(changeTimer);
    // An import under way: said once when it is done (holdWatch), not after every note it touched.
    if (importHold > 0) return;
    changeTimer = setTimeout(() => {
      const batch = [...pendingChanges];
      pendingChanges = new Set();
      const moved = [...pendingMoves];
      pendingMoves = new Map();
      send('vault:changed', { paths: batch, ...(moved.length ? { moves: moved } : {}) });
      if (batch.some((p) => knownProjects.has(p) || isProjectProps(index.get(p)?.props))) syncFileIndex();
    }, 120);
  }

  /** The file list changed (a file or folder added, moved or removed): the renderer reads it again. */
  function filesChanged(): void {
    clearTimeout(filesTimer);
    filesTimer = setTimeout(() => send('files:changed', null), 150);
  }

  /** An import merging into the vault now (vault-home-service.ts importNow, pairing/service.ts): the watcher's news about
   *  its files is not read one by one (20 Nov 2026 — each of ~1,600 arriving files was read, kept as an outside change
   *  and announced, and every announcement had the window read Today, Inbox, Projects and the brief again, so the
   *  import crawled for many minutes with the app pegged and unresponsive). The import rescans once when it is done. */
  let importHold = 0;
  async function holdWatch<T>(run: () => Promise<T>): Promise<T> {
    importHold++;
    try {
      return await run();
    } finally {
      importHold--;
      // What arrived while held is read now, even when the import failed or stopped halfway, and said in one go.
      if (importHold === 0 && vault) await rescan(vault).catch(() => undefined);
      if (importHold === 0 && (pendingChanges.size || pendingMoves.size)) notifyChanged([]);
    }
  }

  async function indexFile(v: Vault, rel: string): Promise<string | null> {
    if (kindOf(rel) !== 'note') return null;
    try {
      const [content, stat] = await Promise.all([v.read(rel), v.stat(rel)]);
      index.set(rel, content, stat.mtime, stat.size, stat.born);
      return content;
    } catch (err) {
      // Only a note that is gone leaves the index: one briefly locked (antivirus, OneDrive mid-write) stays as it was
      // read last, and the next change reads it again.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT' || (err as NodeJS.ErrnoException)?.code === 'ENOTDIR') index.delete(rel);
      return null;
    }
  }

  /** The files that aren't notes, for links and embeds that name them. */
  /** After Recently deleted put something back, the file list and index see it at once (the watcher would, a moment later). */
  async function refreshAfterRestore(): Promise<void> {
    try {
      if (vault) await refreshFiles(vault);
      filesChanged();
    } catch {
      /* the watcher catches up */
    }
  }
  async function refreshFiles(v: Vault): Promise<void> {
    const { files } = await v.listAll();
    index.setFiles(files.filter((f) => f.kind !== 'note').map((f) => f.rel));
  }

  async function rescan(v: Vault): Promise<void> {
    const all = await v.listAll();
    index.setFiles(all.files.filter((f) => f.kind !== 'note').map((f) => f.rel));
    const files = all.files.filter((f) => f.kind === 'note');
    const present = new Set(files.map((f) => f.rel));
    const changed: string[] = [];
    // Only notes confirmed gone leave the index: one the listing could not read (a folder refused for a moment, a
    // file another program holds) stays, and so does its open tab (src/main/vault.ts › confirmedMissing).
    for (const rel of await confirmedMissing(index.allMeta().map((m) => m.path), present, v.lastSkipped, (rel) => v.isGone(rel))) {
      index.delete(rel);
      changed.push(rel);
    }
    // Read in small batches so a big library doesn't open thousands of files at once.
    for (let i = 0; i < files.length; i += 32) {
      await Promise.all(
        files.slice(i, i + 32).map(async (f) => {
          const known = index.get(f.rel);
          if (known && known.mtime === f.mtime && known.size === f.size) return;
          await indexFile(v, f.rel);
          changed.push(f.rel);
        }),
      );
    }
    if (changed.length) notifyChanged(changed);
    filesChanged();
    // Pictures added or changed (the watcher folds them into a rescan): their words are read in the background.
    if (ocrQueue && vault === v) ocrQueue.scan(ocrFilesOf(v, all.files));
  }

  const info = (v: Vault): VaultInfo => ({ path: v.root, name: v.name, library: path.resolve(v.root).toLowerCase() === path.resolve(libraryPath()).toLowerCase() });

  /** Real find-by-meaning for the library opening: its kept embeddings install, the model starts beside the open. */
  function wireMeaning(v: Vault): void {
    meaningBuilder?.stop();
    index.attachMeaning(null);
    index.attachRerank(null);
    const oldEmbedder = meaningEmbedder;
    meaningEmbedder = null;
    if (oldEmbedder) void oldEmbedder.close();
    const oldReranker = meaningReranker;
    meaningReranker = null;
    // The worker holds both models in one runner: closing twice is safe (its close is idempotent).
    if (oldReranker && oldReranker !== (oldEmbedder as unknown as MeaningRerankerLike)) void oldReranker.close();
    const modelDir = findModelDir(defaultModelDirs(__dirname));
    // Off the main thread (9 Nov 2026, the stutters): the worker holds both models once, like the speaker engine's
    // worker; the main process only sends text and receives vectors. Missing worker file, in-process as before (the
    // same classes, the same fallback words); a missing model still reads the same words from the worker.
    const workerFile = path.join(__dirname, 'meaning-worker.cjs');
    const rerankDirEarly = findModelDir(defaultRerankModelDirs(__dirname));
    if (existsSync(workerFile) && (modelDir || rerankDirEarly)) {
      try {
        const w = new Worker(workerFile);
        w.on('error', () => undefined);
        const whost: MeaningWorkerHost = {
          post: (message) => w.postMessage(message),
          onMessage: (fn) => {
            w.on('message', fn);
          },
          end: async () => {
            await w.terminate();
          },
        };
        const runner = new WorkerMeaningRunner(whost, { embedDir: modelDir, rerankDir: rerankDirEarly });
        const fallbackWords = modelDir ? 'the meaning runner is missing from this install' : 'the meaning model is missing from this install';
        const builder = new MeaningBuilder({
          dir: path.join(host.dataDir, 'meaning', libraryKey(v.root)),
          embedder: modelDir ? runner : null,
          fallbackWords,
          index: index.meanings(),
          list: () => index.allMeta().map((m) => m.path),
          read: (p) => {
            const meta = index.get(p);
            const content = index.content(p);
            return meta && content !== undefined ? { title: meta.label, content } : null;
          },
          isExcluded: (p) => index.isExcluded(p),
          onStatus: (s) => send('meaning:status', s),
          log: (m) => host.log?.(m),
        });
        meaningBuilder = builder;
        if (modelDir) meaningEmbedder = runner;
        if (rerankDirEarly) {
          meaningReranker = runner;
          index.attachRerank({ score: (q, texts) => runner.score(q, texts) });
        }
        index.attachMeaning(builder);
        void builder.start();
        void runner
          .start()
          .then((r) => {
            if (vault !== v) {
              void runner.close();
              return;
            }
            if (modelDir && meaningEmbedder !== runner) {
              void runner.close();
              return;
            }
            if (!modelDir && rerankDirEarly && meaningReranker !== runner) {
              void runner.close();
              return;
            }
            if (modelDir && !r.embed.ok) host.log?.(`Meaning search is off on this PC: ${r.embed.words}.`);
            if (modelDir) builder.setEmbedder(r.embed.ok ? runner : null, r.embed.ok ? '' : r.embed.words);
          })
          .catch((err: unknown) => {
            host.log?.(`meaning worker not ready: ${err instanceof Error ? err.message : String(err)}`);
            if (modelDir && meaningEmbedder === runner && vault === v) builder.setEmbedder(null, 'the meaning model would not start on this PC');
          });
        return;
      } catch (err) {
        host.log?.(`meaning worker not ready: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const loaded = loadOrtModule(__dirname, (err) => host.log?.(`meaning runner beside the bundle failed to load: ${err instanceof Error ? err.message : String(err)}`));
    // The reranker on the same runner (no second loader): it starts lazily on the first search that can use it.
    const rerankDir = findModelDir(defaultRerankModelDirs(__dirname));
    const reranker = rerankDir && loaded ? new MeaningReranker({ modelDir: rerankDir, factory: ortPairSessionFactory(loaded.ort, loaded.wasmDir) }) : null;
    if (reranker) {
      meaningReranker = reranker;
      index.attachRerank({ score: (q, texts) => reranker.score(q, texts) });
    }
    const embedder = modelDir && loaded ? new MeaningEmbedder({ modelDir, factory: ortSessionFactory(loaded.ort, loaded.wasmDir) }) : null;
    const fallbackWords = modelDir ? 'the meaning runner is missing from this install' : 'the meaning model is missing from this install';
    const builder = new MeaningBuilder({
      dir: path.join(host.dataDir, 'meaning', libraryKey(v.root)),
      embedder,
      fallbackWords,
      index: index.meanings(),
      list: () => index.allMeta().map((m) => m.path),
      read: (p) => {
        const meta = index.get(p);
        const content = index.content(p);
        return meta && content !== undefined ? { title: meta.label, content } : null;
      },
      isExcluded: (p) => index.isExcluded(p),
      onStatus: (s) => send('meaning:status', s),
      log: (m) => host.log?.(m),
    });
    meaningBuilder = builder;
    if (embedder) meaningEmbedder = embedder;
    index.attachMeaning(builder);
    void builder.start();
    // The model starts beside the open, never holding it (a slow start only delays the embeddings, never the vault).
    if (embedder) {
      void embedder.start().then((r) => {
        if (meaningEmbedder !== embedder || vault !== v) {
          void embedder.close();
          return;
        }
        // A failure to load is said aloud to the log as well as the window's quiet line (6 Nov 2026,
        // find-by-meaning: the fallback words otherwise lived only in the UI).
        if (!r.ok) host.log?.(`Meaning search is off on this PC: ${r.words}.`);
        builder.setEmbedder(r.ok ? embedder : null, r.ok ? '' : r.words);
      });
    }
  }

  async function openVault(folder: string): Promise<VaultInfo> {
    const next = await Vault.open(folder);
    // Another folder of notes opened in place (V12, 28 Oct 2026): a Markdown folder that is neither the person's vault nor
    // ever an Ironleaf vault (another app's, a Git repository of notes) is read and written only where the person
    // edits: no templates added, no folders tidied, no links or canvases repaired, nothing folded or put in the bin, so a
    // `git diff` after browsing it shows nothing Ironleaf did on its own.
    const inPlace = !info(next).library && !(await holdsIdentity(next.root).catch(() => false));
    // A vault opening (at start, or switching) takes the words out of memory, but must not take the sealed
    // remembered unlock away before it is checked below (8.5, 30 Oct 2026): close(), not lock().
    // tryRememberedUnlock then keeps it only for this vault, inside the chosen period.
    if (vault && vault.root !== next.root) {
      ai.leavingVault(vault.root);
      for (const controller of chatControllers.values()) controller.abort();
    }
    privateNotes.close();
    vault?.close();
    void ocrStore?.flush();
    ocrQueue?.stop();
    meaningBuilder?.stop();
    meaningBuilder = null;
    void meaningEmbedder?.close();
    meaningEmbedder = null;
    void meaningReranker?.close();
    meaningReranker = null;
    index.attachMeaning(null);
    index.attachRerank(null);
    index.clear();
    assets.reset();
    vault = next;
    // One vault, one writer (16 Nov 2026): this vault's lock while open. A foreign folder opened in place keeps
    // none (nothing is ever written into it); its own writes still queue per file as before.
    await vaultLock?.release().catch(() => {});
    vaultLock = null;
    lockHeld = { held: false };
    if (!inPlace) {
      vaultLock = new VaultLock(next.root, { app: lockApp });
      lockHeld = await vaultLock.acquire().catch((): LockState => ({ held: false }));
      if (lockHeld.held) send('vault-lock:changed', lockView());
    }
    ocrStore = new OcrStore(path.join(host.dataDir, 'ocr', libraryKey(next.root)));
    ocrQueue = new OcrQueue({
      store: ocrStore,
      engine: ocrEngine,
      pdfPages: ocrPdfPages,
      prefs: () => ({ on: settings.raw.prefs.ocrRead, lang: settings.raw.prefs.ocrLang }),
      onStatus: (s) => send('ocr:status', s),
      log: (m) => host.log?.(m),
    });
    recovery.use(next.root);
    // Crash temps swept (9.2: failed writes never litter beside notes); never in a foreign folder opened in place.
    if (!inPlace) void next.sweepTemps().catch(() => {});
    void backup?.opened(next.root);
    void syncService?.opened(next);
    suggestions.reset();
    await changeSets.use(next.root);
    await rescan(next);
    syncFileIndex();
    wireMeaning(next);
    next.on('change', async (rel: string) => {
      if (vault !== next || importHold > 0) return;
      const content = await indexFile(next, rel);
      // A note changed outside Ironleaf (the former host app saving into it, a sync, another editor): kept for
      // recovery, and credited to the sync service the notes are in when there is one ("Sync (OneDrive)").
      // Ironleaf's own writes heard again here are the same words, so they keep their own credit.
      if (content !== null) {
        const place = await places().then((p) => placeOf(next.root, p, placeDeps), () => null);
        const by = place && place.kind !== 'local' && place.kind !== 'network' ? cleanAuthor(`sync:${place.name}`) : undefined;
        void recovery.keep(rel, content, { by: by ?? 'outside' });
      }
      notifyChanged([rel]);
      filesChanged();
    });
    next.on('rescan', () => {
      if (vault === next && importHold === 0) void rescan(next);
    });
    next.watch();
    void privateNotes.tryRememberedUnlock();
    await settings.rememberVault(next.root);
    // The vault's own settings and memories read from it (the first time on this PC, this PC's own moved in), so every
    // PC shows the same; this PC says it has it open (src/main/vault-sync.ts).
    state.useVault(next.root, { inPlace });
    if (await settings.useVault(next.root, { inPlace }).catch(() => false)) settingsArrived();
    vaultSync.opened();
    // The vault's plugins (a foreign folder opened in place gets none written into it).
    void plugins.useVault(next.root, inPlace).catch((e) => host.log?.(`Plugins: ${e instanceof Error ? e.message : String(e)}`));
    // Its identity (written once) and settings.json's `current`: what the former host app and a chat bot
    // use (src/main/vault-home-service.ts).
    void vaultHome.opened(next.root, { inPlace }).catch(() => {});
    const opened = info(next);
    // Every library Ironleaf opens gets the ready-made templates, once (the record of what was written is kept per
    // library in Ironleaf's own data): never over the person's own or beside one of the same name, and one they
    // delete stays deleted.
    try {
      if (!inPlace) {
        await requireCreate();
        await ensureTemplates();
      }
    } catch {
      // Read-only (no licence yet) or the folder can't be written: the Templates page offers them later.
    }
    // Module folders left outside their area go into it, each file with its links (strayModuleFolders).
    if (!inPlace) void tidyModuleFolders(next).then(() => repairCanvases(next)).then((boards) => boards.length && notifyChanged(boards)).catch(() => {});
    // The vault looks after itself (src/main/vault-check.ts): file records and links to files put right when the vault
    // opens, a little after, so opening is never slower for it. Names Windows cannot keep are planned first and asked
    // about once, naming the files — never repaired behind the person's back (Nov 2026 break audit). An approved plan
    // applies (approved here or on another PC: the receipt is in the vault, so every PC converges instead of
    // storming); a declined plan never asks again.
    setTimeout(() => {
      if (vault !== next) return;
      // Older editions' item notes folded into their editions (src/main/publications.ts foldItems).
      if (!inPlace) void publications.foldItems().catch((e) => host.log?.(`Publications fold: ${e instanceof Error ? e.message : String(e)}`));
      void runCheckWithNames({ repair: !inPlace, ask: !inPlace }).then(
        ({ r }) => {
          if (vault !== next) return;
          lastCheck = { at: Date.now(), ...r };
          if (r.fixed.length || r.left.length) host.log?.(`Vault check: ${r.words}`);
          if (r.fixed.length && !inPlace) filesChanged();
          // Notes that hold almost nothing: one quiet bell line offering them, never a delete (v4-no-clutter item 5).
          if (r.thin.length) {
            const ntc = thinNotice(r.thin);
            reminders.post([{ key: ntc.key, kind: ntc.kind, title: ntc.title, body: ntc.body, path: ntc.path }], { quiet: true });
          }
        },
        (e) => host.log?.(`Vault check didn’t finish: ${e instanceof Error ? e.message : String(e)}`),
      );
    }, 8000);
    // Reminders: checked from now on, and at once (those due while Ironleaf was closed are said as missed).
    reminders.start();
    void reminders.check();
    dueToday.start();
    void dueToday.check().catch(() => {});
    // The weekly tidy: this week's proposal prepared when the week has turned.
    tidy.start();
    // Finance and Documents and ID: their notices checked (only while one is switched on).
    recordModules.start();
    // The work modules (Wave 6 part b): their notices checked (only while one is switched on).
    workModules.start();
    // The Wave 7 part b modules: their notices checked (only while one is switched on).
    lifeRecords.start();
    // A Systems tidy-up the person started, stopped by the app closing or a briefly locked file, carries on by
    // itself now (8 Nov 2026, the plan item 2): same receipt, backup and Undo. Never in place (a foreign
    // folder is never touched); never starting a move, only finishing one; anything else waits for the person.
    if (!inPlace) void maybeResumeMove(lifeRecords).catch(() => undefined);
    // Home, Vehicles, Career and Travel (Wave 7 part a): their notices checked (only while one is switched on).
    personal.start();
    // Publications (Wave 6 part a): its schedule checked (only while it is switched on).
    publications.switched();
    // The window may have loaded before the notes finished indexing at start.
    send('vault:opened', opened);
    if (pendingNote) {
      send('note:show', pendingNote);
      pendingNote = null;
    }
    if (pendingPlace) {
      send('vault:open-place', pendingPlace);
      pendingPlace = null;
    }
    return opened;
  }

  /** Ironleaf's library: the folder it keeps its notes in (Settings › Files in Ironleaf), else the default. */
  function libraryPath(): string {
    return settings.raw.library || host.defaultLibrary;
  }

  /** Opens the library (made when new, with a first note) at start; another folder the person opened last instead. */
  async function openAtStart(): Promise<void> {
    const library = libraryPath();
    const last = settings.raw.lastVault;
    if (last && path.resolve(last).toLowerCase() !== path.resolve(library).toLowerCase()) {
      try {
        await openVault(last);
        return;
      } catch {
        await settings.forgetVault(last);
      }
    }
    // A first start on this PC: a vault waiting in Documents\Ironleaf or a synced place is opened, never a new, empty
    // one made beside it (src/main/vault-home-service.ts).
    if (!host.testBuild && (await vaultHome.firstStart().catch((err) => (host.log?.('Looking for your vault: ' + (err instanceof Error ? err.message : String(err))), false)))) return;
    let made = false;
    try {
      await fsp.access(library);
    } catch {
      made = true;
    }
    await fsp.mkdir(library, { recursive: true });
    if (made) await fsp.writeFile(path.join(library, 'Welcome to Ironleaf.md'), WELCOME_NOTE, { encoding: 'utf8', flag: 'wx' }).catch(() => {});
    await openVault(library);
  }

  // ── Where your vault is (src/main/vault-place.ts) ──
  const placeDeps = systemDeps();
  /** A development build's made-up synced folders (tools/shots-vault-place.mjs): an installed Ironleaf never reads it. */
  const placeStub = !app.isPackaged ? process.env.NV_PLACE_STUB : undefined;
  /** A development build's made-up other PCs, each with its vault (tools/shots-vault-home.mjs), when no host gives them. */
  const homePcStub = !app.isPackaged ? process.env.NV_PCS_STUB : undefined;
  let placesCache: { at: number; value: Promise<Places> } | null = null;
  function places(fresh = false): Promise<Places> {
    if (placeStub)
      return fsp.readFile(placeStub, 'utf8').then(
        (t) => {
          const v = JSON.parse(t) as Partial<Places>;
          return { roots: Array.isArray(v.roots) ? v.roots : [], network: Array.isArray(v.network) ? v.network : [] };
        },
        () => ({ roots: [], network: [] }),
      );
    if (!fresh && placesCache && Date.now() - placesCache.at < 120000) return placesCache.value;
    placesCache = { at: Date.now(), value: detectPlaces(placeDeps).catch(() => ({ roots: [], network: [] })) };
    return placesCache.value;
  }
  /** The old folder to the Bin (a development build's checks may give a folder to put it in instead). */
  const trashDir = !app.isPackaged ? process.env.NV_TRASH_DIR : undefined;
  async function toTrash(abs: string): Promise<void> {
    if (!trashDir) return shell.trashItem(abs);
    await fsp.mkdir(trashDir, { recursive: true });
    await fsp.rename(abs, path.join(trashDir, `${path.basename(abs)}-${Date.now()}`));
  }
  const sameFolder = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  /** The person's own notes in the open vault: not the ready-made templates, not the first note. */
  function ownCounts(): { notes: number; projects: number } {
    const t = (settings.raw.prefs.templatesFolder || '').toLowerCase();
    const notes = index.allMeta().filter((m) => !isWelcomeName(m.path) && !(t && m.path.toLowerCase().startsWith(`${t}/`))).length;
    return { notes, projects: projects.list().length };
  }
  /** What Ironleaf itself writes in a new vault, as it writes it: a vault holding only these is one nobody used. */
  function ownFiles(): Map<string, string> {
    const m = new Map<string, string>([[WELCOME_NAME, WELCOME_NOTE]]);
    for (const b of BUILT_INS) m.set(builtInPath(templatesRoot(), b), b.text);
    return m;
  }
  /** Folders the window was offered to open (a vault found, or one already where a move was going). */
  const offeredVaults = new Set<string>();
  let foundCache: { library: string; value: Promise<FoundVault | null> } | null = null;
  let lastPlan: MovePlan | null = null;
  let moving = false;

  /** The folder of notes open now (else the library): what "Where your vault is" describes and a move acts on. */
  const openFolder = () => vault?.root ?? libraryPath();

  async function placeStatus(fresh = false): Promise<PlaceStatus> {
    const library = libraryPath();
    const folder = openFolder();
    const isLibrary = sameFolder(folder, library);
    const p = await places(fresh);
    const place = placeOf(folder, p, placeDeps);
    const targets = await moveTargets(folder, p, placeDeps);
    // The folder open is judged: its notes for the one-time card, and whether it is new for the vault finder.
    const counts = vault ? ownCounts() : null;
    let candidate: FoundVault | null = null;
    if (isNewVault(counts)) {
      if (!foundCache || foundCache.library !== folder || fresh)
        foundCache = { library: folder, value: findVaults(p, { exclude: [folder, library], templates: settings.raw.prefs.templatesFolder, deps: placeDeps }).then((all) => all[0] ?? null, () => null) };
      candidate = await foundCache.value;
    }
    const { onlyHereCard, found } = vaultCards({ place, counts, found: candidate, tipSnoozedAt: settings.placeTipSnoozedAt(folder), now: new Date(), foundDismissed: (f) => settings.placeDismissed('found', f) });
    if (found) offeredVaults.add(path.resolve(found.path).toLowerCase());
    // Another app's notes open for a look (5 Nov 2026, u3 moving-in): adoptable until they are the library.
    const adoptable = !isLibrary && !(await holdsIdentity(folder).catch(() => true));
    return { library, folder, isLibrary, place, targets, onlyHereCard, found, adoptable };
  }

  /** The library switched to `folder` and opened there: settings.json says so twice (library and lastVault), which is what
   *  the former host app reads to find the vault. */
  async function useLibrary(folder: string): Promise<VaultInfo> {
    let opened: VaultInfo | null = null;
    await switchLibrary(settings, async (f) => (opened = await openVault(f)), folder);
    foundCache = null;
    return opened!;
  }

  /** What Ironleaf remembers about a library (tabs, bookmarks, its templates' record, file recovery) follows it. */
  async function carryLibraryData(from: string, to: string): Promise<void> {
    const real = await fsp.realpath(to).catch(() => to);
    for (const d of ['libraries', 'recovery']) {
      const src = path.join(host.dataDir, d, libraryKey(from));
      const dst = path.join(host.dataDir, d, libraryKey(real));
      if (src === dst) continue;
      await fsp.cp(src, dst, { recursive: true, force: false, errorOnExist: false }).catch(() => {});
    }
  }

  async function placePlan(target: unknown): Promise<MovePlan | MoveRefusal | null> {
    if (moving) throw new Error('Your vault is already moving.');
    let parent: string;
    let label: string;
    if (target === null) {
      const result = await showOpen({ title: 'Choose where your vault goes', buttonLabel: 'Move it here', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      parent = result.filePaths[0];
      label = parent;
    } else {
      const t = (await moveTargets(openFolder(), await places(), placeDeps)).find((x) => typeof target === 'string' && sameFolder(x.path, target));
      if (!t) throw new Error('That place isn’t on this PC any more.');
      parent = t.path;
      label = t.label;
    }
    const from = openFolder();
    const plan = await planMove(from, parent, label, { templates: settings.raw.prefs.templatesFolder, ...(sameFolder(from, libraryPath()) ? {} : { name: path.basename(from) }) });
    if (isRefusal(plan)) {
      if (plan.vault) offeredVaults.add(path.resolve(plan.vault.path).toLowerCase());
      lastPlan = null;
    } else lastPlan = plan;
    return plan;
  }

  async function placeMove(): Promise<MoveDone> {
    const plan = lastPlan;
    if (!plan) throw new Error('Choose where your vault goes first.');
    if (moving) throw new Error('Your vault is already moving.');
    lastPlan = null;
    moving = true;
    try {
      const was = placeOf(plan.from, await places(), placeDeps);
      // The library moves only when it is what moved; another folder of notes is just reopened at its new place.
      const wasLibrary = sameFolder(plan.from, libraryPath());
      const reopen = async (folder: string) => {
        let opened: VaultInfo | null = null;
        await reopenMoved(settings, async (f) => (opened = await openVault(f)), folder, wasLibrary);
        foundCache = null;
        return opened!;
      };
      // A network drive has no Bin (Windows would delete the folder outright): the old folder stays there.
      const canTrash = was.kind !== 'network';
      const done = await moveVault(plan, {
        onProgress: (p) => send('place:progress', p),
        switchTo: async (dest) => {
          await carryLibraryData(plan.from, dest);
          await reopen(dest);
        },
        switchBack: async (from) => {
          await reopen(from);
        },
        ...(canTrash ? { trash: (abs: string) => toTrash(abs) } : {}),
      });
      if (done.trashed) await settings.forgetVault(plan.from);
      const at = vault?.root ?? done.path;
      const links = done.links ? ` ${done.links === 1 ? 'One shortcut inside it wasn’t copied' : `${done.links} shortcuts inside it weren’t copied`}: they pointed somewhere else.` : '';
      const what = wasLibrary ? 'Your vault' : 'This folder of notes';
      const words = done.trashed
        ? `${what} is now in ${plan.label}, at ${at}. The old folder is in the Bin, if you ever need it.${links}`
        : `${what} is now in ${plan.label}, at ${at}. The old folder is still at ${plan.from}: delete it once you’re happy everything is there.${links}`;
      return { path: at, trashed: done.trashed, words };
    } finally {
      moving = false;
      placesCache = null;
    }
  }

  /** A vault found (or one already where a move was going) opened instead: the library switches to it. The new vault
   *  it replaces goes to the Recycle Bin only when it holds nothing but what Ironleaf wrote in it. A foreign folder
   *  is asked about first (one honest line), or opened for a look with nothing added (5 Nov 2026, u3 moving-in). */
  async function placeOpenFound(folder: unknown): Promise<MoveDone | null> {
    if (typeof folder !== 'string' || !offeredVaults.has(path.resolve(folder).toLowerCase())) throw new Error('Unknown folder.');
    if (moving) throw new Error('Your vault is moving.');
    const look = await lookAtVault(folder, { templates: settings.raw.prefs.templatesFolder });
    if (!look.exists) throw new Error('That vault isn’t there any more.');
    const choice = await vaultHome.confirmAdopt(folder);
    if (!choice) return null;
    if (choice === 'browse') {
      const info = await openVault(folder);
      return { path: info.path, trashed: false, words: `“${info.name}” is open for a look. Nothing was added to it.` };
    }
    const old = vault?.root ?? null;
    // Only the vault Ironleaf itself made (the library, new and unused) is put away; a folder the person opened stays.
    const oldWasNew = !!old && sameFolder(old, libraryPath()) && isNewVault(ownCounts());
    const opened = await useLibrary(folder);
    let trashed = false;
    if (old && oldWasNew && !isInside(placeDeps, opened.path, old) && !isInside(placeDeps, old, opened.path) && (await holdsOnlyOwn(old, ownFiles()))) {
      trashed = await toTrash(old).then(
        () => true,
        () => false,
      );
      if (trashed) await settings.forgetVault(old);
    }
    return { path: opened.path, trashed, words: trashed ? 'Your vault is open. The new, empty one made on this PC is in the Bin.' : 'Your vault is open.' };
  }

  /** Settings › Files and links › Open another vault folder…: a vault somewhere unusual becomes the library. A folder
   *  chosen that holds an Ironleaf vault one level down (OneDrive, chosen for OneDrive\Ironleaf) opens that. A
   *  foreign folder is asked about first (one honest line), or opened for a look with nothing added (5 Nov 2026,
   *  u3 moving-in). */
  async function placeOpenFolder(): Promise<VaultInfo | null> {
    if (moving) throw new Error('Your vault is moving.');
    const result = await showOpen({ title: 'Open your vault’s folder', buttonLabel: 'Open vault', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    let folder = result.filePaths[0];
    const templates = settings.raw.prefs.templatesFolder;
    const here = await lookAtVault(folder, { templates });
    if (!here.isVault)
      for (const inner of HOME_FOLDERS.flatMap((name) => [path.join(folder, name), path.join(folder, 'Documents', name)])) {
        const look = await lookAtVault(inner, { templates });
        if (look.isVault && (look.notes || look.projects)) {
          folder = inner;
          break;
        }
      }
    const choice = await vaultHome.confirmAdopt(folder);
    if (!choice) return null;
    return choice === 'adopt' ? useLibrary(folder) : openVault(folder);
  }

  // One standard home for vaults (src/main/vault-home-service.ts): Your vaults, Your PCs, the move into
  // Documents\Ironleaf, a new vault, Export vault and Import vault.
  const vaultHome = createVaultHomeService({
    host: { kind: host.kind, appId: host.appId, defaultLibrary: host.defaultLibrary, dataDir: host.dataDir, version: host.version, ...(host.pcVaults ? { pcVaults: () => host.pcVaults!() } : homePcStub ? { pcVaults: () => fsp.readFile(homePcStub, 'utf8').then((t) => JSON.parse(t) as unknown) } : {}) },
    settings,
    places,
    placesStubbed: !!placeStub,
    placeDeps,
    vaultRoot: () => vault?.root ?? null,
    library: () => libraryPath(),
    templates: () => settings.raw.prefs.templatesFolder,
    ownCounts: () => (vault ? ownCounts() : null),
    ownFiles,
    openVault,
    useLibrary,
    carryLibraryData,
    toTrash,
    trashRel: (rel) => trashRel(rel),
    canWrite: () => requireCreate().then(() => true, () => false),
    keepRecovery: (rel, text) => recovery.keep(rel, text, true),
    send,
    win: () => promptOwner(),
    moving: { get: () => moving, set: (v) => (moving = v) },
    rescan: async () => {
      if (vault) await rescan(vault);
    },
    holdWatch,
    log: (m) => host.log?.(m),
  });

  // Notes from another app, kept paired with where they came from (V9, 28 Oct 2026; src/main/pairing/service.ts).
  const pairing = createPairing({
    dataDir: host.dataDir,
    vaultRoot: () => vault?.root ?? null,
    win: () => promptOwner(),
    daily: () => ({ folder: settings.raw.dailyFolder, format: settings.raw.dailyFormat }),
    ...(host.pairTokens ? { tokens: host.pairTokens } : {}),
    requireCreate,
    keepRecovery: (rel, text) => recovery.keep(rel, text, true),
    trashPath: (rel) => trashRel(rel),
    rescan: async () => {
      if (vault) await rescan(vault);
    },
    holdWatch,
    log: (m) => host.log?.(m),
  });

  // This PC's sync state for the open vault, and its fixes (Settings › Files and links, Today; src/main/vault-sync.ts).
  const syncStub = !app.isPackaged ? process.env.NV_SYNC_STUB : undefined;
  const vaultSync = createVaultSync({
    root: () => vault?.root ?? null,
    device: thisPc,
    version: host.version ?? app.getVersion(),
    identityId: async (root) => (await readIdentity(root))?.id ?? null,
    place: async (root) => {
      const p = placeOf(root, await places(), placeDeps);
      return { kind: p.kind, name: p.name };
    },
    pcs: async () => cleanPcs(host.pcVaults ? await host.pcVaults() : homePcStub ? JSON.parse(await fsp.readFile(homePcStub, 'utf8')) : null),
    mayWrite: () => requireCreate().then(() => true, () => false),
    readNote: async (rel) => index.content(rel) ?? (await requireVault().read(rel)),
    writeNote: (rel, text) => writeNote(rel, text),
    trash: async (rel) => {
      await trashRel(rel);
    },
    move: async (from, to) => {
      await requireCreate();
      await requireVault().move(from, to);
    },
    rescan: async () => {
      if (vault) await rescan(vault);
    },
    ...(syncStub ? { stub: syncStub } : {}),
    log: (m) => host.log?.(m),
  });

  /** Settings changed outside this window (the vault opened with its own, another PC's change arrived, the former host app
   *  brought the person's from another PC): what follows from them, and the window told. */
  function settingsArrived(): void {
    index.setExcluded(settings.raw.prefs.excluded);
    index.setQuiet(settings.raw.prefs.quietFolders ?? []);
    quickCapture.applyKey();
    syncFileIndex();
    try { host.appearance?.set(sharedLook()); } catch { /* The former host app keeps its own until next time */ }
    send('settings:changed', { ...settings.view(), host: host.kind, library: libraryPath() });
  }

  /** The look both apps share, as Vault's settings hold it now (one product step 4): the palette and accent, light or
   *  dark, the interface size and density. One shared row in Settings writes both stores through this. */
  function sharedLook(): { palette: string; accent: string; theme: string; zoom: number; density: string } {
    const p = settings.raw.prefs;
    return { palette: p.palette, accent: p.accent, theme: p.theme, zoom: p.zoom, density: p.density };
  }

  /** Settings written, from the window or from the former host app's Settings through the host (one product step 4): the store
   *  checks each value, the shared look goes back to the former host app, and everything that follows a setting follows.
   *  Both doors run this one path, so the window and the one Settings write the same settings the same way. */
  async function updateSettings(patch: SettingsPatch) {
    const next = await settings.update(patch ?? {});
    // The shared look goes back to the former host app, which changes with it.
    const look = patch?.prefs as { palette?: unknown; accent?: unknown; theme?: unknown; zoom?: unknown; density?: unknown } | undefined;
    if (look && ('palette' in look || 'accent' in look || 'theme' in look || 'zoom' in look || 'density' in look)) {
      try { host.appearance?.set(sharedLook()); } catch { /* The former host app keeps its own until next time */ }
    }
    index.setExcluded(settings.raw.prefs.excluded);
    index.setQuiet(settings.raw.prefs.quietFolders ?? []);
    quickCapture.applyKey();
    privateNotes.refreshRemembered();
    lifeModules.switched();
    publications.switched();
    syncFileIndex();
    // Reading words in pictures, switched on or off (or another language): takes effect on what's there now.
    const ocr = patch?.prefs as { ocrRead?: unknown; ocrLang?: unknown } | undefined;
    if (ocr && ('ocrRead' in ocr || 'ocrLang' in ocr) && vault && ocrQueue) {
      const all = await vault.listAll().catch(() => null);
      if (all && vault && ocrQueue) ocrQueue.scan(ocrFilesOf(vault, all.files));
    }
    return { ...next, host: host.kind, library: libraryPath() };
  }

  function cleanNotePath(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('Invalid note name.');
    let p = cleanRel(raw);
    if (!p.toLowerCase().endsWith('.md')) p += '.md';
    return p;
  }

  // Templates (src/main/templates.ts): Ironleaf's ready-made ones written into the library's Templates folder when
  // they aren't there (never over or beside the person's own; one deleted stays deleted), listed for the Templates page,
  // and notes and projects made from them.
  const templatesRoot = () => settings.raw.prefs.templatesFolder;
  function templateStore(v: Vault): TemplateStore {
    return {
      any: (rel) => v.any(rel),
      create: async (rel, text) => {
        await v.create(rel, text);
        await indexFile(v, rel);
        notifyChanged([rel]);
      },
      notes: () => index.allMeta().map((m) => m.path),
    };
  }
  async function templateRecord(v: Vault): Promise<TemplateRecord> {
    const saved = (await state.load(v.root, 'templates')) as { written?: unknown } | null;
    return { written: Array.isArray(saved?.written) ? saved!.written.filter((x): x is string => typeof x === 'string') : [] };
  }
  /** Writes the ready-made templates that aren't there; with `restore`, also the ones the person deleted. */
  async function ensureTemplates(opts: { restore?: boolean } = {}): Promise<string[]> {
    const v = requireVault();
    const root = templatesRoot();
    if (!root) return [];
    const ownDaily = !!settings.raw.dailyTemplate?.trim();
    const { made, record } = await ensureBuiltIns(templateStore(v), root, await templateRecord(v), { restore: opts.restore, theirs: (b) => b.id === 'daily-note' && ownDaily });
    await state.save(v.root, 'templates', record);
    if (made.length) filesChanged();
    return made;
  }
  /** Today's note's template: the one in Settings › Daily notes, else the ready-made Daily note when it is there. */
  function dailyTemplatePath(): string | null {
    const own = settings.raw.dailyTemplate?.trim();
    if (own) {
      try {
        return cleanNotePath(own);
      } catch {
        return null;
      }
    }
    const rel = builtInPath(templatesRoot(), BUILT_INS.find((b) => b.id === 'daily-note')!);
    return templatesRoot() && index.get(rel) ? rel : null;
  }
  function templatesList(): TemplateInfo[] {
    const root = templatesRoot();
    if (!root) return [];
    const notes = index.allMeta().filter((m) => m.path.startsWith(`${root}/`)).map((m) => ({ path: m.path, mtime: m.mtime, text: index.content(m.path) ?? '' }));
    return listTemplates(notes, root, dailyTemplatePath());
  }
  /** A template the person chose: one in the templates folder, read as it is now. */
  async function readTemplate(raw: unknown): Promise<{ rel: string; text: string }> {
    const rel = cleanNotePath(raw);
    const root = templatesRoot();
    if (root && !rel.startsWith(`${root}/`)) throw new Error('That note isn’t one of your templates.');
    return { rel, text: await requireVault().read(rel) };
  }
  /** A note made from a note template (the Templates page's Use, and agents at Full control). */
  async function noteFromTemplateFile(template: unknown, name: unknown, folder: unknown, project: unknown): Promise<string> {
    return (await makeFromTemplate(template, name, folder, project, null)).path;
  }
  /** A note made from a note template with the answers to its prompts and AI fields (src/shared/template-fields.ts;
   *  21 Oct 2026, gap G27), and where its {{cursor}} was. Nothing in a template is ever run. */
  async function makeFromTemplate(template: unknown, name: unknown, folder: unknown, project: unknown, answers: unknown): Promise<{ path: string; cursor: { line: number; ch: number } | null }> {
    await requireCreate();
    const v = requireVault();
    const { text } = await readTemplate(template);
    if (templateKind(text) !== 'note') throw new Error('That template isn’t one for a note.');
    const dir = typeof folder === 'string' && folder ? cleanRel(folder) : '';
    const base = cleanFileName(name, 'Untitled');
    const rel = await uniqueRel(v, dir, base, '.md');
    const { dateFormat, timeFormat } = settings.raw.prefs;
    const projectName = typeof project === 'string' && isProjectProps(index.get(project)?.props) ? projects.view(project).project.name : undefined;
    if (dir && !(await v.any(dir))) await v.makeFolder(dir);
    const made = takeCursor(noteFromTemplate(text, { title: rel.split('/').pop()!.replace(/\.md$/i, ''), dateFormat, timeFormat, project: projectName, answers: { ...cleanAnswers(answers), cursor: true } }));
    await v.createText(rel, made.text);
    await indexFile(v, rel);
    await relationSyncForCreates(v, [rel], 'you');
    notifyChanged([rel]);
    filesChanged();
    return { path: rel, cursor: made.cursor ? { line: made.cursor.line, ch: made.cursor.ch } : null };
  }
  /** A note (or a project's file) saved as a new template. */
  async function saveAsTemplate(note: unknown, name: unknown, description: unknown): Promise<string> {
    await requireCreate();
    const v = requireVault();
    const root = templatesRoot();
    if (!root) throw new Error('Choose a templates folder first (Settings › General).');
    const source = cleanNotePath(note);
    const text = await v.read(source);
    const isProject = isProjectProps(index.get(source)?.props);
    const isDoc = !isProject && isDocNote(source, index.get(source)?.props ?? {});
    const rel = await uniqueRel(v, `${root}/${isProject ? 'Projects' : isDoc ? 'Docs' : 'Notes'}`, cleanFileName(name, 'New template'), '.md');
    await v.createText(rel, templateFromNote(text, { isProject, isDoc, description: typeof description === 'string' ? description : undefined }));
    await indexFile(v, rel);
    notifyChanged([rel]);
    filesChanged();
    return rel;
  }
  /** A new template: the starter of its group, or the text given (agents at Full control). */
  async function newTemplate(group: unknown, name: unknown, content?: string): Promise<string> {
    await requireCreate();
    const v = requireVault();
    const root = templatesRoot();
    if (!root) throw new Error('Choose a templates folder first (Settings › General).');
    const g: TemplateGroup = group === 'projects' || group === 'reports' || group === 'docs' ? group : 'notes';
    const dir = `${root}/${GROUPS.find((x) => x.id === g)!.folder}`;
    const rel = await uniqueRel(v, dir, cleanFileName(name, 'New template'), '.md');
    if (!(await v.any(dir))) await v.makeFolder(dir);
    await v.createText(rel, content ?? starterTemplate(g));
    await indexFile(v, rel);
    notifyChanged([rel]);
    filesChanged();
    return rel;
  }


  /** To the vault's own Bin (5 Nov 2026, one Bin: a person's Delete went to the operating system's Recycle Bin
   *  while Recently deleted said it stays here 30 days). Every note, file and folder a person deletes goes through the
   *  same Bin the assistant uses, listed on Recently deleted with Restore. Returns the Bin item, for the toast's Undo. */
  async function trashRel(p: string): Promise<BinItem> {
    return binRel(p, { by: 'You' });
  }

  /** Before a removal into the vault's own Bin: every note kept by file recovery too, suggestions
   *  cleared, and the links out of other notes' properties planned while the index still knows them (body links stay
   *  for the tidy to offer). Capped; the rest keep dead links the tidy names. */
  async function planRemoval(pairs: [string, string][]): Promise<ReturnType<typeof planUnlinkForTrash>> {
    for (const [note] of pairs.filter(([f]) => kindOf(f) === 'note').slice(0, 500)) {
      const text = index.content(note);
      if (text !== undefined) await recovery.keep(note, text, true);
      suggestions.clear(note);
    }
    const gone = pairs.filter(([f]) => kindOf(f) === 'note').map(([f]) => f).slice(0, 500);
    return planUnlinkForTrash(
      gone,
      index.allMeta().map((m) => ({ path: m.path, title: m.label || m.title })),
      (path) => index.get(path)?.props ?? {},
    ).slice(0, 500);
  }

  /** After a removal: told (assets, index, tabs, file list), and the planned property links taken out. */
  async function finishRemoval(v: Vault, rels: string[], unlinks: ReturnType<typeof planUnlinkForTrash>, by: VersionAuthor): Promise<void> {
    void assets.removed(rels);
    for (const f of rels) index.delete(f);
    const unlinked: string[] = [];
    if (unlinks.length) {
      const writes = unlinks.flatMap((u) => u.writes.map((w) => ({ path: u.path, key: w.key, value: w.value, ...(w.kindKey !== undefined ? { kindKey: w.kindKey, kindValue: w.kindValue ?? null } : {}) })));
      await applyRelationWrites(writes, {
        read: async (path) => index.content(path) ?? (await v.read(path).catch(() => null)),
        write: async (path, text) => {
          try {
            await writeNote(path, text, by);
            unlinked.push(path);
            return true;
          } catch {
            return false;
          }
        },
      });
    }
    await refreshFiles(v);
    notifyChanged([...rels, ...unlinked]);
    filesChanged();
  }

  /** A note, file or folder into the vault's own Bin (the person's Bin and the assistant's, the same Bin Recently
   *  deleted shows), with the same keeping, unlinking and telling as a removal. A note's own Files folder goes with
   *  it. A failed move destroys nothing: it stays where it was and says so in plain words. */
  async function binRel(p: string, opts?: { why?: string; by?: string }): Promise<BinItem> {
    const v = requireVault();
    if (!(await v.any(p))) throw new Error(`“${titleFromPath(p)}” is no longer in the vault.`);
    const pairs = await movePairs(v, p, p);
    const unlinks = await planRemoval(pairs);
    // A note's own Files folder goes with it: named before the move, for the telling after.
    let extra: string[] = [];
    if (!(await v.isFolder(p).catch(() => false)) && kindOf(p) === 'note' && !ownsFolder(p)) {
      const own = filesFolderFor(p);
      const { files } = await v.listAll();
      extra = files.filter((f) => f.rel === own || f.rel.startsWith(`${own}/`)).map((f) => f.rel);
    }
    let item: BinItem;
    try {
      item = await createVaultBin({ root: v.root }).put(p, { ...(opts?.by ? { by: opts.by } : {}), ...(opts?.why ? { why: opts.why } : {}) });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const stayed = await v.any(p).catch(() => false);
      throw new Error(`“${titleFromPath(p)}” couldn’t go to Recently deleted (${reason.replace(/\.\s*$/, '')}).${stayed ? ' It is still where it was.' : ''}`);
    }
    await finishRemoval(v, [...pairs.map(([f]) => f), ...extra], unlinks, writer.getStore() ?? (opts?.by === 'You' ? 'you' : 'assistant'));
    return item;
  }

  /** What is in the vault's own Bin, newest first. */
  async function binList(): Promise<BinListed[]> {
    return createVaultBin({ root: requireVault().root }).list();
  }

  /** One item gone for good before its 30 days (Recently deleted's Delete now). */
  async function binForget(id: string): Promise<{ forgotten: boolean }> {
    return createVaultBin({ root: requireVault().root }).forget(id);
  }

  /** Recently deleted emptied: everything in the vault's Bin gone for good. */
  async function binEmpty(): Promise<{ emptied: number }> {
    const bin = createVaultBin({ root: requireVault().root });
    let emptied = 0;
    for (const it of await bin.list()) if ((await bin.forget(it.id).catch(() => ({ forgotten: false }))).forgotten) emptied++;
    return { emptied };
  }

  /** Back from the vault's own Bin: the files again, indexed and told. */
  async function binRestore(which: string): Promise<BinRestored> {
    const v = requireVault();
    const r = await createVaultBin({ root: v.root }).restore(which);
    const { files } = await v.listAll();
    const back = files.filter((f) => f.rel === r.restored || f.rel.startsWith(`${r.restored}/`) || (r.files && (f.rel === r.files || f.rel.startsWith(`${r.files}/`))));
    for (const f of back.filter((f) => f.kind === 'note')) await indexFile(v, f.rel);
    await refreshFiles(v);
    notifyChanged(back.map((f) => f.rel));
    filesChanged();
    return r;
  }

  // Reminders (19 Oct 2026, approved them): task lines with ⏰ in the notes, said when they come due by a Windows
  // notification (a click opens the note at the line) and in the bell (src/main/reminders.ts).
  const reminders = new Reminders({
    dataDir: host.dataDir,
    index,
    library: () => vault?.root ?? null,
    read: (rel) => index.content(rel),
    write: (rel, text) => writeNote(rel, text),
    templatesFolder: () => settings.raw.prefs.templatesFolder,
    show: (note) => {
      const open = () => void openWindow({ note: note.path, line: note.line });
      if (host.notify) return host.notify({ title: note.title, body: note.body, onClick: open });
      // No Windows notification while the window is in front (3 Nov 2026): the bell keeps it, like the former
      // host app's own toasts, so news never pops over the notes being read.
      try {
        if (win && !win.isDestroyed() && win.isFocused()) return;
        if (viewContents && !viewContents.isDestroyed() && viewContents.isFocused()) return;
      } catch {
        // The window not there just now: the notification still shows.
      }
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: note.title, body: note.body, icon: host.icon });
      n.on('click', open);
      n.show();
    },
    changed: () => {
      try {
        send('notices:changed', noticesView());
      } catch {
        // The bell asks again when the window comes back.
      }
    },
    ...(host.notices?.add ? { mirror: (n: Parameters<NonNullable<HostNotices['add']>>[0]) => void host.notices!.add!(n) } : {}),
    log: (m) => host.log?.(m),
  });
  // The day's dated tasks in the former host app's bell, once a day as one line (8.0 TR8 4a;
  // src/main/due-today.ts).
  const dueToday = new DueToday({
    tasks: () => tasks.view(),
    ...(host.notices?.add ? { add: (n: Parameters<NonNullable<HostNotices['add']>>[0]) => host.notices!.add!(n) } : {}),
    keep: (n) => reminders.keep(n),
    file: path.join(host.dataDir, 'due-today.json'),
    log: (m) => host.log?.(m),
  });
  // The weekly tidy (2 Nov 2026, 10.0 plan item 21; src/main/weekly-tidy.ts): one proposal a week, each line applied
  // or skipped with Undo, said once in the bell.
  const tidy = new WeeklyTidy({
    dataDir: host.dataDir,
    index,
    resolveRow: (t) => rowResolve(t),
    library: () => vault?.root ?? null,
    read: (rel) => index.content(rel),
    write: (rel, text) => writeNote(rel, text),
    move: (from, to) => movePath(from, to, true),
    trash: async (rel) => {
      await trashRel(rel);
    },
    exists: async (rel) => !!vault && (await vault.any(rel)),
    templatesFolder: () => settings.raw.prefs.templatesFolder,
    dailyToday: () => dailyPath(),
    post: (items) => reminders.post(items),
    changed: () => {
      try {
        send('tidy:changed', tidy.status());
      } catch {
        // The tab asks again when the window comes back.
      }
    },
    log: (m) => host.log?.(m),
  });
  // Finance and Documents and ID (Wave 5 part a, src/main/record-modules.ts): their records are notes; their notices go
  // in the reminders' list (said once each), and nothing runs while both are switched off.
  const recordModules = new RecordModules({
    vault: requireVault,
    index,
    prefs: () => settings.raw.prefs,
    writeNote: (rel, text) => writeNote(rel, text),
    importFiles: (paths, folder) => recordModulesImport(paths, folder),
    pickFiles: async (o) => {
      const options = { title: o.title, buttonLabel: o.button, properties: (o.many ? ['openFile', 'multiSelections'] : ['openFile']) as ('openFile' | 'multiSelections')[], ...(o.filters ? { filters: o.filters } : {}) };
      const r = await showOpen(options);
      return r.canceled ? [] : r.filePaths;
    },
    movePath: (from, to) => movePath(from, to, true),
    post: (items) => reminders.post(items),
    requireCreate,
    log: (m) => host.log?.(m),
    // The Bills move's backup and both-PCs gate (bills as one list, 8 Nov 2026).
    dataDir: host.dataDir,
    device: thisPc,
    appVersion: host.version ?? app.getVersion(),
    // Receipt reading (10.0 v2money): a vault file's words (a PDF's text layer, else its recognised words).
    fileText: async (rel) => {
      try {
        const v = requireVault();
        if (/\.pdf$/i.test(rel)) {
          const buf = await fsp.readFile(v.absolute(rel));
          const text = await pdfReader.read(new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), 10, 200_000).catch(() => '');
          if (text && text.trim()) return text;
        }
        return ocrStore ? ocrFileText(ocrStore.get(rel)) : null;
      } catch {
        return null;
      }
    },
  });
  /** Files from this PC copied into a folder of the vault (Finance's receipts, a site's photos), each under a free name. */
  async function recordModulesImport(paths: string[], folder: string): Promise<string[]> {
    const v = requireVault();
    const added: string[] = [];
    for (const raw of paths.slice(0, 20)) {
      const stat = await fsp.stat(raw).catch(() => null);
      if (!stat?.isFile() || stat.size > 500 * 1024 * 1024) continue;
      const { base, ext } = splitName(cleanFileName(path.basename(raw), 'File'));
      const rel = await uniqueRel(v, folder, base, ext);
      if (folderOf(rel)) await v.makeFolder(folderOf(rel));
      await fsp.copyFile(raw, v.absolute(rel), fsConstants.COPYFILE_EXCL);
      added.push(rel);
    }
    await refreshFiles(v);
    filesChanged();
    return added;
  }
  // The work modules (Wave 6 part b, src/main/work-modules.ts): Meetings, Weekly Updates, Sites and Equipment, and
  // Vendors, Quotes and Contracts. Their records are notes; their notices go in the reminders' list (said once each);
  // nothing runs while every one of them is off.
  const workDeps: ConstructorParameters<typeof WorkModules>[0] = {
    vault: requireVault,
    // Checking or connecting to a machine with its linked login is using it, not revealing it (8.5): no step-up.
    login: async (id, destination) => secrets.useValue(id, destination),
    dataDir: host.dataDir,
    device: thisPc,
    appVersion: host.version ?? app.getVersion(),
    index,
    prefs: () => settings.raw.prefs,
    // Weekly Updates' send (8.2): one plain email through the former host app's mail, when Ironleaf runs
    // inside it.
    ...(host.deliver ? { sendMail: (input: { to: string[]; subject: string; text: string }) => host.deliver!({ channel: 'email', text: input.text, caption: input.subject, subject: input.subject, to: input.to }) } : {}),
    writeNote: (rel, text) => writeNote(rel, text),
    importFiles: (paths, folder) => recordModulesImport(paths, folder),
    pickFiles: async (o) => {
      const options = { title: o.title, buttonLabel: o.button, properties: (o.many ? ['openFile', 'multiSelections'] : ['openFile']) as ('openFile' | 'multiSelections')[], ...(o.filters ? { filters: o.filters } : {}) };
      const r = await showOpen(options);
      return r.canceled ? [] : r.filePaths;
    },
    saveFile: async (o) => {
      const base = cleanFileName(o.name, 'Export');
      // NV_TEST_EXPORT_DIR (the end-to-end check only, never set in the product): straight into that folder, no dialog.
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      const options = { title: o.title, defaultPath: path.join(app.getPath('documents'), `${base}.${o.ext}`), filters: [{ name: o.filter, extensions: [o.ext] }] };
      const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.${o.ext}`) } : await showSave(options);
      if (result.canceled || !result.filePath) return null;
      await fsp.writeFile(result.filePath, typeof o.data === 'string' ? o.data : Buffer.from(o.data));
      exported.add(result.filePath);
      return result.filePath;
    },
    post: (items) => reminders.post(items),
    editProject: (rel, edit, by, said) => editProject(rel, edit, undefined, by, said),
    projects: () => projects.list().map((c) => ({ path: c.path, name: c.name })),
    records: (ix) => (ix ?? index).records({ templatesFolder: settings.raw.prefs.templatesFolder || 'Templates' }),
    askJson: async (system, user) => {
      const status = aiStatus(settings.raw.model);
      if (!status.ready) return { reply: null, error: status.note ?? 'No model is set up yet.' };
      return ai.askJson(system, user, 240_000, 6000);
    },
    requireCreate,
    log: (m) => host.log?.(m),
  };
  const workModules = new WorkModules(workDeps);
  // Memories and Media, Business, Systems and Home Lab, Goals and Habits, and Reading, Watching and Lists (Wave 7 part b,
  // src/main/life-records.ts): another group of modules made of notes, on the same machinery as the work modules.
  const lifeRecords = new WorkModules(
    {
      ...workDeps,
      // Goals and Habits' streak calendar shows Health and Fitness's own yes/no habits beside its own (read only).
      healthHabits: async () => {
        const db = await lifeModules.healthDb();
        return db.measures.filter((x) => x.kind === 'yesno' && x.group === 'habit' && !x.archived).map((x) => ({ id: x.id, name: x.name, days: db.entries.filter((e) => e.measure === x.id && e.yes === true).map((e) => e.day) }));
      },
    },
    LIFE_RECORDS_GROUP,
  );
  // Publications (Wave 6 part a, src/main/publications.ts): publications, editions and their pieces are notes in the
  // Publications area. An edition's pages are laid out and printed by Chromium in a window nobody sees
  // (src/main/edition-print.ts): to a PDF kept with the edition, or to the publication's printer. Its schedule's check
  // runs only while it is switched on.
  const editionPrinter = createEditionPrinter({ dir: path.join(host.dataDir, 'publications'), log: (m) => host.log?.(m) });
  // A note's branded document (5 Nov 2026, src/shared/brand-document.ts): laid out and printed the same way, in a
  // window nobody sees (src/main/brand-print.ts). Export to PDF, Save as PDF and Email it all print through here.
  const brandPrinter = createBrandPrinter({ dir: path.join(host.dataDir, 'brand-print'), log: (m) => host.log?.(m) });
  /** The app's own type for an edition's pages (the window's Source Serif and Inter), found beside its page. */
  let editionFontsFound: { serif?: string; sans?: string; sansItalic?: string } | null = null;
  const editionFonts = async () => {
    if (editionFontsFound) return editionFontsFound;
    const found: { serif?: string; sans?: string; sansItalic?: string } = {};
    const dirs = [path.join(path.dirname(host.renderer.file), 'assets'), path.join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'fonts')];
    for (const dir of dirs) {
      for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
        const url = pathToFileURL(path.join(dir, f)).href;
        if (/^source-serif-4-latin.*\.woff2$/i.test(f)) found.serif ??= url;
        else if (/^inter-latin-italic.*\.woff2$/i.test(f)) found.sansItalic ??= url;
        else if (/^inter-latin(?!-italic).*\.woff2$/i.test(f)) found.sans ??= url;
      }
      if (found.serif) break;
    }
    return (editionFontsFound = found);
  };
  // The Design studio (22 Nov 2026, src/main/design-studio.ts): a note designed into a finished PDF by the person's own
  // AI on the chat's model, printed and checked in the same sealed window the branded document prints in.
  const designStudio = new DesignStudio({
    ask: (system, messages, o) => ai.askTurns(system, messages, o),
    seesPictures: () => ai.designSeesPictures(),
    printer: brandPrinter,
    fonts: editionFonts,
    log: (m) => host.log?.(m),
  });
  const designControllers = new Map<string, AbortController>();
  const publicationsDeps: PublicationsDeps = {
    root: () => vault?.root ?? null,
    index,
    prefs: () => settings.raw.prefs,
    writeNote: (rel, text, by) => writeNote(rel, text, cleanAuthor(by) ?? 'you'),
    requireCreate,
    exists: async (rel) => !!vault && (await vault.any(rel)),
    trash: async (rel) => {
      await trashRel(rel);
    },
    files: async () => (vault ? (await vault.listAll()).files.map((f) => ({ path: f.rel, size: f.size })) : []),
    placeFile: async (o) => {
      const r = await vaultFiles.place({ record: o.record, src: o.src, name: o.name, move: true, source: { by: o.by, how: 'added', at: new Date().toISOString() }, same: 'version', what: o.what, describe: 'later' });
      await refreshFiles(requireVault());
      filesChanged();
      return r;
    },
    copyIn: (paths, folder) => recordModulesImport(paths, folder),
    pickFiles: async (o) => {
      const testFiles = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_PICK_FILES : '';
      if (testFiles) return testFiles.split(path.delimiter).filter(Boolean);
      const options = { title: o.title, filters: o.filters, properties: (o.multi ? ['openFile', 'multiSelections'] : ['openFile']) as ('openFile' | 'multiSelections')[] };
      const r = await showOpen(options);
      return r.canceled ? [] : r.filePaths;
    },
    pickSave: async (o) => {
      // NV_TEST_EXPORT_DIR (the end-to-end check only, never set in the product): straight into that folder, no dialog.
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      if (testDir) return path.join(testDir, o.name);
      const options = { title: o.title, defaultPath: path.join(app.getPath('documents'), o.name), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const r = await showSave(options);
      if (r.canceled || !r.filePath) return null;
      exported.add(r.filePath);
      return r.filePath;
    },
    printer: editionPrinter,
    appFonts: editionFonts,
    readPdfText: async (abs) => {
      const buf = await fsp.readFile(abs);
      return pdfReader.read(new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), 80, 600_000);
    },
    ...(host.deliver ? { deliver: (r: Parameters<NonNullable<IronleafHost['deliver']>>[0]) => host.deliver!(r) } : {}),
    post: (items) => reminders.post(items),
    changed: () => send('modules:changed', 'publications'),
    log: (m) => host.log?.(m),
  };
  const publications = new Publications(publicationsDeps);
  // Home, Vehicles, Career and Travel (Wave 7 part a, src/main/personal-modules.ts): another group on the work modules'
  // machinery (the same deps), which also files Inbox items into its records.
  const personal = new WorkModules(workModules.d, PERSONAL_GROUP);
  const personalFiling = personalInbox(personal);
  // The Wave 7 part b modules file Inbox items into their records the same way (a show onto the watch list, a photo into
  // the album it was taken during, a health note onto the machine it names).
  const lifeFiling = personalInbox(lifeRecords);
  // Today as the hub (src/main/hub.ts): a day's note, meetings and activity, the strip's dots and the Due list, from the
  // index.
  const hub = new Hub({
    index,
    dailyPath: (day) => dailyPath(day),
    templatesFolder: () => settings.raw.prefs.templatesFolder,
    reminders: () => reminders.items(),
    write: (rel, text) => writeNote(rel, text),
    startDay: async (day) => {
      await requireCreate();
      return openDailyNote(day);
    },
    log: (m) => host.log?.(m),
  });
  // Tasks across the notes (src/main/tasks.ts; 21 Oct 2026, gap G24): every tick-box line, open and done, for the Tasks
  // view; ticks, due days and reminders written through the same write every save uses.
  const tasks = new TasksService({ index, templatesFolder: () => settings.raw.prefs.templatesFolder, write: (rel, text) => writeNote(rel, text) });
  // Shared spaces (10.0 item 26, src/main/shared-spaces.ts): the household's spaces and one space's home.
  const spaces = new SharedSpacesService({ root: () => vault?.root ?? null, index });
  /** The bell's list: The former host app's notices (inside the former host app) with Ironleaf's own
reminders. */
  function noticesView(): NoticesView {
    let theirs: NoticesView | null = null;
    try {
      theirs = host.notices ? cleanNotices(host.notices.list()) : null;
    } catch {
      // The former host app's list not there just now: Ironleaf's own still show.
    }
    return mergeNotices(reminders.notices(), theirs);
  }

  /** Ours read too when the former host app's copies were read there (3 Nov 2026: reading there left ours unread
   *  here). Matched the same way, by kind, title and note. */
  function readOwnCopies(): void {
    if (!host.notices) return;
    try {
      const theirs = cleanNotices(host.notices.list());
      const handled = theirs.items.filter((i) => i.read && !i.sessionId && (MIRRORED_KINDS as readonly string[]).includes(i.kind));
      if (!handled.length) return;
      for (const own of reminders.notices()) {
        if (own.read || !(MIRRORED_KINDS as readonly string[]).includes(own.kind)) continue;
        if (handled.some((i) => i.kind === own.kind && i.title === own.title && (!own.note || !i.note || i.note === own.note))) reminders.read(own.id);
      }
    } catch {
      // The former host app's list not there just now: ours stay as they are.
    }
  }

  /** The former host app's copies of one of ours read too (3 Nov 2026: reading here left its copies unread there, so
   *  the two bells counted differently). Matched by kind, title and note: ours and its copy are worded the same. */
  function readHostCopies(own: { kind: string; title: string; note?: string }): void {
    if (!host.notices) return;
    try {
      const theirs = cleanNotices(host.notices.list());
      for (const i of theirs.items) {
        if (i.read || i.sessionId || !(MIRRORED_KINDS as readonly string[]).includes(i.kind)) continue;
        if (i.kind !== own.kind || i.title !== own.title) continue;
        if (own.note && i.note && i.note !== own.note) continue;
        host.notices.read(i.id);
      }
    } catch {
      // The former host app's list not there just now: ours is still read.
    }
  }

  // The chat's assistant reaches the notes through the same steps as the window: every write indexed, shown in open
  // tabs, kept in file recovery; moves keep links working (src/main/agent.ts).
  /** Short texts to the on-device meaning model's vectors for the write check (null: the model is off — exact only). */
  const embedForWrites = async (texts: string[]): Promise<number[][] | null> => {
    const q = meaningBuilder?.queries() ?? null;
    if (!q) return null;
    try {
      const out: number[][] = [];
      for (const t of texts.slice(0, 100)) out.push(await q.embed(t));
      return out;
    } catch {
      return null;
    }
  };
  // What the assistant knows about the person (5 Nov 2026, v8-vault-assistant: stated facts and preferences, recalled
  // into every answer): kept in Ironleaf's own data, never the notes, like the assistant's jobs above.
  let assistantMemory: AssistantMemory = { facts: [] };
  const memoryFile = path.join(host.dataDir, 'assistant-memory.json');
  try {
    const kept = JSON.parse(readFileSync(memoryFile, 'utf8')) as unknown;
    const facts = (kept as { facts?: unknown }).facts;
    if (Array.isArray(facts)) assistantMemory = { facts: facts.filter((f): f is { fact: string; updated: string } => !!f && typeof (f as { fact?: unknown }).fact === 'string' && typeof (f as { updated?: unknown }).updated === 'string').map((f) => ({ fact: f.fact, updated: f.updated })) };
  } catch {
    // None kept yet.
  }
  const keepMemory = () => {
    try {
      writeFileSync(memoryFile, JSON.stringify(assistantMemory));
    } catch {
      // Kept while Ironleaf runs; recalled less after a restart.
    }
  };
  const memoryDay = () => formatDate('YYYY-MM-DD');
  ai.agentHost = {
    index,
    memory: {
      facts: () => assistantMemory.facts.map((f) => ({ ...f })),
      remember: (fact: string) => {
        const r = rememberFact(assistantMemory, fact, memoryDay());
        assistantMemory = r.mem;
        if (r.kept) keepMemory();
        return { kept: r.kept, words: r.words };
      },
      forget: (topic: string) => {
        const r = forgetFact(assistantMemory, topic);
        assistantMemory = r.mem;
        if (r.forgot.length) keepMemory();
        return { forgot: r.forgot, words: r.words };
      },
    },
    embed: embedForWrites,
    // Work handed to the former host app by the assistant, started at once as the person's own request (19 Oct 2026:
    // asked for a brand template, the assistant said it could not make PDFs instead of handing the work over).
    ...(host.neuralSparkJob
      ? {
          job: async (request: { brief: string; project?: { name: string; note: string; folder: string | null }; files?: string[] }) => {
            await requireCreate();
            const started = await host.neuralSparkJob!({ agent: { agentId: 'neuralvault-assistant', agentName: 'Ironleaf', level: 'full', where: 'this-pc' }, ...request, from: 'assistant' });
            assistantJobs.set(started.conversationId, new Set());
            keepJobs();
            return { conversationId: started.conversationId };
          },
        }
      : {}),
    listing: async () => {
      const all = await requireVault().listAll();
      return { files: all.files.map((f) => ({ rel: f.rel, kind: f.kind })), folders: all.folders };
    },
    exists: async (rel) => requireVault().any(rel),
    read: async (rel) => requireVault().read(rel),
    write: async (rel, text) => {
      const before = index.content(rel);
      // The vault assistant's own write (an agent reaching the notes through these steps keeps its own name).
      await writeNote(rel, text, writer.getStore() ?? 'assistant');
      // A project the assistant changed: in the project's history with the person's own changes (Undo on its page).
      if (before !== undefined && (isProjectText(text) || isProjectText(before))) projectHistory.record(rel, { before, after: text, words: 'The assistant’s change to the project.', by: 'assistant' });
    },
    makeFolder: async (rel) => {
      await requireCreate();
      await requireVault().makeFolder(rel);
      filesChanged();
    },
    move: async (from, to) => {
      await requireCreate();
      const r = await movePath(from, to, true);
      return { path: r.path, linksUpdated: r.linksUpdated };
    },
    trash: async (rel) => {
      await requireCreate();
      await trashRel(rel);
    },
    // The vault's own Bin (src/main/bin.ts): the assistant's move_to_bin, the same Bin Recently deleted shows.
    bin: {
      put: async (rel, opts) => {
        await requireCreate();
        return binRel(cleanRel(rel), opts?.why ? { why: opts.why } : undefined);
      },
      list: () => binList(),
      restore: async (which) => {
        await requireCreate();
        return binRestore(which);
      },
    },
    // Tick a task or move it to another day, through the Tasks view's own actions (src/main/tasks.ts), each note it
    // changed listed with its text before for the answer's Undo.
    tasks: {
      tick: async (p, line, text, done) => {
        await requireCreate();
        const { out, changed } = await recordingWrites(() => tasks.tick(cleanNotePath(p), line, text, done));
        return { ...out, changed };
      },
      setDue: async (p, line, text, iso, time) => {
        await requireCreate();
        const { out, changed } = await recordingWrites(() => tasks.setDue(cleanNotePath(p), line, text, iso, time));
        return { words: out, changed };
      },
    },
    clean: (rel) => {
      try {
        return cleanRel(rel);
      } catch {
        return '';
      }
    },
    today: () => `${formatDate('dddd D MMMM YYYY')} (${formatDate('YYYY-MM-DD')})`,
    ...(host.readDocument ? { readDocument: (file: string) => host.readDocument!(file) } : {}),
    // The web, inside the former host app (8.0 V6): its own search, and a page read here as words
    // (src/main/web-read.ts).
    ...(host.webSearch ? { web: { search: async (query: string) => cleanHits(await host.webSearch!(query, 8)), read: (url: string) => readPage(url) } } : {}),
    // Whether its Models web-search switch is off (c3 item 2): live, so the side chat offers no web tools while off.
    ...(host.webSearchOff ? { webSearchOff: () => !!host.webSearchOff!() } : {}),
    projectFiles: {
      search: (query: string, project?: string, limit?: number) => fileIndex.search(query, { ...(project ? { project } : {}), limit: limit ?? 12, snippets: 3 }),
      read: (project: string, rel: string) => fileIndex.read(project, rel),
      projects: () => (vault ? projects.list().map((c) => ({ path: c.path, name: c.name, folder: c.folder })) : []),
      status: () => fileIndex.status(),
    },
    // The words read in pictures and scans (src/main/ocr.ts), for the assistant's search and reading (gated like notes).
    pictureWords: {
      search: (query: string, limit: number) =>
        ocrStore ? searchOcr(ocrStore.all(), query, { isExcluded: (rel) => index.isExcluded(rel), limit }).map((h) => ({ path: h.path, kind: h.kind, ...(h.page ? { page: h.page } : {}), lines: h.snippets.map((s) => s.text) })) : [],
      read: (rel: string) => (ocrStore ? ocrFileText(ocrStore.get(rel)) : null),
      has: (rel: string) => !!ocrStore?.get(rel),
    },
    // The words in a Word, Excel, PowerPoint, PDF or text file among the notes (seams O4: read_note and note_read
    // read them as documents; gated like notes, through the caller's gate).
    readNoteDocument: async (rel: string) => {
      const v = vault;
      if (!v) return null;
      let abs: string;
      try {
        abs = v.absolute(cleanRel(rel));
      } catch {
        return null;
      }
      const ext = rel.split('.').pop() ?? '';
      const stat = await fsp.stat(abs).catch(() => null);
      if (!stat || !stat.isFile()) return null;
      const r = await readFileText(abs, ext, stat.size, { pdf: pdfReader, ...(host.readDocument ? { bridge: (file: string) => host.readDocument!(file) } : {}) });
      return r.state === 'text' ? (r.text ?? '') : r.state === 'empty' ? '' : null;
    },
    ensureTemplates: async () => {
      await ensureTemplates();
    },
    // The vault's note types (src/shared/note-types.ts), so a note the assistant makes gets the right type and folder.
    // The top folders come from the notes already in the index, not a walk of the disk on every message.
    noteTypes: async () => {
      const v = requireVault();
      const top = [...new Set(index.allMeta().map((m) => m.path.split('/')).filter((p) => p.length > 1).map((p) => p[0]))];
      return typesWords(v.root, { topFolders: top, templatesFolder: settings.raw.prefs.templatesFolder, docsFolder: DOCS_FOLDER });
    },
    // Ask before the assistant changes a note (Settings › Models): its edits wait in the note for the person.
    suggest: {
      on: () => askBeforeChangesUnderPolicy(settings.raw.prefs.askBeforeChanges),
      pending: (rel: string, current: string) => suggestions.pending(rel, current),
      offer: (rel: string, current: string, after: string) => suggestions.offer(rel, current, after),
      waiting: () => suggestions.list().map((e) => e.path),
    },
    assets: { list: () => assets.list(), details: (rel: string) => assets.details(rel) },
    // A bill marked paid for the property tools' paid door (2 Nov 2026): the window's own Mark paid, so the due day
    // moves and the payment is recorded, never written bare.
    markBillPaid: (rel: string, day: string) => recordModules.markPaid(rel, day),
    // Projects' own folders, here or on a remote computer through the former host app: the project is the
    // permission.
    folders: { access: projectFolders, projects: () => (vault ? projects.all().map((x) => ({ path: x.path, project: withFiles(x.path, x.project) })) : []) },
    // The assistant's copies and changes in projects' folders on this PC (src/main/agent.ts decides what may be written:
    // new files only, or files it made; never outside the project's folder). The files index reads them straight away.
    fileWrites: {
      write: async (abs: string, data: Buffer, mode: 'new' | 'replace') => {
        await requireCreate();
        await writeFileSafely(abs, data, mode);
        fileIndex.checkAll();
      },
      trash: async (abs: string) => {
        await shell.trashItem(abs);
        fileIndex.checkAll();
      },
    },
  };

  // The side chat reads only the levels the person allows it (Settings › Privacy and secrets; src/main/agent-gate.ts).
  ai.gate = () => (vault ? makeGate(sensitivity, 'side-chat', 'The side chat') : null);
  // One answer's proposed edits wait as one change set (10.0, v2changes): offered here so the chat card and the review
  // panel read the same waiting set, even after a restart. Null while no vault is open: the chat keeps its own cards.
  ai.proposeSet = async (askWords, proposals) => {
    if (!vault) return null;
    try {
      const { set } = await changeSets.offer('The side chat', askWords, proposals.map((p) => ({ id: p.id, path: p.path, name: p.name, base: p.before, after: p.after, changes: p.changes })), writer.getStore() ?? 'assistant');
      return set.id;
    } catch {
      return null;
    }
  };
  ai.acceptSetEntry = (entryId: string) => changeSets.acceptEntry(entryId);

  /** A note landed on disk: indexed, shown in open tabs, kept in file recovery with who wrote it. */
  async function noteWritten(v: Vault, rel: string, text: string, author: VersionAuthor, r: CheckedWrite, o: { relationSync?: boolean } = {}): Promise<{ synced: SyncedBacklink[]; missed: number }> {
    // Wiped (non-empty words replaced with nothing): the earlier words are kept first, so wiping can be undone (F10).
    if (r.emptied) {
      const was = index.content(rel);
      if (was && was.trim()) await recovery.keep(rel, was, true);
    }
    const before = index.content(rel);
    await indexFile(v, rel);
    void recovery.keep(rel, text, { by: author, force: author === 'restored' });
    notifyChanged([rel]);
    // An import's write (o.relationSync false) brings the note in as it was: nothing else is rewritten for it.
    if (o.relationSync === false) return { synced: [], missed: 0 };
    return relationSyncForWrite(v, rel, before, text, author);
  }

  /** A template, never written into by the relations seam, and never the source of back-writes. */
  const isTemplateNote = (p: string): boolean => templateNote(p, settings.raw.prefs.templatesFolder, index.get(p)?.props);

  /**
   * The relations seam after a write landed (src/main/relation-sync.ts): the changed relation properties planned
   * through the shared planner and the back-links written through the guarded write, credited to the same author — so
   * the side chat, agents, imports, the bot, views and note Properties all keep the other side in sync the same way.
   */
  async function relationSyncForWrite(v: Vault, rel: string, before: string | undefined, after: string, author: VersionAuthor): Promise<{ synced: SyncedBacklink[]; missed: number }> {
    const none = { synced: [], missed: 0 };
    // Nothing relation-shaped changed (most saves): out before touching the index.
    if (before === after || !diffRelationProps(readProps(before ?? ''), readProps(after)).length) return none;
    if (isTemplateNote(rel)) return none;
    const metas = index.allMeta();
    const me = metas.find((m) => m.path === rel);
    const writes = withoutTemplates(
      planSyncAfterWrite(
        { path: rel, title: me?.label || me?.title || rel.split('/').pop()!.replace(/\.md$/i, '') },
        before ?? '',
        after,
        { notes: metas.map((m) => ({ path: m.path, title: m.label || m.title })), propsOf: (p) => index.get(p)?.props ?? {} },
      ),
      isTemplateNote,
    );
    if (!writes.length) return none;
    return applyRelationWrites(writes, {
      read: async (p) => index.content(p) ?? (await v.read(p).catch(() => null)),
      write: async (p, text) => {
        try {
          await writeNote(p, text, author);
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  /** A guarded write's answer with what the relations seam did for it (left out when nothing relation-shaped changed). */
  const withSyncResult = (r: CheckedWrite, s: { synced: SyncedBacklink[]; missed: number }): CheckedWrite => ({
    ...r,
    ...(s.synced.length ? { synced: s.synced } : {}),
    ...(s.missed ? { missed: s.missed } : {}),
  });

  /** Newly made notes' links synced back (imports, templates, duplicates): each planned as all-added, one shared list. */
  async function relationSyncForCreates(v: Vault, rels: readonly string[], author: VersionAuthor): Promise<void> {
    const fresh = rels.filter((r) => kindOf(r) === 'note' && !isTemplateNote(r));
    if (!fresh.length) return;
    const metas = index.allMeta();
    const by = { notes: metas.map((m) => ({ path: m.path, title: m.label || m.title })), propsOf: (p: string) => index.get(p)?.props ?? {} };
    const writes = fresh.flatMap((rel) => {
      const after = index.content(rel);
      if (after === undefined) return [];
      const me = metas.find((m) => m.path === rel);
      return withoutTemplates(planSyncAfterWrite({ path: rel, title: me?.label || me?.title || rel.split('/').pop()!.replace(/\.md$/i, '') }, '', after, by), isTemplateNote);
    });
    if (!writes.length) return;
    await applyRelationWrites(writes, {
      read: async (p) => index.content(p) ?? (await v.read(p).catch(() => null)),
      write: async (p, text) => {
        try {
          await writeNote(p, text, author);
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  /**
   * Writes a note as every write does: guarded, indexed, shown in open tabs, kept in file recovery with who wrote it.
   * `base` is the fingerprint of what the writer read; left out, the index's (taken synchronously, so a tick's read
   * and this can't part). A write that would clobber another change is refused in plain words instead (F1, F8).
   */
  async function writeNote(rel: string, text: string, by?: VersionAuthor, base?: string | null): Promise<void> {
    await requireCreate();
    const v = requireVault();
    const isNew = !(await v.any(rel));
    // A module tool's call keeps how the note was (module-writes.ts), for the former host app's Rewind and the reply's card.
    noteBefore(rel, !isNew, isNew ? undefined : index.content(rel));
    const dir = folderOf(rel);
    if (dir && !(await v.any(dir))) await v.makeFolder(dir);
    const author = authorNow(by);
    // An earlier version brought back: the note as it was is kept first, so bringing it back can be undone too.
    const was = author === 'restored' ? index.content(rel) : undefined;
    if (was !== undefined) await recovery.keep(rel, was, true);
    const known = index.content(rel);
    const r = await v.writeChecked(rel, text, base !== undefined ? base : isNew || known === undefined ? null : textVersion(known));
    if (!r.ok) {
      if (r.missing) throw new Error('That note is no longer there.');
      throw new Error('That note changed just now somewhere else, so this change didn’t land. Try it again.');
    }
    await noteWritten(v, rel, text, author, r);
    if (isNew) filesChanged();
  }

  /**
   * A project renamed on its page: its title is written, then its folder and file take the new name when they had the
   * old one (Projects/<Name>/<Name>.md), each move keeping every link to them working. Checked before anything moves.
   */
  async function projectMoves(file: string, oldName: string, newName: string): Promise<[string, string][]> {
    const v = requireVault();
    const from = safeName(oldName);
    const to = safeName(newName);
    if (from.toLowerCase() === to.toLowerCase()) return [];
    const plan: [string, string][] = [];
    const dir = folderOf(file);
    const base = (file.split('/').pop() ?? '').replace(/\.md$/i, '');
    let current = file;
    if (dir && dir.split('/').pop() === from) {
      const next = join(folderOf(dir), to);
      if (await v.any(next)) throw new Error(`There’s already a folder called “${to}” beside it: choose another name.`);
      plan.push([dir, next]);
      current = `${next}/${file.split('/').pop()}`;
    }
    if (base === from) {
      const next = join(folderOf(current), `${to}.md`);
      if (await v.any(next)) throw new Error(`There’s already a note called “${to}” there: choose another name.`);
      plan.push([current, next]);
    }
    return plan;
  }

  /** The project's file after moves: where the first one started, where the last one put it. */
  const movedTo = (file: string, moves: [string, string][]) => moves.reduce((p, [a, b]) => (p === a ? b : p.startsWith(`${a}/`) ? b + p.slice(a.length) : p), file);

  /** A project's change undone, or made again: only on the files as that change left them (one task, one row: a
   *  tick's closed note lines go back with it, or the whole Undo is refused, as a project changed as a note is). */
  async function projectStep(file: string, redo: boolean): Promise<ProjectEditResult> {
    await requireCreate();
    const step = projectHistory.peek(file, redo);
    if (!step) throw new Error(redo ? 'There’s nothing to redo.' : 'There’s nothing to undo here.');
    const mismatchedNote = (step.notes ?? []).find((n) => index.content(n.path) !== (redo ? n.before : n.after));
    if (mismatchedNote) {
      projectHistory.forget(file);
      throw new Error('The project was changed as a note since, so that can’t be undone here. Its earlier versions are in File recovery.');
    }
    const current = index.content(file);
    if (current !== (redo ? step.before : step.after)) {
      projectHistory.forget(file);
      throw new Error('The project was changed as a note since, so that can’t be undone here. Its earlier versions are in File recovery.');
    }
    const moves: [string, string][] = [];
    let target = file;
    if (redo) {
      await writeNote(file, step.after);
      for (const [a, b] of step.moves ?? []) {
        await movePath(a, b, true);
        moves.push([a, b]);
      }
      target = movedTo(file, moves);
      for (const n of step.notes ?? []) await writeNote(n.path, n.after);
    } else {
      for (const [a, b] of [...(step.moves ?? [])].reverse()) {
        await movePath(b, a, true);
        moves.push([b, a]);
      }
      target = movedTo(file, moves);
      await writeNote(target, step.before);
      for (const n of [...(step.notes ?? [])].reverse()) await writeNote(n.path, n.before);
    }
    projectHistory.shift(target, redo);
    const words = step.words.replace(/\.$/, '');
    return { view: projects.view(target), words: `${redo ? 'Made again' : 'Undone'}: ${words.charAt(0).toLowerCase()}${words.slice(1)}.`, moves, ...projectHistory.counts(target) };
  }

  /** Meetings → next steps and the weekly review (src/main/reviews.ts), on the same notes, history and model. */
  const reviews = new Reviews({
    index,
    projects,
    history: projectHistory,
    embed: embedForWrites,
    writeNote,
    exists: async (rel) => !!vault && (await vault.any(rel)),
    trash: async (rel) => {
      await trashRel(rel);
    },
    versions: (rel) => recovery.versions(rel),
    version: (rel, id) => recovery.read(rel, id),
    load: async () => (vault ? state.load(vault.root, 'reviews') : null),
    save: async (value) => {
      if (vault) await state.save(vault.root, 'reviews', value);
    },
    askJson: async (system, user) => {
      const status = aiStatus(settings.raw.model);
      if (!status.ready) return { reply: null, error: status.note ?? 'No model is set up yet.' };
      return ai.askJson(system, user);
    },
    undoProject: (rel) => projectStep(rel, false),
    templatesFolder: () => settings.raw.prefs.templatesFolder ?? 'Templates',
  });
  /**
   * A change made by hand to a project (its page, Quick capture's next step): one way in for every fact
   * (src/shared/project-file.ts applyProjectEdit), refused when the file changed since the page showed it, written back
   * keeping every line it doesn't understand, and kept in the project's history to undo.
   */
  async function editProject(rel: unknown, edit: unknown, version: unknown, by = 'you', said?: string): Promise<ProjectEditResult> {
    await requireCreate();
    const file = cleanRel(rel);
    const before = index.content(file);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    if (typeof version === 'string' && version && version !== textVersion(before)) throw new Error('The project changed just now (the assistant, or the note itself). The page shows it as it is now: make the change again.');
    const p = parseProject(before, file);
    const oldName = p.name;
    // An agent's several lines at once (src/main/agent-access.ts) are one change, as one step to undo.
    const edits = (Array.isArray(edit) ? edit : [edit]) as ProjectEdit[];
    // One task, one home (p12-task-writes): every next step added through here — the page, the person's own adds,
    // agents, Quick capture — runs the write check first (a match updates that task instead of adding another).
    const isNextAdd = (e: ProjectEdit) => e && e.kind === 'add' && e.list === 'next';
    const adds = edits.filter(isNextAdd);
    let rest = edits;
    let words = said;
    if (adds.length) {
      const { planned, updates } = await planNextAdds(
        index,
        file,
        adds.map((e) => (e.kind === 'add' ? (e.item as { what: string; who?: string; when?: string; more?: string }) : { what: '' })),
        { embed: embedForWrites },
      );
      await writeNoteUpdates(index, planned, writeNote);
      rest = [...edits.filter((e) => !isNextAdd(e)), ...plannedEdits(planned)];
      words = plannedWords(planned, updates) ?? said;
      if (!rest.length) {
        // Every line matched with nothing to change: said, not written (the file and its updated day untouched).
        return { view: projects.view(file), words: words ?? 'Already there.', moves: [], ...projectHistory.counts(file) };
      }
    }
    // One task, one row (p13-one-task): a step ticked done or reopened, toggled, or removed (the close dialog's drop
    // and move, a row delete) closes or reopens its matching note lines too. Each identity is read before its edit
    // lands: indexes shift as a batch applies.
    const closed: { step: MatchStep; done: boolean }[] = [];
    const done: string[] = [];
    for (const e of rest) {
      const shut = closedStepOf(p.next, e);
      if (shut) closed.push(shut);
      done.push(applyProjectEdit(p, e, formatDate('D MMM YYYY')));
    }
    words = words ?? (done.length === 1 ? done[0] : `Made ${done.length} changes.`);
    p.updated = formatDate('YYYY-MM-DD');
    const after = serializeProject(p, before);
    const renaming = edits.length === 1 && edits[0]?.kind === 'set' && (edits[0] as { field?: string }).field === 'name' && p.name !== oldName;
    const plan = renaming ? await projectMoves(file, oldName, p.name) : [];
    // The relations before the write (p18-big-vault, as the ticks): the write drops them, and the cascade re-deriving
    // them from every note is what a save cost on a big vault. Reused only when the batch keeps the names the owner
    // rule resolves by — a rename moves them, so it reads them after, as before.
    const rels = closed.length && ownerNamesKept(oldName, p.name, rest) ? index.relations() : null;
    await writeNote(file, after);
    for (const [a, b] of plan) await movePath(a, b, true);
    const target = movedTo(file, plan);
    // The closed steps close their lines in the same change (each note once in the history step, first before to last
    // after, so one Undo restores all of them).
    const skipNote = (rel: string) => inFolder(rel, settings.raw.prefs.templatesFolder || '') || index.isExcluded(rel);
    const cascaded = new Map<string, { before: string; after: string }>();
    for (const c of closed) {
      for (const f of cascadeForStep(index, skipNote, file, c.step, c.done, new Date(), rels)) {
        await writeNote(f.path, f.after);
        const kept = cascaded.get(f.path);
        cascaded.set(f.path, kept ? { before: kept.before, after: f.after } : { before: f.before, after: f.after });
      }
    }
    const notes = [...cascaded].map(([path, v]) => ({ path, ...v }));
    // (moving can bring links in the project's own file up to date: the history keeps the file as it ended up)
    projectHistory.record(target, { before, after: index.content(target) ?? after, words, by, ...(plan.length ? { moves: plan } : {}), ...(notes.length ? { notes } : {}) });
    return { view: projects.view(target), words, moves: plan, ...projectHistory.counts(target) };
  }

  // Tidy (src/shared/project-tidy.ts; 29 Oct 2026): what would move in one project, for the preview the person
  // approves. Nothing is changed by a preview.
  function tidyPreview(file: string): TidyPreview {
    const before = index.content(file);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    const plan = planTidy(before, new Date());
    return { path: file, name: parseProject(before, file).name, version: textVersion(before), moves: plan.moves, said: plan.said, historyPath: historyPathFor(file) };
  }

  /** The History note of the last Tidy of each project, so its Undo puts that note back too. */
  const tidyHistory = new Map<string, { historyPath: string; historyBefore: string | null; moved: number; said: string[] }>();

  /**
   * Tidy one project on the version its preview showed (refused when the file changed since, as every project edit
   * is): what moves goes to its History note first, so nothing is lost if a write fails, then the project file is
   * written through the same history every other project change uses.
   */
  async function tidyProject(rel: unknown, version: unknown): Promise<TidyResult> {
    await requireCreate();
    const file = cleanRel(rel);
    const before = index.content(file);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    if (typeof version === 'string' && version && version !== textVersion(before)) throw new Error('The project changed just now (the assistant, or the note itself). The page shows it as it is now: make the change again.');
    const name = parseProject(before, file).name;
    const plan = planTidy(before, new Date());
    const historyPath = historyPathFor(file);
    if (!plan.moves.length) return { view: projects.view(file), words: `Nothing to tidy in ${name} just now.`, moves: [], ...projectHistory.counts(file), historyPath, moved: 0, said: plan.said };
    let historyBefore = index.content(historyPath) ?? null;
    if (historyBefore === null) historyBefore = await requireVault().read(historyPath).catch(() => null);
    await writeNote(historyPath, historyNoteText(historyBefore, name, plan.history));
    await writeNote(file, plan.keep);
    const words = `Tidied ${name}: moved ${plan.moves.length} ${plan.moves.length === 1 ? 'thing' : 'things'} to its History note.`;
    projectHistory.record(file, { before, after: index.content(file) ?? plan.keep, words, by: 'you' });
    tidyHistory.set(file, { historyPath, historyBefore, moved: plan.moves.length, said: plan.said });
    return { view: projects.view(file), words, moves: [], ...projectHistory.counts(file), historyPath, moved: plan.moves.length, said: plan.said };
  }

  /** The last Tidy of a project taken back: the project file through its history, and its History note as it was
   *  (a History note Tidy made goes to the Bin, never deleted for good). */
  async function tidyUndo(rel: unknown): Promise<TidyResult> {
    await requireCreate();
    const file = cleanRel(rel);
    const kept = tidyHistory.get(file);
    const r = await projectStep(file, false);
    if (kept) {
      if (kept.historyBefore === null) await trashRel(kept.historyPath);
      else await writeNote(kept.historyPath, kept.historyBefore);
      tidyHistory.delete(file);
    }
    return { ...r, historyPath: kept?.historyPath ?? historyPathFor(file), moved: kept?.moved ?? 0, said: kept?.said ?? [] };
  }

  /** A project by hand (Projects home, the Templates page) or by an agent: its shape from a project template when given. */
  async function createProject(name: unknown, folder: unknown, template: unknown, area?: unknown): Promise<string> {
    await requireCreate();
    const v = requireVault();
    const title = typeof name === 'string' ? name.trim().slice(0, 120) : '';
    if (!title) throw new Error('Give the project a name.');
    const top = (await v.listAll()).folders.filter((f) => !f.includes('/'));
    // In an area of life (Wave 4): its Projects folder ("Work/Projects/<Name>/<Name>.md").
    const file = projectPath(typeof area === 'string' && area.trim() ? `${cleanRel(area)}/Projects` : projectsFolder(top), title);
    if (await v.any(file)) throw new Error('A project with that name is already there.');
    const shape = typeof template === 'string' && template ? (await readTemplate(template)).text : '';
    const { dateFormat, timeFormat } = settings.raw.prefs;
    const made = projectFromTemplate(shape, { name: title, title, dateFormat, timeFormat, today: formatDate('YYYY-MM-DD'), folder: typeof folder === 'string' ? folder : undefined });
    await ai.agentHost!.write(file, made.text);
    return file;
  }

  /**
   * Making an offered folder a project (5 Nov 2026, u3 moving-in): the offer still stands, the owned name is free,
   * and one blank-but-for-the-line file is written — the folder's notes untouched.
   */
  async function projectFromFolder(folder: unknown): Promise<string> {
    await requireCreate();
    const v = requireVault();
    const dir = cleanRel(folder);
    const offer = projects.folderOffers().find((o) => o.folder === dir);
    if (!offer) throw new Error('That folder isn’t offered as a project any more.');
    const file = `${dir}/${offer.name}.md`;
    if (await v.any(file)) throw new Error('A project with that name is already there.');
    await writeNote(file, claimFolderText(offer.name));
    return file;
  }

  /** Taking a thin file's project claim back: the `type: project` line goes, the note stays an ordinary note. */
  async function projectUnclaim(rel: unknown): Promise<string> {
    await requireCreate();
    const file = cleanRel(rel);
    const before = index.content(file);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    const after = unclaimProjectText(before);
    if (after === null) throw new Error('That note isn’t a project file.');
    await writeNote(file, after, 'you');
    return file;
  }

  /** A path in the notes as the renderer names it: forward slashes, no leading slash, nothing Windows refuses. */
  function cleanRel(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('Invalid name.');
    const p = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').trim();
    if (!p) throw new Error('A name is needed.');
    if (/[<>:"|?*\u0000-\u001f]/.test(p)) throw new Error('Names cannot contain < > : " | ? * characters.');
    if (p.split('/').some((part) => !part.trim() || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error('A name can’t be empty or end with a dot or a space.');
    if (p.split('/').some((part) => isReservedName(part.indexOf('.') < 0 ? part : part.slice(0, part.indexOf('.'))))) throw new Error('Windows keeps names like CON, PRN and NUL for itself. Choose another name.');
    return p;
  }

  /** A path already in the notes (a move's source, the vault check's repairs): normalised, legality unchecked — it
   *  names what is there, even a name Windows cannot keep (Nov 2026: repairs could not move from such a name). */
  function looseRel(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('Invalid name.');
    const p = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').trim();
    if (!p || p.split('/').some((part) => part === '..')) throw new Error('Invalid name.');
    return p;
  }

  const folderOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
  const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

  /** A free name in a folder: "Name.ext", else "Name 1.ext", "Name 2.ext"… */
  async function uniqueRel(v: Vault, folder: string, base: string, ext: string): Promise<string> {
    for (let i = 0; i < 10000; i++) {
      const rel = join(folder, `${i === 0 ? base : `${base} ${i}`}${ext}`);
      if (!(await v.any(rel))) return rel;
    }
    throw new Error('No free name was found.');
  }

  function splitName(name: string): { base: string; ext: string } {
    // A view's two-part ending stays whole, so its copy is still a view ("Board 1.view.json", not "Board.view 1.json").
    if (/\.view\.json$/i.test(name)) return { base: name.slice(0, -'.view.json'.length), ext: name.slice(-'.view.json'.length) };
    const dot = name.lastIndexOf('.');
    return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' };
  }

  function cleanFileName(raw: unknown, fallback: string): string {
    return sharedCleanFileName(typeof raw === 'string' ? raw.split(/[\\/]/).pop()! : '', fallback, 180);
  }

  /** The notes and files in a folder (or the one file), each with where it ends up. */
  async function movePairs(v: Vault, src: string, dest: string): Promise<[string, string][]> {
    if (!(await v.isFolder(src))) return [[src, dest]];
    const { files } = await v.listAll();
    const prefix = `${src}/`;
    return files.filter((f) => f.rel.startsWith(prefix)).map((f) => [f.rel, `${dest}/${f.rel.slice(prefix.length)}`]);
  }

  /** How a link to `rel` is written from `source`: its name when that alone finds it, else its path. */
  /** A link written from its note's folder, for the note's (new) folder: ./ kept or left off as it was written. */
  function fromFolderText(rel: string, source: string, dotted: boolean, wiki: boolean): string {
    const text = relativePath(folderOfPath(source), wiki && kindOf(rel) === 'note' ? rel.replace(/\.md$/i, '') : rel);
    return dotted ? text : text.replace(/^\.\//, '');
  }

  function linkTextFor(rel: string, source: string, written: string): string {
    if (kindOf(rel) === 'note') {
      const title = titleFromPath(rel);
      if (!written.includes('/') && index.resolve(title, source) === rel) return normalizeTarget(written) === normalizeTarget(title) ? written : title;
      return rel.replace(/\.md$/i, '');
    }
    const name = rel.split('/').pop() ?? rel;
    if (!written.includes('/') && index.resolveFile(name, source) === rel) return written.toLowerCase() === name.toLowerCase() ? written : name;
    return rel;
  }

  /**
   * Canvases name the files on their cards by path (JSON Canvas): a moved or renamed file's cards follow it, written
   * back as they were (only the path changes), so a board never shows a missing file after a rename.
   */
  /** Boards whose cards point at files moved outside Ironleaf (by hand, a sync, another program): each card that names a file
   *  no longer there is pointed at the one file whose path ends the same way ("Projects/X/X.md" now at
   *  "Work/Projects/X/X.md"). Checked as the vault opens (26 Oct 2026: eleven of the project boards had lost every card
   *  after their projects went into an area). */
  async function repairCanvases(v: Vault): Promise<string[]> {
    const files = (await v.listAll()).files;
    const all = files.map((f) => f.rel);
    const have = new Set(all);
    const fix = new Map<string, string>();
    for (const f of files.filter((x) => x.kind === 'canvas').map((x) => x.rel)) {
      let text: string;
      try {
        text = await v.readText(f);
      } catch {
        continue;
      }
      for (const m of text.matchAll(/"(?:file|doc|project)"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
        let value: unknown;
        try {
          value = JSON.parse(m[1]);
        } catch {
          continue;
        }
        if (typeof value !== 'string' || !value || have.has(value) || fix.has(value)) continue;
        const found = all.filter((rel) => rel.endsWith(`/${value}`));
        if (found.length === 1) fix.set(value, found[0]);
      }
    }
    return fix.size ? followInCanvases(v, fix) : [];
  }

  async function followInCanvases(v: Vault, moved: Map<string, string>): Promise<string[]> {
    const changed: string[] = [];
    const back = new Map<string, string>();
    for (const [a, b] of moved) back.set(b, a);
    // A text card's link target rewritten as a note link would be (the board's own path, before and after the move).
    const boardRewrite = (boardNew: string) => {
      const boardOld = back.get(boardNew) ?? boardNew;
      return (target: string, wiki: boolean): string | null => {
        let to: string | undefined;
        if (isRelativeTarget(target)) {
          const oldAbs = joinPath(folderOfPath(boardOld), target);
          to = oldAbs ? (moved.get(oldAbs) ?? moved.get(`${oldAbs}.md`) ?? [...moved].find(([k]) => normalizeTarget(k) === normalizeTarget(oldAbs))?.[1]) : undefined;
          if (!to) return null;
          return fromFolderText(to, boardNew, true, wiki);
        }
        const norm = normalizeTarget(target);
        for (const [from, dest] of moved) {
          if (norm === normalizeTarget(from) || norm === normalizeTarget(from.replace(/\.md$/i, ''))) {
            to = dest;
            break;
          }
        }
        if (!to) return null;
        if (index.writtenFromFolder(target, boardNew)) return fromFolderText(to, boardNew, isRelativeTarget(target), wiki);
        return wiki ? linkTextFor(to, boardNew, target) : to;
      };
    };
    for (const f of (await v.listAll()).files.filter((x) => x.kind === 'canvas')) {
      let text: string;
      try {
        text = await v.readText(f.rel);
      } catch {
        continue;
      }
      let count = 0;
      // A card's file, and the doc or project a board or card is bound to (its `neuralvault` part: doc-canvas.ts,
      // project-canvas.ts), so a doc's or project's board stays bound to it after a move (Wave 4).
      let next = text.replace(/("(?:file|doc|project)"\s*:\s*)("(?:[^"\\]|\\.)*")/g, (whole, key: string, literal: string) => {
        let value: unknown;
        try {
          value = JSON.parse(literal);
        } catch {
          return whole;
        }
        const to = typeof value === 'string' ? moved.get(value) : undefined;
        if (!to) return whole;
        count++;
        return `${key}${JSON.stringify(to)}`;
      });
      // A text card's words (CardFace renders them as Markdown, links and all): the same rewrite as note links.
      const words = relinkBoardText(next, boardRewrite(f.rel));
      if (words !== next) {
        count++;
        next = words;
      }
      if (!count) continue;
      await v.writeText(f.rel, next);
      changed.push(f.rel);
    }
    return changed;
  }

  /** Views over a folder that moved (src/shared/views.ts) follow it, so they still show its notes. */
  async function followInViews(v: Vault, from: string, to: string): Promise<string[]> {
    const changed: string[] = [];
    for (const f of (await v.listAll()).files.filter((x) => x.kind === 'view')) {
      try {
        const text = await v.readText(f.rel);
        // A .base file's every view follows (each written back into the same file, the rest of it kept).
        const { problem, views } = readViewFile(f.rel, text);
        if (problem) continue;
        let next = text;
        for (let i = 0; i < Math.max(1, views.length); i++) {
          const moved = followFolder(readViewFile(f.rel, next, i).def, from, to);
          if (moved) next = writeViewFile(f.rel, next, moved, i);
        }
        if (next === text) continue;
        await v.writeText(f.rel, next);
        changed.push(f.rel);
      } catch {
        // A view that can't be read or written stays as it was; it says so when opened.
      }
    }
    return changed;
  }

  /**
   * Moves or renames a note, a file or a folder. With updateLinks, every link that reached a moved note or file is
   * rewritten so it still does (wikilinks and Markdown links, embeds too), in every note.
   */
  /** Module folders outside their area (a top-level "Finance" while Finance lives in Me) moved into it, file by file with
   *  their links; a file already at its new place stays where it is; an emptied folder is taken away. */
  async function tidyModuleFolders(v: Vault): Promise<number> {
    if (vault !== v) return 0;
    const areas = readAreas(await fsp.readFile(path.join(v.root, ...AREAS_FILE.split('/')), 'utf8').catch(() => null)).config?.areas ?? null;
    const tops = (await fsp.readdir(v.root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    const plan = strayModuleFolders(tops, modulesOn(settings.raw.prefs.modules).map((m) => m.id), areas);
    let moved = 0;
    for (const { from, to } of plan) {
      const files: string[] = [];
      const walk = async (rel: string): Promise<void> => {
        for (const e of await fsp.readdir(path.join(v.root, ...rel.split('/')), { withFileTypes: true }).catch(() => [])) {
          const child = `${rel}/${e.name}`;
          if (e.isDirectory()) await walk(child);
          else if (e.isFile()) files.push(child);
        }
      };
      await walk(from);
      for (const rel of files) {
        const dest = to + rel.slice(from.length);
        if (vault !== v || (await v.any(dest))) continue;
        await movePath(rel, dest, true).then(() => moved++, () => {});
      }
      const left: string[] = [];
      const count = async (rel: string): Promise<void> => {
        for (const e of await fsp.readdir(path.join(v.root, ...rel.split('/')), { withFileTypes: true }).catch(() => [])) {
          if (e.isDirectory()) await count(`${rel}/${e.name}`);
          else left.push(e.name);
        }
      };
      await count(from);
      if (!left.length) await v.trashPath(from).catch(() => {});
    }
    if (moved) {
      notifyChanged([]);
      filesChanged();
    }
    return moved;
  }

  async function movePath(from: unknown, to: unknown, updateLinks: boolean): Promise<MoveResult> {
    const v = requireVault();
    const src = looseRel(from);
    let dest = cleanRel(to);
    if (!(await v.any(src))) throw new Error('That is no longer there.');
    const folder = await v.isFolder(src);
    // A note renamed without its extension keeps it.
    if (!folder && kindOf(src) === 'note' && !/\.[a-z0-9]{1,8}$/i.test(dest.split('/').pop() ?? '')) dest += '.md';
    if (src === dest) return { path: src, linksUpdated: 0, notesUpdated: 0 };
    const pairs = await movePairs(v, src, dest);
    const moved = new Map(pairs);
    // Before moving: in each note, which written links reach a moved note or file, and where that is going.
    // Each written link (by its target) → where it must reach now, and whether it is written from its note's folder
    // (rewritten from the note's new folder, as written: with or without ./).
    const plans = new Map<string, Map<string, { to: string; fromFolder: boolean; dotted: boolean }>>();
    if (updateLinks) {
      for (const meta of index.allMeta()) {
        for (const link of meta.links) {
          const reached = index.resolveAny(link.target, meta.path);
          const fromFolder = index.writtenFromFolder(link.target, meta.path);
          if (!reached || (!moved.has(reached) && !(moved.has(meta.path) && fromFolder))) continue;
          let plan = plans.get(meta.path);
          if (!plan) plans.set(meta.path, (plan = new Map()));
          plan.set(normalizeTarget(link.target), { to: moved.get(reached) ?? reached, fromFolder, dotted: isRelativeTarget(link.target) });
        }
        // Links in properties follow a move like body links do (the indexer keeps them apart as propLinks).
        for (const pl of meta.propLinks ?? []) {
          const reached = index.resolveAny(pl.target, meta.path);
          const fromFolder = index.writtenFromFolder(pl.target, meta.path);
          if (!reached || (!moved.has(reached) && !(moved.has(meta.path) && fromFolder))) continue;
          let plan = plans.get(meta.path);
          if (!plan) plans.set(meta.path, (plan = new Map()));
          plan.set(normalizeTarget(pl.target), { to: moved.get(reached) ?? reached, fromFolder, dotted: isRelativeTarget(pl.target) });
        }
      }
    }
    await v.move(src, dest);
    // From here the move has happened: nothing after it may fail the whole call (20 Nov 2026 audit: a link write that
    // threw, a briefly locked note, left the window's tab on the old path while the file was already at the new one, so
    // its next save found nothing there). Each step below is kept going on its own; the links it could not bring up to
    // date are logged and left as they were (they still point at the old name, which the vault check reports).
    const after = async (what: string, step: () => Promise<unknown> | unknown): Promise<void> => {
      try {
        await step();
      } catch (err) {
        host.log?.(`Ironleaf moved ${src} to ${dest}, but could not ${what}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    void assets.renamed(pairs);
    await vaultFiles.renamed(pairs).catch(() => {});
    for (const [oldRel, newRel] of pairs) {
      if (kindOf(oldRel) !== 'note') continue;
      index.delete(oldRel);
      await indexFile(v, newRel);
      await after('carry its earlier versions', () => recovery.renamed(oldRel, newRel));
      await after('carry its project history', () => projectHistory.renamed(oldRel, newRel));
      await after('carry its suggestions', () => suggestions.renamed(oldRel, newRel));
      await after('carry its change sets', () => changeSets.renamed(oldRel, newRel));
    }
    await after('read the file list again', () => refreshFiles(v));
    let linksUpdated = 0;
    let notesUpdated = 0;
    for (const [source, plan] of plans) {
      const sourcePath = moved.get(source) ?? source;
      // Guarded, read fresh each try (F8): a save landing mid-rename is followed, never clobbered; a note gone
      // mid-rename is left alone (never recreated).
      for (let attempt = 0; attempt < 3; attempt++) {
        let content: string;
        try {
          content = await v.read(sourcePath);
        } catch {
          break;
        }
        let count = 0;
        let updated = replaceWikilinks(content, (link, raw, embed) => {
          const step = plan.get(normalizeTarget(link.target));
          if (!step) return raw;
          const text = step.fromFolder ? fromFolderText(step.to, sourcePath, step.dotted, true) : linkTextFor(step.to, sourcePath, link.target);
          if (text === link.target) return raw;
          count++;
          return `${embed ? '!' : ''}[[${text}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`;
        });
        updated = replaceMarkdownLinks(updated, (target, fragment, raw, embed, label) => {
          const step = plan.get(normalizeTarget(target));
          if (!step) return raw;
          const path = step.fromFolder ? fromFolderText(step.to, sourcePath, step.dotted, false) : step.to;
          if (normalizeTarget(path) === normalizeTarget(target)) return raw;
          count++;
          return `${embed ? '!' : ''}[${label}](${encodeLinkPath(path)}${fragment})`;
        });
        updated = relinkPropsInText(updated, (target) => {
          const step = plan.get(normalizeTarget(target));
          if (!step) return null;
          const text = step.fromFolder ? fromFolderText(step.to, sourcePath, step.dotted, true) : linkTextFor(step.to, sourcePath, target);
          if (text === target) return null;
          count++;
          return text;
        });
        if (!count || updated === content) break;
        let r: Awaited<ReturnType<typeof v.writeChecked>>;
        try {
          r = await v.writeChecked(sourcePath, updated, textVersion(content));
        } catch (err) {
          // Locked or not writable now: this note's links stay as they were; the move stands.
          host.log?.(`Ironleaf moved ${src} to ${dest}, but could not update the links in ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
        if (r.ok) {
          void recovery.keep(sourcePath, updated, { by: 'you' });
          await indexFile(v, sourcePath);
          linksUpdated += count;
          notesUpdated++;
          break;
        }
        if (r.missing) break;
      }
    }
    const canvases = updateLinks ? await followInCanvases(v, moved).catch(() => [] as string[]) : [];
    const views = folder ? await followInViews(v, src, dest).catch(() => [] as string[]) : [];
    // Reminders and the bell's notices follow the move, so ticking and snoozing from the bell keep working.
    try {
      reminders.renamed(src, dest);
    } catch {
      /* the move stands; the bell asks again on focus */
    }
    // Folders follow a moved or renamed folder (kept-out folders and the search's left-out folders name
    // the folder, as bookmarks name notes: the choice follows it, never the old name; single-folder settings
    // follow the same way, 8 Nov 2026 item 5). Best effort, like the bell.
    if (folder) {
      try {
        const before = settings.raw.prefs;
        const quietFolders = movedFolderList(before.quietFolders ?? [], src, dest);
        const excluded = movedFolderList(before.excluded ?? [], src, dest);
        const templatesFolder = movedFolder(before.templatesFolder ?? 'Templates', src, dest);
        const attachmentsFolder = movedFolder(before.attachmentsFolder ?? 'Attachments', src, dest);
        const assetsFolder = movedFolder(before.assetsFolder ?? 'Assets', src, dest);
        const newNoteFolder = movedFolder(before.newNoteFolder ?? '', src, dest);
        const dailyFolder = movedFolder(settings.raw.dailyFolder ?? 'Daily', src, dest);
        const listsMoved = JSON.stringify(quietFolders) !== JSON.stringify(before.quietFolders ?? []) || JSON.stringify(excluded) !== JSON.stringify(before.excluded ?? []);
        const singlesMoved = templatesFolder !== (before.templatesFolder ?? 'Templates') || attachmentsFolder !== (before.attachmentsFolder ?? 'Attachments') || assetsFolder !== (before.assetsFolder ?? 'Assets') || newNoteFolder !== (before.newNoteFolder ?? '') || dailyFolder !== (settings.raw.dailyFolder ?? 'Daily');
        if (listsMoved || singlesMoved) {
          await settings.update({ prefs: { quietFolders, excluded, templatesFolder, attachmentsFolder, assetsFolder, newNoteFolder }, ...(dailyFolder !== (settings.raw.dailyFolder ?? 'Daily') ? { dailyFolder } : {}) });
          index.setExcluded(settings.raw.prefs.excluded);
          index.setQuiet(settings.raw.prefs.quietFolders ?? []);
          send('settings:changed', { ...settings.view(), host: host.kind, library: libraryPath() });
        }
      } catch (err) {
        host.log?.(`Ironleaf could not carry its folders to ${dest}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // The moves ride along, so open tabs, documents, bookmarks and the recorder follow a move the window did not
    // start (a repair, a tidy, an agent) instead of closing or stranding.
    notifyChanged([...pairs.flat(), ...plans.keys(), ...canvases, ...views], [[src, dest]]);
    filesChanged();
    return { path: dest, linksUpdated, notesUpdated };
  }

  /** How many links (in how many notes) reach a note, a file, or anything in a folder. */
  async function linksInto(rel: unknown): Promise<{ links: number; notes: number }> {
    const v = requireVault();
    const src = cleanRel(rel);
    const inside = new Set((await movePairs(v, src, src)).map(([p]) => p));
    let links = 0;
    const notes = new Set<string>();
    for (const meta of index.allMeta()) {
      if (inside.has(meta.path)) continue;
      for (const link of meta.links) {
        const reached = index.resolveAny(link.target, meta.path);
        if (reached && inside.has(reached)) {
          links++;
          notes.add(meta.path);
        }
      }
    }
    return { links, notes: notes.size };
  }

  /** Where pasted and dropped files go for this note (Settings › Files and links). */
  function attachmentsFolder(note: string): string {
    // Beside the note, in its Files folder (src/shared/file-records.ts), unless the person chose one folder for everything.
    if (note && settings.raw.prefs.filesWithRecord !== false && /\.(md|canvas)$/i.test(note)) return vaultFiles.folderFor(note);
    const setting = settings.raw.prefs.attachmentsFolder;
    if (setting.startsWith('./')) return [folderOf(note), setting.slice(2)].filter(Boolean).join('/');
    return setting;
  }

  /** Today's note's place in the notes (Settings › Daily notes); another day's, for Today's week strip. */
  function dailyPath(day = new Date()): string {
    const { dailyFolder, dailyFormat } = settings.raw;
    const date = formatDate(dailyFormat, day);
    return cleanNotePath(dailyFolder ? `${dailyFolder}/${date}` : date);
  }

  /** An ISO day as a local date (never UTC midnight, which reads as the day before east of Greenwich). */
  function dayFromIso(iso: unknown): Date {
    const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim()) : null;
    if (!m) return new Date();
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : new Date();
  }

  async function openDailyNote(day = new Date()): Promise<string> {
    const v = requireVault();
    const date = formatDate(settings.raw.dailyFormat, day);
    const rel = dailyPath(day);
    if (!(await v.exists(rel))) {
      let content = '';
      const template = dailyTemplatePath();
      if (template) {
        try {
          const { dateFormat, timeFormat } = settings.raw.prefs;
          content = noteFromTemplate(await v.read(template), { title: date, dateFormat, timeFormat, now: day });
        } catch {
          // A missing template leaves the day's note empty.
        }
      }
      await v.create(rel, content);
      await indexFile(v, rel);
      await relationSyncForCreates(v, [rel], 'you');
      notifyChanged([rel]);
    }
    return rel;
  }

  /**
   * A new link to a note or file written into the note at `source` (Settings › Files and links): the shortest name that
   * finds it, the path from the note, or the path from the top; as a [[wikilink]] or a Markdown link.
   */
  function newLink(rel: string, source: string, alias?: string): string {
    const { linkFormat, wikilinks } = settings.raw.prefs;
    const note = kindOf(rel) === 'note';
    const bare = note ? rel.replace(/\.md$/i, '') : rel;
    const name = bare.split('/').pop() ?? bare;
    const target =
      linkFormat === 'absolute' ? bare : linkFormat === 'relative' ? relativePath(folderOfPath(source), bare) : (note ? index.resolve(name, source) : index.resolveFile(name, source)) === rel ? name : bare;
    if (wikilinks) return `[[${target}${alias ? `|${alias}` : ''}]]`;
    return `[${alias ?? name}](${encodeLinkPath(note ? `${target}.md` : target)})`;
  }

  /** Turns the first unlinked mention of a note's title on one line of another note into a [[link]]. */
  async function linkMention(source: string, line: number, target: string): Promise<boolean> {
    const v = requireVault();
    const meta = index.get(target);
    if (!meta) return false;
    // Guarded, read fresh on a clash (F8): a save landing mid-link is followed, never clobbered.
    for (let attempt = 0; attempt < 3; attempt++) {
      const content = await v.read(source);
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      const lines = content.split(/\r?\n/);
      const text = lines[line];
      if (text === undefined) return false;
      let linked = false;
      for (const name of [meta.title, ...meta.aliases]) {
        const col = findUnlinkedPhrase(text, name);
        if (col < 0) continue;
        const found = text.slice(col, col + name.length);
        const link = newLink(target, source, found === meta.title ? undefined : found);
        lines[line] = text.slice(0, col) + link + text.slice(col + name.length);
        linked = true;
        break;
      }
      if (!linked) return false;
      const r = await v.writeChecked(source, lines.join(eol), textVersion(content));
      if (r.ok) {
        await indexFile(v, source);
        await relationSyncForWrite(v, source, content, lines.join(eol), 'you');
        notifyChanged([source]);
        return true;
      }
      if (r.missing) return false;
    }
    return false;
  }

  async function uniqueUntitled(): Promise<string> {
    const v = requireVault();
    for (let i = 0; ; i++) {
      const rel = i === 0 ? 'Untitled.md' : `Untitled ${i}.md`;
      if (!(await v.exists(rel))) return rel;
    }
  }

  function registerIpc(): void {
    handle('vault:pick', async () => {
      const result = await showOpen({ title: 'Open a folder of notes', buttonLabel: 'Open folder', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      return openVault(result.filePaths[0]);
    });
    handle('vault:open', async (folder: unknown) => {
      if (typeof folder !== 'string' || (!settings.raw.recentVaults.includes(folder) && path.resolve(folder).toLowerCase() !== path.resolve(libraryPath()).toLowerCase())) throw new Error('Unknown folder.');
      try {
        return await openVault(folder);
      } catch (err) {
        await settings.forgetVault(folder);
        throw err;
      }
    });
    handle('vault:library', async () => {
      await fsp.mkdir(libraryPath(), { recursive: true });
      return openVault(libraryPath());
    });
    handle('vault:current', () => (vault ? info(vault) : null));
    // What the page guard caught, kept in the guard's own log (8.7.1, 31 Oct 2026, never silent): the page kind, the
    // error message and stack, the time, the version — no note content, no secrets.
    handle('errors:report', (entry: unknown) => reportError(host.dataDir, host.version ?? app.getVersion(), (entry ?? {}) as { kind: string; name: string; message: string; stack: string }));
    // The close handshake (F2, one product step 1): the window or the view saved everything (notes, loose files,
    // layout) and may go. Each page releases only its own waiter (t17 break, 8 Nov 2026: the first page to save
    // released both closes, so the other surface could go with edits unsaved): the sender tells them apart.
    handle(CLOSE_READY, (event: IpcMainInvokeEvent) => {
      if (win && !win.isDestroyed() && event.sender === win.webContents) {
        closeReady?.();
        closeReady = null;
      }
      if (viewContents && !viewContents.isDestroyed() && event.sender === viewContents) {
        viewReady?.();
        viewReady = null;
      }
    }, { sender: true });
    handle('vault:list', () => index.allMeta());
    // The light list for boot (5 Nov 2026, v5-vault-speed): names first, links on the full list behind it.
    handle('vault:list-slim', () => index.slimMeta());
    handle('vault:reveal', () => {
      if (vault) void shell.openPath(vault.root);
    });

    // Dictation by Windows voice typing (src/main/dictation.ts): the window has put the cursor where the words go.
    handle('dictation:start', () => {
      focusSurface();
      return startDictation();
    });
    // Dictation heard by the former host app (8.6 voice, second pass): where it would be heard, one turn written
    // down, one live piece, and the window allowed the microphone once dictation starts. On its own the window
    // keeps Windows voice typing above; the status says which hears.
    {
      const dictate: DictationDeps = {
        ...(models.transcribe ? { transcribe: (audio, mime, opts) => models.transcribe!(audio, mime, undefined, opts) } : {}),
        ...(models.transcribeStatus ? { transcribeStatus: async () => models.transcribeStatus!() } : {}),
        requireCreate,
      };
      const heard = dictationHandlers(dictate);
      handle('dictation:status', () => heard.status());
      handle('dictation:hear', (audio: unknown, mime: unknown) => heard.hear(audio, mime));
      handle('dictation:chunk', (request: unknown) => heard.chunk(request));
      handle('dictation:prepare', () => {
        const page = pageContents();
        if (page) allowDictationMic([{ id: page.id, session: page.session } as never], true);
        return { prepared: true };
      });
    }

    // Private notes (src/main/private-notes.ts): only through these; the vault's own handlers refuse their folder.
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    handle('private:status', () => privateNotes.status());
    handle('private:setup', async (password: unknown, withHello: unknown) => {
      await requireCreate();
      return privateNotes.setUp(text(password), withHello === true);
    });
    handle('private:unlock-hello', () => privateNotes.unlockWithHello());
    handle('private:unlock-password', (password: unknown) => privateNotes.unlockWithPassword(text(password)));
    handle('private:lock', () => {
      privateNotes.lock();
      return privateNotes.status();
    });
    handle('private:add-pc', () => privateNotes.addThisPc());
    handle('private:change-password', (password: unknown) => privateNotes.changePassword(text(password)));
    handle('private:used', () => privateNotes.noteUse());
    handle('private:step-up-hello', () => privateNotes.stepUpWithHello());
    handle('private:step-up-password', (password: unknown) => privateNotes.stepUpWithPassword(text(password)));
    handle('private:list', () => privateNotes.list());
    handle('private:read', (rel: unknown) => privateNotes.read(text(rel)));
    handle('private:write', async (rel: unknown, content: unknown) => {
      await requireCreate();
      await privateNotes.write(text(rel), text(content));
    });
    handle('private:create', async (folder: unknown, base: unknown) => {
      await requireCreate();
      return privateNotes.create(text(folder), text(base));
    });
    handle('private:rename', async (from: unknown, to: unknown) => {
      await requireCreate();
      return privateNotes.rename(text(from), text(to));
    });
    handle('private:remove', (rel: unknown) => privateNotes.remove(text(rel)));
    handle('private:search', (query: unknown) => privateNotes.search(text(query)));
    // The one Locked place's state (10.0 v2locked): one lock over private notes and secrets, both counts together.
    handle('locked:status', async (): Promise<LockedStatus> => {
      const ps = await privateNotes.status();
      return { exists: ps.exists, unlocked: ps.unlocked, hello: ps.hello, thisPc: ps.thisPc, notes: ps.count, secrets: ps.unlocked ? await secrets.count() : 0, ...(ps.rememberedUntil !== undefined ? { rememberedUntil: ps.rememberedUntil } : {}) };
    });

    handle('note:read', (rel: string) => requireVault().read(rel));
    // A note opened in the editor: its words with the fingerprint its saves pass back (guarded, never clobbering).
    handle('note:open', (rel: string) => requireVault().readForEdit(rel));
    // The window's own saves: the person's typing, a suggested change they kept (the assistant's, by their say), or an
    // earlier version brought back (src/renderer/src/state/docs.ts). Guarded (F1): the answer says landed, conflict
    // (both kept, the editor says so), or gone — and refused words are kept in File recovery too, so even a crash
    // after a conflict loses nothing.
    handle('note:write', async (rel: string, content: string, by: unknown, base: unknown, opts: unknown): Promise<CheckedWrite> => {
      await requireCreate();
      const v = requireVault();
      const author: VersionAuthor = by === 'assistant' || by === 'restored' ? by : 'you';
      const was = author === 'restored' ? index.content(rel) : undefined;
      if (was !== undefined) await recovery.keep(rel, was, true);
      const r = await v.writeChecked(rel, content, typeof base === 'string' ? base : null);
      if (!r.ok) {
        if (typeof content === 'string' && content.trim()) void recovery.keep(rel, content, { by: author, force: true });
        return r;
      }
      // An import's merge into an existing note (state/imports.ts through docs.writeThrough) syncs nothing back.
      const s = await noteWritten(v, rel, content, author, r, { relationSync: (opts as { imported?: unknown } | undefined)?.imported !== true });
      return withSyncResult(r, s);
    });
    handle('suggestions:list', () => suggestions.list());
    handle('suggestions:settle', (rel: unknown, base: unknown, after: unknown) => {
      if (typeof base !== 'string' || (after !== null && typeof after !== 'string')) return;
      suggestions.settle(cleanRel(rel), base, after);
    });
    // Change sets waiting for review as one (10.0, v2changes; src/main/change-sets.ts): the list, one set with its
    // before/after bodies, and accept/reject of one file or the whole set. Accepting writes through the guarded write.
    handle('change-sets:list', () => changeSets.list().map(changeSetSummary));
    handle('change-sets:get', (id: unknown) => {
      if (typeof id !== 'string') throw new Error('Which change set?');
      const set = changeSets.get(id);
      if (!set) throw new Error('That change set isn’t here any more.');
      return set;
    });
    handle('change-sets:accept', async (id: unknown, entryId: unknown) => {
      await requireCreate();
      if (typeof id !== 'string') throw new Error('Which change set?');
      return changeSets.accept(id, typeof entryId === 'string' ? entryId : undefined);
    });
    handle('change-sets:reject', async (id: unknown, entryId: unknown) => {
      if (typeof id !== 'string') throw new Error('Which change set?');
      return changeSets.reject(id, typeof entryId === 'string' ? entryId : undefined);
    });
    handle('note:create', async (rel: unknown, content: unknown, opts: unknown) => {
      await requireCreate();
      const v = requireVault();
      const p = rel === null ? await uniqueUntitled() : cleanNotePath(rel);
      await v.create(p, typeof content === 'string' ? content : '');
      await indexFile(v, p);
      // A note an import made (state/imports.ts) comes in as it was: no back-links written into other notes for it.
      if ((opts as { imported?: unknown } | undefined)?.imported !== true) await relationSyncForCreates(v, [p], 'you');
      notifyChanged([p]);
      filesChanged();
      return p;
    });
    handle('note:resolve', (target: unknown, from: unknown) => (typeof target === 'string' ? index.resolve(target, typeof from === 'string' ? from : undefined) : null));
    handle('file:resolve', (target: unknown, from: unknown) => (typeof target === 'string' ? index.resolveAny(target, typeof from === 'string' ? from : undefined) : null));

    // Files and folders: the file list, notes and canvases as text, new ones with free names, moves with links kept.
    handle('files:list', () => requireVault().listAll());
    handle('file:read-text', (rel: unknown) => requireVault().readText(rel));
    // A canvas, drawing, or view opened in the editor: its words with the fingerprint its saves pass back.
    handle('file:open-text', (rel: unknown) => requireVault().readTextForEdit(rel));
    handle('file:write-text', async (rel: unknown, content: unknown, base: unknown): Promise<CheckedWrite> => {
      await requireCreate();
      const v = requireVault();
      const p = cleanRel(rel);
      const r = await v.writeTextChecked(p, content, typeof base === 'string' ? base : null);
      if (!r.ok) {
        if (kindOf(p) === 'note' && typeof content === 'string' && content.trim()) void recovery.keep(p, content, { by: 'you', force: true });
        return r;
      }
      if (kindOf(p) === 'note' && typeof content === 'string') {
        const s = await noteWritten(v, p, content, 'you', r);
        return withSyncResult(r, s);
      }
      notifyChanged([p]);
      return r;
    });
    handle('file:create', async (folder: unknown, base: unknown, ext: unknown, content: unknown) => {
      await requireCreate();
      const v = requireVault();
      const dir = typeof folder === 'string' && folder ? cleanRel(folder) : '';
      // A view over notes (src/shared/views.ts) is made here too, with the same free-name rule as canvases
      // (either kind of view file: Ironleaf's own, or the open .base kind).
      // A drawing (src/shared/drawing.ts; 21 Oct 2026, gap G23) too, kept as a .nvdraw file.
      const extension = ext === '.canvas' ? '.canvas' : ext === '.view.json' ? '.view.json' : ext === '.base' ? '.base' : ext === '.nvdraw' ? '.nvdraw' : '.md';
      const name = cleanFileName(base, extension === '.canvas' ? 'Untitled canvas' : extension === '.view.json' || extension === '.base' ? 'Untitled view' : extension === '.nvdraw' ? 'Untitled canvas' : 'Untitled');
      const rel = await uniqueRel(v, dir, name, extension);
      await v.createText(rel, typeof content === 'string' ? content : extension === '.canvas' ? '{"nodes":[],"edges":[]}' : extension === '.nvdraw' ? newDrawingText() : extension === '.view.json' ? '{\n\t"version": 1,\n\t"source": { "kind": "all" },\n\t"layout": "table"\n}\n' : '');
      await indexFile(v, rel);
      if (extension === '.md') await relationSyncForCreates(v, [rel], 'you');
      notifyChanged([rel]);
      filesChanged();
      return rel;
    });
    // Import CSV (src/shared/csv.ts): the person picks a spreadsheet; its words come back for the renderer to shape.
    handle('import:csv-pick', async () => {
      const testFile = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_IMPORT_CSV : '';
      const options = { title: 'Import a CSV file as notes', buttonLabel: 'Import', properties: ['openFile' as const], filters: [{ name: 'CSV (spreadsheet)', extensions: ['csv', 'tsv', 'txt'] }] };
      const file = testFile || (await showOpen(options)).filePaths[0];
      if (!file) return null;
      const stat = await fsp.stat(file);
      if (stat.size > 20 * 1024 * 1024) throw new Error('That file is larger than 20 MB. Split it into smaller files and import each one.');
      return { name: path.basename(file).replace(/\.[^.]+$/, ''), text: await fsp.readFile(file, 'utf8') };
    });
    // Each row a new note in the folder: never over a note already there ("Name 2", "Name 3"… instead).
    handle('import:csv-notes', async (folder: unknown, notes: unknown) => {
      await requireCreate();
      const v = requireVault();
      const dir = typeof folder === 'string' && folder.trim() ? cleanRel(folder) : '';
      if (!Array.isArray(notes)) throw new Error('Nothing to import.');
      if (notes.length > 5000) throw new Error('That is more than 5,000 rows. Split the file and import each part.');
      const made: string[] = [];
      for (const n of notes as { name?: unknown; content?: unknown }[]) {
        const base = cleanFileName(n?.name, 'Untitled');
        let rel = '';
        for (let i = 1; i < 10000 && !rel; i++) {
          const candidate = join(dir, `${i === 1 ? base : `${base} ${i}`}.md`);
          if (!(await v.any(candidate))) rel = candidate;
        }
        if (!rel) continue;
        await v.createText(rel, typeof n?.content === 'string' ? n.content : '');
        await indexFile(v, rel);
        made.push(rel);
      }
      // An import brings rows in as notes and writes nothing else (no back-links into other notes; 20 Nov 2026).
      notifyChanged(made);
      filesChanged();
      return made;
    });
    handle('folder:create', async (parent: unknown, name: unknown) => {
      await requireCreate();
      const v = requireVault();
      const dir = typeof parent === 'string' && parent ? cleanRel(parent) : '';
      const rel = await uniqueRel(v, dir, cleanFileName(name, 'New folder'), '');
      await v.makeFolder(rel);
      filesChanged();
      return rel;
    });
    handle('path:move', async (from: unknown, to: unknown, updateLinks: unknown) => {
      await requireCreate();
      return movePath(from, to, updateLinks !== false);
    });
    handle('path:links-into', (rel: unknown) => linksInto(rel));
    handle('path:trash', async (rel: unknown) => {
      await requireCreate();
      return (await trashRel(cleanRel(rel))).id;
    });
    handle('path:duplicate', async (rel: unknown) => {
      await requireCreate();
      const v = requireVault();
      const p = cleanRel(rel);
      const folder = await v.isFolder(p);
      const { base, ext } = folder ? { base: p.split('/').pop()!, ext: '' } : splitName(p.split('/').pop()!);
      const dest = await uniqueRel(v, folderOf(p), base, ext);
      await fsp.cp(v.absolute(p), v.absolute(dest), { recursive: true, errorOnExist: true, force: false });
      if (folder) await rescan(v);
      else if (kindOf(dest) === 'note') await indexFile(v, dest);
      else await refreshFiles(v);
      // A copy's links link back to the copy, as a new note's do.
      await relationSyncForCreates(v, folder ? index.allMeta().filter((m) => m.path === dest || m.path.startsWith(`${dest}/`)).map((m) => m.path) : [dest], 'you');
      notifyChanged([dest]);
      filesChanged();
      return dest;
    });
    handle('path:reveal', (rel: unknown) => {
      const v = requireVault();
      if (rel === '' || rel === null || rel === undefined) void shell.openPath(v.root);
      else shell.showItemInFolder(v.absolute(cleanRel(rel)));
    });
    handle('path:open-default', async (rel: unknown) => {
      const v = requireVault();
      const failed = await shell.openPath(v.absolute(cleanRel(rel)));
      if (failed) throw new Error(failed);
    });
    handle('path:absolute', (rel: unknown) => (rel === '' ? requireVault().root : requireVault().absolute(cleanRel(rel))));

    // Pictures and other files pasted or dropped into a note, and files dropped in from File Explorer.
    handle('attachment:save', async (name: unknown, data: unknown, forNote: unknown) => {
      await requireCreate();
      const v = requireVault();
      if (!(data instanceof Uint8Array)) throw new Error('That file could not be read.');
      const { base, ext } = splitName(cleanFileName(name, 'Picture.png'));
      const note = typeof forNote === 'string' ? forNote : '';
      const rel = await uniqueRel(v, attachmentsFolder(note), base, ext.toLowerCase());
      await v.writeBinary(rel, data);
      await refreshFiles(v);
      filesChanged();
      void vaultFiles.recordAdded(rel, { source: { by: 'you', how: 'pasted', at: new Date().toISOString() }, ...(note ? { record: note } : {}), describe: 'later' }).catch(() => {});
      return rel;
    });
    handle('attachment:import', async (paths: unknown, folder: unknown, forNote: unknown) => {
      await requireCreate();
      const v = requireVault();
      if (!Array.isArray(paths)) throw new Error('Nothing to add.');
      const dir = typeof folder === 'string' ? (folder ? cleanRel(folder) : '') : attachmentsFolder(typeof forNote === 'string' ? forNote : '');
      const added: string[] = [];
      for (const raw of paths.slice(0, 200)) {
        if (typeof raw !== 'string' || !path.isAbsolute(raw)) continue;
        const stat = await fsp.stat(raw).catch(() => null);
        if (!stat?.isFile() || stat.size > 4 * 1024 * 1024 * 1024) continue;
        // A file already among the notes is linked where it is, never copied.
        const inside = path.relative(v.root, raw);
        if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) {
          added.push(inside.split(path.sep).join('/'));
          continue;
        }
        const { base, ext } = splitName(cleanFileName(path.basename(raw), 'File'));
        const target = kindOf(raw) === 'note' && typeof folder !== 'string' ? (typeof forNote === 'string' ? folderOf(forNote) : '') : dir;
        // A big file is copied in pieces that carry on after a break (its place is chosen now, so the link works when it lands).
        if (stat.size > BIG_FILE && kindOf(raw) !== 'note') {
          const s = await vaultFiles.importPath({ ...(typeof forNote === 'string' && forNote ? { record: forNote } : {}), folder: target, src: raw, how: 'dropped' });
          if (s.rel) added.push(s.rel);
          continue;
        }
        const rel = await uniqueRel(v, target, base, ext);
        if (folderOf(rel)) await v.makeFolder(folderOf(rel));
        await fsp.copyFile(raw, v.absolute(rel), fsConstants.COPYFILE_EXCL);
        if (kindOf(rel) === 'note') await indexFile(v, rel);
        else void vaultFiles.recordAdded(rel, { source: { by: 'you', how: 'dropped', from: raw, at: new Date().toISOString() }, ...(typeof forNote === 'string' && forNote ? { record: forNote } : {}), describe: 'later' }).catch(() => {});
        added.push(rel);
      }
      await refreshFiles(v);
      notifyChanged(added);
      filesChanged();
      return added;
    });

    // The asset store (src/main/assets.ts): the Assets page, its details panel, the brand kit, files copied in.
    handle('assets:list', () => assets.list());
    handle('assets:details', (rel: unknown) => assets.details(rel));
    handle('assets:update', async (rel: unknown, patch: unknown) => {
      await requireCreate();
      return assets.update(rel, patch);
    });
    handle('assets:brand', async (brand: unknown) => {
      await requireCreate();
      return assets.setBrand(brand);
    });
    handle('assets:brands', async (action: unknown) => {
      await requireCreate();
      return assets.brands(action);
    });
    handle('assets:collections', async (action: unknown) => {
      await requireCreate();
      return assets.collections(action);
    });
    handle('assets:check', (paths: unknown) => assets.check(paths));
    handle('assets:add', async (paths: unknown, options: unknown) => {
      await requireCreate();
      return assets.add(paths, options);
    });
    handle('assets:pick', async () => {
      const options = { title: 'Add files to your assets', buttonLabel: 'Add to assets', properties: ['openFile' as const, 'multiSelections' as const] };
      const pick = await showOpen(options);
      return pick.canceled ? [] : pick.filePaths;
    });
    handle('assets:source', (rel: unknown) => assets.source(rel));
    handle('assets:thumb', (rel: unknown, data: unknown, info: unknown) => assets.saveThumb(rel, data, info));

    // The vault's note types (.neuralvault/types.json in the notes, src/main/note-types.ts): they travel with the notes.
    handle('types:load', () => (vault ? readTypesFile(vault.root) : ''));
    handle('types:save', async (text: unknown) => {
      await requireCreate();
      await writeTypesFile(requireVault().root, text);
    });

    // Project workspaces and views of records, kept in the vault (.neuralvault/workspaces and .neuralvault/views,
    // src/main/workspaces.ts), so every PC shows the same sections and views.
    handle('workspace:load', (project: unknown) => (vault ? loadWorkspace(vault.root, project) : ''));
    handle('workspace:save', async (project: unknown, text: unknown) => {
      await requireCreate();
      await saveWorkspace(requireVault().root, project, text);
    });
    handle('views:list', () => (vault ? listViews(vault.root) : []));
    handle('views:save', async (name: unknown, text: unknown) => {
      await requireCreate();
      return saveView(requireVault().root, name, text);
    });
    handle('views:remove', async (name: unknown) => {
      await requireCreate();
      await removeView(requireVault().root, name);
    });

    // What Ironleaf remembers about this folder of notes: tabs and panels, bookmarks, the graph's settings.
    handle('state:load', (name: unknown) => (vault && typeof name === 'string' ? state.load(vault.root, name) : null));
    handle('state:save', async (name: unknown, value: unknown) => {
      if (!vault || typeof name !== 'string') return;
      await state.save(vault.root, name, value);
    });

    handle('recovery:list', () => recovery.list());
    // Earlier versions show a note's Git backup history beside File recovery's copies, newest first (21 Oct 2026, G28).
    handle('recovery:versions', async (rel: unknown) => {
      const note = cleanRel(rel);
      const [own, fromGit] = await Promise.all([recovery.versions(note), backup ? backup.versions(note) : []]);
      return [...own, ...fromGit].sort((a, b) => b.time - a.time);
    });
    handle('recovery:read', (rel: unknown, id: unknown) =>
      typeof id === 'string' && id.startsWith('git:') && backup ? backup.read(id) : recovery.read(cleanRel(rel), typeof id === 'string' ? id : ''),
    );
    // What changed in a project lately, from its earlier versions (File recovery's copies): each change in words, with
    // who made it, newest first (the project hub's Recent activity; src/shared/project-hub.ts projectChanges).
    handle('project:changes', async (rel: unknown): Promise<ProjectChange[]> => {
      const note = cleanRel(rel);
      const now = index.content(note);
      if (now === undefined) return [];
      const versions = (await recovery.versions(note)).slice(0, 16);
      const texts = await Promise.all(versions.map((v) => recovery.read(note, v.id).catch(() => null)));
      const today = todayDay();
      const out: ProjectChange[] = [];
      // The file as it is now, against the newest copy (a change since it was kept), then each copy against the one before.
      const steps: { after: string; before: string | null; time: number; by?: string }[] = [];
      if (texts[0] !== null && texts[0] !== undefined && texts[0] !== now) steps.push({ after: now, before: texts[0], time: index.get(note)?.mtime ?? Date.now() });
      for (let i = 0; i < versions.length; i++) {
        const after = texts[i];
        const before = texts[i + 1];
        if (after === null || before === null || before === undefined) continue;
        steps.push({ after, before, time: versions[i].time, ...(versions[i].by ? { by: versions[i].by } : {}) });
      }
      for (const s of steps) {
        if (s.before === null || s.before === s.after) continue;
        const words = projectChanges(parseProject(s.before, note), parseProject(s.after, note), today);
        if (words.length) out.push({ time: s.time, ...(s.by ? { by: s.by } : {}), words });
        if (out.length >= 10) break;
      }
      return out;
    });

    // Export to PDF: the week as shown (the Weekly page prints what it shows); notes print as their branded document.
    handle('export:pdf', async (name: unknown) => {
      const page = pageContents();
      if (!page) throw new Error('Ironleaf’s window is closed.');
      const base = cleanFileName(name, 'Note');
      // NV_TEST_EXPORT_DIR (the end-to-end check only, never set in the product): straight into that folder, no dialog.
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.pdf`) } : await showSave({ title: 'Export to PDF', defaultPath: path.join(app.getPath('documents'), `${base}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return null;
      const pdf = await page.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.55, bottom: 0.55, left: 0.6, right: 0.6 }, generateDocumentOutline: true });
      await fsp.writeFile(result.filePath, pdf);
      exported.add(result.filePath);
      return result.filePath;
    });
    // A note's branded document (5 Nov 2026, src/shared/brand-document.ts): Export to PDF and Save as PDF print the
    // finished HTML the window made, laid out in a window nobody sees, to the file the person picks.
    handle('export:brand-pdf', async (name: unknown, html: unknown) => {
      if (typeof html !== 'string' || !html.includes('<html')) throw new Error('Nothing to export.');
      const base = cleanFileName(name, 'Note');
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.pdf`) } : await showSave({ title: 'Export to PDF', defaultPath: path.join(app.getPath('documents'), `${base}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return null;
      const { pdf } = await brandPrinter.pdf(html.slice(0, 60_000_000));
      await fsp.writeFile(result.filePath, pdf);
      exported.add(result.filePath);
      return result.filePath;
    });
    // The Design studio (22 Nov 2026): the window hands over the note's cleaned content (brandContent, the branded
    // document's own reading) with its kit; the AI designs it here, on the chat's model, as the side chat would read it.
    const designInput = (raw: unknown): DesignStartIn => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
      const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map((x) => x.slice(0, max)) : []);
      const c = (o.content && typeof o.content === 'object' ? o.content : {}) as Record<string, unknown>;
      const path = str(o.path, 2000);
      if (!path || !index.get(path)) throw new Error('Open a note to design it.');
      const g = ai.gate?.();
      if (g && !g.sees(path)) throw new Error('This note’s level isn’t one the assistant may read (Settings › Privacy and secrets), so it can’t be designed by AI.');
      const blocks = strs(c.blocks, 600, 400_000);
      if (blocks.reduce((n, b) => n + b.length, 0) > 4_000_000) throw new Error('This note is too long to design in one go.');
      const logo = (v: unknown) => (typeof v === 'string' && v.startsWith('file:') && fileUrlPath(v, process.platform) !== null ? v : undefined);
      const logos = (o.logos && typeof o.logos === 'object' ? o.logos : {}) as Record<string, unknown>;
      return {
        path,
        kind: designKindInfo(o.kind).id,
        brief: str(o.brief, 2000),
        title: str(o.title, 300),
        content: {
          title: str(c.title, 300) || 'Untitled',
          label: str(c.label, 120),
          sub: strs(c.sub, 4, 300),
          figures: (Array.isArray(c.figures) ? c.figures : []).slice(0, 8).map((f) => ({ value: str((f as Record<string, unknown>)?.value, 80), label: str((f as Record<string, unknown>)?.label, 120) })).filter((f) => f.value),
          people: (Array.isArray(c.people) ? c.people : []).slice(0, 3).map((p) => ({ label: str((p as Record<string, unknown>)?.label, 40), names: strs((p as Record<string, unknown>)?.names, 60, 120) })),
          blocks,
          confidential: c.confidential === true,
          foot: str(c.foot, 300),
        },
        kit: o.kit ? cleanBrand(o.kit) : null,
        logos: { primary: logo(logos.primary), onDark: logo(logos.onDark) },
        brandName: str(o.brandName, 120),
      };
    };
    const designRun = async <T>(requestId: unknown, run: (step: (words: string) => void, signal: AbortSignal) => Promise<T>): Promise<T> => {
      await requireCreate();
      if (!models.effectiveChoice(settings.raw.model)) throw new Error('Designing needs an AI: choose one in Settings › AI.');
      const id = typeof requestId === 'string' ? requestId.slice(0, 80) : '';
      const controller = new AbortController();
      if (id) designControllers.set(id, controller);
      try {
        return await run((words) => send('design:step', { requestId: id, words }), controller.signal);
      } finally {
        if (id) designControllers.delete(id);
      }
    };
    handle('design:ready', () => ({ model: models.effectiveChoice(settings.raw.model) ? ai.currentModelName() ?? 'your AI' : null, pictures: ai.designSeesPictures() }));
    handle('design:start', (requestId: unknown, input: unknown) => designRun(requestId, (step, signal) => designStudio.start(designInput(input), step, signal)));
    handle('design:change', (requestId: unknown, id: unknown, words: unknown) => designRun(requestId, (step, signal) => designStudio.change(id, words, step, signal)));
    handle('design:cancel', (requestId: unknown) => {
      if (typeof requestId === 'string') designControllers.get(requestId)?.abort();
    });
    handle('design:save', async (id: unknown, name: unknown, format: unknown = 'pdf') => {
      if (!isDesignFormat(format)) throw new Error('Choose PDF, PowerPoint, Word or Excel.');
      const f = DESIGN_FORMATS[format];
      const { data, kind } = await designStudio.file(id, format);
      const base = cleanFileName(typeof name === 'string' && name.trim() ? `${name} – ${kind.name}` : kind.name, 'Design');
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.${f.ext}`) } : await showSave({ title: `Save the design as ${f.name === 'PDF' ? 'a PDF' : f.name}`, defaultPath: path.join(app.getPath('documents'), `${base}.${f.ext}`), filters: [{ name: f.filter, extensions: [f.ext] }] });
      if (result.canceled || !result.filePath) return null;
      await fsp.writeFile(result.filePath, data);
      exported.add(result.filePath);
      return result.filePath;
    });
    // Export as CSV (a view's notes as a spreadsheet, src/shared/csv.ts): the renderer makes the words; the file goes where
    // the person picks, written as given (UTF-8 with the byte-order mark Excel looks for).
    handle('export:csv', async (name: unknown, text: unknown) => {
      if (typeof text !== 'string') throw new Error('Nothing to export.');
      const base = cleanFileName(name, 'View');
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      const options = { title: 'Export as CSV', defaultPath: path.join(app.getPath('documents'), `${base}.csv`), filters: [{ name: 'CSV (spreadsheet)', extensions: ['csv'] }] };
      const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.csv`) } : await showSave(options);
      if (result.canceled || !result.filePath) return null;
      await fsp.writeFile(result.filePath, text, 'utf8');
      exported.add(result.filePath);
      return result.filePath;
    });
    // Export a drawing (src/shared/drawing.ts; 21 Oct 2026, gap G23): as SVG (its words) or PNG (its bytes, drawn by the
    // window), written where the person picks.
    handle('export:drawing', async (name: unknown, kind: unknown, data: unknown) => {
      const png = kind === 'png';
      if (png ? !(data instanceof Uint8Array) : typeof data !== 'string') throw new Error('Nothing to export.');
      const base = cleanFileName(name, 'Drawing');
      const ext = png ? 'png' : 'svg';
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      const options = { title: png ? 'Export as a picture (PNG)' : 'Export as SVG', defaultPath: path.join(app.getPath('documents'), `${base}.${ext}`), filters: [png ? { name: 'PNG picture', extensions: ['png'] } : { name: 'SVG drawing', extensions: ['svg'] }] };
      const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.${ext}`) } : await showSave(options);
      if (result.canceled || !result.filePath) return null;
      await fsp.writeFile(result.filePath, png ? Buffer.from(data as Uint8Array) : (data as string), png ? undefined : 'utf8');
      exported.add(result.filePath);
      return result.filePath;
    });
    handle('export:reveal', (file: unknown) => {
      if (typeof file === 'string' && exported.has(file)) shell.showItemInFolder(file);
    });
    // Share › Save as Markdown (8.8, src/shared/share.ts): the file as the window made it (checked again here, so a
    // secret or private note never slips through), alone as a .md, or a zip with its attachments (pictures, documents
    // at their vault paths, so the file's links still find them) when it has any.
    handle('export:share-md', async (name: unknown, text: unknown, attachments: unknown) => {
      const v = requireVault();
      const clean = withoutPrivate(withoutSecrets(typeof text === 'string' ? text : ''), { resolve: (t) => t });
      if (!clean.trim()) throw new Error('There is nothing to share.');
      const base = cleanFileName(name, 'Note');
      const rels = [...new Set(Array.isArray(attachments) ? attachments.filter((r): r is string => typeof r === 'string') : [])];
      const files: { name: string; abs: string }[] = [];
      let bytes = 0;
      for (const rel of rels.slice(0, 200)) {
        if (isPrivatePath(rel)) continue;
        let abs: string;
        try {
          abs = v.resolve(rel);
        } catch {
          continue;
        }
        try {
          const stat = statSync(abs);
          if (!stat.isFile() || stat.size > 50 * 1024 * 1024 || bytes + stat.size > 250 * 1024 * 1024) continue;
          bytes += stat.size;
          files.push({ name: rel.replace(/\\/g, '/'), abs });
        } catch {
          // Gone since the list was made: left out.
        }
      }
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      if (!files.length) {
        const options = { title: 'Save as Markdown', defaultPath: path.join(app.getPath('documents'), `${base}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] };
        const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.md`) } : await showSave(options);
        if (result.canceled || !result.filePath) return null;
        await fsp.writeFile(result.filePath, clean, 'utf8');
        exported.add(result.filePath);
        return result.filePath;
      }
      const options = { title: 'Save as Markdown (with attachments)', defaultPath: path.join(app.getPath('documents'), `${base}.zip`), filters: [{ name: 'Zip', extensions: ['zip'] }] };
      const result = testDir ? { canceled: false, filePath: path.join(testDir, `${base}.zip`) } : await showSave(options);
      if (result.canceled || !result.filePath) return null;
      await writeZip(result.filePath, [{ name: `${base}.md`, data: Buffer.from(clean, 'utf8') }, ...files]);
      exported.add(result.filePath);
      return result.filePath;
    });
    // Share › Email it (8.8, src/shared/share.ts): the window's branded document (5 Nov 2026, the same one Export to
    // PDF prints) laid out in a window nobody sees; the PDF goes into a draft (.eml) the person's mail program opens,
    // with the subject and words. Opening the draft is all this side does: it never sends. The draft and the PDF sit
    // in temp files.
    handle('export:share-email', async (name: unknown, subject: unknown, body: unknown, html: unknown) => {
      if (typeof html !== 'string' || !html.includes('<html')) throw new Error('Nothing to share.');
      const base = cleanFileName(name, 'Note');
      const { pdf } = await brandPrinter.pdf(String(html).slice(0, 60_000_000));
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      const dir = testDir || app.getPath('temp');
      await fsp.mkdir(dir, { recursive: true });
      const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const pdfFile = path.join(dir, testDir ? `${base}.pdf` : `nv-share-${stamp}.pdf`);
      const emlFile = path.join(dir, testDir ? `${base}.eml` : `nv-share-${stamp}.eml`);
      await fsp.writeFile(pdfFile, pdf);
      await fsp.writeFile(emlFile, emlDraft({ subject: typeof subject === 'string' && subject.trim() ? subject.slice(0, 200) : base, body: typeof body === 'string' ? body.slice(0, 4000) : '', pdfName: `${base}.pdf`, pdfBase64: pdf.toString('base64') }), 'utf8');
      if (testDir) return { pdf: pdfFile, eml: emlFile, opened: true };
      const failed = await shell.openPath(emlFile);
      return failed ? { pdf: pdfFile, eml: emlFile, opened: false as const, words: failed } : { pdf: pdfFile, eml: emlFile, opened: true as const };
    });

    handle('index:backlinks', (rel: string) => index.backlinks(rel));
    handle('index:unlinked', (rel: string) => index.unlinkedMentions(rel));
    handle('index:mentions', (rel: string, content: unknown) => index.mentionsIn(rel, typeof content === 'string' ? content : ''));
    // Beside an unprotected person's page, Related never suggests a protected note (t21 follow-up): the same
    // rule the served cards filter by (src/main/life.ts). Everywhere else, and inside Health, it suggests as before.
    const relatedSkipFor = (rel: string) => purposefulRelatedSkip(rel, { propsOf: (p: string) => index.get(p)?.props, areas: areasNow(), places: { templatesFolder: settings.raw.prefs.templatesFolder, assetsFolder: settings.raw.prefs.assetsFolder } });
    handle('index:related', (rel: string) => {
      const skip = relatedSkipFor(rel);
      const out = index.related(rel);
      return skip ? out.filter((r) => !skip(r.path)) : out;
    });
    // Related notes (src/shared/related.ts; 21 Oct 2026, gap G25): links, tags and shared words, templates left out.
    handle('index:related-notes', (rel: unknown) => {
      const templates = (settings.raw.prefs.templatesFolder || '').toLowerCase().replace(/\/+$/, '');
      const clean = cleanNotePath(rel);
      const skip = relatedSkipFor(clean);
      return index.relatedNotes(clean, 12, (p) => (!!templates && p.toLowerCase().startsWith(`${templates}/`)) || !!skip?.(p));
    });
    handle('index:graph', () => index.graph(settings.raw.prefs.templatesFolder ?? ''));
    // The graph since the generation the window holds (5 Nov 2026, v5-vault-speed): only what moved.
    handle('index:graph-since', (since: unknown) => index.graphSince(typeof since === 'number' ? since : -1, settings.raw.prefs.templatesFolder ?? ''));
    // The connected vault (src/shared/records.ts; WS1 part B): a record's peek and the questions asked of the records.
    const recordModel = () => index.records({ templatesFolder: settings.raw.prefs.templatesFolder || 'Templates' });
    const recordRef = (v: unknown): RecordRef => {
      const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      const s = (k: string, max = 1000) => (typeof o[k] === 'string' ? (o[k] as string).slice(0, max) : undefined);
      return { id: s('id'), type: RECORD_TYPES.includes(o.type as RecordType) ? (o.type as RecordType) : undefined, path: s('path'), title: s('title'), name: s('name', 200), folderFile: s('folderFile'), line: typeof o.line === 'number' && Number.isFinite(o.line) ? o.line : undefined };
    };
    // A file in a project's folder that its Documents list doesn't name opens with its details (src/main/folder-file-peek.ts).
    // A person's peek holds the same rule as their card (t21 follow-up): protected joins go from an unprotected
    // person's peek, and the role fact reads the served card.
    handle('records:peek', async (ref: unknown) => {
      const model = recordModel();
      const found = await peekWithFolderFiles(model, recordRef(ref), (p) => index.allMeta().find((m) => m.path === p)?.props?.folder);
      return purposefulPeek(found, { model, propsOf: (p: string) => index.get(p)?.props, areas: areasNow(), places: { templatesFolder: settings.raw.prefs.templatesFolder, assetsFolder: settings.raw.prefs.assetsFolder } });
    });
    handle('records:find', (words: unknown, types: unknown) => (typeof words === 'string' ? findRecords(recordModel(), words.slice(0, 200), Array.isArray(types) ? (types.filter((t) => RECORD_TYPES.includes(t)) as RecordType[]) : undefined, 20) : []));
    // A person's open items read through the same rule as every other people door (t28 follow-up, 8 Nov
    // 2026: this served raw open items with no filter, safe for no future caller). A protected person's own
    // answer passes through untouched; on anyone else's, protected lists go and projects stay (membership).
    handle('records:person', (who: unknown, project: unknown) => {
      if (typeof who !== 'string') return null;
      const model = recordModel();
      return purposefulPersonItems(personOpenItems(model, who.slice(0, 200), typeof project === 'string' ? { project } : {}), { model, propsOf: (p: string) => index.get(p)?.props, areas: areasNow(), places: { templatesFolder: settings.raw.prefs.templatesFolder, assetsFolder: settings.raw.prefs.assetsFolder } });
    });
    handle('records:meeting', (which: unknown) => (typeof which === 'string' ? meetingItems(recordModel(), which.slice(0, 1000)) : null));
    handle('records:attention', (project: unknown) => (typeof project === 'string' ? projectAttention(recordModel(), project) : null));
    // The vault as a life OS (Wave 4): areas, the move into areas, People and Organisations, the Inbox, the tag manager.
    registerVaultFiles(vaultFiles, {
      handle,
      requireCreate,
      chooseFiles: async (o) => {
        const r = await showOpen({ title: o.title, buttonLabel: o.multiple ? 'Add' : 'Choose', properties: o.multiple ? ['openFile', 'multiSelections'] : ['openFile'] });
        return r.canceled ? null : r.filePaths;
      },
      openPath: async (abs) => {
        const failed = await shell.openPath(abs);
        if (failed) throw new Error(failed);
      },
      showInFolder: (abs) => shell.showItemInFolder(abs),
    });
    const lifeDeps: LifeDeps = {
      // The organiser reads what the vault can't place (src/main/life.ts readUnsure): the connected model, and only notes
      // the side chat may read.
      askJson: async (system, user) => {
        const status = aiStatus(settings.raw.model);
        if (!status.ready) return { reply: null, error: status.note ?? 'No model is set up yet.' };
        return ai.askJson(system, user, 120_000, 5000);
      },
      assistantMay: (rel) => sensitivity.decide('side-chat', rel, 'The side chat').ok,
      syncAfterWrite: async (rel, before, after) => {
        await relationSyncForWrite(requireVault(), rel, before, after, 'you');
      },
      handle, vault: requireVault, index, prefs: () => settings.raw.prefs, dailyFolder: () => settings.raw.dailyFolder, records: recordModel, movePath: (from, to, updateLinks) => movePath(from, to, updateLinks), indexFile, refreshFiles, changed: notifyChanged, filesChanged, requireCreate, editProject: (rel, edit, version) => editProject(rel, edit, version), moduleSuggestion: (item) => recordModules.inboxBill(item), fileToModule: (item) => recordModules.fileInboxBill(item), receiptSuggestion: (item) => recordModules.inboxReceipt(item), fileReceipt: (item) => recordModules.fileInboxReceipt(item), moduleRecordSuggestions: async (item) => [...(await personalFiling.suggestions(item)), ...(await lifeFiling.suggestions(item))], fileToModuleRecord: async (item, target) => (await personalFiling.file(item, target)) ?? (await lifeFiling.file(item, target)),
      // Folding one area into another (9 Nov 2026): its backup and lock, the bills tidy-up's way.
      dataDir: host.dataDir, device: thisPc, appVersion: host.version ?? app.getVersion(),
      // The front door's mail (t243): Gmail and Outlook through the former host app's connection, never a
      // new one.
      ...(host.mail ? { mail: host.mail } : {}) };
    registerLife(lifeDeps);
    // Finance and Documents and ID (Wave 5 part a): their models, edits, imports and options (src/main/record-modules.ts).
    registerRecordModules(recordModules, { handle, vault: requireVault, index, requireCreate });
    // The work modules (Wave 6 part b): each module's calls and the shared options (src/main/work-modules.ts).
    registerWorkModules([workModules, lifeRecords, personal], handle);
    // Publications (Wave 6 part a): publications, editions, pieces, puzzles, the studio's pages, the PDF and delivery.
    registerPublications(publications, handle);
    handle('index:search', (query: unknown) => (typeof query === 'string' ? index.searchAsync(query.slice(0, 1000)) : []));
    handle('index:query', (query: unknown) => (typeof query === 'string' ? index.query(query.slice(0, 1000)) : []));
    handle('index:outgoing', (rel: string) => index.outgoing(rel));
    handle('index:tags', () => index.tags());
    handle('index:link-mention', (source: string, line: unknown, target: string) => (typeof line === 'number' ? linkMention(source, line, target) : false));

    // Yesterday's note from a daily note (8.7 w2b): an ISO day opens that day's note (made from the template when
    // it isn't there yet, as today's is); anything else opens today's.
    handle('daily:open', (iso: unknown) => openDailyNote(dayFromIso(iso)));
    // Where the days live when they don't live in the day-notes folder (5 Nov 2026, u3 moving-in): one suggestion
    // line in Settings, never auto-switching.
    handle('daily:folder-hint', () => dailyFolderHint(dayShapedByFolder([...index.allMeta()].map((m) => m.path)), settings.raw.dailyFolder));

    handle('settings:get', () => ({ ...settings.view(), host: host.kind, library: libraryPath() }));
    handle('settings:update', async (patch: SettingsPatch) => updateSettings(patch ?? {}));
    handle('settings:choose-library', async () => {
      const result = await showOpen({ title: 'Choose where Ironleaf keeps your notes', buttonLabel: 'Keep notes here', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      await settings.update({ library: result.filePaths[0] });
      await openVault(result.filePaths[0]);
      return libraryPath();
    });

    vaultHome.register(handle);
    // Export everything (31 Oct 2026: portable export to prove no lock-in): one zip saved where chosen, in
    // Settings › Backups and sync, the palette and a project's menu. Downloads first, as asked.
    registerPortableExport({
      handle,
      send,
      root: () => vault?.root ?? null,
      vaultName: () => (vault?.root ? path.basename(vault.root) : 'Vault'),
      saveDialog: async (defaultName) => {
        // A development build's checks answer Windows' Save window with this (tools/shots-portable-export.mjs).
        const stub = !app.isPackaged ? process.env.NV_PORTABLE_PATH : undefined;
        if (stub) return stub;
        const w = promptOwner();
        let downloads = '';
        try {
          downloads = app.getPath('downloads');
        } catch {
          downloads = os.homedir();
        }
        const options = { title: 'Export everything', defaultPath: path.join(downloads || os.homedir(), defaultName), buttonLabel: 'Export', filters: [{ name: 'Zip file', extensions: ['zip'] }] };
        const r = w ? await dialog.showSaveDialog(w, options) : await dialog.showSaveDialog(options);
        return r.canceled || !r.filePath ? null : r.filePath;
      },
      allowFile: !app.isPackaged,
      notes: () => index.allMeta().map((m) => ({ path: m.path, title: m.label || m.title, props: (m.props ?? {}) as Record<string, unknown>, mtime: m.mtime })),
      projectMembers: (p) => projects.view(p).notes.map((n) => n.path),
      projects: () => projects.all().map(({ path: p, project }) => ({ path: p, name: project.name, ...(project.status ? { status: project.status } : {}), ...(project.health ? { health: project.health } : {}), ...(project.progress !== undefined ? { progress: project.progress } : {}), ...(project.owner ? { owner: project.owner } : {}), ...(project.due ? { due: project.due } : {}), ...(project.updated ? { updated: project.updated } : {}), ...(project.folder ? { folder: project.folder } : {}), tags: project.tags })),
      tasks: () => tasks.view().tasks.map((t) => ({ words: t.words, done: t.done, due: t.due, time: t.time, projectName: t.projectName, path: t.path, title: t.title, line: t.line, tags: t.allTags, ...(t.priority ? { priority: t.priority } : {}), reminder: t.reminder, repeats: t.repeats })),
      moduleTypes: () => MODULE_TYPES.map((t) => ({ id: t.id, name: t.name, plural: t.plural, fields: t.fields.map((f) => ({ key: f.key })) })),
      privateUnlocked: () => privateNotes.unlocked,
      privateNotes: () => privateNotes.list().map((e) => ({ path: e.path, text: privateNotes.read(e.path), modified: e.modified })),
      secrets: async () => (await secrets.allRecords()).map((r) => ({ name: r.name, kind: r.kind, ...(r.username ? { username: r.username } : {}), ...(r.where ? { where: r.where } : {}), ...(r.notes ? { notes: r.notes } : {}), value: r.value, created: r.created, modified: r.modified, ...(r.from ? { from: r.from } : {}) })),
      health: async () => {
        try {
          const db = await lifeModules.healthDb();
          const as = (rows: unknown) => (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []);
          return { measures: as(db.measures), entries: as(db.entries), notes: as(db.notes), sessions: as(db.sessions), plans: as(db.plans), exercises: as(db.exercises), meals: as(db.meals), appointments: as(db.appointments) };
        } catch {
          return null;
        }
      },
    });
    // Publish as a website (9.0 w122publish): the person's sites, the preview, the folder, and the former
    // host app's destinations through the host (src/main/site-publish.ts).
    const siteDeps: SitePublishDeps = {
      handle,
      send,
      root: () => vault?.root ?? null,
      readText: (rel) => index.content(rel) ?? requireVault().read(rel),
      notes: () => index.allMeta().map((m) => ({ path: m.path, title: m.label || m.title, props: (m.props ?? {}) as Record<string, unknown>, tags: m.tags ?? [], mtime: m.mtime })),
      resolve: (target, from) => index.resolveAny(target, from),
      readFile: (rel) => {
        if (!vault) return null;
        try {
          const abs = vault.absolute(rel);
          if (statSync(abs).size > 100 * 1024 * 1024) return null;
          return new Uint8Array(readFileSync(abs));
        } catch {
          return null;
        }
      },
      sensitivity: () => sensitivity.store(),
      accent: () => settings.raw.prefs.accent,
      showProperties: () => settings.raw.prefs.propertiesShow !== 'hidden',
      pickFolder: async () => {
        // A development build's checks answer the folder window with this (tools/shots-w122publish.mjs).
        const stub = !app.isPackaged ? process.env.NV_SITE_PATH : undefined;
        if (stub) return stub;
        const w = promptOwner();
        const options = { title: 'Where does this site go?', buttonLabel: 'Publish here', properties: ['openDirectory' as const, 'createDirectory' as const] };
        const r = w ? await dialog.showOpenDialog(w, options) : await dialog.showOpenDialog(options);
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
      },
      trash: (abs) => shell.trashItem(abs),
      openPath: (abs) => shell.openPath(abs),
      hostPublish: host.sitePublish ? ((req: HostPublishRequest) => host.sitePublish!(req as { op: string; [key: string]: unknown })) : null,
      log: (m) => host.log?.(m),
    };
    registerSitePublish(siteDeps);
    pairing.register(handle);
    handle('sync:status', (fresh: unknown) => vaultSync.status(fresh === true));
    handle('sync:fix', (id: unknown, arg: unknown) => vaultSync.fix(id, arg));
    handle('place:status', (fresh: unknown) => placeStatus(fresh === true));
    handle('place:plan', (target: unknown) => placePlan(target));
    handle('place:move', () => placeMove());
    handle('place:open-found', (folder: unknown) => placeOpenFound(folder));
    handle('place:open-folder', () => placeOpenFolder());
    // The folder open for a look becomes the library (the moving-in screen's own words ask first, so no dialog here).
    handle('place:adopt-open', () => useLibrary(openFolder()));
    handle('place:dismiss', async (kind: unknown, folder: unknown) => {
      if ((kind !== 'tip' && kind !== 'found') || typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Unknown card.');
      await settings.dismissPlace(kind, folder);
    });

    handle('vault-lock:status', () => lockView());
    handle('vault-lock:open-other', () => openOtherApp());
    handle('vault-lock:read-only', () => lockView());

    // The person's own AI connections (Settings › AI; src/main/providers): the view, a connection added, changed or
    // removed, its key (kept by the KeyStore, never sent back), its models as the provider lists them, and a test.
    const connectionId = (id: unknown): string => {
      if (typeof id !== 'string' || !models.view().connections.some((c) => c.id === id)) throw new Error('That connection is no longer here.');
      return id;
    };
    handle('models:view', () => modelsView());
    handle('models:add-connection', async (input: unknown) => {
      if (!models.addConnection || !input || typeof input !== 'object') throw new Error('That connection couldn’t be added.');
      const v = input as ModelConnectionInput & { key?: unknown };
      const id = await models.addConnection({ kind: v.kind, name: v.name, baseURL: v.baseURL, api: v.api, models: Array.isArray(v.models) ? v.models : undefined, noAuth: v.noAuth });
      if (typeof v.key === 'string' && v.key.trim()) await models.setKey?.(id, v.key);
      return { id, view: modelsView() };
    });
    handle('models:update-connection', async (id: unknown, patch: unknown) => {
      if (!models.updateConnection || !patch || typeof patch !== 'object') throw new Error('That connection couldn’t be changed.');
      const v = patch as Partial<ModelConnectionInput>;
      await models.updateConnection(connectionId(id), { ...(v.name !== undefined ? { name: v.name } : {}), ...(v.baseURL !== undefined ? { baseURL: v.baseURL } : {}), ...(Array.isArray(v.models) ? { models: v.models } : {}), ...(v.noAuth !== undefined ? { noAuth: v.noAuth } : {}), ...(v.api !== undefined ? { api: v.api } : {}) });
      return modelsView();
    });
    handle('models:remove-connection', async (id: unknown) => {
      if (!models.removeConnection) throw new Error('That connection couldn’t be removed.');
      const gone = connectionId(id);
      await models.removeConnection(gone);
      if (settings.raw.model?.provider === gone) await settings.update({ model: null });
      return modelsView();
    });
    handle('models:set-key', async (id: unknown, key: unknown) => {
      if (!models.setKey) throw new Error('This PC can’t keep keys.');
      await models.setKey(connectionId(id), key === null ? null : typeof key === 'string' ? key : '');
      return modelsView();
    });
    handle('models:list-remote', async (id: unknown) => {
      if (!models.listRemote) throw new Error('The models couldn’t be listed.');
      return models.listRemote(connectionId(id));
    });
    handle('models:set-transcription', async (choice: unknown) => {
      if (!models.setTranscription) throw new Error('Transcription couldn’t be set.');
      const v = choice && typeof choice === 'object' ? (choice as { connection?: unknown; model?: unknown }) : null;
      await models.setTranscription(v && typeof v.connection === 'string' && typeof v.model === 'string' ? { connection: v.connection, model: v.model } : null);
      return modelsView();
    });
    handle('models:test', (id: unknown, modelId: unknown) => {
      if (typeof id !== 'string' || typeof modelId !== 'string') throw new Error('Choose a connection and a model to test.');
      return models.test(id, modelId.slice(0, 200));
    });

    handle('ai:chat', async (requestId: unknown, history: unknown, options: unknown) => {
      await requireCreate();
      if (typeof requestId !== 'string' || !Array.isArray(history)) throw new Error('Invalid chat request.');
      const turns: ChatTurn[] = history
        .filter((t): t is ChatTurn => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.content === 'string')
        .slice(-20)
        .map((t) => (t.role === 'user' && t.attachments ? { role: 'user', content: t.content, attachments: cleanAttachments(t.attachments) } : { role: t.role, content: t.content }));
      const o = (options && typeof options === 'object' ? options : {}) as ChatOptions;
      const clean: ChatOptions = {
        scope: o.scope === 'note' ? 'note' : 'all',
        note: typeof o.note === 'string' && index.get(o.note) ? o.note : undefined,
        noteText: typeof o.noteText === 'string' ? o.noteText.slice(0, 200_000) : undefined,
        // Folders the person added with the chat's folder button (chosen in Windows' own folder window).
        folders: Array.isArray(o.folders) ? o.folders.filter((f): f is string => typeof f === 'string' && chatFolders.has(f)).slice(0, 10) : undefined,
      };
      if (o.scope === 'chat') {
        clean.scope = 'chat';
        delete clean.note;
        delete clean.noteText;
        clean.folders = [];
        const target = resolveChatAsk(toldFocus, o.chat?.id);
        if (target && 'withheld' in target) clean.chatWithheld = target.withheld;
        else if (target && host.chatTranscript) {
          const transcript = await host.chatTranscript(target.id).catch(() => null);
          const now = resolveChatAsk(toldFocus, target.id);
          if (!now || !transcript) clean.chatMissing = true;
          else if ('withheld' in now) clean.chatWithheld = now.withheld;
          else if ('private' in transcript) clean.chatWithheld = 'private';
          else if ('locked' in transcript) clean.chatWithheld = 'locked';
          else {
            clean.chat = { id: target.id, title: transcript.title };
            clean.chatText = transcript.text.slice(-MAX_CHAT_CHARS);
          }
        } else clean.chatMissing = true;
      }
      const controller = new AbortController();
      chatControllers.set(requestId, controller);
      try {
        return await ai.chat(turns, (text) => send('ai:chat-delta', { requestId, text }), controller.signal, clean, (step, clearText) => send('ai:chat-step', { requestId, step, clearText }));
      } finally {
        chatControllers.delete(requestId);
      }
    });
    // A document attached to the chat: its words, read here from the bytes the chat window hands over (src/shared/chat-attach.ts).
    handle('ai:attachment-text', async (name: unknown, bytes: unknown) => {
      await requireCreate();
      if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('That file couldn’t be attached.');
      if (bytes.byteLength > ATTACH_LIMITS.fileBytes) return { error: 'It is too big to attach (60 MB at most).' };
      return attachmentText(name.slice(0, 200), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { pdf: pdfReader, ...(host.readDocument ? { bridge: (abs: string) => host.readDocument!(abs) } : {}), tmpDir: path.join(host.dataDir, 'attach-read'), maxChars: ATTACH_LIMITS.docChars });
    });
    // A folder on this PC for the chat's assistant to read: only one chosen here, in Windows' own folder window.
    handle('ai:add-folder', async () => {
      const options = { title: 'Add a folder for the assistant to read', buttonLabel: 'Add folder', properties: ['openDirectory' as const] };
      const pick = await showOpen(options);
      if (pick.canceled || !pick.filePaths[0]) return null;
      chatFolders.add(pick.filePaths[0]);
      return pick.filePaths[0];
    });
    // Projects (docs/PROJECTS-DESIGN.md): the Projects home, a project's page, its folder's files, edits in place.
    handle('projects:list', () => projects.list());
    handle('projects:folder-offers', () => projects.folderOffers());
    handle('project:from-folder', (folder: unknown) => projectFromFolder(folder));
    handle('project:unclaim', (rel: unknown) => projectUnclaim(rel));
    // A damaged board's bytes, kept in File recovery before the person starts over (5 Nov 2026, u3 moving-in:
    // the first save used to destroy them with no copy). Nothing is written into the file.
    handle('canvas:keep-damaged', async (rel: unknown) => {
      const file = cleanRel(rel);
      const v = requireVault();
      if (!(await v.any(file))) throw new Error('That board isn’t there any more.');
      await recovery.keep(file, await v.readText(file), { force: true });
      return true;
    });
    // Every project in full (its dates, steps, people…): the Timeline reads them live from their files.
    handle('projects:all', () => projects.all());
    // Each live project's catch-up checks (10.0 item 19): standing checks and proposals from its changed notes,
    // for its page's banner and Today. Cached until the notes change.
    handle('projects:checks', () => projectChecks.checks());
    // Projects related to each other (src/shared/relations.ts, the graph's own): the portfolio board draws the same lines.
    handle('projects:relations', () => {
      const r = index.relations(), set = new Set(r.projects);
      return r.relations.filter((x) => set.has(x.source) && set.has(x.target) && x.kinds.some((k) => k !== 'owns')).map((x) => ({ a: x.source, b: x.target, kinds: x.kinds, reasons: x.reasons }));
    });
    handle('project:view', (rel: unknown) => projects.view(cleanRel(rel)));
    // A project's folder on this PC (src/main/project-places.ts): chosen, found, made here, worked on without, or put back
    // to the folder its note names. Kept in this PC's settings; the note (synced to the other PC) is never changed.
    handle('project:folder-here', async (rel: unknown, action: unknown, chosen: unknown): Promise<FolderHereResult> => {
      const file = cleanRel(rel);
      const v = requireVault();
      const before = projects.view(file);
      const recorded = recordedFolder(parseProject(index.content(file) ?? '', file));
      // No folder named yet (a project made by hand): finding, making or working without need a recorded
      // folder to work from, but choosing writes the note's first folder, in the choose case below.
      if (!recorded && action !== 'choose') throw new Error('This project names no folder yet. Choose its folder first.');
      // The folders this PC keeps its other projects in (where to look, and where a new one goes).
      const others = projects
        .all()
        .filter((x) => x.path !== file && x.project.folder && path.isAbsolute(x.project.folder))
        .map((x) => x.project.folder!);
      const done = (words: string, found?: string[]): FolderHereResult => ({ view: projects.view(file), words, ...(found ? { found } : {}) });
      const name = before.project.name;
      switch (action) {
        case 'choose': {
          let folder = typeof chosen === 'string' && chosen ? chosen : '';
          if (!folder) {
            const options = { title: `Choose ${name}’s folder on this PC`, buttonLabel: 'Use this folder', properties: ['openDirectory' as const, 'createDirectory' as const] };
            const pick = await showOpen(options);
            if (pick.canceled || !pick.filePaths[0]) return done('');
            folder = pick.filePaths[0];
          }
          // The note's first folder (no recorded folder): written to the note itself, as every project
          // change is (with its day and its history step, so it undoes), not to this PC's choices.
          if (!recorded) {
            const text = index.content(file) ?? '';
            const p = parseProject(text, file);
            p.folder = folder;
            p.updated = formatDate('YYYY-MM-DD');
            const after = serializeProject(p, text);
            await writeNote(file, after);
            const words = `On this PC, ${name} uses ${folder}.`;
            projectHistory.record(file, { before: text, after: index.content(file) ?? after, words, by: 'you' });
            return done(words);
          }
          const real = await projectPlaces.choose(recorded, folder);
          return done(`On this PC, ${name} uses ${real}. Your other PC keeps its own folder.`);
        }
        case 'find': {
          const found = await projectPlaces.find(recorded, others);
          if (found.length === 1) {
            const real = await projectPlaces.choose(recorded, found[0]);
            return done(`Found it: ${real}. ${name} uses it on this PC.`, found);
          }
          return done(found.length ? `Found ${found.length} folders called “${path.basename(found[0])}”. Choose the right one.` : `No folder called “${recorded.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}” on this PC. Choose it, or use a new folder here.`, found);
        }
        case 'new': {
          const real = await projectPlaces.makeHere(recorded, others);
          return done(`Made a folder for ${name} on this PC: ${real}.`);
        }
        case 'without': {
          await projectPlaces.without(recorded);
          await fsp.mkdir(v.absolute(ownFilesFolder(file)), { recursive: true }).catch(() => undefined);
          return done(`On this PC, ${name} works without a folder: its files are kept with it in Ironleaf (${ownFilesFolder(file)}).`);
        }
        case 'forget': {
          await projectPlaces.forget(recorded);
          return done(`${name} looks for its folder as its note names it again.`);
        }
        default:
          throw new Error('Choose what to do with the project’s folder.');
      }
    });
    // A project's conversations in the former host app, whatever its folder (8.0 TR8 row 5, Phase 5 "workspace ↔ project
    // linked"): its folder on this PC, its remote computer's folder, and any conversation that worked on it in Ironleaf
    // (My workspace included); every one (the page shows a few and "Show all"), and one of them opened there.
    handle('project:work', async (rel: unknown): Promise<ProjectConversation[] | null> => {
      if (!host.projectWork) return null;
      const note = cleanRel(rel);
      // The folder this PC reads (t58 break: the raw note names no folder for a project worked on without
      // one, so its chats never listed, though Start a chat here starts them in its own Files folder).
      const where = projectAt(note).where;
      const r = await host.projectWork({ note, ...(where?.kind === 'local' ? { folder: where.folder } : where?.kind === 'remote' ? { remote: { computer: where.computer, path: where.path } } : {}) }).catch(() => null);
      // Every one (t58 break: the cap hid chats and the page counted what crossed).
      const list = (r?.conversations ?? []).filter((c) => typeof c?.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(c.id));
      for (const c of list) projectConversations.add(c.id);
      // Each with its kind (one product, 9 Nov 2026, DESIGN A.5); a private chat reads "Private chat" here too,
      // so its words never reach the page even if the host forgot to mask them. A locked chat reads
      // "Locked conversation" the same way (t63 break: its title reached the view).
      return list.map((c) => {
        const priv = c.private === true;
        const locked = !priv && (c as { locked?: unknown }).locked === true;
        const kind = c.kind === 'code' || c.kind === 'cowork' ? c.kind : 'chat';
        const title = priv ? 'Private chat' : locked ? 'Locked conversation' : String(c.title || 'Untitled conversation').slice(0, 140);
        return { id: c.id, title, updatedAt: Number(c.updatedAt) || 0, running: c.running === true, kind, ...(priv ? { private: true as const } : {}), ...(locked ? { locked: true as const } : {}) };
      });
    });
    // The bell in the header: the notices the former host app keeps for both apps (inside the former host app),
    // with Ironleaf's own reminders that came due (src/main/reminders.ts), on its own too. Names Windows cannot
    // keep (Nov 2026 break audit): the window shows the plan, the person approves or leaves it, and one Undo
    // puts an applied plan back. Nothing here renames without the person's word.
    handle('names-preview', async () => {
      const v = requireVault();
      const look = await vaultFiles.check({ repair: false, templatesFolder: settings.raw.prefs.templatesFolder });
      const decision = await namesDecision(v.root, look.renames, look.nameLeft).catch(() => null);
      const pairs = decision === 'approved' ? await namesPending(v.root, look.renames, look.nameLeft).catch(() => []) : decision === 'declined' ? [] : look.renames;
      return { pairs, notes: look.nameLeft, decided: decision };
    });
    handle('names-repair', async () => {
      const v = requireVault();
      const look = await vaultFiles.check({ repair: false, templatesFolder: settings.raw.prefs.templatesFolder });
      await namesDecide(v.root, look.renames, look.nameLeft, 'approved');
      const { r, applied, failed } = await runCheckWithNames({ repair: true, ask: false });
      lastCheck = { at: Date.now(), ...r };
      if (r.fixed.length) filesChanged();
      if (!applied.length && !failed.length) return 'Nothing to repair.';
      if (!applied.length) return failed.join(' ');
      // Short for the toast (the bell's quiet notice carries the full telling): the count, and the Undo beside it.
      const told = namesTold(applied, failed);
      return `${told.title}.${failed.length ? ` ${failed.length} couldn’t.` : ''}`;
    });
    handle('names-leave', async () => {
      const v = requireVault();
      const look = await vaultFiles.check({ repair: false, templatesFolder: settings.raw.prefs.templatesFolder });
      await namesDecide(v.root, look.renames, look.nameLeft, 'declined');
      return 'Left as they are. They will be asked about again only if new names need it.';
    });
    handle('names-undo', async () => {
      const v = requireVault();
      const pairs = await namesUndoPairs(v.root);
      if (!pairs.length) return 'Nothing to put back.';
      // Folders first (each carries its files back), then files whose folder stayed: gone means already back.
      const folders: [string, string][] = [];
      const files: [string, string][] = [];
      for (const [from, to] of pairs) (await v.isFolder(to).catch(() => false) ? folders : files).push([from, to]);
      let back = 0;
      const stuck: string[] = [];
      for (const [from, to] of [...folders, ...files]) {
        if (!(await v.any(to))) continue;
        try {
          let dest = from;
          if (await v.any(dest)) {
            const { base, ext } = splitName(dest.split('/').pop() ?? dest);
            dest = await uniqueRel(v, dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '', base, ext);
          }
          await movePath(to, dest, true);
          back++;
        } catch (err) {
          stuck.push(`${to}: ${err instanceof Error ? err.message.replace(/\.\s*$/, '') : String(err)}.`);
        }
      }
      if (back && !stuck.length) await namesUndoneLatest(v.root);
      filesChanged();
      if (!back && !stuck.length) return 'Everything is already back.';
      if (!back) return stuck.join(' ');
      return `${back === 1 ? 'Put 1 name back' : `Put ${back} names back`}.${stuck.length ? ` ${stuck.join(' ')}` : ''}`;
    });
    handle('notices:list', (): NoticesView => noticesView());
    handle('notices:read', (id: unknown): NoticesView => {
      const one = typeof id === 'string' ? id : undefined;
      const own = one ? reminders.get(one) : undefined;
      if (!one || own) reminders.read(one);
      if (own) readHostCopies(own);
      if (host.notices && (!one || !own)) host.notices.read(one);
      return noticesView();
    });
    handle('notices:open', (id: unknown) => {
      if (typeof id !== 'string' || !host.notices || reminders.has(id)) return { opened: false };
      return { opened: host.notices.open(id)?.opened === true };
    });
    handle('notices:clear', (): NoticesView => {
      reminders.clear();
      host.notices?.clear();
      return noticesView();
    });
    // Reminders (src/main/reminders.ts): Today's card, and a reminder ticked or snoozed from it or from the bell.
    handle('reminders:view', () => reminders.view());
    handle('reminders:done', async (key: unknown) => {
      if (typeof key !== 'string') throw new Error('Which reminder?');
      await requireCreate();
      const words = await reminders.done(key);
      for (const n of reminders.notices()) if (n.reminder === key) readHostCopies(n);
      return words;
    });
    handle('reminders:snooze', async (key: unknown, until: unknown) => {
      if (typeof key !== 'string' || typeof until !== 'number' || !Number.isFinite(until)) throw new Error('Which reminder, and until when?');
      await requireCreate();
      const words = await reminders.snooze(key, until);
      for (const n of reminders.notices()) if (n.reminder === key) readHostCopies(n);
      return words;
    });
    handle('reminders:untick', async (key: unknown) => {
      if (typeof key !== 'string') throw new Error('Which reminder?');
      await requireCreate();
      return reminders.untick(key);
    });
    // The weekly tidy (src/main/weekly-tidy.ts): this week's proposal, each line applied or skipped, each change
    // undone, and the waiting lines as Needs you entries for Wave 1 and the former host app.
    handle('tidy:status', () => tidy.status());
    handle('tidy:get', () => tidy.get());
    handle('tidy:needs', () => tidy.needs());
    handle('tidy:prepare', async () => {
      await requireCreate();
      return tidy.prepare(true);
    });
    handle('tidy:apply', async (id: unknown) => {
      if (typeof id !== 'string') throw new Error('Which line?');
      await requireCreate();
      return tidy.apply(id);
    });
    handle('tidy:skip', async (id: unknown) => {
      if (typeof id !== 'string') throw new Error('Which line?');
      await requireCreate();
      return tidy.skip(id);
    });
    handle('tidy:apply-all', async () => {
      await requireCreate();
      return tidy.applyAll();
    });
    handle('tidy:undo', async (id: unknown) => {
      if (typeof id !== 'string') throw new Error('Which line?');
      await requireCreate();
      return tidy.undo(id);
    });
    handle('project:open-conversation', (id: unknown) => {
      if (typeof id !== 'string' || !projectConversations.has(id)) throw new Error('That conversation isn’t one this project listed.');
      if (host.openConversation) return host.openConversation(id);
      throw new Error('That can’t be opened here.');
    });
    // Today (src/shared/today.ts): what's due, at risk, waiting and changed across every project, today's note and
    // meetings; then the files changed since yesterday in the projects' folders (read from the PC, so it comes after).
    handle('today:data', () => {
      const { dailyFolder, dailyFormat } = settings.raw;
      const date = formatDate(dailyFormat, new Date());
      const daily = cleanNotePath(dailyFolder ? `${dailyFolder}/${date}` : date);
      return todayData(index, { path: daily, exists: index.has(daily) }, new Date(), settings.raw.prefs.templatesFolder ?? '');
    });
    handle('hub:day', (iso: unknown, opened: unknown) => hub.day(String(iso ?? ''), Array.isArray(opened) ? opened.filter((p): p is string => typeof p === 'string').slice(0, 200) : undefined));
    handle('hub:marks', (from: unknown, to: unknown) => hub.marks(String(from ?? ''), String(to ?? '')));
    handle('hub:due', () => hub.due());
    handle('hub:due-on', (iso: unknown) => hub.dueOn(String(iso ?? '')));
    handle('hub:tick', async (rel: unknown, line: unknown, text: unknown, done: unknown) => {
      if (typeof text !== 'string' || typeof line !== 'number') throw new Error('Which task?');
      await requireCreate();
      return hub.tick(cleanNotePath(rel), line, text, done !== false);
    });
    handle('hub:start', (iso: unknown) => hub.start(String(iso ?? '')));
    // The Tasks view (src/main/tasks.ts): the list, a tick, a due day and a reminder made from a task's day and time.
    handle('tasks:view', () => tasks.view());
    handle('tasks:tick', async (rel: unknown, line: unknown, text: unknown, done: unknown) => {
      if (typeof text !== 'string' || typeof line !== 'number') throw new Error('Which task?');
      await requireCreate();
      return tasks.tick(cleanNotePath(rel), line, text, done !== false);
    });
    handle('tasks:due', async (rel: unknown, line: unknown, text: unknown, iso: unknown, time: unknown) => {
      if (typeof text !== 'string' || typeof line !== 'number') throw new Error('Which task?');
      await requireCreate();
      return tasks.setDue(cleanNotePath(rel), line, text, typeof iso === 'string' && iso ? iso : null, typeof time === 'string' && time ? time : null);
    });
    handle('tasks:remind', async (rel: unknown, line: unknown, text: unknown) => {
      if (typeof text !== 'string' || typeof line !== 'number') throw new Error('Which task?');
      await requireCreate();
      return tasks.remind(cleanNotePath(rel), line, text);
    });
    handle('tasks:edit', async (rel: unknown, line: unknown, text: unknown, rest: unknown) => {
      if (typeof text !== 'string' || typeof line !== 'number' || typeof rest !== 'string') throw new Error('Which task?');
      await requireCreate();
      return tasks.edit(cleanNotePath(rel), line, text, rest);
    });
    // Shared spaces (10.0 item 26): the list and one space's home.
    handle('shared-spaces:list', () => spaces.list());
    handle('shared-spaces:home', (folder: unknown) => spaces.home(String(folder ?? '')));
    handle('today:files', (since: unknown) => changedFiles(index, typeof since === 'number' && Number.isFinite(since) ? since : Date.now() - 2 * 86400000));
    handle('project:files', async (rel: unknown, fresh: unknown) => {
      const file = cleanRel(rel);
      const raw = projects.view(file).project;
      const { p, where } = projectAt(file);
      if (!where) return null;
      if (where.kind === 'local') fileIndex.touch(p.folder);
      const listed = await projectFolders.files(where, { fresh: fresh === true });
      // No folder of its own: the files agents saved for it, in its own Files folder in Ironleaf.
      if (!raw.folder && where.kind === 'local') return { ...listed, own: ownFilesFolder(file) };
      // A remote computer's folder (read only): files agents saved for it are kept in Ironleaf, listed beside it.
      if (where.kind === 'remote') {
        const own = ownFilesAt(file);
        if (own) {
          const saved = await folderFiles(own);
          const list = saved.groups.flatMap((g) => g.files);
          if (list.length) return { ...listed, saved: { rel: ownFilesFolder(file), folder: own, files: list } };
        }
      }
      return listed;
    });
    // The former host app brought forward at Remote computers (a remote project's "isn't connected
    // right now").
    handle('app:open-remote-computers', () => {
      if (!host.openRemoteComputers) throw new Error('Remote computers aren’t available in Ironleaf.');
      host.openRemoteComputers();
    });
    // A remote project's file as it is (a picture, a PDF, a recording), for the viewer: its bytes through the former
    // host app.
    handle('project:file-bytes', async (rel: unknown, file: unknown) => {
      const w = remoteOf(rel);
      if (!w || typeof file !== 'string') throw new Error('Files on this PC are shown straight from the disk.');
      try {
        return new Uint8Array(await projectFolders.bytes(w, file));
      } catch (err) {
        throw new Error(err instanceof FolderProblem ? err.problem.words : err instanceof Error ? err.message : String(err));
      }
    });
    // Searching inside project files: hits (the search panel, Open a note, the navigator, a project's Files), the
    // progress line and Settings › Search.
    handle('fileindex:search', (query: unknown, options: unknown) => {
      if (typeof query !== 'string' || !query.trim()) return [];
      const o = (options && typeof options === 'object' ? options : {}) as { project?: unknown; limit?: unknown };
      return fileIndex.search(query.slice(0, 1000), { ...(typeof o.project === 'string' ? { project: o.project } : {}), limit: typeof o.limit === 'number' ? Math.max(1, Math.min(500, Math.round(o.limit))) : 60 });
    });
    handle('fileindex:status', () => fileIndex.status());
    handle('meaning:status', (): MeaningStatus => meaningBuilder?.status() ?? MEANING_STATUS_QUIET);
    // A project file's words as the index has them (the viewer's "The words in it" for Word, Excel and PowerPoint).
    handle('fileindex:read', async (project: unknown, file: unknown) => {
      if (typeof project !== 'string' || typeof file !== 'string') throw new Error('Which file?');
      const w = remoteOf(project);
      try {
        const f = w ? await projectFolders.read(cleanRel(project), w, file) : (await fileIndex.read(cleanRel(project), file)).file;
        return { state: f.state, text: f.text ?? '', cut: !!f.cut };
      } catch (err) {
        if (err instanceof FolderProblem) throw new Error(err.problem.words);
        throw err;
      }
    });
    handle('fileindex:rebuild', () => fileIndex.rebuild());
    // Words in pictures and scans (src/main/ocr.ts): search, one picture's lines, one scan page's lines, Read again.
    const ocrOff = () => ({ on: settings.raw.prefs.ocrRead, available: false, reason: 'starting', busy: false, done: 0, todo: 0, files: 0, withWords: 0, languages: null, lang: settings.raw.prefs.ocrLang });
    handle('ocr:status', () => ocrQueue?.status() ?? ocrOff());
    handle('ocr:search', (query: unknown, options: unknown) => {
      if (!ocrStore || typeof query !== 'string') return [];
      const o = (options && typeof options === 'object' ? options : {}) as { limit?: unknown };
      return searchOcr(ocrStore.all(), query.slice(0, 1000), { isExcluded: (rel) => index.isExcluded(rel), limit: typeof o.limit === 'number' ? Math.max(1, Math.min(100, Math.round(o.limit))) : 30 });
    });
    /** A path among the notes as the store keeps it (inside the vault, never private). */
    const ocrRelOf = (rel: unknown): string | null => {
      if (typeof rel !== 'string' || !rel || rel.length > 1000) return null;
      const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
      try {
        requireVault().absolute(clean);
      } catch {
        return null;
      }
      return isPrivatePath(clean) ? null : clean;
    };
    handle('ocr:lines', (rel: unknown) => {
      const clean = ocrRelOf(rel);
      if (!clean || !ocrStore) return null;
      return ocrStore.get(clean)?.pages?.['1'] ?? null;
    });
    handle('ocr:page', (rel: unknown, page: unknown) => {
      const clean = ocrRelOf(rel);
      const n = typeof page === 'number' && Number.isFinite(page) ? Math.floor(page) : 0;
      if (!clean || !ocrStore || n < 1 || n > OCR_LIMITS.pages) return { state: 'failed', lines: [] };
      return ocrPageState(ocrStore.get(clean), n);
    });
    handle('ocr:rebuild', async () => {
      const v = requireVault();
      if (!ocrQueue) return;
      const all = await v.listAll();
      ocrQueue.rebuild(ocrFilesOf(v, all.files));
    });
    /** A file saved for a remote project in Ironleaf (its own Files folder), when that is where it is. */
    const savedHere = (rel: unknown, file: unknown): string | null => {
      if (typeof file !== 'string' || !file) return null;
      const own = ownFilesAt(cleanRel(rel));
      if (!own) return null;
      try {
        const abs = insideFolder(own, file);
        return statSync(abs, { throwIfNoEntry: false })?.isFile() ? abs : null;
      } catch {
        return null;
      }
    };
    handle('project:open-file', async (rel: unknown, file: unknown) => {
      const w = remoteOf(rel);
      const kept = w ? savedHere(rel, file) : null;
      if (w && !kept) throw new Error(READ_ONLY(w));
      const folder = pcFolderOf(rel);
      if (!kept && (!folder || typeof file !== 'string')) throw new Error('This project has no folder on this PC.');
      const words = await shell.openPath(kept ?? insideFolder(folder!, file as string));
      if (words) throw new Error(words);
    });
    handle('project:show-file', (rel: unknown, file: unknown) => {
      const w = remoteOf(rel);
      const kept = w ? savedHere(rel, file) : null;
      if (w && !kept) throw new Error(READ_ONLY(w));
      if (kept) return shell.showItemInFolder(kept);
      const folder = pcFolderOf(rel);
      if (!folder) throw new Error('This project has no folder on this PC.');
      shell.showItemInFolder(typeof file === 'string' && file ? insideFolder(folder, file) : folder);
    });
    handle('project:open-folder', async (rel: unknown) => {
      const w = remoteOf(rel);
      if (w) throw new Error(READ_ONLY(w));
      const folder = pcFolderOf(rel);
      if (!folder) throw new Error('This project has no folder on this PC.');
      const words = await shell.openPath(folder);
      if (words) throw new Error(words);
    });
    // A change made by hand on a project's page: one way in for every fact (src/shared/project-file.ts applyProjectEdit),
    // refused when the file changed since the page showed it, written back keeping every line it doesn't understand, and
    // kept in the project's history to undo.
    // A rename moves the project's workspace with it (src/main/workspaces.ts).
    const withWorkspace = async (r: ProjectEditResult): Promise<ProjectEditResult> => {
      if (r.moves.length && vault) await followMoves(vault.root, r.moves);
      return r;
    };
    handle('project:edit', (rel: unknown, edit: unknown, version: unknown): Promise<ProjectEditResult> => editProject(rel, edit, version).then(withWorkspace));
    // Tidy (29 Oct 2026): its preview, one project tidied on the version shown, every project with something to
    // move (Today's quiet line), and Tidy's own Undo.
    handle('project:tidy-preview', (rel: unknown) => tidyPreview(cleanRel(rel)));
    handle('projects:tidy-preview', () => projects.all().map((x) => tidyPreview(x.path)).filter((x) => x.moves.length > 0));
    handle('project:tidy', (rel: unknown, version: unknown): Promise<TidyResult> => tidyProject(rel, version));
    handle('project:tidy-undo', (rel: unknown): Promise<TidyResult> => tidyUndo(rel));
    handle('project:undo', (rel: unknown) => projectStep(cleanRel(rel), false).then(withWorkspace));
    handle('project:redo', (rel: unknown) => projectStep(cleanRel(rel), true).then(withWorkspace));
    // The start of a text file in a project's folder (a Markdown note, a list, a CSV), for its preview.
    handle('project:read-file', async (rel: unknown, file: unknown): Promise<ProjectFileText> => {
      const w = remoteOf(rel);
      if (w && typeof file === 'string') {
        try {
          const v = await projectFolders.remote.call<{ kind: string; text: string | null; truncated?: boolean }>(w, 'read', { path: file, maxBytes: 256 * 1024 });
          if (typeof v.text !== 'string') throw new Error('This file isn’t text.');
          return { text: v.text, truncated: !!v.truncated };
        } catch (err) {
          throw new Error(err instanceof FolderProblem ? err.problem.words : err instanceof Error ? err.message : String(err));
        }
      }
      const folder = pcFolderOf(rel);
      if (!folder || typeof file !== 'string') throw new Error('This project has no folder on this PC.');
      const abs = insideFolder(folder, file);
      const max = 256 * 1024;
      const handle = await fsp.open(abs, 'r');
      try {
        const size = (await handle.stat()).size;
        const buffer = Buffer.alloc(Math.min(size, max));
        await handle.read(buffer, 0, buffer.length, 0);
        return { text: buffer.toString('utf8').replace(/^\uFEFF/, ''), truncated: size > max };
      } finally {
        await handle.close();
      }
    });
    // A PDF's first page, drawn by the window with PDF.js and kept here: a PDF in a project's folder, or one in the
    // library (an asset, a canvas card). The picture is named by the file's path, time and size.
    handle('pdf:page', async (where: unknown) => {
      const w = (where && typeof where === 'object' ? where : {}) as { project?: unknown; file?: unknown; rel?: unknown; version?: unknown };
      let abs: string;
      if (typeof w.project === 'string' && typeof w.file === 'string') {
        // A remote computer's PDF: its first page drawn once from its bytes (read through the former host app), kept by
        // its version.
        const remote = remoteOf(w.project);
        if (remote) {
          const version = typeof w.version === 'string' ? w.version.slice(0, 80) : '';
          const size = Number(version.split(':')[1]) || 0;
          const file = w.file;
          return pdfThumbs.remotePage(`${remote.computer}:${remote.path}/${file}`, version, size, () => projectFolders.bytes(remote, file));
        }
        const folder = pcFolderOf(w.project);
        // A remote project's PDF shows its kind's picture in the grid (its pages are drawn in the viewer).
        if (!folder) return { failed: true };
        abs = insideFolder(folder, w.file);
      } else abs = requireVault().absolute(w.rel);
      try {
        return await pdfThumbs.page(abs);
      } catch {
        return { failed: true };
      }
    });
    handle('pdf:save', (key: unknown, data: unknown) => pdfThumbs.save(key, data));
    // A whole PDF in the notes, for the reader (views/pdf/PdfView.tsx; 19 Oct 2026, 5.0.0): its bytes go to the window,
    // which draws its pages with PDF.js, so it reads the same offline and on every PC. Only PDFs, and not giant ones.
    handle('pdf:bytes', async (rel: unknown) => {
      const abs = requireVault().absolute(rel);
      if (!/\.pdf$/i.test(abs)) throw new Error('Only PDFs open here.');
      const stat = await fsp.stat(abs);
      if (stat.size > 512 * 1024 * 1024) throw new Error('This PDF is too big to open here. Open it in its default app.');
      if (stat.size === 0) throw new Error('This file is empty. There is nothing to show.');
      const buf = await fsp.readFile(abs);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    });
    // A first-page picture of a PDF or slides, made by Windows (or macOS) itself; none elsewhere, or when it can't.
    handle('project:thumb', async (rel: unknown, file: unknown): Promise<string | null> => {
      if (process.platform !== 'win32' && process.platform !== 'darwin') return null;
      const folder = pcFolderOf(rel);
      if (!folder || typeof file !== 'string' || !/\.(pdf|pptx?|odp)$/i.test(file)) return null;
      const abs = insideFolder(folder, file);
      let key: string;
      try {
        key = `${abs}|${(await fsp.stat(abs)).mtimeMs}`;
      } catch {
        return null;
      }
      if (thumbs.has(key)) return thumbs.get(key)!;
      let url: string | null = null;
      try {
        const image = await nativeImage.createThumbnailFromPath(abs, { width: 360, height: 360 });
        const size = image.getSize();
        url = !image.isEmpty() && size.width >= 48 && size.height >= 48 ? image.toDataURL() : null;
      } catch {
        url = null;
      }
      if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
      thumbs.set(key, url);
      return url;
    });
    // A project by hand (Projects home, the Templates page): its shape from a project template (Templates/Projects), its
    // next steps, key dates and risks ready to change; without one, just the name.
    handle('project:create', (name: unknown, folder: unknown, template: unknown, area: unknown) => createProject(name, folder, template, area));
    // Docs (src/main/docs.ts): a project that is really documentation turned into a doc in place (every word kept, its
    // canvas re-pointed, links sent on, the project and its pages to the Bin), a doc turned into a project, a new
    // doc (from a doc template or blank), and Undo of a conversion.
    handle('docs:to-doc', async (rel: unknown) => {
      await requireCreate();
      return docsService.projectToDoc(cleanRel(rel));
    });
    handle('docs:to-project', async (rel: unknown) => {
      await requireCreate();
      return docsService.docToProject(cleanRel(rel));
    });
    handle('docs:undo', async (rel: unknown) => {
      await requireCreate();
      return docsService.undo(cleanRel(rel));
    });
    handle('docs:create', async (name: unknown, template: unknown) => {
      await requireCreate();
      let text: string | undefined;
      if (typeof template === 'string' && template) {
        const t = await readTemplate(template);
        const { dateFormat, timeFormat } = settings.raw.prefs;
        const title = typeof name === 'string' ? name.trim() : 'Untitled doc';
        text = noteFromTemplate(t.text, { title, dateFormat, timeFormat }).replace(/^type:\s*["']?doc-template["']?\s*$/m, 'type: doc');
      }
      return docsService.create(typeof name === 'string' ? name : 'Untitled doc', text);
    });
    // Templates: the Templates page, a note made from one, a note saved as one, a new one, the ready-made ones back.
    handle('templates:list', () => ({ folder: templatesRoot(), templates: templatesList(), groups: GROUPS, daily: dailyTemplatePath() }));
    handle('templates:missing', async () => {
      const root = templatesRoot();
      if (!vault || !root) return [];
      return (await missingBuiltIns(templateStore(vault), root, await templateRecord(vault))).map((b) => b.name);
    });
    handle('templates:restore', async () => {
      await requireCreate();
      return (await ensureTemplates({ restore: true })).length;
    });
    handle('templates:use', (template: unknown, name: unknown, folder: unknown, project: unknown) => noteFromTemplateFile(template, name, folder, project));
    // Template fields (src/shared/template-fields.ts; 21 Oct 2026, gap G27): a note made with its prompts' answers, its
    // cursor's place given back; and the AI fields written by the assistant on the model the former host app set up,
    // from the note's name, its project and the answers only (never a private note's, never anything run). "Capture
    // to…" (src/main/capture-flows.ts; 21 Oct 2026, gap G27): a line added with the time to a flow's place.
    handle('capture-flow:add', (id: unknown, text: unknown, project: unknown) =>
      captureToFlow(
        {
          flows: () => settings.raw.prefs.captureFlows,
          readNote: async (rel) => index.content(rel) ?? (await requireVault().read(rel).catch(() => null)),
          writeNote: (rel, words) => writeNote(rel, words),
          dailyNote: () => openDailyNote(),
          projectName: (p) => (isProjectProps(index.get(p)?.props) ? projects.view(p).project.name : null),
          requireCreate,
        },
        id,
        text,
        project,
      ),
    );
    handle('templates:make', (template: unknown, name: unknown, folder: unknown, project: unknown, answers: unknown) => makeFromTemplate(template, name, folder, project, answers));
    handle('templates:ai', async (template: unknown, info: unknown) => {
      const { text } = await readTemplate(template);
      const asks = templateFields(text).ai;
      if (!asks.length) return { fields: {} };
      const i = (info && typeof info === 'object' ? info : {}) as { title?: unknown; project?: unknown; answers?: unknown; target?: unknown };
      if (typeof i.target === 'string' && isPrivatePath(i.target)) return { fields: {}, error: 'This note is private, so nothing in it goes to the assistant.' };
      const p = typeof i.project === 'string' && isProjectProps(index.get(i.project)?.props) ? projects.view(i.project).project : null;
      const user = aiFieldsPrompt({ asks, title: String(i.title ?? '').slice(0, 200) || 'Untitled', project: p?.name, projectSummary: p?.summary, answers: cleanAnswers({ prompts: i.answers }).prompts, today: formatDate('dddd D MMMM YYYY') });
      const { reply, error } = await ai.askJson(AI_FIELDS_SYSTEM, user, 90_000, 1500);
      const fields = readAiFields(reply, asks);
      return { fields, ...(error ? { error } : Object.keys(fields).length ? {} : { error: 'The assistant didn’t fill them in.' }) };
    });
    handle('templates:save-as', (note: unknown, name: unknown, description: unknown) => saveAsTemplate(note, name, description));
    handle('templates:create', (group: unknown, name: unknown) => newTemplate(group, name));
    // ── Project canvases (src/shared/project-canvas.ts): a card edited on a project's canvas writes the project file;
    // files dropped on it are copied into the project's folder on the PC (never moved; the original stays).
    handle('project:canvas-edit', async (rel: unknown, edit: unknown) => {
      await requireCreate();
      const file = cleanRel(rel);
      const before = index.content(file);
      const { after } = projects.changed(file, (p: Project) => {
        applyItemEdit(p, edit);
        p.updated = formatDate('YYYY-MM-DD');
      });
      await ai.agentHost!.write(file, after);
      // In the project's one history, as the page's own changes are: Undo on the page takes a canvas change back too.
      if (before !== undefined) projectHistory.record(file, { before, after: index.content(file) ?? after, words: 'Changed on the canvas', by: 'you' });
      return projects.view(file);
    });
    handle('project:add-files', async (rel: unknown, paths: unknown) => {
      await requireCreate();
      const w = remoteOf(rel);
      if (w) throw new Error(`This project’s folder is on ${projectFolders.remote.nameOf(w)}, which Ironleaf reads but doesn’t change: put files there on that computer.`);
      const p = projects.view(cleanRel(rel)).project;
      if (!p.folder) throw new Error(projects.view(cleanRel(rel)).place?.state === 'elsewhere' ? 'This project’s folder is on another PC. Choose its folder on this PC on its page, then drop the files again.' : 'This project has no folder on this PC yet.');
      if (!(await fsp.stat(p.folder).catch(() => null))?.isDirectory()) throw new Error('The project’s folder isn’t on this PC any more.');
      const taken = new Set(await fsp.readdir(p.folder).catch(() => [] as string[]));
      const copied: string[] = [];
      for (const raw of Array.isArray(paths) ? paths.slice(0, 200) : []) {
        if (typeof raw !== 'string' || !path.isAbsolute(raw)) continue;
        const stat = await fsp.stat(raw).catch(() => null);
        if (!stat?.isFile()) continue;
        // Already in the project's folder: shown where it is, never copied again.
        const within = path.relative(path.resolve(p.folder), path.resolve(raw));
        if (within && !within.startsWith('..') && !path.isAbsolute(within)) {
          copied.push(within.split(path.sep).join('/'));
          continue;
        }
        const name = copyTarget(path.basename(raw), taken);
        await fsp.copyFile(raw, insideFolder(p.folder, name), fsConstants.COPYFILE_EXCL);
        taken.add(name);
        copied.push(name);
      }
      return copied;
    });
    // Meetings, and the weekly review (src/main/reviews.ts).
    handle('meetings:context', (rel: unknown) => reviews.meetingContext(cleanRel(rel)));
    handle('meetings:find-more', async (rel: unknown, text: unknown) => {
      await requireCreate();
      return reviews.findMore(cleanRel(rel), typeof text === 'string' ? text.slice(0, 200_000) : '');
    });
    handle('reviews:status', () => reviews.status());
    handle('reviews:put-off', () => reviews.putOff());
    handle('reviews:draft', () => reviews.draft());
    handle('reviews:look-over', async (draft: unknown) => {
      await requireCreate();
      return reviews.lookOver(draft as Parameters<Reviews['lookOver']>[0]);
    });
    handle('reviews:apply', async (draft: unknown) => {
      await requireCreate();
      return reviews.apply(draft as Parameters<Reviews['apply']>[0]);
    });
    handle('reviews:undo', async (id: unknown) => {
      await requireCreate();
      return typeof id === 'string' ? reviews.undo(id) : 'There’s nothing to undo for that now.';
    });
    // The vault tidy (t238, Settings › Backups and sync, off until turned on): a preview first (a dry run,
    // nothing written), then a run on a copy beside the vault. The open vault is never touched.
    handle('vault:tidy-preview', () => previewVault(index));
    handle('vault:tidy-copy', async () => {
      await requireCreate();
      const root = vault?.root;
      if (!root) throw new Error('Your notes are not open.');
      return tidyCopyTo(root);
    });
    handle('ai:apply-proposal', async (id: unknown) => {
      await requireCreate();
      return typeof id === 'string' ? ai.applyProposal(id) : { ok: false, words: 'That proposal isn’t here any more.' };
    });
    // Undo under an answer is the person's own change (the earlier versions say "You").
    handle('ai:pack-preview', async (root: string, path: string, page: number) => {
      const v = requireVault();
      if (root !== v.root || typeof path !== 'string' || !/\.md$/i.test(path)) throw new Error('Choose a note in this folder.');
      const rel = cleanNotePath(path);
      const gate = makeGate(sensitivity, 'side-chat', 'The side chat');
      gate.check(rel);
      const content = await v.read(rel);
      if (v !== vault) throw new Error('Return to the original notes folder.');
      gate.check(rel);
      gate.note(rel, 'read', 'pack action source preview');
      return notePage(rel, content, page, 2400);
    });
    handle('ai:pack-action', async (root: unknown, name: unknown, args: unknown) => {
      if (root !== requireVault().root || typeof root !== 'string' || typeof name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Review the pack action in the current notes folder.');
      await requireCreate();
      return writer.run('assistant', () => ai.runPackAction(root, () => vault?.root, name, args as Record<string, unknown>));
    });
    handle('ai:pack-undo', async (id: string) => {
      await requireCreate();
      return writer.run('you', () => ai.undoPackAction(requireVault().root, id));
    });
    handle('ai:undo', async (turnId: unknown) => {
      await requireCreate();
      return typeof turnId === 'string' ? writer.run('you', () => ai.undo(turnId)) : 'There is nothing to undo.';
    });
    handle('ai:chat-cancel', (requestId: unknown) => {
      if (typeof requestId === 'string') chatControllers.get(requestId)?.abort();
    });
    handle('ai:suggest-links', async (rel: string, content: unknown) => {
      await requireCreate();
      requireVault();
      return ai.suggestLinks(rel, typeof content === 'string' ? content : '');
    });

    // Recently deleted (8.0 U13): the one list both apps share, drawn on the vault's own page (views/BinView.tsx).
    // On its own (no former host app) the page reads the vault's own Bin here, in the same shape, so a person's
    // deletes are listed with Restore however the vault runs.
    handle('bin:available', () => true);
    handle('bin:call', async (input: unknown) => {
      const i = (input ?? {}) as Record<string, unknown>;
      const action = ['list', 'restore', 'purge', 'empty'].includes(String(i.action)) ? String(i.action) : 'list';
      if (!hostBin?.call) {
        if (action === 'list') {
          const kindWords: Record<string, string> = { note: 'Note', canvas: 'Canvas', view: 'View', file: 'File', folder: 'Folder' };
          const others = (await binList()).map((it) => ({ type: 'vault', id: it.id, app: 'vault', kind: it.kind === 'folder' ? 'folder' : it.kind === 'note' ? 'note' : 'file', kindWords: kindWords[it.kind] ?? 'File', title: it.title, detail: `Ironleaf · ${it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : 'the vault'}${it.by && it.by !== 'You' ? ` · taken out by ${it.by}` : ''}`, where: it.path, deletedAt: it.at, daysLeft: it.daysLeft }));
          return { items: [], others, keepDays: KEEP_DAYS };
        }
        if (action === 'restore' && typeof i.id === 'string') {
          const r = await binRestore(i.id);
          void refreshAfterRestore();
          return r;
        }
        if (action === 'purge' && typeof i.id === 'string') return binForget(i.id);
        if (action === 'empty') return binEmpty();
        throw new Error('That isn’t in Recently deleted.');
      }
      const result = await hostBin.call({ action, ...(typeof i.id === 'string' ? { id: i.id } : {}), ...(typeof i.type === 'string' ? { type: i.type } : {}), ...(typeof i.sessionId === 'string' ? { sessionId: i.sessionId } : {}) });
      if (action === 'restore') void refreshAfterRestore();
      return result;
    });
    // Notebook mode (src/main/notebook.ts; 21 Oct 2026): a folder's sources, cited answers, the Studio, flashcard reviews.
    const notebook = registerNotebook({
      handle,
      requireCreate,
      vault: requireVault,
      index,
      ai,
      readFile: (abs, ext, size) => readFileText(abs, ext, size, { pdf: pdfReader, ...(host.readDocument ? { bridge: (file: string) => host.readDocument!(file) } : {}) }),
      // A note as the person's own change; a mind map's canvas made new (never over a file there).
      writeNote: async (rel, text) => {
        if (kindOf(rel) === 'note') return writeNote(rel, text);
        const v = requireVault();
        await v.createText(rel, text);
        notifyChanged([rel]);
        filesChanged();
      },
      freeName: (folder, base, ext) => uniqueRel(requireVault(), folder, base, ext),
      skip: (rel) => {
        const t = (settings.raw.prefs.templatesFolder || '').toLowerCase();
        return (!!t && rel.toLowerCase().startsWith(`${t}/`)) || index.isExcluded(rel);
      },
      // Find sources: The former host app's browser search, handed over as the assistant hands work over (unattended
      // there).
      ...(host.neuralSparkJob && host.neuralSparkJobStatus
        ? {
            job: async (brief: string) => {
              await requireCreate();
              const started = await host.neuralSparkJob!({ agent: { agentId: 'neuralvault-assistant', agentName: 'Ironleaf', level: 'full', where: 'this-pc' }, brief, from: 'assistant' });
              return { conversationId: started.conversationId };
            },
            jobStatus: (id: string) => host.neuralSparkJobStatus!(id),
          }
        : {}),
      today: () => formatDate('YYYY-MM-DD', new Date()),
    });
    // Today's calendar (src/main/calendar.ts): The former host app's answer, checked; nothing at all on Ironleaf's own,
    // except a made-up day for a development build's screen tests (NV_TEST_CALENDAR, never set in the product). Kept a
    // minute, so the calendar and the brief opening together ask the former host app once.
    let calendarKept: { at: number; value: Promise<CalendarToday> } | null = null;
    const calendarNow = (): Promise<CalendarToday> => {
      if (calendarKept && Date.now() - calendarKept.at < 60_000) return calendarKept.value;
      const value = calendarToday({
        ...(host.calendarToday ? { ask: () => host.calendarToday!() } : {}),
        ...(!app.isPackaged && host.kind === 'standalone' && process.env.NV_TEST_CALENDAR ? { testFile: process.env.NV_TEST_CALENDAR } : {}),
        log: (m) => host.log?.(m),
      });
      calendarKept = { at: Date.now(), value };
      return value;
    };
    handle('calendar:today', () => calendarNow());
    // Two-way sync (8.9): the calendars, events across days, and writes, each through the former host app when
    // there. A development build's screen tests stand in files (NV_TEST_CALENDAR_LIST, NV_TEST_CALENDAR_RANGE).
    // Kept half a minute, so the week opening with the month asks once.
    const devStandalone = !app.isPackaged && host.kind === 'standalone';
    let listKept: { at: number; value: Promise<CalendarList> } | null = null;
    const listNow = (): Promise<CalendarList> => {
      if (listKept && Date.now() - listKept.at < 30_000) return listKept.value;
      const value = calendarList({
        ...(host.calendarList ? { ask: () => host.calendarList!() } : {}),
        ...(devStandalone && process.env.NV_TEST_CALENDAR_LIST ? { testFile: process.env.NV_TEST_CALENDAR_LIST } : {}),
        log: (m) => host.log?.(m),
      });
      listKept = { at: Date.now(), value };
      return value;
    };
    handle('calendar:list', () => listNow());
    const rangeKept = new Map<string, { at: number; value: Promise<CalendarRange> }>();
    handle('calendar:range', async (from: unknown, to: unknown) => {
      const f = typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '';
      const t = typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : '';
      if (!f || !t || t < f) return { connected: false, reason: 'unavailable' } as CalendarRange;
      const key = `${f}/${t}`;
      const kept = rangeKept.get(key);
      if (kept && Date.now() - kept.at < 30_000) return kept.value;
      const value = calendarRange({
        ...(host.calendarRange ? { ask: () => host.calendarRange!({ from: f, to: t }) } : {}),
        ...(devStandalone && process.env.NV_TEST_CALENDAR_RANGE ? { testFile: process.env.NV_TEST_CALENDAR_RANGE } : {}),
        log: (m) => host.log?.(m),
      });
      rangeKept.set(key, { at: Date.now(), value });
      if (rangeKept.size > 12) for (const k of [...rangeKept.keys()].slice(0, rangeKept.size - 12)) rangeKept.delete(k);
      return value;
    });
    handle('calendar:write', async (args: unknown) => {
      const a = (args && typeof args === 'object' ? args : {}) as { op?: unknown; calendarId?: unknown; eventId?: unknown; event?: unknown };
      const op = a.op === 'create' || a.op === 'update' || a.op === 'delete' ? a.op : null;
      const calendarId = typeof a.calendarId === 'string' ? a.calendarId.trim().slice(0, 200) : '';
      const eventId = typeof a.eventId === 'string' ? a.eventId.trim().slice(0, 200) : '';
      const e = (a.event && typeof a.event === 'object' ? a.event : {}) as Record<string, unknown>;
      const event = op === 'delete' ? undefined : { title: typeof e.title === 'string' ? e.title.trim().slice(0, 300) : '', start: typeof e.start === 'string' ? e.start.trim().slice(0, 40) : '', end: typeof e.end === 'string' ? e.end.trim().slice(0, 40) : '', allDay: e.allDay === true, location: typeof e.location === 'string' ? e.location.trim().slice(0, 300) : '' };
      if (!op || !calendarId || (op !== 'create' && !eventId) || (op !== 'delete' && !event?.title)) return { ok: false, words: 'That change was missing its details. Try again.' } as CalendarWrite;
      const done = await calendarWrite(host.calendarWrite ? () => host.calendarWrite!({ op, calendarId, ...(eventId ? { eventId } : {}), ...(event ? { event } : {}) }) : undefined);
      listKept = null;
      rangeKept.clear();
      calendarKept = null;
      return done;
    });

    // The morning brief on Today (src/main/brief.ts; 21 Oct 2026, gap G20): from the notes on this PC, the calendar, and
    // the former host app's overnight finds when it is there (a development build's screen tests may stand in a file for
    // them: NV_TEST_BRIEF, never set in the product). "Not useful" is remembered for this vault in Ironleaf's own data.
    const testBrief = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_BRIEF : '';
    registerBrief({
      handle,
      due: () => hub.due(),
      today: () => todayData(index, undefined),
      calendar: calendarNow,
      decks: () => notebook.dueDecks(),
      // People gone quiet, each with a drafted check-in (10.0 v2locked): the same served cards as People,
      // so a work person's draft never carries health words (t21, 8 Nov 2026).
      people: () => {
        const model = recordModel();
        const propsOf = (p: string) => index.get(p)?.props;
        const places = { templatesFolder: settings.raw.prefs.templatesFolder, assetsFolder: settings.raw.prefs.assetsFolder };
        return quietBriefPeople(personCards(model, propsOf).map((c) => purposefulCard(c, { model, propsOf, areas: areasNow(), places })));
      },
      meetingNotes: () => {
        const out: Record<string, string> = {};
        for (const m of index.allMeta()) {
          const id = m.props?.['calendar-event'];
          if (typeof id === 'string' && id) out[id] = m.path;
        }
        return out;
      },
      // The brief is made from the notes alone; a development build's screen tests may stand a file in for outside finds.
      ...(testBrief ? { found: async () => JSON.parse(await fsp.readFile(testBrief, 'utf8')) } : {}),
      load: async () => (vault ? state.load(vault.root, 'brief') : null),
      save: async (value) => {
        if (vault) await state.save(vault.root, 'brief', value);
      },
      log: (m) => host.log?.(m),
      // Money that warns early (10.0 v2money): the brief's money lines from the Finance module, null while off.
      money: () => (vault ? recordModules.briefMoney() : null),
    });

    // The meeting recorder (src/main/meeting-recorder.ts; 21 Oct 2026, gap G18): pieces of a recording written down by
    // the former host app, the notes made on Ironleaf's model, and the window allowed the microphone (and on Windows
    // the PC's sound) when a recording starts. A development build's screen tests may stand in a file for what each
    // piece says (NV_TEST_TRANSCRIPT) and cut shorter pieces (NV_TEST_PIECE_SECONDS); neither is ever set in the
    // product.
    const testTranscript = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_TRANSCRIPT : '';
    const testPiece = !app.isPackaged && host.kind === 'standalone' ? Number(process.env.NV_TEST_PIECE_SECONDS) : NaN;
    // The PC's sound on Linux, for a development build's screen tests only (Chromium's fake devices stand in for it).
    const testSystemAudio = !app.isPackaged && host.kind === 'standalone' && process.env.NV_TEST_SYSTEM_AUDIO === '1';
    const recorderDeps: RecorderDeps = {
      handle,
      requireCreate,
      askJson: (system, user, timeoutMs, maxTokens, opts) => ai.askJson(system, user, timeoutMs, maxTokens, opts),
      ...(models.transcribe && !testTranscript ? { transcribe: (audio: Uint8Array, mime: string, hints?: string[], opts?: { signal?: AbortSignal; language?: string }) => models.transcribe!(audio, mime, hints, opts) } : {}),
      ...(models.transcribeStatus && !testTranscript ? { transcribeStatus: async () => models.transcribeStatus!() } : {}),
      ...(testTranscript ? { testLines: async () => JSON.parse(await fsp.readFile(testTranscript, 'utf8')) as unknown[] } : {}),
      prepare: () => {
        const page = pageContents();
        if (!page) return;
        allowRecording({
          contents: page as never,
          fromFrame: (frame) => webContents.fromFrame(frame as never),
          screens: () => desktopCapturer.getSources({ types: ['screen'] }),
          platform: process.platform,
          systemAudio: process.platform === 'win32' || testSystemAudio,
          othersAllowed: true,
        });
      },
      platform: process.platform,
      systemAudio: testSystemAudio,
      dataDir: host.dataDir,
      saveFile: async (name, file, forNote) => {
        const v = requireVault();
        const { base, ext } = splitName(cleanFileName(name, 'Recording.m4a'));
        const rel = await uniqueRel(v, attachmentsFolder(forNote), base, ext.toLowerCase());
        await v.writeBinary(rel, new Uint8Array(await fsp.readFile(file)));
        await refreshFiles(v);
        filesChanged();
        void vaultFiles.recordAdded(rel, { source: { by: 'you', how: 'recording', at: new Date().toISOString() }, ...(forNote ? { record: forNote } : {}), describe: 'later' }).catch(() => {});
        return rel;
      },
      ...(testPiece >= 2 && testPiece <= 120 ? { pieceSeconds: testPiece } : {}),
      // The extra far-side capture (m6, a call on any output): its contained child runs as a utility process, so a
      // crash there is an exit — never the app or the recording. Off Windows the manager reports it absent.
      extra: {
        here: __dirname,
        fork: (childPath, vendorPath) => {
          const proc = utilityProcess.fork(childPath, [vendorPath], { serviceName: 'Ironleaf extra audio capture' });
          return {
            on: (event: 'message' | 'exit' | 'error', fn: (...args: any[]) => void) => {
              // No 'error' on a utility process (a failed spawn exits); the manager treats an exit the same.
              if (event === 'message') proc.on('message', (message: unknown) => fn(message));
              else if (event === 'exit') proc.on('exit', (code: number) => fn(code));
            },
            send: (msg: unknown) => proc.postMessage(msg),
            kill: () => void proc.kill(),
          };
        },
        send,
      },
    };
    registerRecorder(recorderDeps);

    // The meeting's voices (src/main/meeting-speakers.ts; 6 Nov 2026, speakers): each voiced piece-side heard live,
    // one final pass over the kept speech settling them, and earlier meetings re-run from their kept recordings.
    // Free, on this PC: its models ship with the app and run in a worker of their own. A development build's screen
    // tests may stand in fixed voices (NV_TEST_SPEAKERS); never set in the product.
    {
      const testVoices = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_SPEAKERS : '';
      registerSpeakerEngine({
        handle,
        dataDir: host.dataDir,
        mainDir: __dirname,
        log: (m) => host.log?.(m),
        ...(testVoices
          ? {
              runner: () => ({
                embed: async () => Float32Array.from({ length: 512 }, (_, i) => ((testVoices.charCodeAt(i % testVoices.length) % 7) - 3) / 4),
                diarize: async (samples: Float32Array, opts: { side: 'mic' | 'pc' | 'mix' }) => {
                  const seconds = samples.length / 16000;
                  const half = Math.round(seconds / 2);
                  return {
                    turns: [
                      { id: 'spk1', start: 0, end: half, side: opts.side },
                      { id: 'spk2', start: half, end: Math.round(seconds), side: opts.side },
                    ],
                    voices: 2,
                  };
                },
                close: async () => {},
              }),
            }
          : {}),
      });
    }

    // Backup and sync (src/main/backup.ts; 21 Oct 2026, gap G28): a Git history of the notes pushed to a remote the
    // person chooses (inside the former host app signing in with its Git accounts), and an end-to-end encrypted copy in a
    // folder they pick, synced both ways. Settings for each vault are Ironleaf's own data, never the notes.
    backup = registerBackup({
      handle,
      send,
      root: () => vault?.root ?? null,
      dataDir: host.dataDir,
      load: async () => (vault ? state.load(vault.root, 'backup') : null),
      save: async (value) => {
        if (vault) await state.save(vault.root, 'backup', value);
      },
      ...(host.git ? { hostGit: () => host.git!() } : {}),
      device: deviceOf(host.dataDir),
      trash: (abs) => shell.trashItem(abs),
      changedOnDisk: () => filesChanged(),
      window: () => win,
    });

    // Ironleaf Sync (src/main/sync/service.ts, docs/SYNC.md): end-to-end encrypted sync through the Ironleaf account.
    const sealWith = { available: () => osProtect.available(), encrypt: (t: string) => osProtect.seal(t), decrypt: (b: Buffer) => osProtect.open(b) };
    syncService = registerSync({
      handle,
      send,
      dataDir: host.dataDir,
      device: thisPc,
      protect: sealWith,
      osTrash: (abs) => shell.trashItem(abs),
      applied: (rels, moves) => (vault && void rescan(vault).catch(() => {}), notifyChanged(rels, moves), filesChanged()),
      mayWrite: () => requireCreate().then(() => true, () => false),
      ...(!app.isPackaged && process.env.IRONLEAF_CLOUD_API ? { apiBase: process.env.IRONLEAF_CLOUD_API } : {}),
      ...(!app.isPackaged && process.env.IRONLEAF_SYNC_DEV_TOKEN ? { devToken: process.env.IRONLEAF_SYNC_DEV_TOKEN } : {}),
      log: (m) => host.log?.(m),
    });
    teamsService = registerTeams({ handle, send, dataDir: host.dataDir, protect: sealWith, sync: syncService.team, ...(!app.isPackaged && process.env.IRONLEAF_CLOUD_API ? { apiBase: process.env.IRONLEAF_CLOUD_API } : {}), log: (m) => host.log?.(m) });

    // Settings › Connect an AI and What agents did (src/main/agent-access.ts).
    handle('agents:state', () => agentAccess.state());
    handle('agents:local-mcp', (patch: unknown) => agentAccess.setLocalMcp(patch));
    handle('agents:local-mcp-token', async () => {
      await mcpHttp?.newToken();
      return agentAccess.state();
    });
    // Plugins, a first small door (8.9): Settings › Plugins, the palette's plugin commands, Home's plugin cards.
    handle('plugins:list', () => plugins.list());
    // Settings › Plugins opened (8.9 round 3): the example present the first time in any vault.
    handle('plugins:ensure', () => plugins.listWithExample());
    handle('plugins:set', (id: unknown, on: unknown) => {
      if (typeof id !== 'string' || typeof on !== 'boolean') throw new Error('That plugin can’t be switched.');
      return plugins.setOn(id, on);
    });
    handle('plugins:allow', (id: unknown) => {
      if (typeof id !== 'string') throw new Error('That plugin can’t be allowed.');
      return plugins.allow(id);
    });
    handle('plugins:remove', (id: unknown) => {
      if (typeof id !== 'string') throw new Error('That plugin can’t be removed.');
      return plugins.remove(id);
    });
    handle('plugins:run-command', (pluginId: unknown, commandId: unknown) => {
      if (typeof pluginId !== 'string' || typeof commandId !== 'string') throw new Error('That command can’t run.');
      return writer.run('you', () => plugins.runCommand(pluginId, commandId));
    });
    handle('plugins:cards', () => plugins.cards());
    handle('plugins:commands', () => plugins.commands());
    handle('plugins:undo', (id: unknown) => writer.run('you', () => plugins.undo(id)));
    handle('plugins:open-folder', async () => {
      const dir = plugins.dir();
      if (!dir) throw new Error('Open a vault first.');
      // With the example when first made (else an empty folder would keep the example from ever arriving).
      await plugins.ensureExample();
      await fsp.mkdir(dir, { recursive: true });
      const failed = await shell.openPath(dir);
      if (failed) throw new Error(failed);
    });
    handle('agents:undo', async (id: unknown) => {
      await requireCreate();
      return writer.run('you', () => agentAccess.undo(id));
    });
    // A delivered file opened or put away.
    handle('agents:seen', (id: unknown) => agentAccess.seenFile(id));

    // The right-click menu's actions: Chromium's own editing commands and spelling.
    handle('edit:command', (command: unknown, word: unknown) => {
      const wc = pageContents();
      if (!wc) return;
      switch (command) {
        case 'cut':
          return wc.cut();
        case 'copy':
          return wc.copy();
        case 'paste':
          return wc.paste();
        case 'paste-plain':
          return wc.pasteAndMatchStyle();
        case 'select-all':
          return wc.selectAll();
        case 'replace-misspelling':
          if (typeof word === 'string' && word.length < 100) wc.replaceMisspelling(word);
          return;
        case 'add-word':
          if (typeof word === 'string' && word.length < 100) wc.session.addWordToSpellCheckerDictionary(word);
          return;
      }
    });

    // Interface size (src/shared/interface-size.ts): the page asks for the size it has chosen (Settings › Appearance, or
    // a zoom command whose keys the person changed), and says while a canvas has the keys, so they zoom the canvas.
    handle('window:zoom', (factor: unknown) => applyInterfaceSize(nearestSize(factor)));
    handle('window:own-zoom', (on: unknown) => {
      ownZoomKeys = on === true;
    });

    // The window's own top band: Windows draws the buttons over it in the page's colours (as the former host app's
    // window does).
    handle('window:chrome', (colors: { background?: string; symbols?: string; height?: number }) => {
      if (!win || win.isDestroyed() || process.platform === 'darwin') return;
      const ok = (c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
      // The page's band is measured at its interface size; Windows' band is in screen units.
      const tall = typeof colors?.height === 'number' && colors.height >= 24 && colors.height <= 80 ? colors.height : 40;
      const height = Math.round(tall * (win.webContents.getZoomFactor() || 1));
      try {
        win.setTitleBarOverlay({ color: ok(colors?.background) ? colors.background : '#f2f4f7', symbolColor: ok(colors?.symbols) ? colors.symbols : '#1b2235', height });
      } catch {
        // Older Windows without the overlay: the system's own bar stays.
      }
    });
  }

  // The size of everything (5.0.0; src/shared/interface-size.ts): one of six sizes, kept in the preferences on this PC,
  // put on the window as it opens (before Ironleaf's page has read its settings, so it never opens at 100% and then
  // jumps), and stepped by Ctrl + plus, Ctrl + minus and Ctrl + 0 from anywhere in the window, standalone or inside The
  // former host app alike (this window is Ironleaf's own in both). The page is told, so Settings shows the new size.
  let ownZoomKeys = false;
  let sizeSaving: Promise<unknown> = Promise.resolve();
  function applyInterfaceSize(factor = settings.raw.prefs.zoom): number {
    const size = nearestSize(factor);
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.setZoomFactor(size);
      } catch {
        // A window on its way out: the next one takes the size as it opens.
      }
    }
    // The view shows the same size (one product step 1; the host puts its shared size on after every load).
    if (viewContents && !viewContents.isDestroyed()) {
      try {
        viewContents.setZoomFactor(size);
      } catch {
        // A view on its way out: the next show takes the size.
      }
    }
    return size;
  }
  let sizeAhead: number | null = null;
  function stepInterfaceSize(direction: -1 | 0 | 1): void {
    // A held key repeats faster than a file is written: each step goes on from the last one, and the saves follow in turn.
    const size = applyInterfaceSize(stepSize(sizeAhead ?? settings.raw.prefs.zoom, direction));
    sizeAhead = size;
    sizeSaving = sizeSaving
      .then(() => settings.update({ prefs: { zoom: size } }))
      .then((next) => {
        if (sizeAhead === size) sizeAhead = null;
        send('settings:changed', { ...next, host: host.kind, library: libraryPath() });
      })
      .catch((err) => {
        sizeAhead = null;
        host.log?.('Ironleaf could not keep the interface size: ' + (err instanceof Error ? err.message : String(err)));
      });
  }

  function buildMenu(): void {
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      // Open file… (21 Oct 2026, gap G26): a Markdown file from anywhere on the PC (its keys are the window's own).
      { label: 'File', submenu: [{ label: 'Open file…', accelerator: 'CmdOrCtrl+Shift+O', registerAccelerator: false, click: () => send('loose:pick', null) }, { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
      { role: 'editMenu' },
      // The size items step the same six sizes as the keys and Settings (Electron's own zoom roles would step their own).
      // Their keys are shown, not registered: the window's before-input-event has them (and leaves them to a canvas).
      { label: 'View', submenu: [{ label: 'Actual size', accelerator: 'CmdOrCtrl+0', registerAccelerator: false, click: () => stepInterfaceSize(0) }, { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', registerAccelerator: false, click: () => stepInterfaceSize(1) }, { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', registerAccelerator: false, click: () => stepInterfaceSize(-1) }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }])] },
      { role: 'windowMenu' },
      { role: 'help', submenu: [{ label: 'About Ironleaf', click: () => openAbout() }, { label: 'Check for updates…', click: () => openAbout({ check: true }) }, { label: 'What’s new', click: () => openAbout({ focus: 'whats-new' }) }] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  /** Where the window was and how big (or maximised), so it opens as it was left; never off every screen. */
  const windowFile = path.join(host.dataDir, 'window.json');
  function savedWindow(): { x?: number; y?: number; width: number; height: number; maximized: boolean } {
    const fallback = { width: 1400, height: 900, maximized: false };
    try {
      const v = JSON.parse(readFileSync(windowFile, 'utf8')) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown; maximized?: unknown };
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);
      const width = Math.max(900, n(v.width) ?? fallback.width);
      const height = Math.max(600, n(v.height) ?? fallback.height);
      const x = n(v.x);
      const y = n(v.y);
      // Its top-left corner area on a screen that is still there (a screen may have been unplugged).
      const onScreen = x !== null && y !== null && screen.getAllDisplays().some((d) => x + 100 > d.workArea.x && x < d.workArea.x + d.workArea.width - 100 && y >= d.workArea.y - 8 && y < d.workArea.y + d.workArea.height - 60);
      return { ...(onScreen ? { x: x!, y: y! } : {}), width, height, maximized: v.maximized === true };
    } catch {
      return fallback;
    }
  }
  let windowSaveTimer: NodeJS.Timeout | undefined;
  function rememberWindow(w: BrowserWindow): void {
    clearTimeout(windowSaveTimer);
    windowSaveTimer = setTimeout(() => {
      if (w.isDestroyed() || w.isMinimized()) return;
      const b = w.getNormalBounds();
      fsp.writeFile(windowFile, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() })).catch(() => {});
    }, 600);
  }

  /** One page's guards (one product step 1): the window's page and the view's page are wired the same — links open
   *  outside, the page never navigates away, no webview, and right-click draws the window's own menu. */
  function wirePage(contents: WebContents): void {
    // Links in notes and chat open in the system browser; the page never navigates away.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (url !== contents.getURL()) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    // Right-click: the window draws its own menu (spelling suggestions, cut, copy, paste, formatting).
    contents.on('context-menu', (_event, params) => {
      send('edit:context', {
        x: params.x,
        y: params.y,
        misspelled: params.misspelledWord || '',
        suggestions: (params.dictionarySuggestions || []).slice(0, 6),
        selection: (params.selectionText || '').slice(0, 2000),
        editable: params.isEditable,
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        link: params.linkURL || '',
      });
    });
  }

  /** One page's zoom keys, taken before the page sees them, except where Ironleaf already gives them a meaning (a canvas
   *  with the keys, or keys changed in Settings › Keys: the page runs those). The window steps its own size; the
   *  view steps the host's shared size (the interface size is the former host app's and Ironleaf follows it). */
  function wireZoomKeys(contents: WebContents, viaHost: boolean): void {
    contents.on('before-input-event', (event, input) => {
      const step = keyStep(input);
      if (step === null || ownZoomKeys || !mainTakesZoomKey(step, settings.raw.prefs.hotkeys)) return;
      event.preventDefault();
      if (viaHost && host.viewZoomStep) host.viewZoomStep(step);
      else stepInterfaceSize(step);
    });
  }

  function createWindow(): BrowserWindow {
    const place = savedWindow();
    const next = new BrowserWindow({
      ...(place.x !== undefined ? { x: place.x, y: place.y } : {}),
      width: place.width,
      height: place.height,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'Ironleaf',
      // Cool white before the page paints (8.6.1): Bright's page and side bar, never the old cream, until the page
      // tints the buttons itself.
      backgroundColor: '#ffffff',
      icon: host.icon,
      // No system title bar: Ironleaf's own top band drags the window, and the window buttons are drawn over it in the
      // page's colours (16 Oct 2026).
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { color: '#f2f4f7', symbolColor: '#1b2235', height: 40 } }),
      // The page both surfaces share (vault-view.ts; plugins: Chromium's own PDF viewer, for PDFs among the notes).
      webPreferences: viewWebPreferences(host.preload),
    });
    next.removeMenu();
    if (process.platform === 'win32') {
      try {
        next.setAppDetails({ appId: host.appId, appIconPath: host.icon, relaunchDisplayName: 'Ironleaf' });
      } catch {
        // The taskbar keeps the host's identity.
      }
    }
    next.on('ready-to-show', () => {
      if (place.maximized) next.maximize();
      next.show();
    });
    for (const e of ['resize', 'move', 'maximize', 'unmaximize'] as const) next.on(e as 'resize', () => rememberWindow(next));
    // What closed the window, in the log (19 Oct 2026: it closed by itself while the former host app made designs for a
    // job, and nothing said why): a close from code names its caller; one with no caller came from Windows or the
    // person.
    let closedBy = '';
    for (const name of ['close', 'destroy'] as const) {
      const own = next[name].bind(next);
      next[name] = (() => {
        closedBy = `${name}() from ${(new Error().stack ?? '').split('\n').slice(2, 7).map((l) => l.trim()).join(' < ')}`;
        own();
      }) as never;
    }
    // Interface size: put on as the page starts (the keys are wireZoomKeys above, shared with the view).
    next.webContents.on('dom-ready', () => {
      ownZoomKeys = false;
      try {
        next.webContents.setZoomFactor(nearestSize(settings.raw.prefs.zoom));
      } catch {
        // The page shows at 100% and asks for its size once it has read its settings.
      }
    });
    wireZoomKeys(next.webContents, false);
    let pageGone = '';
    next.webContents.on('render-process-gone', (_e, d) => (pageGone = `its page stopped (${d.reason}, exit ${d.exitCode})`));
    // A close from outside Ironleaf's code, told apart by Windows' own messages: the system close command comes from
    // the title bar's ×, Alt+F4 or the taskbar (the person); a bare close message from another program or Windows.
    let outside = '';
    let quitting = false;
    app.once('before-quit', () => (quitting = true));
    if (process.platform === 'win32') {
      try {
        next.hookWindowMessage(0x0112, (w: Buffer) => {
          if ((w.readUInt32LE(0) & 0xfff0) === 0xf060 && !outside) outside = 'the window’s close command (its ×, Alt+F4 or the taskbar)';
        });
        next.hookWindowMessage(0x0010, () => {
          if (!outside && !closedBy) outside = 'a close message from outside Ironleaf (another program or Windows)';
        });
      } catch {
        // Not hooked: the log says less.
      }
    }
    // Never loses an edit on the way out (F2): closing waits for the window to save everything first (notes, loose
    // files, layout), a few seconds at most; then the window goes whatever came back, and the log says if saves were
    // still waiting.
    let allowClose = false;
    let closing = false;
    next.on('close', (event) => {
      if (allowClose) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      void (async () => {
        // Only this window's page is asked (a view showing beside it answers for its own flush).
        if (!next.isDestroyed()) next.webContents.send(CHANNEL(CLOSE_REQUEST), null);
        const flushed = await closeHandshake((done) => {
          closeReady = done;
        }, VIEW_FLUSH_MS);
        closeReady = null;
        if (!flushed) host.log?.('Ironleaf window closed with saves still waiting.');
        // Kept in the tray instead (src/main/tray.ts): hidden, every edit saved, and the next close asks again.
        if (!next.isDestroyed() && (await host.tray?.keepOnClose(next).catch(() => false))) return void (closing = false);
        allowClose = true;
        closing = false;
        if (!next.isDestroyed()) next.close();
      })();
    });
    next.on('closed', () => {
      const why = closedBy || pageGone || (quitting ? 'the app quitting' : '') || outside || "not by Ironleaf's code, nor by a close message (its own page, or Windows ending it)";
      host.log?.(`Ironleaf window closed: ${why}`);
      if (win === next) win = null;
      // On its own Ironleaf closes with its window; inside the former host app it keeps running, and Quick capture
      // with it.
      if (host.kind === 'standalone') quickCapture.stop();
      secrets.clearClipboardNow();
      privateNotes.close();
      for (const fn of closedListeners) fn();
    });
    // Windows signing out (or shutting down) ends the remembered unlock for real (8.5): the sealed copy goes, so
    // the next sign-in asks again. A plain window close above only takes the words out of memory.
    next.on('session-end', () => privateNotes.lock());
    // (Links, navigation, webviews and right-click: wirePage above, shared with the view.)
    wirePage(next.webContents);
    if (host.renderer.devUrl) void next.loadURL(host.renderer.devUrl);
    else void next.loadFile(host.renderer.file);
    return next;
  }

  // Quick capture (src/main/capture.ts): the Windows-wide key and its box, filing through the same steps as the window.
  const quickCapture = new QuickCapture({
    kind: host.kind,
    dataDir: host.dataDir,
    preload: host.preload,
    renderer: host.renderer,
    icon: host.icon,
    prefs: () => settings.raw.prefs,
    setPrefs: async (patch) => {
      await settings.update({ prefs: patch });
    },
    ready: async () => {
      if (!vault) await openAtStart();
    },
    projects: async () => {
      const metas = index.allMeta();
      return Promise.all(
        projects.list().map(async (card) => {
          const p = hereProject(parseProject(index.content(card.path) ?? '', card.path));
          const dir = folderOf(card.path);
          // Its last change: the project's file or any note of its own.
          const modified = Math.max(card.modified, ...metas.filter((m) => dir && m.path.startsWith(`${dir}/`)).map((m) => m.mtime));
          const pcFolder = p.folder && (await fsp.stat(p.folder).catch(() => null))?.isDirectory() ? p.folder : null;
          const folderName = p.folder ? p.folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : undefined;
          return { path: card.path, name: p.name, ...(folderName ? { folderName } : {}), people: [...(p.owner ? [p.owner] : []), ...p.people.map((x) => x.name)], tags: p.tags, ...(p.status ? { status: p.status } : {}), modified, pcFolder };
        }),
      );
    },
    requireCreate,
    addNextStep: async (project, item) => {
      const result = await editProject(project, { kind: 'add', list: 'next', item }, undefined);
      const file = result.view.path;
      const step = projectHistory.peek(file);
      return {
        file,
        undo: async () => {
          if (!step || projectHistory.peek(file) !== step) return 'The project was changed since, so the next step was left in it. Remove it on the project’s page.';
          await projectStep(file, false);
        },
      };
    },
    readNote: async (rel) => index.content(rel) ?? (await requireVault().read(rel).catch(() => null)),
    writeNote,
    removeFile: async (rel) => {
      const v = requireVault();
      await fsp.rm(v.absolute(cleanRel(rel)), { force: true });
      index.delete(rel);
      void assets.removed([rel]);
      await refreshFiles(v);
      notifyChanged([rel]);
      filesChanged();
    },
    freeNote: async (folder, title) => uniqueRel(requireVault(), folder ? cleanRel(folder) : '', cleanFileName(title, 'Capture'), '.md'),
    dailyNote: () => openDailyNote(),
    dailyPath,
    attachmentsFor: (note) => attachmentsFolder(note),
    saveFile: async (folder, name, from) => {
      const v = requireVault();
      const { base, ext } = splitName(cleanFileName(name, 'File'));
      const dir = folder ? cleanRel(folder) : '';
      const rel = await uniqueRel(v, dir, base, ext);
      if (dir) await v.makeFolder(dir);
      if (typeof from === 'string') await fsp.copyFile(from, v.absolute(rel), fsConstants.COPYFILE_EXCL);
      else await fsp.writeFile(v.absolute(rel), from, { flag: 'wx' });
      await refreshFiles(v);
      notifyChanged([rel]);
      filesChanged();
      return rel;
    },
    addAssets: async (paths) => (await assets.add(paths, { duplicates: 'keep' })).added,
    removeAsset: async (rel) => {
      const v = requireVault();
      await fsp.rm(v.absolute(cleanRel(rel)), { force: true });
      await assets.removed([rel]);
      await refreshFiles(v);
      notifyChanged([rel]);
      filesChanged();
    },
    link: (rel, from) => newLink(rel, from),
    open: (target) => openWindow(target),
    log: (message) => host.log?.(message),
    // Quick capture dictates through the former host app too (its own dictate channels, below in
    // capture.ts).
    dictate: {
      ...(models.transcribe ? { transcribe: (audio: Uint8Array, mime: string, opts?: { signal?: AbortSignal }) => models.transcribe!(audio, mime, undefined, opts) } : {}),
      ...(models.transcribeStatus ? { transcribeStatus: async () => models.transcribeStatus!() } : {}),
      requireCreate,
    },
  });

  // Full control (src/main/agent-full.ts): what an agent may do beyond Jobs, through the steps the person's own pages use.
  const fullHost: FullHost = {
    readText: (rel) => requireVault().readText(cleanRel(rel)),
    writeText: async (rel, text) => {
      await requireCreate();
      const v = requireVault();
      const p = cleanRel(rel);
      if (kindOf(p) === 'note') return writeNote(p, text);
      const isNew = !(await v.any(p));
      await v.writeText(p, text);
      notifyChanged([p]);
      if (isNew) filesChanged();
    },
    isFolder: async (rel) => !!vault && (rel === '' || (await vault.isFolder(cleanRel(rel)))),
    move: async (from, to) => {
      await requireCreate();
      const r = await movePath(from, to, true);
      return { path: r.path, linksUpdated: r.linksUpdated };
    },
    makeFolder: async (rel) => {
      await requireCreate();
      await requireVault().makeFolder(cleanRel(rel));
      filesChanged();
    },
    trashPath: async (rel) => {
      await requireCreate();
      await trashRel(cleanRel(rel));
    },
    templateNote: (template, name, folder, project) => noteFromTemplateFile(template, name, folder, project),
    templateCreate: (group, name, content) => newTemplate(group, name, content),
    templateFromNote: (note, name, description) => saveAsTemplate(note, name, description),
    assets: {
      add: async (paths, options) => {
        await requireCreate();
        return assets.add(paths, options);
      },
      update: async (rel, patch) => {
        await requireCreate();
        return assets.update(rel, patch);
      },
      details: (rel) => assets.details(rel),
      brand: async () => (await assets.list()).brand,
      setBrand: async (brand) => {
        await requireCreate();
        return assets.setBrand(brand);
      },
    },
    reviewDraft: () => reviews.draft(),
    reviewApply: async (draft) => {
      await requireCreate();
      return reviews.apply(draft as Parameters<Reviews['apply']>[0]);
    },
    reviewUndo: async (id) => {
      await requireCreate();
      return reviews.undo(id);
    },
    download: async (url, name) => {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new Error('That isn’t a web address.');
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https addresses are fetched.');
      if (/^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i.test(u.hostname)) throw new Error('Addresses on this PC itself aren’t fetched.');
      const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(90_000) }).catch(() => null);
      if (!res || !res.ok || !res.body) throw new Error(`That address didn’t give a file${res ? ` (${res.status})` : ''}.`);
      const max = 100 * 1024 * 1024;
      if (Number(res.headers.get('content-length') ?? 0) > max) throw new Error('That file is larger than 100 MB.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader.cancel().catch(() => {});
          throw new Error('That file is larger than 100 MB.');
        }
        chunks.push(value);
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf' };
      let file = cleanFileName(name || decodeURIComponent(u.pathname.split('/').pop() || '') || 'Download', 'Download');
      if (!/\.[a-z0-9]{1,8}$/i.test(file) && EXT[type]) file += EXT[type];
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nv-asset-'));
      const out = path.join(dir, file);
      await fsp.writeFile(out, Buffer.concat(chunks));
      return out;
    },
  };

  // Life modules (Wave 5; src/main/modules.ts): Health and Fitness (its encrypted store on this PC, key protected by
  // Windows through safeStorage) and Family (notes in the Family area), off until switched on in Settings › Packs.
  // The end-to-end check on Linux only (never in the product, never on Windows): no keyring there, so Electron's own
  // stand-in protects the key and the store's sealing is proved all the same (tools/shots-modules.mjs).
  if (!app.isPackaged && host.kind === 'standalone' && process.platform === 'linux' && process.env.NV_TEST_PLAIN_KEYS === '1') {
    osProtect.allowFixedKey();
    await osProtect.ready();
  }
  const lifeModules = new Modules({
    handle,
    dataDir: host.dataDir,
    root: () => vault?.root ?? null,
    vaultKey: async (root) => (await readIdentity(root).catch(() => null))?.id ?? libraryKey(root),
    index,
    modules: () => settings.raw.prefs.modules,
    protector: {
      available: () => osProtect.available(),
      protect: (plain) => osProtect.seal(plain.toString('utf8')),
      unprotect: async (sealed) => Buffer.from(await osProtect.open(sealed), 'utf8'),
    },
    sensitivity,
    requireCreate,
    writeNote: (rel, text, by) => writeNote(rel, text, (by as VersionAuthor | undefined) ?? 'you'),
    readNote: async (rel) => (vault && (await vault.any(rel)) ? vault.read(rel) : null),
    exists: async (rel) => !!vault && (await vault.any(rel)),
    makeFolder: async (rel) => {
      const v = requireVault();
      if (!(await v.any(rel))) await v.makeFolder(rel);
      await refreshFiles(v);
      filesChanged();
    },
    trash: async (rel) => {
      await trashRel(cleanRel(rel));
    },
    ...(hostBin ? { bin: (item: { kind: string; title: string; detail?: string; ref?: unknown }) => hostBin.put(item) } : {}),
    files: async () => (vault ? (await vault.listAll()).files.map((f) => f.rel) : []),
    folders: async () => (vault ? (await vault.listAll()).folders : []),
    copyIn: async (paths, folder) => {
      const v = requireVault();
      const added: string[] = [];
      for (const raw of paths.slice(0, 500)) {
        const { base, ext } = splitName(cleanFileName(path.basename(raw), 'Photo'));
        const rel = await uniqueRel(v, folder, base, ext);
        if (folderOf(rel)) await v.makeFolder(folderOf(rel));
        await fsp.copyFile(raw, v.absolute(rel), fsConstants.COPYFILE_EXCL);
        added.push(rel);
      }
      await refreshFiles(v);
      notifyChanged(added);
      filesChanged();
      return added;
    },
    pickFiles: async (o) => {
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_PICK_FILES : '';
      if (testDir) return testDir.split(path.delimiter).filter(Boolean);
      const r = await showOpen({ title: o.title, filters: o.filters, properties: o.multi ? ['openFile', 'multiSelections'] : ['openFile'] });
      return r.canceled ? [] : r.filePaths;
    },
    pickSave: async (o) => {
      const testDir = !app.isPackaged && host.kind === 'standalone' ? process.env.NV_TEST_EXPORT_DIR : '';
      if (testDir) return path.join(testDir, o.name);
      const r = await showSave({ title: o.title, defaultPath: path.join(app.getPath('documents'), o.name), filters: o.filters });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    notify: (note) => {
      if (host.notify) return host.notify(note);
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: note.title, body: note.body, icon: host.icon });
      if (note.onClick) n.on('click', note.onClick);
      n.show();
    },
    openHealth: () => void openWindow().then(() => send('modules:open', 'health')),
    changed: (module) => send('modules:changed', module),
    log: (m) => host.log?.(m),
  });
  lifeModules.register();
  // Finance and Documents and ID's tools (src/main/record-modules.ts) go through the same one list (src/main/modules.ts).
  // The work modules' tools (Wave 6 part b, src/main/work-modules.ts) join them: the first that knows the tool answers.
  // Publications' tools (Wave 6 part a, src/main/publications.ts) are asked first, then the work modules', then Finance's.
  lifeModules.setDelegate({ call: async (name, args, ctx) => (await publications.callTool(name, args, ctx.gate)) ?? (await workModules.callTool(name, args, ctx.gate)) ?? (await lifeRecords.callTool(name, args, ctx.gate)) ?? (await personal.callTool(name, args, ctx.gate)) ?? recordModules.callTool(name, args, ctx.gate), rules: () => [recordModules.rules(), workModules.rules(), lifeRecords.rules(), personal.rules(), publications.rules()].filter(Boolean).join('\n') });
  lifeModules.switched();
  // The side chat's module tools (through its own gate) and the rules it is told while a module is on.
  ai.modules = (g) => (g ? { specs: () => lifeModules.tools(), call: async (name, args, onSource) => {
    const result = await lifeModules.call({ gate: g }, name, args);
    for (const source of result.sources ?? []) onSource?.(source);
    return result.text;
  }, rules: () => lifeModules.rules() } : null);

  // Other AI apps (src/main/agent-access.ts): the local MCP server's calls and the side chat's catalogue, every change
  // through the same steps as the person's own (a project's edit with the agent's name in its history; notes kept in
  // File recovery), and what they did kept in Ironleaf's own data.
  // Connect an AI's local URL (src/main/mcp-http.ts), made once the command's connection is (below).
  let mcpHttp: McpHttpServer | null = null;
  // Skills (24 Nov 2026, phase 3; src/main/skills.ts): the built-in ones and the person's own from their notes, less those
  // switched off in Settings › AI › Skills. The side chat lists them in its instructions; every AI loads one with skill_use.
  const skillLibrary = new SkillLibrary(() => (vault ? index : null), () => settings.raw.prefs.skillsOff ?? []);
  const skillsHost = { list: () => skillLibrary.list(), home: () => skillsHome(index, areasNow().some((a) => a.id === 'library')) };
  ai.skills = () => skillLibrary.list();
  handle('skills:list', (): SkillsView => ({
    home: skillsHost.home(),
    skills: skillLibrary.every().map(({ skill, on, replaces }) => ({ name: skill.name, title: skillTitleOf(skill), about: skill.about ?? skill.description, source: skill.source, ...(skill.path ? { path: skill.path } : {}), on, replaces, files: skill.files.length })),
    problems: skillLibrary.problems(),
  }));
  // A skill someone published, brought into the notes (Settings' Add a skill): its SKILL.md, or the skill zipped.
  handle('skills:add', async (): Promise<{ name: string; path: string; skipped: string[] } | null> => {
    await requireCreate();
    const v = requireVault();
    const r = await showOpen({ title: 'Add a skill', buttonLabel: 'Add', properties: ['openFile'], filters: [{ name: 'Skills', extensions: ['md', 'zip', 'skill'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const pack = await packFrom(r.filePaths[0]);
    const folder = `${skillsHost.home()}/${pack.name}`;
    if (index.has(`${folder}/SKILL.md`)) throw new Error(`You already have a skill called ${pack.name} (${folder}). Remove or rename it first.`);
    const written: string[] = [];
    for (const [rel, data] of pack.files) {
      const target = cleanRel(`${folder}/${rel}`);
      if (!target || !target.startsWith(`${folder}/`)) continue;
      const abs = v.absolute(target);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, data, { flag: 'wx' });
      written.push(target);
    }
    for (const rel of written) if (/\.md$/i.test(rel)) await indexFile(v, rel);
    await refreshFiles(v);
    notifyChanged(written);
    filesChanged();
    return { name: pack.name, path: `${folder}/SKILL.md`, skipped: pack.skipped };
  });
  // A built-in skill's whole text, to start the person's own copy of it from (Settings' Make it mine).
  handle('skills:text', (name: string) => {
    const s = skillLibrary.every().find((e) => e.skill.name === name)?.skill;
    return s ? skillText(s.name, s.description, s.body) : null;
  });
  const agentAccess: AgentAccess = new AgentAccess({
    dataDir: host.dataDir,
    // The MCP-only tools' reads (src/main/mcp-tools.ts) and the local URL's view for Settings › Connect an AI.
    mcp: {
      versions: (rel) => recovery.versions(rel),
      version: (rel, id) => recovery.read(rel, id),
      bookmarks: async () => (vault ? state.load(vault.root, 'bookmarks') : null),
      command: () => (app.isPackaged ? process.env.APPIMAGE || process.execPath : null),
      httpView: (): LocalMcpHttpView | undefined => mcpHttp?.view(agentAccess.localMcpSettings().port ?? MCP_HTTP_PORT),
    },
    kind: host.kind,
    ready: async () => {
      if (!vault) await openAtStart();
    },
    library: () => vault?.root ?? null,
    index,
    notes: ai.agentHost!,
    projects: () => (vault ? projects.list() : []),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    editProject: async (rel, edits, by, words) => {
      const before = index.content(rel) ?? '';
      const result = await editProject(rel, edits, undefined, by, words);
      const file = result.view.path;
      return { file, words: result.words, before, after: index.content(file) ?? '' };
    },
    embed: embedForWrites,
    undoProject: async (file, step, words) => {
      const top = projectHistory.peek(file);
      if (top && top.before === step.before && top.after === step.after) {
        await projectStep(file, false);
        return;
      }
      await writeNote(file, step.before);
      projectHistory.record(file, { before: step.after, after: step.before, words, by: 'you' });
    },
    createProject: (name, template) => createProject(name, undefined, template),
    writeNote,
    trash: async (rel) => {
      await requireCreate();
      await trashRel(cleanRel(rel));
    },
    today: () => todayData(index, { path: dailyPath(), exists: index.has(dailyPath()) }),
    dailyPath,
    dailyNote: () => openDailyNote(),
    freeNote: async (folder, title) => uniqueRel(requireVault(), folder ? cleanRel(folder) : '', cleanFileName(title, 'Capture'), '.md'),
    prefs: () => ({ captureNoProject: settings.raw.prefs.captureNoProject, timeFormat: settings.raw.prefs.timeFormat, templatesFolder: settings.raw.prefs.templatesFolder }),
    areas: () => areasNow(),
    templates: () => templatesList(),
    skills: skillsHost,
    lastReview: async () => (await reviews.status()).last,
    person: () => (vault ? todayData(index, undefined).me : null),
    tidy: {
      list: async () => {
        const p = await tidy.get();
        return (p?.lines ?? []).filter((l) => l.status === 'waiting').map((l) => ({ id: l.id, title: l.title, detail: l.detail }));
      },
      apply: async (id: string) => {
        await requireCreate();
        return (await tidy.apply(id)).words;
      },
    },
    full: fullHost,
    // Files agents make, delivered into the project they are for (src/main/agent-files.ts).
    files: {
      target: (rel) => {
        const p = projects.view(cleanRel(rel)).project;
        if (p.folder && p.folder.trim()) return { kind: 'folder', folder: p.folder.trim() };
        const w = projectWhere(p);
        return { kind: 'library', folder: ownFilesFolder(cleanRel(rel)), ...(w?.kind === 'remote' ? { remoteName: projectFolders.remote.nameOf(w) } : {}) };
      },
      absolute: (rel) => (rel ? requireVault().absolute(cleanRel(rel)) : requireVault().root),
      addedToLibrary: async (rel) => {
        await requireCreate();
        const v = requireVault();
        if (kindOf(rel) === 'note') {
          // A note delivered by work handed over: its first version is the former host app's (or the agent's that
          // made it).
          const text = await indexFile(v, rel);
          if (text !== null) void recovery.keep(rel, text, { by: writer.getStore() ?? 'neuralspark' });
        }
        await refreshFiles(v);
        notifyChanged([rel]);
        filesChanged();
        syncFileIndex();
      },
      addedToFolder: (rel) => {
        fileIndex.touch(pcFolderOf(rel));
      },
      trashFile: async (abs) => {
        await shell.trashItem(abs);
        syncFileIndex();
      },
      attachmentsFor: (note) => attachmentsFolder(note),
      recorded: async (rel, o) => {
        await vaultFiles.recordAdded(rel, { source: { by: o.by, how: o.how, ...(o.from ? { from: o.from } : {}), at: new Date().toISOString() }, ...(o.record ? { record: o.record } : {}), ...(o.what ? { what: o.what } : {}), describe: 'later' });
      },
      newVersion: async (rel, src, o) => {
        const e = await vaultFiles.addVersion(rel, src, { source: { by: o.by, how: o.how, ...(o.from ? { from: o.from } : {}), at: new Date().toISOString() }, move: o.move });
        return e.version;
      },
      reference: (record, abs, o) => vaultFiles.reference({ record, path: abs, by: o.by, ...(o.what ? { what: o.what } : {}) }),
    },
    // A note's branded document printed for an AI (note_to_pdf, 5 Nov 2026): the same hidden window Export to PDF
    // prints through (src/main/brand-print.ts), so one document, one path.
    brandPrint: async (html: string) => {
      const { pdf, laidOut } = await brandPrinter.pdf(html);
      return { pdf, pages: laidOut.pages };
    },
    // A note designed by the person's AI for an AI's call (design_document, 22 Nov 2026): the Design studio's own loop.
    design: async (input, format) => {
      if (!models.effectiveChoice(settings.raw.model)) throw new Error('Designing needs an AI: choose one in Settings › AI.');
      const view = await designStudio.start(input, () => {}, AbortSignal.timeout(15 * 60_000));
      const { data } = await designStudio.file(view.id, view.formats.includes(format) ? format : 'pdf');
      return { data, ext: DESIGN_FORMATS[view.formats.includes(format) ? format : 'pdf'].ext, pages: view.pages, problems: view.problems };
    },
    changed: () => send('agents:changed', null),
    log: (m) => host.log?.(m),
    // Every call goes through its agent's gate (src/main/agent-gate.ts): the levels the person allows it.
    gate: (who, name) => makeGate(sensitivity, who, name),
    // Life modules' tools (Wave 5), offered while each module is on, every call through the agent's gate.
    modules: { tools: () => lifeModules.tools(), call: (gate, name, args) => lifeModules.call({ gate }, name, args) },
    // What files_find, tasks_list and calendar_get read (8.0 V1; src/shared/agent-reach.ts).
    fileCatalogue: async () => (vault ? vaultFiles.catalogue() : []),
    tasks: () => tasks.view(),
    calendar: () => calendarToday(host.calendarToday ? { ask: () => host.calendarToday!() } : {}),
  });
  agentAccess.load();
  // The one vault catalogue for the side chat (8.0 V1 and V6, src/shared/vault-tools.ts): every tool outside agents have
  // that the side chat has no tool of its own for (Today, tasks, the calendar, the timeline, where a file is, archiving a
  // project, templates, canvases, a meeting's actions into a project, assets…), carried out by the same handlers, through
  // the side chat's gate. Each note a call changes is kept with its text before, so the answer's Undo takes it back.
  ai.catalogue = (g) => ({
    // The side chat's own Bin tool (move_to_bin, over the same Bin) stands in for the former host app's served
    // one, so the Bin is one tool, not two; outside agents keep the served one.
    specs: () => [...catalogueFor('side'), ...sparkServed(host.sparkVault).filter((t) => t.name !== 'neuralvault_bin')],
    call: async (name, args) => {
      // The former host app's own vault tools (views, bulk, the Bin, records…): carried out there as the side chat, its
      // changes back. Routed by the checked list (sparkDefs: a known name with an object schema), never the raw list (8.0
      // V8).
      if (host.sparkVault && sparkDefs(host.sparkVault).some((t) => t.name === name)) {
        const r = await host.sparkVault.call('side-chat', 'The side chat', name, args);
        return { text: String(r?.text ?? ''), isError: r?.isError === true, changed: Array.isArray(r?.changed) ? r.changed : [] };
      }
      const { out, changed } = await recordingWrites(() => writer.run('assistant', () => agentAccess.asOwn({ id: 'assistant', name: 'Ironleaf’s assistant', consumer: 'side' }, g, name, args)));
      return { text: out.content.map((c) => c.text).join('\n'), isError: out.isError === true, changed };
    },
  });

  // Secrets, levels, the scanner, the audit trail and Private notes into levels, for the window (src/main/sensitive.ts);
  // The former host app's and the bots' requests for a Family-private photo become cards here.
  const sensitive = new SensitiveWork({
    dataDir: host.dataDir,
    index,
    sensitivity,
    secrets,
    privateNotes,
    root: () => vault?.root ?? null,
    canEdit: requireCreate,
    writeNote: (rel, text) => writeNote(rel, text),
    exists: async (rel) => !!vault && (await vault.any(rel)),
    files: async () => (vault ? (await vault.listAll()).files.filter((f) => f.kind !== 'note').map((f) => f.rel) : []),
    noteTypes: async () => {
      if (!vault) return [];
      const top = [...new Set(index.allMeta().map((m) => m.path.split('/')).filter((p) => p.length > 1).map((p) => p[0]))];
      return resolveTypes(readTypes(await readTypesFile(vault.root)).config, { topFolders: top, templatesFolder: settings.raw.prefs.templatesFolder }).filter((t) => !t.hidden && t.id !== 'note').map((t) => ({ id: t.id, name: t.name }));
    },
    changed: (what) => send('privacy:changed', what),
    log: (m) => host.log?.(m),
  });
  sensitivity.onChange(() => send('privacy:changed', 'privacy'));

  // Ironleaf from outside its window (src/main/external.ts; 21 Oct 2026, gap G26): the ironleaf command,
  // ironleaf:// links (each change asked about first) and Markdown files from anywhere on the PC.
  const registerHere = takesPlaces({
    platform: process.platform,
    packaged: app.isPackaged,
    testBuild: !!host.testBuild,
    forced: process.env.NV_REGISTER_WINDOWS === '1',
  });
  const external = new ExternalEntry({
    dataDir: host.dataDir,
    kind: host.kind,
    version: host.version ?? app.getVersion(),
    icon: host.icon,
    handle,
    send,
    window: () => (win && !win.isDestroyed() ? win : null),
    openWindow: (target) => openWindow(target),
    openSettingsAt: async (section: string, row?: string) => {
      await openWindow();
      const shaped = /^[a-z-]{2,20}$/.test(String(section)) ? section : 'general';
      const named = typeof row === 'string' && row.trim() ? row.trim().slice(0, 80) : undefined;
      send('agents:show', named ? { section: shaped, row: named } : shaped);
    },
    ready: async () => {
      if (!vault) await openAtStart();
    },
    vaultRoot: () => vault?.root ?? null,
    agents: agentAccess,
    readNote: async (rel) => index.content(rel) ?? (await requireVault().read(rel)),
    writeNote: (rel, text) => writeNote(rel, text),
    canWrite: requireCreate,
    dailyNote: () => openDailyNote(),
    freeNote: async (folder, title) => uniqueRel(requireVault(), folder ? cleanRel(folder) : '', cleanFileName(title, 'Untitled'), '.md'),
    notes: () => index.allMeta().map((m) => ({ path: m.path, content: index.content(m.path) ?? '' })),
    windowsEntry: registerHere ? { exe: process.execPath, launchArgs: host.launchArgs ?? [...(app.isPackaged ? [] : [path.resolve(process.argv[1] ?? '.')])] } : null,
    log: (m) => host.log?.(m),
  });
  mcpHttp = new McpHttpServer({ dataDir: host.dataDir, backend: () => external.mcpBackend(), log: (m) => host.log?.(m) });
  const syncMcpHttp = () => {
    const s = agentAccess.localMcpSettings();
    void mcpHttp!.sync({ on: s.on && !!s.http, port: s.port ?? MCP_HTTP_PORT }).then(() => send('agents:changed', null));
  };
  agentAccess.onLocalMcpChange(syncMcpHttp);
  setTimeout(syncMcpHttp, 0);

  await settings.load();
  index.setExcluded(settings.raw.prefs.excluded);
  index.setQuiet(settings.raw.prefs.quietFolders ?? []);
  // What another PC changed in the vault's settings and memories, or the former host app brought of the person's: read
  // again every 20 seconds (a small file's time looked at), and the window told.
  setInterval(() => {
    void settings.refresh().then((changed) => { if (changed) settingsArrived(); }, () => undefined);
    void state.refresh().then((names) => { if (names.length) send('state:changed', names); }, () => undefined);
  }, 20_000).unref?.();
  // The look the former host app has (5.2.0, widened one product step 4): taken at start, and whenever it's
  // changed there.
  const takeLook = async (look: { palette?: string; accent?: string; theme?: string; zoom?: number; density?: string } | null | undefined): Promise<boolean> => {
    if (!look) return false;
    const prefs = settings.raw.prefs;
    const patch: { palette?: string; accent?: string; theme?: string; zoom?: number; density?: string } = {};
    if (look.palette && look.palette !== prefs.palette) patch.palette = look.palette;
    if (look.accent && look.accent.toLowerCase() !== prefs.accent.toLowerCase()) patch.accent = look.accent;
    if (look.theme && look.theme !== prefs.theme) patch.theme = look.theme;
    if (typeof look.zoom === 'number' && look.zoom !== prefs.zoom) patch.zoom = look.zoom;
    if (look.density && look.density !== prefs.density) patch.density = look.density;
    if (!Object.keys(patch).length) return false;
    await settings.update({ prefs: patch as Partial<Prefs> }); // mergePrefs checks each value
    return true;
  };
  try { await takeLook(host.appearance?.get()); } catch { /* Ironleaf's own colours stand */ }
  host.appearance?.onChange((look) => {
    void takeLook(look)
      .then((changed) => { if (changed) send('settings:changed', { ...settings.view(), host: host.kind, library: libraryPath() }); })
      .catch(() => {});
  });
  await models.start();
  models.onChange(() => send('models:changed', modelsView()));
  host.notices?.onChange(() => { try { readOwnCopies(); send('notices:changed', noticesView()); } catch { /* the bell asks again on focus */ } });
  // Reminders are checked when the PC wakes or is unlocked too, so one due while it slept is said straight away.
  try {
    // Unlock once means once (8.5): Windows lock and sleep lock Secrets only when the person turned that on
    // (Settings › Privacy and secrets, off by default); signing out of Windows always locks.
    watchLockEvents(powerMonitor, () => privateNotes.lock(), () => settings.raw.prefs.secretsLockOnWindowsLock);
    watchSignOutEvents(powerMonitor, () => privateNotes.lock());
    powerMonitor.on('resume', () => void reminders.check());
    powerMonitor.on('unlock-screen', () => void reminders.check());
  } catch {
    // No power events here (a test run): the 30-second check still catches up.
  }
  registerIpc();
  registerSensitive(handle, sensitive, sensitivity);
  // Where the vault is, looked up once soon after start (never in its way): Today and Settings ask for it later.
  setTimeout(() => void places(), 2500).unref?.();
  quickCapture.register(handle);
  quickCapture.applyKey();
  if (host.menu) buildMenu();
  external.register();
  void external.start();
  // The web clipper's endpoint on this PC (src/main/clipper.ts): the person's own browser extension. On its own and
  // inside the former host app alike (this module is both), listening while the notes may not be open yet (a clip
  // opens them).
  const clipperExtensionDir = (): string => {
    // Inside the former host app the extension sits beside the bundled main side; on its own, in the app's
    // folder.
    const beside = path.join(__dirname, 'clipper');
    if (existsSync(path.join(beside, 'manifest.json'))) return beside;
    // Packaged, the app's folder is app.asar: the extension's real files are in app.asar.unpacked, the folder the
    // browser can load and Show in folder can open (Electron alone sees inside the asar).
    const own = path.join(app.getAppPath(), 'extensions', 'clipper');
    return app.isPackaged ? outsideAsar(own) : own;
  };
  const clipper = new ClipperService({
    dataDir: host.dataDir,
    version: host.version ?? app.getVersion(),
    clipperOn: () => settings.raw.prefs.clipperEnabled,
    extensionDir: clipperExtensionDir,
    ready: async () => {
      if (!vault) await openAtStart();
    },
    requireCreate,
    vaultName: () => (vault ? path.basename(libraryPath()) : null),
    places: async () => ({ folders: (await requireVault().listAll()).folders, projects: projects.list().map((card) => ({ path: card.path, name: card.name })) }),
    freeNote: async (folder, title) => uniqueRel(requireVault(), folder ? cleanRel(folder) : '', cleanFileName(title, 'Web clip'), '.md'),
    findClip: async (source) => {
      const hit = index.allMeta().find((m) => typeof m.props?.source === 'string' && m.props.source && canonicalClipUrl(m.props.source) === source);
      return hit ? { path: hit.path, title: hit.title || hit.path.split('/').pop()!.replace(/\.md$/, '') } : null;
    },
    // A page saved again merges into its kept note (10.0 item 16): its words and its pictures by their bytes.
    readNote: async (rel) => index.content(rel) ?? (await requireVault().read(rel).catch(() => null)),
    readFile: async (rel) => fsp.readFile(requireVault().absolute(cleanRel(rel))).catch(() => null),
    writeNote,
    saveImage: async (folder, name, bytes) => {
      const v = requireVault();
      const { base, ext } = splitName(cleanFileName(name, 'Picture.png'));
      const dir = folder ? cleanRel(folder) : '';
      const rel = await uniqueRel(v, dir, base, ext.toLowerCase());
      if (dir) await v.makeFolder(dir);
      await fsp.writeFile(v.absolute(rel), bytes, { flag: 'wx' });
      await refreshFiles(v);
      notifyChanged([rel]);
      filesChanged();
      return rel;
    },
    // A clip's pictures by the path they were saved under, in the person's link form: short names collide across
    // notes (8.8 round 2: the second "Picture.png" resolved to the first note's file).
    link: (rel) => {
      if (!settings.raw.prefs.wikilinks) return `[${rel.split('/').pop() ?? rel}](${encodeLinkPath(rel)})`;
      return `[[${rel}]]`;
    },
    attachmentsFor: (note) => attachmentsFolder(note),
    log: (message) => host.log?.(message),
  });
  handle('clipper:status', () => clipper.status());
  handle('clipper:set', async (on: unknown) => {
    await settings.update({ prefs: { clipperEnabled: on === true } });
    return clipper.status();
  });
  handle('clipper:reveal', () => {
    const dir = clipperExtensionDir();
    if (existsSync(path.join(dir, 'manifest.json'))) shell.showItemInFolder(path.join(dir, 'manifest.json'));
    return dir;
  });
  void clipper.start().catch((err) => host.log?.(`The web clipper could not start: ${err instanceof Error ? err.message : String(err)}`));
  // What this start of the program was for (a link or a file it was opened with), and what each later start is for.
  setTimeout(() => void external.launch(process.argv), 0);
  app.on('second-instance', (_event, argv) => void external.launch(argv));

  /** A deep link's place, kept to the pages the former host app's side bar names (one product step 2): anything else is no
place. */
  function validPlace(place: unknown): string | null {
    const p = String(place || '').trim().toLowerCase().slice(0, 20);
    return ['today', 'inbox', 'projects', 'tasks', 'meetings', 'notes', 'people', 'graph'].includes(p) ? p : null;
  }

  /** Opens (or brings forward) Ironleaf's window, at a note when one is named. */
  async function openWindow(target?: { note?: string; line?: number; place?: string; folder?: string; newNote?: boolean }): Promise<void> {
    // One window (step 6): while the former host app hosts Vault's page, no path makes Vault's window — links,
    // reminders, health, agents and every other caller land in the former host app's one window through the
    // host instead. Off, or on its own (no such hook), the window opens exactly as today.
    if (vaultWindowSuppressed(host)) {
      try {
        await host.showInWindow?.(target);
      } catch (err) {
        try {
          host.log?.(`Ironleaf: the one window would not show (${String((err as Error)?.message || err)})`);
        } catch {
          /* nowhere to say it */
        }
      }
      return;
    }
    // At a line: in a window already showing (a window still loading gets the note, from its top).
    if (target?.note && Number.isInteger(target.line) && target.line! >= 0 && win && !win.isDestroyed() && vault) {
      await openWindow();
      send('note:reveal', { path: target.note, line: target.line });
      return;
    }
    if (target?.note) pendingNote = target.note;
    // A place (one product step 2): the page opens once the notes are there, like a note.
    // Step 3 carries a new note through the same seam.
    const place = validPlace(target?.place);
    const folder = typeof target?.folder === 'string' ? target.folder.slice(0, 200) : '';
    const fresh = target?.newNote === true;
    // A bare folder is Notes in that folder.
    if (!target?.note && (place || folder || fresh)) pendingPlace = { place: place || 'notes', ...(folder ? { folder } : {}), ...(fresh ? { newNote: true } : {}) };
    if (!win || win.isDestroyed()) {
      win = createWindow();
      // No re-announce when the vault is already open (one window, 9 Nov 2026: Today/Graph clicks
      // stayed on People): the page answers vault:opened with a reload from the saved layout, landing after
      // the place, so the place is lost. openVault announces the opening; navigating never does.
      if (!vault) await openAtStart().catch((err) => host.log?.('Ironleaf could not open its notes: ' + (err instanceof Error ? err.message : String(err))));
    } else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    if (vault && pendingNote) {
      send('note:show', pendingNote);
      pendingNote = null;
    }
    if (vault && pendingPlace) {
      send('vault:open-place', pendingPlace);
      pendingPlace = null;
    }
  }

  /** The view's page attached (one product step 1): trusted on the same channels, guarded and keyed as the window's
   *  page, zooming through the host's shared size. The view never touches the window's remembered bounds. */
  function attachView(contents: WebContents): void {
    if (viewContents === contents) return;
    viewContents = contents;
    wirePage(contents);
    wireZoomKeys(contents, true);
    contents.on('dom-ready', () => {
      ownZoomKeys = false;
    });
  }

  function detachView(): void {
    viewContents = null;
  }

  /** Vault's side shown in the former host app's window (one product step 1): its notes open and the named note shown,
   *  without ever making a window. The note goes to the view alone (t17 break, 8 Nov 2026: the broadcast moved
   *  Vault's own window too, mid-reading); the vault opening is shared truth both surfaces need, so it still
   *  broadcasts. Step 2 adds places beside notes, through the same seam, and they too go to the view alone. */
  async function openInView(target?: { note?: string; line?: number; place?: string; folder?: string; newNote?: boolean; settings?: string; row?: string }): Promise<void> {
    if (!viewContents || viewContents.isDestroyed()) throw new Error('Ironleaf’s view is not open.');
    // At a line: the showing view gets the note, from its line.
    if (target?.note && Number.isInteger(target.line) && target.line! >= 0 && vault) {
      sendToView('note:reveal', { path: target.note, line: target.line });
      try {
        viewContents.focus();
      } catch {}
      return;
    }
    if (target?.note) pendingNote = target.note;
    // A place (one product step 2): the page opens once the notes are there, like a note.
    // Step 3 carries a new note through the same seam.
    const place = validPlace(target?.place);
    const folder = typeof target?.folder === 'string' ? target.folder.slice(0, 200) : '';
    const fresh = target?.newNote === true;
    // A bare folder is Notes in that folder.
    if (!target?.note && (place || folder || fresh)) pendingPlace = { place: place || 'notes', ...(folder ? { folder } : {}), ...(fresh ? { newNote: true } : {}) };
    // A Settings section (one product step 4): Vault's own page for it, on its row when one is named.
    if (!target?.note && !place && !folder && !fresh && typeof target?.settings === 'string' && /^[a-z-]{2,20}$/.test(target.settings)) {
      pendingSettings = { section: target.settings, ...(typeof target.row === 'string' && target.row.trim() ? { row: target.row.trim().slice(0, 80) } : {}) };
    }
    // No re-announce when the vault is already open (one window, 9 Nov 2026: Today/Graph clicks
    // stayed on People): the view answers vault:opened with a reload from the saved layout, landing after the
    // place, so the place is lost. openVault announces the opening; navigating never does.
    if (!vault) await openAtStart().catch((err) => host.log?.('Ironleaf could not open its notes: ' + (err instanceof Error ? err.message : String(err))));
    if (vault && pendingNote) {
      sendToView('note:show', pendingNote);
      pendingNote = null;
    }
    if (vault && pendingPlace) {
      sendToView('vault:open-place', pendingPlace);
      pendingPlace = null;
    }
    if (vault && pendingSettings) {
      sendToView('vault:open-settings', pendingSettings);
      pendingSettings = null;
    }
    try {
      viewContents.focus();
    } catch {}
  }

  /** What the former host app's window last told about its split (one product step 5 part 3, kept here since t46
   *  break): a chat-scope question may read the told chat alone, never an id the page names by itself. */
  let toldFocus: SplitFocus = { split: false, focus: 'note' };
  /** Whether the former host app's window split its main area and which side has focus (one product step 5 part 3):
   *  told to the view alone, like its notes, so the chat panel re-scopes at once. Coerced through the shared
   *  words — split or not, chat or note, and the chat side's id, title and withheld state (part 4) — so an
   *  unreadable tell never puts the panel somewhere strange. */
  function splitFocus(told: unknown): void {
    toldFocus = coerceSplitFocus(told);
    sendToView('vault:split-focus', toldFocus);
  }

  /** One strip (one product, 9 Nov 2026): the view's tabs for the one above — opening, closing, active. Only the
   *  view reports (the window keeps its own strip and reports nothing); unreadable reports are dropped. The told
   *  split focus rides back with it (t63 break: a restart with a split told the focus before the view subscribed,
   *  so the panel landed unscoped until the next click) — same channel, no new one. */
  function tabsReport(report: unknown, fromView: boolean): void {
    if (!fromView || !host.vaultTabs) return;
    const r = report && typeof report === 'object' ? (report as { tabs?: unknown; active?: unknown }) : null;
    // What a tab is (a place, a Notes folder, a note), in the seam's words — read whole, capped, and only when
    // it says something, so an older page reporting bare titles still crosses as today.
    const readTarget = (t: { target?: unknown }): { place?: string; folder?: string; note?: string } | undefined => {
      const raw = t.target && typeof t.target === 'object' ? (t.target as { place?: unknown; folder?: unknown; note?: unknown }) : null;
      if (!raw) return undefined;
      const out: { place?: string; folder?: string; note?: string } = {};
      if (typeof raw.place === 'string' && raw.place) out.place = raw.place.slice(0, 20);
      if (typeof raw.folder === 'string' && raw.folder) out.folder = raw.folder.slice(0, 200);
      if (typeof raw.note === 'string' && raw.note) out.note = raw.note.slice(0, 1000);
      return out.place || out.folder || out.note ? out : undefined;
    };
    const tabs = Array.isArray(r?.tabs)
      ? r.tabs
          .filter((t): t is { id: string; title: string; target?: unknown } => !!t && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string' && typeof (t as { title?: unknown }).title === 'string')
          .map((t) => {
            const target = readTarget(t);
            return target ? { id: t.id.slice(0, 120), title: t.title.replace(/\s+/g, ' ').trim().slice(0, 140), target } : { id: t.id.slice(0, 120), title: t.title.replace(/\s+/g, ' ').trim().slice(0, 140) };
          })
          .filter((t) => t.id && t.title)
          .slice(0, 60)
      : [];
    const active = typeof r?.active === 'string' && r.active ? r.active.slice(0, 120) : null;
    host.vaultTabs({ tabs, active: active && tabs.some((t) => t.id === active) ? active : null });
    sendToView('vault:split-focus', toldFocus);
  }

  /** One strip: show this Vault tab in the view (the one above was clicked). */
  function tabsActivate(id: unknown): void {
    const v = typeof id === 'string' ? id.slice(0, 120) : '';
    if (!v) return;
    sendToView('vault:tabs-activate', { id: v });
  }

  /** One strip: close this Vault tab in the view (its × in the one above). */
  function tabsClose(id: unknown): void {
    const v = typeof id === 'string' ? id.slice(0, 120) : '';
    if (!v) return;
    sendToView('vault:tabs-close', { id: v });
  }

  handle(
    'tabs:report',
    (event: IpcMainInvokeEvent, report: unknown) => {
      const fromView = !!viewContents && !viewContents.isDestroyed() && event.sender === viewContents;
      tabsReport(report, fromView);
    },
    { sender: true },
  );

  /** The view's edits saved before the former host app's window closes (one product step 1): the same handshake as the
   *  window's close — the page saves everything, a few seconds at most — then the former host app goes whatever
   *  came back. True when the page said it saved. */
  async function flushView(ms = VIEW_FLUSH_MS): Promise<boolean> {
    if (!viewContents || viewContents.isDestroyed()) return true;
    viewContents.send(CHANNEL(CLOSE_REQUEST), null);
    const flushed = await closeHandshake((done) => {
      viewReady = done;
    }, ms);
    viewReady = null;
    if (!flushed) host.log?.('Ironleaf view closed with saves still waiting.');
    return flushed;
  }

  return {
    open: (target) => openWindow(target),
    attachView: (contents) => attachView(contents),
    detachView: () => detachView(),
    openInView: (target) => openInView(target),
    splitFocus: (told) => splitFocus(told),
    tabsActivate: (id) => tabsActivate(id),
    tabsClose: (id) => tabsClose(id),
    flushView: (ms) => flushView(ms),
    // One window (one product step 6): private notes as the second window's close leaves them, for the one
    // window's close (the window calls the same two on its way out; a restart inside the remembered period
    // finds them as it finds them there).
    closePrivate: () => {
      secrets.clearClipboardNow();
      privateNotes.close();
    },
    // One Settings (one product step 4): the former host app's Settings reads and writes through these, the same
    // shapes the window's settings:get/settings:update/models:view carry, so both doors see the same settings.
    // The packs and the hideable buttons ride along as catalogues (their names live here, not in the prefs).
    vaultSettings: () => ({ ...settings.view(), host: host.kind, library: libraryPath(), packs: LIFE_MODULES.map((m) => ({ id: m.id, name: m.name, words: m.words })), hideable: HIDEABLE_ITEMS.map((i) => ({ id: i.id, group: i.group, label: i.label })) }),
    vaultModels: () => modelsView(),
    updateVaultSettings: async (patch) => ({ ...(await updateSettings(patch ?? {})), packs: LIFE_MODULES.map((m) => ({ id: m.id, name: m.name, words: m.words })), hideable: HIDEABLE_ITEMS.map((i) => ({ id: i.id, group: i.group, label: i.label })) }),
    window: () => (win && !win.isDestroyed() ? win : null),
    library: () => libraryPath(),
    // The person's own name as the notes know it (the same whoIsMe reading the bar feeds on through
    // today.data()): the former host app's account block reads it for the chain's second step. Null until
    // the notes open.
    person: () => (vault ? todayData(index, undefined).me : null),
    // Today's count for the former host app's one side bar (one product step 3): the one Today count, 0 until
    // the notes open. Break-it t31: through the side bar's own query (steps plus the hub), so it matches
    // Vault's Today.
    todayCount: async () => {
      if (!vault) await openAtStart().catch(() => {});
      if (!vault) return 0;
      try {
        return sidebarTodayCount(todayData(index, undefined), hub.due(), new Date());
      } catch {
        return 0;
      }
    },
    // The Notes tree in the former host app's one side bar (one window, 9 Nov 2026: Templates listed
    // beside the person's folders): the top folders with note counts, most notes first, through the same
    // machinery rule Notes reads (fewer-folders, as NotesPage builds it) — the app's own folders and kept-out
    // folders hide too. The counts are Notes' own (one window, 9 Nov 2026: the bar said Work 52 while the page
    // said 19): every Markdown file under a folder is not what clicking shows — projects, meetings, records and
    // the app's own folders never list — so the bar counts the index by Notes' rule (notes-list.ts
    // countsOnNotes), with the types resolved as the page resolves them. Private notes never count.
    topFolders: async () => {
      if (!vault) await openAtStart().catch(() => {});
      if (!vault) return [];
      try {
        const metas = index.allMeta();
        const tops = [...new Set(metas.map((m) => m.path.split('/')).filter((p) => p.length > 1).map((p) => p[0]))];
        const areas = areasNow();
        const types = resolveTypes(readTypes(await readTypesFile(vault.root)).config, {
          topFolders: tops,
          templatesFolder: settings.raw.prefs.templatesFolder,
          docsFolder: DOCS_FOLDER,
          modules: moduleTypeInputs(
            modulesOn(settings.raw.prefs.modules).map((m) => m.id),
            areas.length ? areas : null,
          ),
        });
        const ctx: MachineryCtx = {
          templatesFolder: settings.raw.prefs.templatesFolder,
          assetsFolder: settings.raw.prefs.assetsFolder,
          attachmentsFolder: settings.raw.prefs.attachmentsFolder,
          dailyFolder: settings.raw.dailyFolder ?? 'Daily',
          areas,
          moduleFolders: MODULES.map((m) => moduleFolder(m.id, areas.length ? areas : null)).filter(Boolean),
          quietFolders: settings.raw.prefs.quietFolders ?? [],
        };
        const counts = new Map<string, number>();
        for (const m of metas) {
          const top = m.path.includes('/') ? m.path.slice(0, m.path.indexOf('/')) : '';
          if (!top || top.toLowerCase() === PRIVATE_DIR.toLowerCase()) continue;
          if (!countsOnNotes({ path: m.path, title: m.title, props: m.props }, types, settings.raw.prefs.templatesFolder, ctx)) continue;
          counts.set(top, (counts.get(top) ?? 0) + 1);
        }
        return [...counts]
          .filter(([name]) => !isMachineryTop(name, ctx))
          .map(([name, count]) => ({ name, prefix: name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en-AU'))
          .slice(0, 30);
      } catch {
        return [];
      }
    },
    onClosed(fn) {
      closedListeners.add(fn);
      return () => closedListeners.delete(fn);
    },
    capture: () => quickCapture.show(),
    /** The former host app › Settings › Ironleaf (26 Oct 2026, one Settings): this window at one of its own sections, on the
     *  named row when one is given (4 Nov 2026, the 14 doors: the bare section still sends the bare id, so old
     *  callers land as before and the window resolves the row from the id). */
    openSettingsAt: async (section: string, row?: string) => {
      await openWindow();
      const shaped = /^[a-z-]{2,20}$/.test(String(section)) ? section : 'general';
      const named = typeof row === 'string' && row.trim() ? row.trim().slice(0, 80) : undefined;
      send('agents:show', named ? { section: shaped, row: named } : shaped);
    },
    // Life modules for the former host app and a chat bot (Wave 5): a module tool called as the former host app
    // ('neuralspark') or one of a chat bot's bots ('neuralbot', 'bot:<id>'), through that agent's gate (Settings
    // › Privacy and secrets decides).
    modules: {
      // The modules switched off are offered too, marked off: asking for one of their tools is asking for the module, so
      // it is switched on and said (26 Oct 2026: "Publications is switched off" stopped the paper). Health and Family
      // stay the person's own switch.
      tools: () => {
        const view = (t: (typeof MODULE_TOOLS)[number], off = false) => ({ name: t.name, title: t.title, description: t.description, level: t.level, input: t.input, required: t.required ?? [], step: t.step, module: t.module, moduleName: moduleInfo(t.module)?.name ?? t.module, ...(off ? { off: true } : {}) });
        const on = lifeModules.tools();
        const have = new Set(on.map((t) => t.name));
        const off = MODULE_TOOLS.filter((t) => !have.has(t.name) && !OWN_SWITCH.has(t.module) && !moduleOn(settings.raw.prefs.modules, t.module));
        return [...on.map((t) => view(t)), ...off.map((t) => view(t, true))];
      },
      bin: async (action: 'restore' | 'forget', kind: unknown, ref: unknown) => {
        if (!vault) await openAtStart().catch(() => {});
        return lifeModules.binAction(action, kind, ref);
      },
      // The former host app's conversation and Library searches re-scored by real relevance (10.0 m10rerank): asked
      // over the vault-asks bridge (the host's runtimeAsks 'rerank'), answered by the one model on this PC.
      // Caller-given texts only (never vault notes, never private ones); nothing is read, stored or logged.
      // {ok:false} keeps the caller's own order: the model missing, still starting, or busy with another search.
      rerank: async (query: string, items: { id: string; title: string; text: string }[]) => {
        const q = String(query ?? '').trim().slice(0, 1000);
        const slim = (Array.isArray(items) ? items : [])
          .filter((it) => it && typeof it.id === 'string' && it.id.length > 0)
          .slice(0, RERANK_MAX)
          .map((it) => ({ id: it.id.slice(0, 160), title: String(it.title ?? '').slice(0, 300), text: String(it.text ?? '').slice(0, 2000) }));
        const reranker = meaningReranker;
        if (!q || slim.length < 2 || !reranker) return { ok: false as const };
        const scores = await reranker.score(q, slim.map((it) => `${it.title}\n${it.text}`.slice(0, RERANK_MAX_TEXT_CHARS))).catch(() => null);
        if (!scores || scores.length !== slim.length) return { ok: false as const };
        return { ok: true as const, order: applyRerank(q, slim, (it) => it.title, scores).map((it) => it.id) };
      },
      call: async (who: string, name: string, args: Record<string, unknown>) => {
        if (!vault) await openAtStart().catch(() => {});
        // Only askers Ironleaf knows, each at its own levels (an outside agent's job asks as 'agent:<id>'); never a default.
        // Checked before anything is switched on, so a refused ask changes nothing (9.2 seam).
        const id = typeof who === 'string' && /^(neuralspark|neuralbot|bot:[\w-]{1,80}|agent:[\w:.-]{1,120})$/.test(who) ? who : null;
        if (!id) return { text: 'That asker isn’t known to Ironleaf.', isError: true };
        const def = MODULE_TOOLS.find((t) => t.name === name);
        let switched = '';
        if (def && !OWN_SWITCH.has(def.module) && !moduleOn(settings.raw.prefs.modules, def.module)) {
          await settings.update({ prefs: { modules: withSwitch(settings.raw.prefs.modules, def.module, true) } });
          switched = `${moduleInfo(def.module)?.name ?? def.module} is switched on now in Ironleaf (Settings › Packs). `;
        }
        const label = id === 'neuralspark' ? 'Another app' : id === 'neuralbot' ? 'Chat bot' : id.startsWith('bot:') ? `Chat bot (${id.slice(4)})` : `Agent (${id.slice(6)})`;
        // A tool of the one vault catalogue (8.0 V1, src/shared/vault-tools.ts), asked by the former host app's own vault
        // tools (native-runtime/plugins/desktop/vault-catalogue.mjs) by its catalogue name: the handler outside agents
        // use, through this agent's gate, each note it changed listed with its text before (for Rewind and the reply's
        // card).
        if (!def && VAULT_TOOLS.some((t) => t.name === name)) {
          const { out, changed } = await recordingWrites(() => writer.run(id === 'neuralspark' ? 'neuralspark' : 'agent', () => agentAccess.asOwn({ id, name: label, consumer: 'spark' }, makeGate(sensitivity, id, label), name, args)));
          const said = { text: out.content.map((c) => c.text).join('\n'), ...(out.isError ? { isError: true } : {}) };
          return changed.length ? { ...said, changed } : said;
        }
        try {
          // Each note the call changed, with its text before (module-writes.ts): The former host app puts them in Rewind
          // and the card.
          const { out, changed } = await recordingWrites(() => writer.run(id === 'neuralspark' ? 'neuralspark' : 'agent', () => lifeModules.call({ gate: makeGate(sensitivity, id, label) }, name, args)));
          const said = switched ? { ...out, text: switched + out.text } : out;
          return changed.length ? { ...said, changed } : said;
        } catch (err) {
          return { text: err instanceof Error ? err.message : String(err), isError: true };
        }
      },
      // Short texts to the on-device model's vectors (10.0 reuse): the one embedding service
      // (src/main/meaning-service.ts), over the library's live builder.
      embed: async (texts: unknown) => {
        if (!vault) await openAtStart().catch(() => {});
        const status = meaningBuilder?.status();
        return embedShortTexts(meaningBuilder?.queries() ?? null, texts, status?.mode === 'fallback' && status.words ? status.words : 'Meaning search is off on this PC.');
      },
    },
    // Several edits proposed as one change set (10.0, v2changes): The former host app or a bot's door to the same waiting
    // set the side chat offers (reviewed once in Ironleaf, kept on disk). Nothing is written until the person accepts.
    proposeChangeSet: async (who: string, input: { askWords?: string; entries: { path: string; name?: string; base: string | null; after: string; changes?: string[] }[] }) => {
      if (!vault) await openAtStart().catch(() => {});
      if (!vault) return { text: 'Ironleaf’s notes aren’t open.', isError: true };
      const askedBy = askerWords(who);
      if (!askedBy) return { text: 'That asker isn’t known to Ironleaf.', isError: true };
      try {
        const { set, skipped } = await changeSets.offer(askedBy, input.askWords ?? '', input.entries ?? [], who === 'neuralspark' ? 'neuralspark' : 'agent');
        const words = `Proposed ${set.entries.length === 1 ? 'a change' : `${set.entries.length} changes`} for review in Ironleaf.${skipped.length ? ` Left out (Private notes): ${skipped.join(', ')}.` : ''}`;
        return { text: words, setId: set.id };
      } catch (err) {
        return { text: err instanceof Error ? err.message : String(err), isError: true };
      }
    },
    // A brand kit the former host app saved, kept as Ironleaf's own when Ironleaf has none yet (19 Oct 2026, the
    // former host app and Vault design, release 4: brand kits in one home). One already there is never changed
    // from here.
    async checkVault(o: { repair?: boolean } = {}): Promise<CheckResult & { at: number }> {
      if (!vault) await openAtStart().catch(() => {});
      if (!vault) throw new Error('Ironleaf’s notes aren’t open.');
      const { r } = await runCheckWithNames({ repair: o.repair !== false, ask: false });
      lastCheck = { at: Date.now(), ...r };
      if (r.fixed.length && o.repair !== false) filesChanged();
      if (r.thin.length) {
        const ntc = thinNotice(r.thin);
        reminders.post([{ key: ntc.key, kind: ntc.kind, title: ntc.title, body: ntc.body, path: ntc.path }], { quiet: true });
      }
      return lastCheck;
    },
    async keepLayout(o: { publication?: string; page: string }): Promise<{ kept: boolean; words: string }> {
      if (!vault) await openAtStart().catch(() => {});
      if (!vault) return { kept: false, words: 'Ironleaf’s notes aren’t open.' };
      try {
        // Asking for a paper to come out again is asking for Publications (26 Oct 2026: "Publications is switched off"
        // stopped the paper being kept): it is switched on, and said.
        const was = moduleOn(settings.raw.prefs.modules, 'publications');
        if (!was) await settings.update({ prefs: { modules: withSwitch(settings.raw.prefs.modules, 'publications', true) } });
        const words = await publications.keepLayout(o, 'an agent');
        return { kept: true, words: was ? words : `Publications is switched on now (Settings › Packs). ${words}` };
      } catch (e) {
        return { kept: false, words: e instanceof Error ? e.message : String(e) };
      }
    },
    async adoptBrand(kit: { name?: string; colours?: { name?: string; hex?: string; use?: string }[]; fonts?: { name?: string; use?: string }[]; logo?: string }): Promise<{ adopted: boolean; words: string }> {
      if (!vault) await openAtStart().catch(() => {});
      if (!vault) return { adopted: false, words: 'Ironleaf’s notes aren’t open.' };
      const now = (await assets.readIndex()).brand;
      if (now.name || now.colours.length) return { adopted: false, words: `Ironleaf’s brand kit is ${now.name || 'already set'}; it was left as it is.` };
      const logos: Record<string, string> = {};
      if (typeof kit.logo === 'string' && path.isAbsolute(kit.logo)) {
        const r = await assets.add([kit.logo], { kind: 'logo', duplicates: 'reuse' }).catch(() => null);
        const rel = r?.added[0] ?? r?.reused[0];
        if (rel) logos.primary = rel;
      }
      const brand = await assets.setBrand({ name: kit.name, logos, colours: kit.colours ?? [], fonts: kit.fonts ?? [] });
      return { adopted: true, words: `Kept ${brand.name ?? 'it'} as Ironleaf’s brand kit (Assets).` };
    },
    async start() {
      if (!vault) await openAtStart().catch((err) => host.log?.('Ironleaf could not open its notes: ' + (err instanceof Error ? err.message : String(err))));
    },
    launch: (argv) => external.launch(argv),
    tray: { mcpOn: () => agentAccess.localMcpSettings().on, setMcp: async (on) => void (await agentAccess.setLocalMcp({ on })), onMcpChange: (fn) => agentAccess.onLocalMcpChange(() => fn()), search: async () => (await openWindow(), external.push({ kind: 'search', query: '' })), handle },
    stop() {
      void external.stop();
      void mcpHttp?.stop();
      void clipper.stop();
      reminders.stop();
      dueToday.stop();
      tidy.stop();
      lifeModules.stop();
      quickCapture.stop();
      backup?.stop();
      void syncService?.stop();
      teamsService?.stop();
      secrets.clearClipboardNow();
      privateNotes.close();
      void assets.flushCache();
      void fileIndex.flush().finally(() => fileIndex.stop());
      void ocrStore?.flush();
      ocrQueue?.stop();
      void meaningBuilder?.flush().finally(() => meaningBuilder?.stop());
      void meaningEmbedder?.close();
      void meaningReranker?.close();
      models.stop();
      vault?.close();
      vault = null;
      void vaultLock?.release();
      vaultLock = null;
      lockHeld = { held: false };
    },
  };
}
