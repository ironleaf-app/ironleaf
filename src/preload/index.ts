// The only API the renderer gets. It runs in a sandbox with context isolation,
// so the interface never touches Node or the file system directly.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { updateCheckApi } from './update-check';
import { managedApi } from './managed';
import { accountApi } from './account';
import type { DocConvertResult, ProjectConversation, PrivateEntry, PrivateStatus, ProjectCard, FolderProjectOffer, ProjectEditResult, ProjectFiles, ProjectFileText, ProjectView, FolderHereResult, TidyPreview, TidyResult } from '../shared/types';
import type { Project, ProjectEdit } from '../shared/project-file';
import type { DesignFormat, DesignStartIn, DesignViewOut } from '../shared/design-doc';
import type { ProjectCheckState } from '../shared/project-checks';
import type { ProjectChange } from '../shared/project-hub';
import type { SkillsView } from '../shared/skills';
import type { TodayData, TodayFileInput } from '../shared/today';
import type { MeetingItems, PersonItems, ProjectAttention, RecordPeek, RecordRef, RecordType, VaultRecord } from '../shared/records';
import type { TemplateGroup, TemplateInfo } from '../shared/templates';
import type { SplitFocus } from '../shared/split-focus';
import type { TemplateAnswers } from '../shared/template-fields';
import type { AssetDetails, AssetKind, AssetListing, AssetPatch, BrandAction, BrandKit, BrandSection, NamedBrandKit } from '../shared/assets';
import type { AiLinkResult, AppSettings, ChatEvent, ChatOptions, ChatResult, ChatStepEvent, ChatTurn, ModelConnectionInput, ModelsView, CheckedWrite, FileList, GraphData, GraphSnapshot, LineContext, Mention, MoveResult, NoteMeta, OutgoingLink, RelatedNote, SearchHit, SettingsPatch, Snapshot, SnapshotFile, TagCount, VaultChange, VaultInfo, VaultLockView, NoteSuggestionEvent } from '../shared/types';
import type { ItemEdit } from '../shared/project-canvas';
import type { MeetingAction } from '../shared/meetings';
import type { TidyReport } from '../shared/vault-tidy';
import type { ReviewDraft, ReviewOutcome } from '../shared/weekly-review';
import type { MeetingContext } from '../main/reviews';
import type { CaptureContext, CaptureSaved, CaptureStatus, SnipResult } from '../shared/capture';
import type { ClipperStatus } from '../main/clipper';
import type { FileHit, FileIndexStatus, FileTextState } from '../shared/file-index';
import type { OcrEntryState, OcrHit, OcrLine, OcrStatus } from '../shared/ocr';
import type { MeaningStatus } from '../shared/meaning';
import type { MoveDone, MovePlan, MoveProgress, MoveRefusal, PlaceStatus } from '../shared/vault-place';
import type { ExportDone, HomeMovePlan, HomeStatus, ImportPlan, ImportProgress, ImportSummary } from '../shared/vault-home';
import type { PairListed, PairPlan, PairProgress, PairSummary, FileKind as SourceKind } from '../shared/pairing/types';
import type { SyncFixDone, SyncView } from '../shared/vault-sync';
import type { NoticesView } from '../shared/notices';
import type { RemindersView } from '../main/reminders';
import type { DueView } from '../main/hub';
import type { TidyLine, TidyNeed, TidyProposal, TidyStatus } from '../main/weekly-tidy';
import type { RelatedItem } from '../shared/related';
import type { TasksView } from '../main/tasks';
import type { SharedSpaceHome } from '../main/shared-spaces';
import type { SharedSpaceListItem } from '../shared/shared-space';
import type { DueDeck, NotebookAnswer, NotebookState } from '../main/notebook';
import type { Card, ReviewState } from '../shared/flashcards';
import type { ScriptLine, StudioKind, SourcesChoice } from '../shared/notebook';
import type { CalendarList, CalendarRange, CalendarToday, CalendarWrite } from '../shared/calendar';
import type { BackupView, GitBackupPrefs } from '../shared/backup';
import type { PortableProgress, PortableResult } from '../shared/portable-export';
import { PRIVATE_NEEDED } from '../shared/portable-export';
import type { Brief } from '../shared/brief';
import type { MeetingNotes, SpeakersForPrompt } from '../shared/meeting-notes';
import type { SpeakerNames, SpeakerTurn } from '../shared/meeting-speakers';
import type { MeetingMinutes } from '../shared/meeting-minutes';
import type { ExtraAudio, RecorderStatus, TranscribeFailure, Transcribed } from '../main/meeting-recorder';
import type { ExtraStartResult, ExtraStatus } from '../main/extra-loopback';
import type { RecJob } from '../shared/recorder';
import type { DayMark, DueEntry, HubDay } from '../shared/hub';
import type { ExternalItem, ExternalState } from '../main/external';
import type { AuditEntry, Level, SensitivityStore } from '../shared/sensitivity';
import type { LevelOfView, LockedStatus, MigrationChoice, MigrationNote, MigrationResult, MoveResult as SecretsMoveResult, PrivacyState, ScanReport, SecretInput, SecretsStatus, SecretView } from '../shared/secrets';
import type { LooseOpened, LooseWrite } from '../main/loose-files';
import { lifeApi } from '../shared/life-api';
import { syncApi } from '../main/sync/window-api';
import { teamsApi } from '../main/teams/window-api';
import { vaultFilesApi } from '../shared/vault-files-api';
import { modulesApi } from '../shared/modules-api';
import { recordModulesApi } from '../shared/record-modules-api';
import { workModulesApi } from '../shared/work-modules-api';
import { publicationsApi } from '../shared/publications-api';
import { sitePublishApi } from '../shared/site-publish-api';
import type { AgentsState } from '../shared/agent-access';
import type { ChangeSet, ChangeSetSummary } from '../shared/change-sets';
import type { PluginCardView, PluginCommandView, PluginToast, PluginView } from '../shared/plugins';

// Every channel is named nv:… so Ironleaf's never meet the former host app's when it runs inside the
// former host app.
/** The main side's one step-up refusal (src/main/private-notes.ts: its STEP_UP_NEEDED words): read as a machine
 *  flag below, never as a substring, with a test keeping the words in step. */
const STEP_UP_MESSAGE = 'Step-up needed: confirm it is you to do that.';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // Plain words only (8.0.1, 29 Oct 2026: a panel showed "Error invoking remote method 'nv:vfiles:info': Error: That
  // file isn't there any more."): Electron's wrapper is taken off every failure here, once, for every window.
  return (ipcRenderer.invoke('nv:' + channel, ...args) as Promise<T>).catch((e: unknown) => {
    if (e instanceof Error) e.message = e.message.replace(/^Error invoking remote method '[^']+':\s*(?:[A-Za-z]*Error:\s*)?/, '');
    // A step-up refusal reads as a machine flag (9.2 uplift F147), so a reworded sentence cannot silently break
    // unlocking: the flag is exact, and a test pins the main side's words.
    if (e instanceof Error && e.message === STEP_UP_MESSAGE) (e as Error & { needStepUp?: boolean }).needStepUp = true;
    throw e;
  });
}

/** Private notes locked (9.2 uplift F135): the main side throws the shared PRIVATE_NEEDED words; the window reads
 *  a machine flag off the error, never the sentence, so a rewording cannot silently hide the unlock button. */
function flagUnlockNeeded<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof Error && e.message === PRIVATE_NEEDED) (e as Error & { needUnlock?: boolean }).needUnlock = true;
    throw e;
  });
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on('nv:' + channel, listener);
  return () => ipcRenderer.removeListener('nv:' + channel, listener);
}

const api = {
  /** The vault as a life OS (Wave 4): areas, the move into areas, people, the Inbox, tags (src/main/life.ts). */
  life: lifeApi(invoke),
  /** Files done properly (Wave 4 part c): Files views, a file's details and versions, adding files, big imports (src/main/vault-files.ts). */
  vfiles: vaultFilesApi(invoke, subscribe),
  // Health and Fitness and Family (Wave 5, src/main/modules.ts).
  modules: modulesApi(invoke, subscribe),
  /** Finance and Documents and ID (Wave 5 part a; src/main/record-modules.ts). */
  recmod: recordModulesApi(invoke),
  /** Meetings, Weekly Updates, Sites and Equipment, and Vendors, Quotes and Contracts (Wave 6 part b; src/main/work-modules.ts). */
  work: workModulesApi(invoke),
  /** Publications (Wave 6 part a; src/main/publications.ts). */
  pub: publicationsApi(invoke),
  /** Publish as a website (9.0 w122publish; src/main/site-publish.ts). */
  site: sitePublishApi(invoke),
  vault: {
    pick: () => invoke<VaultInfo | null>('vault:pick'),
    open: (folder: string) => invoke<VaultInfo>('vault:open', folder),
    current: () => invoke<VaultInfo | null>('vault:current'),
    /** Back to Ironleaf's own notes (after another folder was opened). */
    library: () => invoke<VaultInfo>('vault:library'),
    list: () => invoke<NoteMeta[]>('vault:list'),
    /** The light list for boot: every note's names, tags and properties without its links and headings. */
    listSlim: () => invoke<NoteMeta[]>('vault:list-slim'),
    reveal: () => invoke<void>('vault:reveal'),
  },
  notes: {
    read: (path: string) => invoke<string>('note:read', path),
    /** A note opened in the editor: its words with the fingerprint its saves pass back (guarded, never clobbering). */
    open: (path: string) => invoke<{ text: string; version: string }>('note:open', path),
    /** `by`: a suggested change the person kept (the assistant's) or an earlier version brought back, for the history.
     *  `base`: the fingerprint of what was read — a save on a stale one comes back unlanded, with both copies kept. */
    write: (path: string, content: string, by?: 'assistant' | 'restored', base?: string | null, opts?: { imported?: boolean }) => invoke<CheckedWrite>('note:write', path, content, by, base, opts),
    /** Pass null as the path to create a uniquely named "Untitled" note. */
    create: (path: string | null, content = '', opts?: { imported?: boolean }) => invoke<string>('note:create', path, content, opts),
    resolve: (target: string, from?: string) => invoke<string | null>('note:resolve', target, from),
  },
  files: {
    /** Every file (notes, canvases, pictures, PDFs…) and every folder. */
    list: () => invoke<FileList>('files:list'),
    /** A note or a file named by a link. */
    resolve: (target: string, from?: string) => invoke<string | null>('file:resolve', target, from),
    readText: (path: string) => invoke<string>('file:read-text', path),
    /** A canvas, drawing, or view opened in the editor: its words with the fingerprint its saves pass back. */
    openText: (path: string) => invoke<{ text: string; version: string }>('file:open-text', path),
    writeText: (path: string, content: string, base?: string | null) => invoke<CheckedWrite>('file:write-text', path, content, base),
    /** A new note or canvas with a free name in a folder ('' is the top). */
    create: (folder: string, base: string, ext: '.md' | '.canvas' | '.view.json' | '.base' | '.nvdraw', content?: string) => invoke<string>('file:create', folder, base, ext, content),
    createFolder: (parent: string, name: string) => invoke<string>('folder:create', parent, name),
    move: (from: string, to: string, updateLinks: boolean) => invoke<MoveResult>('path:move', from, to, updateLinks),
    linksInto: (path: string) => invoke<{ links: number; notes: number }>('path:links-into', path),
    /** To Recently deleted (the vault's own Bin, restorable 30 days), never a hard delete. Returns its Bin id, for Undo. */
    trash: (path: string) => invoke<string>('path:trash', path),
    duplicate: (path: string) => invoke<string>('path:duplicate', path),
    /** Shows it in File Explorer ('' opens the notes folder). */
    reveal: (path: string) => invoke<void>('path:reveal', path),
    openDefault: (path: string) => invoke<void>('path:open-default', path),
    absolute: (path: string) => invoke<string>('path:absolute', path),
    saveAttachment: (name: string, data: Uint8Array, forNote: string) => invoke<string>('attachment:save', name, data, forNote),
    /** Files dropped in from File Explorer: into `folder`, or (null) where the note's attachments go. */
    importPaths: (paths: string[], folder: string | null, forNote?: string) => invoke<string[]>('attachment:import', paths, folder, forNote),
    /** The path of a file dropped from File Explorer. */
    pathOf: (file: File) => webUtils.getPathForFile(file),
  },
  /** The vault's note types file (.neuralvault/types.json; src/shared/note-types.ts): its words ('' when none yet). */
  types: {
    load: () => invoke<string>('types:load'),
    save: (text: string) => invoke<void>('types:save', text),
  },
  /** A project's workspace (src/main/workspaces.ts): its sections, views and the person's own, kept in the vault. */
  workspace: {
    load: (project: string) => invoke<string>('workspace:load', project),
    save: (project: string, text: string) => invoke<void>('workspace:save', project, text),
  },
  /** Views over the whole vault's records (.neuralvault/views): list, save (a new one when `name` is ''), remove. */
  recordViews: {
    list: () => invoke<{ name: string; title: string; layout: string; text: string }[]>('views:list'),
    save: (name: string, text: string) => invoke<string>('views:save', name, text),
    remove: (name: string) => invoke<void>('views:remove', name),
  },
  state: {
    load: <T>(name: 'workspace' | 'bookmarks' | 'graph' | 'explorer' | 'search' | 'projects' | 'timeline' | 'dismissed' | 'home-cards' | 'notes-pinned' | 'moving-in' | 'project-keeps' | 'word-fixes' | 'people') => invoke<T | null>('state:load', name),
    save: (name: 'workspace' | 'bookmarks' | 'graph' | 'explorer' | 'search' | 'projects' | 'timeline' | 'dismissed' | 'home-cards' | 'notes-pinned' | 'moving-in' | 'project-keeps' | 'word-fixes' | 'people', value: unknown) => invoke<void>('state:save', name, value),
  },
  /** What the page guard caught, kept in the guard's own log (8.7.1, never silent). */
  errors: {
    report: (entry: { kind: string; name: string; message: string; stack: string; components?: string }) => invoke<void>('errors:report', entry),
  },
  /** The assistant's suggested changes waiting in notes (src/main/suggestions.ts): all of them, and what still waits in a
   *  note after the person kept or discarded some (null: nothing). */
  suggestions: {
    list: () => invoke<NoteSuggestionEvent[]>('suggestions:list'),
    settle: (path: string, base: string, after: string | null) => invoke<void>('suggestions:settle', path, base, after),
  },
  /** Change sets waiting for review as one (10.0, v2changes; src/main/change-sets.ts): the list, one set with its
   *  before/after bodies, and accept/reject of one file (`entryId`) or the whole set (left out). */
  changeSets: {
    list: () => invoke<ChangeSetSummary[]>('change-sets:list'),
    get: (id: string) => invoke<ChangeSet>('change-sets:get', id),
    accept: (id: string, entryId?: string) => invoke<{ words: string; accepted: { path: string; name: string }[]; stale: string[] }>('change-sets:accept', id, entryId),
    reject: (id: string, entryId?: string) => invoke<{ words: string; rejected: string[] }>('change-sets:reject', id, entryId),
  },
  recovery: {
    list: () => invoke<SnapshotFile[]>('recovery:list'),
    versions: (path: string) => invoke<Snapshot[]>('recovery:versions', path),
    read: (path: string, id: string) => invoke<string>('recovery:read', path, id),
  },
  canvas: {
    /** Keep a damaged board's bytes in File recovery before starting over (nothing is written into the file). */
    keepDamaged: (path: string) => invoke<boolean>('canvas:keep-damaged', path),
  },
  /** The Design studio (22 Nov 2026, src/main/design-studio.ts): a note designed into a finished PDF by the person's AI. */
  design: {
    start: (requestId: string, input: DesignStartIn) => invoke<DesignViewOut>('design:start', requestId, input),
    change: (requestId: string, id: string, words: string) => invoke<DesignViewOut>('design:change', requestId, id, words),
    cancel: (requestId: string) => invoke<void>('design:cancel', requestId),
    /** The design saved where the person picks, as a PDF, PowerPoint, Word or Excel file: the file, or null when they
     *  cancelled. */
    save: (id: string, name: string, format: DesignFormat = 'pdf') => invoke<string | null>('design:save', id, name, format),
    /** Whether the chat's model is set up, and sees pictures. */
    ready: () => invoke<{ model: string | null; pictures: boolean }>('design:ready'),
  },
  exports: {
    /** Prints what the window shows for print (the Weekly page as shown) to a PDF the person names. */
    pdf: (name: string) => invoke<string | null>('export:pdf', name),
    /** A note's branded document (5 Nov 2026): the finished HTML laid out in a window nobody sees, to a PDF named. */
    brandPdf: (name: string, html: string) => invoke<string | null>('export:brand-pdf', name, html),
    reveal: (file: string) => invoke<void>('export:reveal', file),
    /** A view's notes as a CSV file the person names (the words made by src/shared/csv.ts). */
    csv: (name: string, text: string) => invoke<string | null>('export:csv', name, text),
    /** A drawing as SVG (its words) or PNG (its bytes), to a file the person names (src/shared/drawing.ts). */
    drawing: (name: string, kind: 'svg' | 'png', data: string | Uint8Array) => invoke<string | null>('export:drawing', name, kind, data),
    /** Share › Save as Markdown (8.8): the file, or a zip with its attachments when it has any. */
    shareMd: (name: string, text: string, attachments: string[]) => invoke<string | null>('export:share-md', name, text, attachments),
    /** Share › Email it (8.8): the branded document printed, drafted with the PDF attached, opened in the mail program. */
    shareEmail: (name: string, subject: string, body: string, html: string) => invoke<{ pdf: string; eml: string; opened: boolean; words?: string }>('export:share-email', name, subject, body, html),
  },
  /** Markdown files from outside the vault (src/main/loose-files.ts; 21 Oct 2026, gap G26), read and saved by the number
   *  Ironleaf gave them when they were opened. A file inside the vault comes back as its note. */
  loose: {
    open: (path: string) => invoke<LooseOpened>('loose:open', path),
    pick: () => invoke<LooseOpened[]>('loose:pick'),
    read: (id: string) => invoke<{ text: string; mtime: number }>('loose:read', id),
    /** `baseMtime`: the reading this save is based on — a save on a stale one comes back unlanded, both kept. */
    write: (id: string, text: string, baseMtime?: number | null) => invoke<LooseWrite>('loose:write', id, text, baseMtime),
    close: (id: string) => invoke<void>('loose:close', id),
    /** A copy in the vault (the file outside stays as it is); its path. */
    copyIn: (id: string) => invoke<string>('loose:copy-in', id),
  },
  /** The ironleaf command and ironleaf:// links (src/main/external.ts): what the window is asked to do, and
   *  Settings › Files and links › Links from other apps. */
  external: {
    take: () => invoke<ExternalItem[]>('external:take'),
    state: () => invoke<ExternalState>('external:state'),
    allow: (kinds: string[]) => invoke<ExternalState>('external:allow', kinds),
  },
  imports: {
    /** A CSV file the person picks: its name and words, or null. */
    pickCsv: () => invoke<{ name: string; text: string } | null>('import:csv-pick'),
    /** New notes in a folder, one per row; a name already there gets " 2", " 3"… Returns the notes made. */
    csvNotes: (folder: string, notes: { name: string; content: string }[]) => invoke<string[]>('import:csv-notes', folder, notes),
  },
  index: {
    backlinks: (path: string) => invoke<LineContext[]>('index:backlinks', path),
    unlinked: (path: string) => invoke<LineContext[]>('index:unlinked', path),
    mentions: (path: string, content: string) => invoke<Mention[]>('index:mentions', path, content),
    related: (path: string) => invoke<RelatedNote[]>('index:related', path),
    /** The notes most like this one, each with why (src/shared/related.ts; 21 Oct 2026, gap G25). */
    relatedNotes: (path: string) => invoke<RelatedItem[]>('index:related-notes', path),
    graph: () => invoke<GraphData>('index:graph'),
    /** The graph since the generation the window holds: only what moved, or the whole graph. */
    graphSince: (since: number) => invoke<GraphSnapshot>('index:graph-since', since),
    search: (query: string) => invoke<SearchHit[]>('index:search', query),
    query: (query: string) => invoke<string[]>('index:query', query),
    outgoing: (path: string) => invoke<OutgoingLink[]>('index:outgoing', path),
    tags: () => invoke<TagCount[]>('index:tags'),
    linkMention: (source: string, line: number, target: string) => invoke<boolean>('index:link-mention', source, line, target),
  },
  /** The connected vault (src/shared/records.ts): a record's peek, and the questions screens ask of the records. */
  records: {
    peek: (ref: RecordRef) => invoke<RecordPeek | null>('records:peek', ref),
    find: (words: string, types?: RecordType[]) => invoke<VaultRecord[]>('records:find', words, types),
    person: (who: string, project?: string) => invoke<PersonItems | null>('records:person', who, project),
    meeting: (which: string) => invoke<MeetingItems | null>('records:meeting', which),
    attention: (project: string) => invoke<ProjectAttention | null>('records:attention', project),
  },
  daily: {
    open: (iso?: string) => invoke<string>('daily:open', iso),
    /** Where the days live when they don't live in the day-notes folder: one suggestion line, never auto-switching. */
    folderHint: () => invoke<{ folder: string; count: number } | null>('daily:folder-hint'),
  },
  settings: {
    get: () => invoke<AppSettings>('settings:get'),
    update: (patch: SettingsPatch) => invoke<AppSettings>('settings:update', patch),
    chooseLibrary: () => invoke<string | null>('settings:choose-library'),
  },
  /** Your vaults, your PCs, the move into Documents\Ironleaf, a new vault, Export vault and Import vault
   *  (Settings › Files and links, Today's card; src/main/vault-home-service.ts). */
  /** This PC's sync state for the open vault, and its fixes (Settings › Files and links, Today; src/main/vault-sync.ts). */
  sync: {
    status: (fresh?: boolean) => invoke<SyncView | null>('sync:status', !!fresh),
    fix: (id: 'start-onedrive' | 'show-onedrive' | 'keep-here' | 'merge' | 'keep-both' | 'merge-all', copy?: string) => invoke<SyncFixDone>('sync:fix', id, copy),
  },
  home: {
    status: (fresh?: boolean) => invoke<HomeStatus>('home:status', !!fresh),
    open: (folder: string) => invoke<VaultInfo | null>('home:open', folder),
    planMove: () => invoke<HomeMovePlan | MoveRefusal>('home:plan-move'),
    move: () => invoke<MoveDone>('home:move'),
    oldFolder: (from: string, action: 'trash' | 'keep') => invoke<string>('home:old-folder', from, action),
    dismiss: () => invoke<void>('home:dismiss'),
    newVault: (name: string, choose: boolean) => invoke<VaultInfo | null>('home:new-vault', name, choose),
    /** `file`: a development build's checks only (an installed Ironleaf always asks with Windows' Save window). */
    exportVault: (file?: string) => invoke<ExportDone | null>('home:export', file),
    pickImport: (kind: 'folder' | 'zip', given?: string) => invoke<ImportPlan | null>('home:import-pick', kind, given),
    importNow: () => invoke<ImportSummary>('home:import'),
    cancelImport: () => invoke<void>('home:import-cancel'),
    undoImport: (id: string) => invoke<{ words: string; notes: number; files: number; restored: number; left: string[] }>('home:import-undo', id),
    onProgress: (cb: (p: ImportProgress) => void) => subscribe('home:progress', cb),
  },
  /** Notes from another app, paired with where they came from (Settings › Files and links › Import…; src/main/pairing). */
  pairing: {
    /** `mode`: a file or a folder (the app's usual one when not given); `given`: a development build's checks only. */
    pick: (kind: SourceKind, mode?: 'file' | 'folder', given?: string) => invoke<PairPlan | null>('pair:pick', kind, mode, given),
    bring: () => invoke<PairSummary>('pair:import'),
    cancel: () => invoke<void>('pair:cancel'),
    list: () => invoke<PairListed[]>('pair:list'),
    compare: (rel: string, copy: string) => invoke<{ mine: string; theirs: string }>('pair:compare', rel, copy),
    /** Live pairing (V10, V11): whether a token is saved on this PC (never the token), connect, sync, pause, end. */
    liveStatus: () => invoke<Record<'notion' | 'todoist', boolean>>('pair:live-status'),
    liveConnect: (kind: 'notion' | 'todoist', token: string) => invoke<PairSummary>('pair:live-connect', kind, token),
    liveSync: (kind: 'notion' | 'todoist', confirmed?: string) => invoke<PairSummary>('pair:live-sync', kind, confirmed),
    undoPair: (id: string) => invoke<{ words: string; notes: number; files: number; restored: number; left: string[] }>('pair:undo', id),
    liveDisconnect: (kind: 'notion' | 'todoist') => invoke<void>('pair:live-disconnect', kind),
    setPaused: (id: string, paused: boolean) => invoke<void>('pair:set-paused', id, paused),
    disconnect: (id: string) => invoke<void>('pair:disconnect', id),
    /** A large import's progress (F1): the bar listens while bringing in. */
    onProgress: (cb: (p: PairProgress) => void) => subscribe('pair:progress', cb),
  },
  /** Where the vault is (Settings › Files and links, Today's cards; src/main/vault-place.ts). */
  place: {
    status: (fresh?: boolean) => invoke<PlaceStatus>('place:status', !!fresh),
    /** What moving to a place would do (a target's path; null asks with Windows' folder window), or why it can't. */
    plan: (target: string | null) => invoke<MovePlan | MoveRefusal | null>('place:plan', target),
    /** The move last planned, done. */
    move: () => invoke<MoveDone>('place:move'),
    onProgress: (cb: (p: MoveProgress) => void) => subscribe('place:progress', cb),
    openFound: (folder: string) => invoke<MoveDone | null>('place:open-found', folder),
    openFolder: () => invoke<VaultInfo | null>('place:open-folder'),
    /** The folder open for a look becomes the library (the caller asks first, in its own words). */
    adoptOpen: () => invoke<VaultInfo>('place:adopt-open'),
    dismiss: (kind: 'tip' | 'found', folder: string) => invoke<void>('place:dismiss', kind, folder),
  },
  /** One vault, one writer (16 Nov 2026): who writes now, for the lock notice. */
  vaultLock: {
    status: () => invoke<VaultLockView>('vault-lock:status'),
    openOther: () => invoke<void>('vault-lock:open-other'),
    readOnly: () => invoke<VaultLockView>('vault-lock:read-only'),
  },
  /** The person's own AI connections (Settings › AI). A key goes in and never comes back. */
  models: {
    view: () => invoke<ModelsView>('models:view'),
    addConnection: (input: ModelConnectionInput & { key?: string }) => invoke<{ id: string; view: ModelsView }>('models:add-connection', input),
    updateConnection: (connectionId: string, patch: Partial<ModelConnectionInput>) => invoke<ModelsView>('models:update-connection', connectionId, patch),
    removeConnection: (connectionId: string) => invoke<ModelsView>('models:remove-connection', connectionId),
    setKey: (connectionId: string, key: string | null) => invoke<ModelsView>('models:set-key', connectionId, key),
    /** The models the provider says it has. */
    listRemote: (connectionId: string) => invoke<{ id: string; name: string }[]>('models:list-remote', connectionId),
    /** Speech-to-text: the connection and model that write recordings and dictation down (null: none). */
    setTranscription: (choice: { connection: string; model: string } | null) => invoke<ModelsView>('models:set-transcription', choice),
    test: (connectionId: string, modelId: string) => invoke<{ ok: boolean; words: string }>('models:test', connectionId, modelId),
  },
  /** One strip (one product, 9 Nov 2026): the view reports its tabs; the one above holds them. Each tab
   *  carries what it is (a place, a Notes folder, a note) so one place opens one tab above. */
  tabs: {
    report: (report: { tabs: { id: string; title: string; target?: { place?: string; folder?: string; note?: string } }[]; active: string | null }) => invoke<void>('tabs:report', report),
  },
  window: {
    /** The window buttons drawn over Ironleaf's top band, in the page's colours. */
    chrome: (colors: { background: string; symbols: string; height?: number }) => invoke<void>('window:chrome', colors),
    platform: process.platform,
    /** The size of everything (src/shared/interface-size.ts): the main side puts it on the window and keeps it there. */
    zoom: (factor: number) => invoke<number>('window:zoom', factor),
    /** A canvas has the keys (or no longer): Ctrl + plus, minus and 0 zoom the canvas while it does. */
    ownZoom: (on: boolean) => invoke<void>('window:own-zoom', on),
    /** Cut, copy, paste, select all, and spelling (from the right-click menu). */
    edit: (command: 'cut' | 'copy' | 'paste' | 'paste-plain' | 'select-all' | 'replace-misspelling' | 'add-word', word?: string) => invoke<void>('edit:command', command, word),
  },
  /** The window-close handshake (F2): the main side asks, the window saves everything, then says it may go. */
  app: {
    onCloseRequest: (cb: () => void) => subscribe('app:close-request', () => cb()),
    closeReady: () => invoke<void>('app:close-ready'),
  },
  ai: {
    packPreview: (root: string, path: string, page: number) => invoke<import('../shared/note-passage').NotePage>('ai:pack-preview', root, path, page),
    packAction: (root: string, name: string, args: Record<string, unknown>) => invoke<ChatResult>('ai:pack-action', root, name, args),
    undoPackAction: (id: string) => invoke<string>('ai:pack-undo', id),
    chat: (requestId: string, history: ChatTurn[], options?: ChatOptions) => invoke<ChatResult>('ai:chat', requestId, history, options),
    cancel: (requestId: string) => invoke<void>('ai:chat-cancel', requestId),
    suggestLinks: (path: string, content: string) => invoke<AiLinkResult>('ai:suggest-links', path, content),
    /** A folder on this PC for the assistant to read, chosen in Windows' own folder window (null when cancelled). */
    addFolder: () => invoke<string | null>('ai:add-folder'),
    /** A document attached to the chat: its words (read from its bytes), or why it can't be attached. */
    attachmentText: (name: string, bytes: Uint8Array) => invoke<{ text: string; cut: boolean } | { error: string; scanned?: boolean }>('ai:attachment-text', name, bytes),
    /** Undoes what one answer changed in the notes; the words to show come back. */
    undo: (turnId: string) => invoke<string>('ai:undo', turnId),
    /** Accepts a change the assistant proposed to a project (Catch up). */
    applyProposal: (id: string) => invoke<{ ok: boolean; words: string; turnId?: string }>('ai:apply-proposal', id),
  },
  /** Dictation (src/main/dictation.ts): Windows voice typing (`start`, with the cursor where the words should go), or
   *  heard by the former host app inside it (`status`: which hears; `prepare`: the microphone; `hear`: one turn
   *  written down; `chunk`: one live piece while speaking). */
  dictation: {
    start: () => invoke<{ started: boolean; words?: string }>('dictation:start'),
    status: () => invoke<{ hearing: 'service' | 'windows'; ready: boolean; route: string; live: string; words?: string }>('dictation:status'),
    prepare: () => invoke<{ prepared: boolean }>('dictation:prepare'),
    hear: (audio: Uint8Array, mime: string) => invoke<{ text: string } | { error: string }>('dictation:hear', audio, mime),
    chunk: (request: { op: 'begin' | 'chunk' | 'end'; id?: string; route?: string; hear?: string; accent?: string; words?: string[]; audio?: string; last?: boolean }) =>
      invoke<{ partial?: string; final?: string; id?: string; rate?: number; provider?: string } | { error: string }>('dictation:chunk', request),
    available: process.platform === 'win32',
  },
  /** Quick capture (src/main/capture.ts): the box itself (its own window) and, from the main window, opening it. */
  capture: {
    show: () => invoke<void>('capture:show'),
    status: () => invoke<CaptureStatus>('capture:status'),
    context: () => invoke<CaptureContext>('capture:context'),
    save: (request: { kind: 'note' | 'task'; text: string; project: string | null; pictures: string[]; files: string[]; toAssets: boolean; ignoreDue?: boolean }) => invoke<CaptureSaved>('capture:save', request),
    undo: (id: string) => invoke<string>('capture:undo', id),
    open: (target: string | null) => invoke<void>('capture:open', target),
    close: () => invoke<void>('capture:close'),
    resize: (height: number) => invoke<void>('capture:resize', height),
    snip: () => invoke<SnipResult>('capture:snip'),
    dropPicture: (id: string) => invoke<void>('capture:drop-picture', id),
    addPicture: (data: Uint8Array) => invoke<SnipResult>('capture:add-picture', data),
    dictate: () => invoke<{ started: boolean; words?: string }>('capture:dictate'),
    /** The box dictated through the former host app (src/main/capture.ts): which hears, one turn, one live piece, the microphone. */
    dictateStatus: () => invoke<{ hearing: 'service' | 'windows'; ready: boolean; route: string; live: string; words?: string }>('capture:dictate-status'),
    dictatePrepare: () => invoke<{ prepared: boolean }>('capture:dictate-prepare'),
    dictateHear: (audio: Uint8Array, mime: string) => invoke<{ text: string } | { error: string }>('capture:dictate-hear', audio, mime),
    dictateChunk: (request: { op: 'begin' | 'chunk' | 'end'; id?: string; route?: string; hear?: string; accent?: string; words?: string[]; audio?: string; last?: boolean }) =>
      invoke<{ partial?: string; final?: string; id?: string; rate?: number; provider?: string } | { error: string }>('capture:dictate-chunk', request),
    remember: (patch: { toAssets?: boolean }) => invoke<void>('capture:remember', patch),
    snipImage: () => invoke<{ url: string; width: number; height: number } | null>('capture:snip-image'),
    snipDone: (rect: { x: number; y: number; width: number; height: number } | null) => invoke<void>('capture:snip-done', rect),
    onShown: (cb: (info: { at: number }) => void) => subscribe('capture:shown', cb),
    onHidden: (cb: () => void) => subscribe('capture:hidden', () => cb()),
    onWindow: (cb: (title: string) => void) => subscribe('capture:window', cb),
  },
  /** The web clipper (src/main/clipper.ts): its pairing code, on or off, and the extension's folder. */
  clipper: {
    status: () => invoke<ClipperStatus>('clipper:status'),
    set: (on: boolean) => invoke<ClipperStatus>('clipper:set', on),
    reveal: () => invoke<string>('clipper:reveal'),
  },
  /** Private notes: encrypted on disk, opened with Windows Hello or the recovery password (src/main/private-notes.ts). */
  private: {
    status: () => invoke<PrivateStatus>('private:status'),
    setUp: (password: string, withHello: boolean) => invoke<PrivateStatus>('private:setup', password, withHello),
    unlockWithHello: () => invoke<PrivateStatus>('private:unlock-hello'),
    unlockWithPassword: (password: string) => invoke<PrivateStatus>('private:unlock-password', password),
    lock: () => invoke<PrivateStatus>('private:lock'),
    addThisPc: () => invoke<PrivateStatus>('private:add-pc'),
    changePassword: (password: string) => invoke<void>('private:change-password', password),
    used: () => invoke<void>('private:used'),
    stepUpWithHello: () => invoke<void>('private:step-up-hello'),
    stepUpWithPassword: (password: string) => invoke<void>('private:step-up-password', password),
    list: () => invoke<PrivateEntry[]>('private:list'),
    read: (path: string) => invoke<string>('private:read', path),
    write: (path: string, text: string) => invoke<void>('private:write', path, text),
    create: (folder: string, name: string) => invoke<string>('private:create', folder, name),
    rename: (from: string, to: string) => invoke<string>('private:rename', from, to),
    remove: (path: string) => invoke<void>('private:remove', path),
    search: (query: string) => invoke<{ path: string; line: string }[]>('private:search', query),
  },
  /** Sensitivity levels and who may read what (Settings › Privacy and secrets; src/main/sensitive.ts). */
  privacy: {
    state: () => invoke<PrivacyState>('privacy:state'),
    store: () => invoke<SensitivityStore>('privacy:store'),
    levelOf: (path: string) => invoke<LevelOfView>('privacy:level-of', path),
    setLevel: (path: string, level: Level | null) => invoke<LevelOfView>('privacy:set-level', path, level),
    /** A level set in the open note's own words (the editor saves it): kept in the audit trail. */
    noted: (path: string, level: Level | null) => invoke<void>('privacy:noted', path, level),
    setFolder: (folder: string, level: Level | null) => invoke<PrivacyState>('privacy:set-folder', folder, level),
    setType: (type: string, level: Level | null) => invoke<PrivacyState>('privacy:set-type', type, level),
    setAccess: (who: string, levels: Level[] | null) => invoke<PrivacyState>('privacy:set-access', who, levels),
    setPhotos: (rule: 'ask' | 'never') => invoke<PrivacyState>('privacy:set-photos', rule),
  },
  /** Secrets: the locked store (the same lock as Private notes); values only through reveal, and copy clears itself. */
  secrets: {
    status: () => invoke<SecretsStatus>('secrets:status'),
    list: () => invoke<SecretView[]>('secrets:list'),
    add: (input: SecretInput) => invoke<SecretView>('secrets:add', input),
    update: (id: string, patch: SecretInput) => invoke<SecretView>('secrets:update', id, patch),
    remove: (id: string) => invoke<void>('secrets:remove', id),
    reveal: (id: string) => invoke<string>('secrets:reveal', id),
    copy: (id: string) => invoke<{ seconds: number }>('secrets:copy', id),
    copyLink: (id: string) => invoke<{ seconds: number }>('secrets:copy-link', id),
    usedIn: (id: string) => invoke<{ path: string; title: string }[]>('secrets:used-in', id),
  },
  /** The one Locked place (10.0 v2locked): one lock over private notes and secrets, both counts together. */
  locked: {
    status: () => invoke<LockedStatus>('locked:status'),
  },
  /** The secret scanner: findings masked; a move into Secrets with locked links left behind, and its Undo. */
  scan: {
    run: () => invoke<ScanReport>('scan:run'),
    move: (items: { path: string; fp: string; name?: string }[]) => invoke<SecretsMoveResult>('scan:move', items),
    undo: (id: string) => invoke<string>('scan:undo', id),
    ignore: (fp: string, on = true) => invoke<void>('scan:ignore', fp, on),
  },
  /** Who or what read or changed which sensitive item, and when. */
  audit: {
    list: (months?: number) => invoke<AuditEntry[]>('audit:list', months),
    exported: (where: string) => invoke<void>('audit:exported', where),
  },
  /** Private notes sorted into levels. */
  migrate: {
    plan: () => invoke<MigrationNote[]>('migrate:plan'),
    run: (choices: MigrationChoice[]) => invoke<MigrationResult>('migrate:run', choices),
  },
  /** The asset store (src/main/assets.ts): logos, pictures, icons and documents kept in the library, and the brand kit. */
  /** A PDF's first page: a kept picture, that it can't be drawn, or its bytes to draw (and the name to keep it under). */
  pdf: {
    page: (where: { project: string; file: string; version?: string } | { rel: string }) => invoke<{ url: string } | { failed: true } | { key: string; bytes: Uint8Array }>('pdf:page', where),
    save: (key: string, data: Uint8Array | null) => invoke<string | null>('pdf:save', key, data),
    /** A PDF in the notes, whole, for the reader. */
    bytes: (rel: string) => invoke<Uint8Array>('pdf:bytes', rel),
  },
  assets: {
    list: () => invoke<AssetListing>('assets:list'),
    details: (path: string) => invoke<AssetDetails>('assets:details', path),
    update: (path: string, patch: AssetPatch) => invoke<AssetDetails>('assets:update', path, patch),
    setBrand: (brand: BrandKit) => invoke<BrandKit>('assets:brand', brand),
    brands: (action: BrandAction) => invoke<BrandSection & { kit?: NamedBrandKit }>('assets:brands', action),
    collections: (action: { kind: 'add' | 'remove'; name: string } | { kind: 'rename'; name: string; to: string }) => invoke<string[]>('assets:collections', action),
    /** Files on this PC about to be copied in: each one's kind and the asset with the same content, if any. */
    check: (paths: string[]) => invoke<{ source: string; name: string; size: number; kind: AssetKind; duplicateOf?: string }[]>('assets:check', paths),
    add: (paths: string[], options: { duplicates: 'keep' | 'existing'; collection?: string; kind?: AssetKind }) => invoke<{ added: string[]; reused: string[] }>('assets:add', paths, options),
    /** Files chosen in Windows' own window ([] when cancelled). */
    pick: () => invoke<string[]>('assets:pick'),
    source: (path: string) => invoke<{ svg: string } | { bytes: Uint8Array; type: string } | null>('assets:source', path),
    saveThumb: (path: string, data: Uint8Array | null, info: { width?: number; height?: number; palette?: string[] }) => invoke<string | null>('assets:thumb', path, data, info),
  },
  /** Today: the day's work across every project (src/shared/today.ts), and the files changed in their folders. */
  today: {
    data: () => invoke<TodayData>('today:data'),
    files: (since: number) => invoke<TodayFileInput[]>('today:files', since),
  },
  /** Today's calendar from the former host app (src/main/calendar.ts): its events, or not connected and why. */
  calendar: {
    today: () => invoke<CalendarToday>('calendar:today'),
    /** Two-way sync (8.9): the calendars, events across days, and writes through the former host app. */
    list: () => invoke<CalendarList>('calendar:list'),
    range: (from: string, to: string) => invoke<CalendarRange>('calendar:range', from, to),
    write: (args: { op: 'create' | 'update' | 'delete'; calendarId: string; eventId?: string; event?: { title: string; start: string; end: string; allDay: boolean; location: string } }) => invoke<CalendarWrite>('calendar:write', args),
  },
  /** The morning brief on Today (src/main/brief.ts): its lines, and "Not useful" (and its Undo) by a line's id. */
  brief: {
    get: () => invoke<Brief>('brief:get'),
    notUseful: (id: string) => invoke<Brief>('brief:not-useful', id),
    usefulAgain: (id: string) => invoke<Brief>('brief:useful-again', id),
  },
  /** Export everything (31 Oct 2026): one zip saved where chosen, in Settings › Backups and sync and the palette. */
  portable: {
    exportAll: (o?: { includePrivate?: boolean; file?: string }) => flagUnlockNeeded(invoke<PortableResult | null>('portable:export', o ?? {})),
    previewProject: (project: string) => invoke<{ entries: string[]; token: string }>('portable:preview-project', project),
    exportProject: (project: string, o?: { expectedPreview?: string; includePrivate?: boolean; file?: string }) => flagUnlockNeeded(invoke<PortableResult | null>('portable:export-project', project, o ?? {})),
    cancel: () => invoke<void>('portable:cancel'),
    onProgress: (cb: (p: PortableProgress) => void) => subscribe('portable:progress', cb),
  },
  /** Settings › Backup and sync (src/main/backup.ts; 21 Oct 2026): the Git backup and the encrypted sync folder. */
  backup: {
    view: () => invoke<BackupView>('backup:view'),
    git: (patch: Partial<GitBackupPrefs>) => invoke<BackupView>('backup:git', patch),
    gitToken: (token: string, user?: string) => invoke<BackupView>('backup:git-token', token, user),
    gitNow: () => invoke<BackupView>('backup:git-now'),
    pickFolder: () => invoke<{ folder: string; existing: boolean } | null>('backup:sync-pick'),
    setUpSync: (folder: string, passphrase: string) => invoke<{ joined: boolean; view: BackupView }>('backup:sync-setup', folder, passphrase),
    sync: (patch: { on?: boolean; minutes?: number }) => invoke<BackupView>('backup:sync', patch),
    forgetSync: () => invoke<BackupView>('backup:sync-forget'),
    syncNow: () => invoke<BackupView>('backup:sync-now'),
    onChange: (fn: (view: BackupView) => void) => subscribe<BackupView>('backup:changed', fn),
  },
  /** Settings › Ironleaf Sync (src/main/sync/service.ts, docs/SYNC.md). */
  cloudSync: syncApi(invoke, subscribe),
  /** Settings › Teams (src/main/teams/service.ts; Ironleaf Cloud's docs/TEAMS.md). */
  teams: teamsApi(invoke, subscribe),
  /** The meeting recorder (src/main/meeting-recorder.ts): what this PC can do, the window allowed to record, a piece of the
   *  recording written down by the former host app, and the notes made from the transcript. */
  recorder: {
    status: () => invoke<RecorderStatus>('recorder:status'),
    prepare: () => invoke<RecorderStatus>('recorder:prepare'),
    transcribe: (audio: Uint8Array, mime: string, hints?: string[]) => invoke<Transcribed | TranscribeFailure>('recorder:transcribe', audio, mime, hints),
    notes: (note: string, input: { title: string; date: string; transcript: string; people: string[]; me?: string; speakers?: SpeakersForPrompt }, requestId?: string) => invoke<{ notes: MeetingNotes | null; error?: string }>('recorder:notes', note, input, requestId),
    minutes: (note: string, input: { title: string; date: string; transcript: string; people: string[]; me?: string; attendees?: string[]; speakers?: SpeakersForPrompt }, requestId?: string) => invoke<{ minutes: MeetingMinutes | null; error?: string; partial?: true }>('recorder:minutes', note, input, requestId),
    /** Stops the notes or minutes ask with this id (its wait aborts and says it was stopped). */
    cancel: (requestId: string) => invoke<void>('recorder:cancel', requestId),
    /** A recording kept on disk as it goes (Ironleaf's own data): begun, its sound and speech added, its record
     *  updated, the ones not finished listed (after a crash or a restart), a stretch of its speech read back, the
     *  recording put among the notes, and the folder removed once written up. */
    begin: (job: RecJob) => invoke<RecJob>('recorder:begin', job),
    append: (id: string, kind: 'audio' | 'speech', bytes: Uint8Array) => invoke<void>('recorder:append', id, kind, bytes),
    update: (id: string, patch: Partial<RecJob>) => invoke<RecJob | null>('recorder:update', id, patch),
    jobs: () => invoke<RecJob[]>('recorder:jobs'),
    speech: (id: string, start: number, seconds: number, side?: 'mic' | 'pc') => invoke<Uint8Array>('recorder:speech', id, start, seconds, side),
    keep: (id: string, name: string, note: string) => invoke<string>('recorder:keep', id, name, note),
    discard: (id: string) => invoke<void>('recorder:discard', id),
    /** The extra far-side capture (m6, a call on any output): started with the speakers as Chromium lists them; its
     *  sound and state arrive unasked while it captures. Without the part each answers cleanly. */
    extraStatus: () => invoke<ExtraStatus>('recorder:extra-status'),
    extraStart: (outputs: { deviceId: string; label: string }[]) => invoke<ExtraStartResult>('recorder:extra-start', outputs),
    extraStop: () => invoke<void>('recorder:extra-stop'),
    onExtraAudio: (fn: (audio: ExtraAudio) => void) => subscribe<ExtraAudio>('recorder:extra-audio', fn),
    onExtraState: (fn: (state: { capturing: boolean; device: string; died?: boolean }) => void) => subscribe<{ capturing: boolean; device: string; died?: boolean }>('recorder:extra-state', fn),
  },
  /** The meeting's voices (src/main/meeting-speakers.ts): whether they can be told apart on this PC, each voiced
   *  piece-side heard live (its provisional voice, rough on purpose), the live voices forgotten at the end, one final
   *  pass over the kept speech settling them, and an earlier meeting re-run from its kept recording in pieces. */
  speakers: {
    status: () => invoke<{ ready: boolean; words?: string }>('speakers:status'),
    liveBegin: (job: string, expected?: number) => invoke<void>('speakers:live-begin', job, expected),
    live: (job: string, wav: Uint8Array, side: 'mic' | 'pc' | 'mix', start: number, seconds: number) => invoke<{ voice: number; spans?: { voice: number; start: number; seconds: number }[] }>('speakers:live', job, wav, side, start, seconds),
    liveEnd: (job: string) => invoke<{ turns: SpeakerTurn[] }>('speakers:live-end', job),
    final: (job: string, sources: 'mic' | 'mic+pc', stereo: boolean, liveTurns: SpeakerTurn[], names: SpeakerNames, meeting?: { title: string; attendees: string[]; me?: string }) => invoke<{ turns: SpeakerTurn[] } | { error: string }>('speakers:final', job, sources, stereo, liveTurns, names, meeting),
    rerunBegin: (job: string) => invoke<void>('speakers:rerun-begin', job),
    rerunAppend: (job: string, bytes: Uint8Array) => invoke<void>('speakers:rerun-append', job, bytes),
    rerunEnd: (job: string) => invoke<{ turns: SpeakerTurn[] } | { error: string }>('speakers:rerun-end', job),
  },
  /** Notebook mode (src/main/notebook.ts): a folder's sources and ticks, cited answers, the Studio's outputs, Find sources
   *  through the former host app, and flashcard reviews (a deck, a card graded, the decks due for Today, an audio
   *  script's lines). */
  notebook: {
    state: (folder: string) => invoke<NotebookState>('notebook:state', folder),
    choose: (folder: string, choice: SourcesChoice) => invoke<NotebookState>('notebook:choose', folder, choice),
    ask: (folder: string, question: string, previous?: string) => invoke<NotebookAnswer>('notebook:ask', folder, question, previous ?? ''),
    make: (folder: string, kind: StudioKind) => invoke<string>('notebook:make', folder, kind),
    saveAnswer: (id: string) => invoke<string>('notebook:save-answer', id),
    find: (folder: string, topic: string) => invoke<{ id: string }>('notebook:find', folder, topic),
    findStatus: (id: string) => invoke<{ status: 'working' | 'done' | 'failed'; path?: string; why?: string }>('notebook:find-status', id),
    deck: (path: string) => invoke<{ path: string; title: string; cards: Card[]; due: string[]; review: Record<string, ReviewState> }>('notebook:deck', path),
    grade: (path: string, id: string, grade: 'again' | 'hard' | 'good' | 'easy') => invoke<ReviewState>('notebook:grade', path, id, grade),
    due: () => invoke<DueDeck[]>('notebook:due'),
    script: (path: string) => invoke<{ lines: ScriptLine[]; voices: string[] }>('notebook:script', path),
  },
  /** Today as the hub (src/main/hub.ts): a day's note, meetings and activity, the week strip's dots, the Due list, a task
   *  ticked from it, and the day's note made on its first words (its place comes back). */
  hub: {
    day: (iso: string, opened?: readonly string[]) => invoke<HubDay>('hub:day', iso, opened),
    marks: (from: string, to: string) => invoke<Record<string, DayMark>>('hub:marks', from, to),
    due: () => invoke<DueView>('hub:due'),
    dueOn: (iso: string) => invoke<DueEntry[]>('hub:due-on', iso),
    tick: (path: string, line: number, text: string, done: boolean) => invoke<string>('hub:tick', path, line, text, done),
    start: (iso: string) => invoke<string>('hub:start', iso),
  },
  /** "Capture to…" (src/main/capture-flows.ts; 21 Oct 2026, gap G27): a line added with the time to a flow's place (a
   *  project's log asks which project when its flow doesn't say). */
  captureFlows: {
    add: (id: string, text: string, project?: string) => invoke<{ path: string; words: string }>('capture-flow:add', id, text, project ?? ''),
  },
  /** Tasks across the notes (src/main/tasks.ts; 21 Oct 2026, gap G24): every tick-box line for the Tasks view, a tick
   *  written into its note, a due day set ("📅 2026-10-24", with a time) and a task made a reminder at its time. */
  tasks: {
    view: () => invoke<TasksView>('tasks:view'),
    tick: (path: string, line: number, text: string, done: boolean) => invoke<{ words: string; line: string }>('tasks:tick', path, line, text, done),
    setDue: (path: string, line: number, text: string, iso: string | null, time: string | null) => invoke<string>('tasks:due', path, line, text, iso ?? '', time ?? ''),
    remind: (path: string, line: number, text: string) => invoke<string>('tasks:remind', path, line, text),
    edit: (path: string, line: number, text: string, rest: string) => invoke<{ words: string; line: string }>('tasks:edit', path, line, text, rest),
  },
  /** Shared spaces (10.0 item 26, src/main/shared-spaces.ts): the household's spaces and one space's home. */
  sharedSpaces: {
    list: () => invoke<SharedSpaceListItem[]>('shared-spaces:list'),
    home: (folder: string) => invoke<SharedSpaceHome | null>('shared-spaces:home', folder),
  },
  /** Reminders (⏰ task lines in the notes, src/main/reminders.ts): Today's card, and ticking or snoozing one (by its key);
   *  the words to show come back. */
  reminders: {
    view: () => invoke<RemindersView>('reminders:view'),
    done: (key: string) => invoke<string>('reminders:done', key),
    untick: (key: string) => invoke<string>('reminders:untick', key),
    snooze: (key: string, until: number) => invoke<string>('reminders:snooze', key, until),
  },
  /** Names Windows cannot keep (src/main/vault-check.ts): the plan, the person's word, and one Undo. */
  names: {
    preview: () => invoke<{ pairs: [string, string][]; notes: string[]; decided: 'approved' | 'declined' | null }>('names-preview'),
    repair: () => invoke<string>('names-repair'),
    leave: () => invoke<string>('names-leave'),
    undo: () => invoke<string>('names-undo'),
  },
  /** The weekly tidy (src/main/weekly-tidy.ts): this week's proposal, each line applied or skipped, each change undone. */
  tidy: {
    status: () => invoke<TidyStatus>('tidy:status'),
    get: () => invoke<TidyProposal | null>('tidy:get'),
    needs: () => invoke<TidyNeed[]>('tidy:needs'),
    prepare: () => invoke<TidyProposal | null>('tidy:prepare'),
    apply: (id: string) => invoke<{ words: string; line: TidyLine }>('tidy:apply', id),
    skip: (id: string) => invoke<TidyLine>('tidy:skip', id),
    applyAll: () => invoke<{ applied: number; failed: number; words: string }>('tidy:apply-all'),
    undo: (id: string) => invoke<{ words: string; line: TidyLine }>('tidy:undo', id),
  },
  /** Projects: the Projects home, a project's page, its folder's files (live), edits in place. */
  projects: {
    list: () => invoke<ProjectCard[]>('projects:list'),
    /** Every project in full, with its file's fingerprint (the Timeline). */
    all: () => invoke<{ path: string; version: string; project: Project }[]>('projects:all'),
    /** Each live project's catch-up checks (10.0 item 19): standing checks and proposals from its changed notes. */
    checks: () => invoke<ProjectCheckState[]>('projects:checks'),
    view: (path: string) => invoke<ProjectView>('project:view', path),
    /** Its folder on this PC, when its note names another PC's (src/main/project-places.ts): choose (a picker, or the
     *  folder given), find, new (a folder made here), without (work without a folder here), forget. */
    folderHere: (path: string, action: 'choose' | 'find' | 'new' | 'without' | 'forget', folder?: string) => invoke<FolderHereResult>('project:folder-here', path, action, folder ?? ''),
    /** The project's conversations in the former host app (null: not inside the former host app, or its folder isn't on this
PC). */
    work: (path: string) => invoke<ProjectConversation[] | null>('project:work', path),
    openConversation: (id: string) => invoke<void>('project:open-conversation', id),
    /** The project's files (on this PC, or on a remote computer through the former host app); `fresh` asks again rather than
     *  using what was just read (Refresh). */
    files: (path: string, fresh?: boolean) => invoke<ProjectFiles | null>('project:files', path, fresh === true),
    /** A remote project's file as it is (a picture, a PDF, a recording), for the viewer. */
    fileBytes: (path: string, file: string) => invoke<Uint8Array>('project:file-bytes', path, file),
    openFile: (path: string, file: string) => invoke<void>('project:open-file', path, file),
    showFile: (path: string, file?: string) => invoke<void>('project:show-file', path, file ?? ''),
    openFolder: (path: string) => invoke<void>('project:open-folder', path),
    /** One change made by hand (src/shared/project-file.ts ProjectEdit), on the version of the file the page shows. */
    edit: (path: string, edit: ProjectEdit, version?: string) => invoke<ProjectEditResult>('project:edit', path, edit, version ?? ''),
    undo: (path: string) => invoke<ProjectEditResult>('project:undo', path),
    /** What Tidy would move in this project (src/shared/project-tidy.ts), for its preview. */
    tidyPreview: (path: string) => invoke<TidyPreview>('project:tidy-preview', path),
    /** What Tidy would move in every project, one row per project that has something to move. */
    tidyAllPreview: () => invoke<TidyPreview[]>('projects:tidy-preview'),
    /** Tidy this project on the version shown, writing what moves to its History note. */
    tidy: (path: string, version: string) => invoke<TidyResult>('project:tidy', path, version),
    /** Take the last Tidy of this project back (its History note goes back too). */
    tidyUndo: (path: string) => invoke<TidyResult>('project:tidy-undo', path),
    redo: (path: string) => invoke<ProjectEditResult>('project:redo', path),
    /** What changed in the project lately, from its earlier versions, newest first (the hub's Recent activity). */
    changes: (path: string) => invoke<ProjectChange[]>('project:changes', path),
    readFile: (path: string, file: string) => invoke<ProjectFileText>('project:read-file', path, file),
    thumb: (path: string, file: string) => invoke<string | null>('project:thumb', path, file),
    /** A project by hand; `template` is a project template's path (Templates/Projects), else just the name. */
    /** `area`: an area of life's folder (its Projects folder holds it). */
    create: (name: string, folder?: string, template?: string, area?: string) => invoke<string>('project:create', name, folder ?? '', template ?? '', area ?? ''),
    /** Folders that read like projects but claim nothing: offered on the Projects home, never made on their own. */
    folderOffers: () => invoke<FolderProjectOffer[]>('projects:folder-offers'),
    /** Make an offered folder a project: one blank-but-for-the-line file, the folder's notes untouched. */
    fromFolder: (folder: string) => invoke<string>('project:from-folder', folder),
    /** Take a thin file's project claim back: the line goes, the note stays an ordinary note. */
    unclaim: (path: string) => invoke<string>('project:unclaim', path),
    /** A card edited on the project's canvas (src/shared/project-canvas.ts), written to the project file. */
    /** Projects related to each other, as the graph has them: shared people, mentions, going together, tags. */
    relations: () => invoke<{ a: string; b: string; kinds: string[]; reasons: string[] }[]>('projects:relations'),
    canvasEdit: (path: string, edit: ItemEdit) => invoke<ProjectView>('project:canvas-edit', path, edit),
    /** Files dropped on the project's canvas, copied into its folder on the PC: their names there. */
    addFiles: (path: string, files: string[]) => invoke<string[]>('project:add-files', path, files),
  },
  /** Docs (src/main/docs.ts): a project turned into a doc and back, a new doc, Undo of a conversion. */
  docs: {
    toDoc: (path: string) => invoke<DocConvertResult>('docs:to-doc', path),
    toProject: (path: string) => invoke<DocConvertResult>('docs:to-project', path),
    undo: (path: string) => invoke<DocConvertResult>('docs:undo', path),
    /** A new doc in the Docs folder, from a doc template (Templates/Docs) or blank: its path. */
    create: (name: string, template?: string) => invoke<string>('docs:create', name, template ?? ''),
  },
  /** Meetings (src/main/reviews.ts): a note's projects and people, the assistant's finds. */
  meetings: {
    context: (note: string) => invoke<MeetingContext | null>('meetings:context', note),
    findMore: (note: string, text: string) => invoke<{ actions: MeetingAction[]; error?: string }>('meetings:find-more', note, text),
  },
  /** The weekly review: its draft, the assistant's look-over, the person's choices applied, Undo, the Friday notice. */
  reviews: {
    status: () => invoke<{ last: number | null; putOff: number | null }>('reviews:status'),
    putOff: () => invoke<void>('reviews:put-off'),
    draft: () => invoke<ReviewDraft & { last: number | null }>('reviews:draft'),
    lookOver: (draft: ReviewDraft) => invoke<{ draft: ReviewDraft; error?: string; added: number }>('reviews:look-over', draft),
    apply: (draft: ReviewDraft) => invoke<{ note: string; changes: number; words: string; id: string; outcomes: ReviewOutcome[] }>('reviews:apply', draft),
    /** Undoes a whole review (reviews.apply) by its id. */
    undo: (id: string) => invoke<string>('reviews:undo', id),
  },
  /** The vault tidy (src/main/vault-tidy.ts): a preview first (a dry run, nothing written), then a run on a
   *  copy beside the vault. Behind the Settings switch, off until turned on. */
  vaultTidy: {
    preview: () => invoke<{ report: TidyReport; words: string }>('vault:tidy-preview'),
    tidyCopy: () => invoke<{ folder: string; backup: string | null; report: TidyReport; words: string }>('vault:tidy-copy'),
  },
  /** Searching inside project files (src/main/file-index.ts): the words in each project folder's documents. */
  fileIndex: {
    /** Files matching a search, by their words or their name; `project` keeps to one project. */
    search: (query: string, options?: { project?: string; limit?: number }) => invoke<FileHit[]>('fileindex:search', query, options ?? {}),
    status: () => invoke<FileIndexStatus>('fileindex:status'),
    /** A file's words as the index keeps them ("\f<label>" lines start a page, slide or sheet). */
    read: (project: string, file: string) => invoke<{ state: FileTextState; text: string; cut: boolean }>('fileindex:read', project, file),
    /** Every project's files read again from the start. */
    rebuild: () => invoke<void>('fileindex:rebuild'),
  },
  /** Finding notes by what they mean (src/main/meaning-build.ts): the build's progress, or that it is off. */
  meaning: {
    status: () => invoke<MeaningStatus>('meaning:status'),
  },
  /** Words in pictures and scans (src/main/ocr.ts): what Windows' recogniser read among the notes. */
  ocr: {
    /** Pictures and scans matching a search, with the lines where the words are. */
    search: (query: string, options?: { limit?: number }) => invoke<OcrHit[]>('ocr:search', query, options ?? {}),
    status: () => invoke<OcrStatus>('ocr:status'),
    /** A picture's recognised lines, with where each sits (for marking the found words). */
    lines: (rel: string) => invoke<OcrLine[] | null>('ocr:lines', rel),
    /** A scan page's recognised lines: 'words', 'pending' (still being read), 'clear' (it has words of its own),
     *  'big', 'failed'. */
    page: (rel: string, page: number) => invoke<{ state: OcrEntryState | 'pending'; lines: OcrLine[] }>('ocr:page', rel, page),
    /** Every picture and scanned page read again from the start. */
    rebuild: () => invoke<void>('ocr:rebuild'),
  },
  /** Skills (Settings › AI › Skills): every skill, on or off, and a skill's whole text to start a copy from. */
  skills: {
    list: () => invoke<SkillsView>('skills:list'),
    text: (name: string) => invoke<string | null>('skills:text', name),
    /** A skill someone published, picked on this PC (its SKILL.md, or a .zip or .skill) and copied into the notes. */
    add: () => invoke<{ name: string; path: string; skipped: string[] } | null>('skills:add'),
  },
  /** Templates: the Templates page, notes made from one, a note saved as one, new ones, the ready-made ones back. */
  templates: {
    list: () => invoke<{ folder: string; templates: TemplateInfo[]; groups: { id: TemplateGroup; label: string; folder: string; words: string }[]; daily: string | null }>('templates:list'),
    /** Ironleaf's ready-made templates not in the library now (their names). */
    missing: () => invoke<string[]>('templates:missing'),
    /** Writes the missing ready-made templates again; how many. */
    restore: () => invoke<number>('templates:restore'),
    /** A new note from a template, in `folder` (its {{project}} from the project file at `project`); its path. */
    use: (template: string, name: string, folder: string, project?: string) => invoke<string>('templates:use', template, name, folder, project ?? ''),
    /** The same, with the answers to its prompts and AI fields (src/shared/template-fields.ts); its path and where its
     *  {{cursor}} was (line and column from 0). */
    make: (template: string, name: string, folder: string, project: string | undefined, answers: TemplateAnswers) => invoke<{ path: string; cursor: { line: number; ch: number } | null }>('templates:make', template, name, folder, project ?? '', answers),
    /** A template's AI fields written by the assistant from the note's name, its project and the answers (or why not). */
    aiFields: (template: string, info: { title: string; project?: string; answers: Record<string, string>; target?: string }) => invoke<{ fields: Record<string, string>; error?: string }>('templates:ai', template, info),
    saveAs: (note: string, name: string, description?: string) => invoke<string>('templates:save-as', note, name, description ?? ''),
    create: (group: TemplateGroup, name: string) => invoke<string>('templates:create', group, name),
  },
  // Recently deleted, the one list both apps share (8.0 U13; the former host app's
  // /native-desktop/neuralvault/recently-deleted).
  bin: {
    available: () => invoke<boolean>('bin:available'),
    call: (input: { action: 'list' | 'restore' | 'purge' | 'empty'; id?: string; type?: string; sessionId?: string }) => invoke<unknown>('bin:call', input),
  },

  /** The tray icon and starting at login (src/main/tray.ts): Settings, General, Tray and start-up. */
  tray: { state: () => invoke<import('../shared/tray-model').TrayView>('tray:state'), set: (patch: { keepInTray?: boolean; startAtLogin?: boolean }) => invoke<import('../shared/tray-model').TrayView>('tray:set', patch) },
  /** Settings › Connect an AI and What agents did (src/main/agent-access.ts). */
  agents: {
    state: () => invoke<AgentsState>('agents:state'),
    localMcp: (patch: { on?: boolean; level?: 'read' | 'edit'; http?: boolean; port?: number }) => invoke<AgentsState>('agents:local-mcp', patch),
    localMcpToken: () => invoke<AgentsState>('agents:local-mcp-token'),
    undo: (activityId: string) => invoke<string>('agents:undo', activityId),
    /** A delivered file opened or put away. */
    seenFile: (activityId: string) => invoke<void>('agents:seen', activityId),
  },
  /** Plugins, a first small door (src/main/plugins.ts): Settings › Plugins, the palette and Home. */
  plugins: {
    list: () => invoke<PluginView[]>('plugins:list'),
    /** Settings › Plugins opened: the example present the first time in any vault. */
    ensure: () => invoke<PluginView[]>('plugins:ensure'),
    set: (id: string, on: boolean) => invoke<PluginView[]>('plugins:set', id, on),
    allow: (id: string) => invoke<PluginView[]>('plugins:allow', id),
    remove: (id: string) => invoke<PluginView[]>('plugins:remove', id),
    runCommand: (pluginId: string, commandId: string) => invoke<{ ok: boolean; words: string }>('plugins:run-command', pluginId, commandId),
    cards: () => invoke<PluginCardView[]>('plugins:cards'),
    commands: () => invoke<PluginCommandView[]>('plugins:commands'),
    undo: (id: string) => invoke<string>('plugins:undo', id),
    openFolder: () => invoke<void>('plugins:open-folder'),
  },
  /** The bell's notices (inside the former host app; empty on its own). */
  notices: {
    list: () => invoke<NoticesView>('notices:list'),
    read: (id?: string) => invoke<NoticesView>('notices:read', id),
    open: (id: string) => invoke<{ opened: boolean }>('notices:open', id),
    clear: () => invoke<NoticesView>('notices:clear'),
  },
  on: {
    /** A link, the command or a file from outside asked the window for something (take it with external.take). */
    externalItems: (cb: () => void) => subscribe('external:items', () => cb()),
    /** File › Open file… in the window's menu. */
    loosePick: (cb: () => void) => subscribe('loose:pick', () => cb()),
    /** The bell's notices changed (the former host app kept a new one, or one was read). */
    noticesChanged: (cb: (view: NoticesView) => void) => subscribe('notices:changed', cb),
    /** The weekly tidy changed (prepared, applied, skipped, undone). */
    tidyChanged: (cb: (status: TidyStatus) => void) => subscribe('tidy:changed', cb),
    /** Agents, their requests or what they did changed. */
    agentsChanged: (cb: () => void) => subscribe('agents:changed', cb),
    /** Plugins switched, allowed or removed (read them again). */
    pluginsChanged: (cb: () => void) => subscribe('plugins:changed', () => cb()),
    /** Something a plugin wants said (with Undo while it is a write just made). */
    pluginsToast: (cb: (t: PluginToast) => void) => subscribe('plugins:toast', cb),
    /** Show Settings › AI agents (a Windows notice was clicked, or the former host app asked). */
    /** The former host app asked for a Settings section (Settings › Ironleaf there): 'agents' unless it named another, with its
row when one was named. */
    agentsShow: (cb: (section?: string, row?: string) => void) =>
      subscribe('agents:show', (payload?: unknown) => {
        if (typeof payload === 'string') return cb(payload, undefined);
        const p = payload as { section?: unknown; row?: unknown } | null | undefined;
        cb(typeof p?.section === 'string' ? p.section : undefined, typeof p?.row === 'string' ? p.row : undefined);
      }),
    vaultChanged: (cb: (change: VaultChange) => void) => subscribe('vault:changed', cb),
    vaultOpened: (cb: (info: VaultInfo) => void) => subscribe('vault:opened', cb),
    /** The vault's writer changed (the other app opened or closed it): read the lock again. */
    vaultLockChanged: (cb: (view: VaultLockView) => void) => subscribe('vault-lock:changed', cb),
    chatDelta: (cb: (event: ChatEvent) => void) => subscribe('ai:chat-delta', cb),
    /** What the Design studio is doing (its request's id and the step in words). */
    designStep: (cb: (event: { requestId: string; words: string }) => void) => subscribe('design:step', cb),
    /** Something the assistant did while answering (searched, read, made a note…). */
    chatStep: (cb: (event: ChatStepEvent) => void) => subscribe('ai:chat-step', cb),
    /** The assistant suggested changes to a note (or none wait there any more). */
    suggestions: (cb: (event: NoteSuggestionEvent) => void) => subscribe('suggestions:changed', cb),
    /** A change set was offered, accepted or rejected: how many files wait across every set now. */
    changeSets: (cb: (event: { waiting: number }) => void) => subscribe('change-sets:changed', cb),
    modelsChanged: (cb: (view: ModelsView) => void) => subscribe('models:changed', cb),
    /** The settings changed outside Settings (Ctrl + plus or minus stepped the interface size). */
    settingsChanged: (cb: (settings: AppSettings) => void) => subscribe('settings:changed', cb),
    /** What Ironleaf remembers about the vault changed in the vault (another PC's change arrived): the names. */
    stateChanged: (cb: (names: string[]) => void) => subscribe('state:changed', cb),
    /** A right-click, with what Chromium knows about the spot (a misspelt word and suggestions, the selection). */
    editContext: (cb: (info: EditContext) => void) => subscribe('edit:context', cb),
    /** A file or folder was added, moved or removed. */
    filesChanged: (cb: () => void) => subscribe('files:changed', () => cb()),
    /** Open this note (from the former host app's Open in Ironleaf). */
    noteShow: (cb: (path: string) => void) => subscribe('note:show', cb),
    /** Open this note at this line (a reminder's Windows notification was clicked). */
    noteReveal: (cb: (where: { path: string; line: number }) => void) => subscribe('note:reveal', cb),
    /** Open a place from the former host app's side bar (one product step 2): Today, Projects, Notes, People, Graph and the rest.
Step 3 carries a new note too. */
    vaultOpenPlace: (cb: (target: { place: string; folder?: string; newNote?: boolean }) => void) => subscribe('vault:open-place', cb),
    /** Open Vault's own Settings page for a section (one product step 4): the one Settings' door to a whole
     *  sub-screen (the keyboard editor, plugins, publish), in the view alone, never the window. */
    vaultOpenSettings: (cb: (target: { section: string; row?: string }) => void) => subscribe('vault:open-settings', cb),
    /** Whether the former host app's window split its main area and which side has focus (one product step 5 part
     *  3): the chat panel re-scopes from it at once. Part 4 carries the chat side along (its id, title and
     *  withheld state). To the view alone, never the window. */
    splitFocus: (cb: (told: SplitFocus) => void) => subscribe('vault:split-focus', cb),
    /** One strip (one product, 9 Nov 2026): show this Vault tab, told by the one above. To the view alone. */
    vaultTabsActivate: (cb: (target: { id: string }) => void) => subscribe('vault:tabs-activate', cb),
    /** One strip: close this Vault tab, told by the one above. To the view alone. */
    vaultTabsClose: (cb: (target: { id: string }) => void) => subscribe('vault:tabs-close', cb),
    /** Private notes locked (time unused, another folder of notes, or the person). */
    privateLocked: (cb: () => void) => subscribe('private:locked', () => cb()),
    /** Levels, access, Secrets or the trail changed (here, or another PC's sync): read them again. */
    privacyChanged: (cb: (what: 'privacy' | 'secrets' | 'audit') => void) => subscribe('privacy:changed', cb),
    /** The files index read files, or finished (the progress line). */
    fileIndexStatus: (cb: (status: FileIndexStatus) => void) => subscribe<FileIndexStatus>('fileindex:status', cb),
    /** A site was kept, published or unpublished: the lists and marks read again. */
    siteChanged: (cb: () => void) => subscribe('site:changed', () => cb()),
    /** Pictures and scanned pages read, or finished (the progress line). */
    ocrStatus: (cb: (status: OcrStatus) => void) => subscribe<OcrStatus>('ocr:status', cb),
    /** Meaning search building, ready, or off (the progress line). */
    meaningStatus: (cb: (status: MeaningStatus) => void) => subscribe<MeaningStatus>('meaning:status', cb),
  },
};

export interface EditContext {
  x: number;
  y: number;
  misspelled: string;
  suggestions: string[];
  selection: string;
  editable: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  link: string;
}

contextBridge.exposeInMainWorld('nv', api);
contextBridge.exposeInMainWorld('nvUpdate', updateCheckApi(ipcRenderer));
contextBridge.exposeInMainWorld('nvManaged', managedApi(ipcRenderer));
contextBridge.exposeInMainWorld('nvAccount', accountApi(ipcRenderer));

export type IronleafApi = typeof api;
