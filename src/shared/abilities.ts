// What the Vault can do (8.8, 31 Oct 2026: rival notes apps): the one registry of every ability, grouped, each in one
// plain line with a "Show me" target that opens the real place or does the first step. The Vault's page
// (views/AbilitiesPage.tsx), the website's features page (docs/abilities.json, written by tools/export-abilities.mjs
// from this file) and the tests all read this one source. Pure: no files, no window. A target is a command
// (state/commands.ts), a page (state/workspace.ts ViewType, Settings sections by path), or a pack (life-modules.ts,
// with an optional part). The guard (tests/abilities-88.test.mjs) fails if a command or a page is added without an
// entry here or an explicit mark in NON_FEATURE_COMMANDS / NON_FEATURE_PAGES.

import { LIFE_MODULES } from './life-modules';

export type AbilityGroupId =
  | 'write' | 'organise' | 'views' | 'projects' | 'meetings' | 'packs' | 'find' | 'capture' | 'private' | 'spark';

export interface AbilityGroup {
  id: AbilityGroupId;
  title: string;
  /** One plain line under the group name. */
  words: string;
}

export const ABILITY_GROUPS: AbilityGroup[] = [
  { id: 'write', title: 'Write', words: 'Notes, docs, drawings and everything inside them.' },
  { id: 'organise', title: 'Organise', words: 'Folders, tags, links and canvases that keep it tidy.' },
  { id: 'views', title: 'Views and databases', words: 'Tables, boards, calendars and cards over your notes.' },
  { id: 'projects', title: 'Projects and tasks', words: 'Projects, their dates, and every tick box.' },
  { id: 'meetings', title: 'Meetings', words: 'Notes, recordings, series and prep packs.' },
  { id: 'packs', title: 'Packs', words: 'Eighteen life areas, each switched on when you need it.' },
  { id: 'find', title: 'Find and ask', words: 'Search, the graph, notebooks and the helper.' },
  { id: 'capture', title: 'Capture and import', words: 'Quick notes in, and other apps out of your way.' },
  { id: 'private', title: 'Private and safe', words: 'Locked notes, secrets, versions and backups.' },
  { id: 'spark', title: 'AI and other apps', words: 'Your AI connections, agents, plugins and exports.' },
];

export type AbilityTarget =
  /** Run a command (its id in state/commands.ts). */
  | { kind: 'command'; command: string }
  /** Open a page (a ViewType; Settings takes its section as the path). */
  | { kind: 'page'; page: string; path?: string }
  /** Open a pack (life-modules.ts; a switched off pack opens Settings so it can be switched on). */
  | { kind: 'pack'; pack: string; part?: string };

export interface Ability {
  id: string;
  group: AbilityGroupId;
  title: string;
  /** One plain line: what it does. */
  words: string;
  target: AbilityTarget;
}

const cmd = (command: string): AbilityTarget => ({ kind: 'command', command });
const page = (pageName: string, path?: string): AbilityTarget => ({ kind: 'page', page: pageName, path });
const pack = (packId: string, part?: string): AbilityTarget => ({ kind: 'pack', pack: packId, part });

// Every ability but the packs (the packs are generated from LIFE_MODULES below, so the registry always lists the
// eighteen the app has, with the same names).
const ABILITIES_HEAD: Ability[] = [
  // Write
  { id: 'notes', group: 'write', title: 'Notes', words: 'Plain Markdown notes with links, pictures and files.', target: cmd('new-note') },
  { id: 'daily-notes', group: 'write', title: 'Daily notes', words: 'One note per day, today’s a key away.', target: cmd('daily') },
  { id: 'note-templates', group: 'write', title: 'Note templates', words: 'Meetings, updates and today’s note, pre-shaped.', target: cmd('templates') },
  { id: 'note-types', group: 'write', title: 'Note types', words: 'Notes, people, meetings, ideas and docs, each with its fields.', target: cmd('open-note-type') },
  { id: 'docs', group: 'write', title: 'Docs', words: 'How something is set up and run, step by step.', target: cmd('new-doc') },
  { id: 'tables', group: 'write', title: 'Tables in notes', words: 'Tables you edit cell by cell, with rows and columns that move.', target: cmd('table') },
  { id: 'callouts', group: 'write', title: 'Callouts and quotes', words: 'Tinted panels for warnings and tips, quotes for feedback.', target: cmd('callout') },
  { id: 'maths', group: 'write', title: 'Maths (LaTeX)', words: 'Maths blocks that typeset themselves as you type.', target: cmd('math-block') },
  { id: 'diagrams', group: 'write', title: 'Diagrams (Mermaid)', words: 'Flowcharts and diagrams from a few typed lines.', target: cmd('insert-mermaid') },
  { id: 'code', group: 'write', title: 'Code blocks', words: 'Code with highlighting, fenced and copyable.', target: cmd('code-block') },
  { id: 'footnotes', group: 'write', title: 'Footnotes', words: 'Asides that gather at the foot of the note.', target: cmd('footnote') },
  { id: 'drawings', group: 'write', title: 'Drawings', words: 'Freehand, shapes, arrows and labels on a free page.', target: cmd('new-drawing') },
  { id: 'pdf-read', group: 'write', title: 'Read and highlight PDFs', words: 'Pages, zoom and find in the document; highlights and clips kept in a note beside the PDF.', target: cmd('open-pdf') },
  { id: 'embeds', group: 'write', title: 'Embeds', words: 'See another note, block or picture inside this one.', target: cmd('insert-asset') },
  { id: 'block-refs', group: 'write', title: 'Block references', words: 'Link to a heading or a block inside any note.', target: cmd('link') },
  { id: 'synced-blocks', group: 'write', title: 'Synced blocks', words: 'One block shown in several notes, changed everywhere at once.', target: cmd('synced-block') },
  { id: 'page-columns', group: 'write', title: 'Columns on a page', words: 'Lay blocks side by side, two to four across.', target: cmd('new-note') },
  // Organise
  { id: 'folders', group: 'organise', title: 'Folders and files', words: 'Notes in folders, nested as deep as you like.', target: cmd('files') },
  { id: 'tags', group: 'organise', title: 'Tags', words: 'Tag notes, then rename, merge or retire tags in one place.', target: cmd('tags') },
  { id: 'areas', group: 'organise', title: 'Areas of life', words: 'Work, home and the rest, each with its folders.', target: cmd('areas') },
  { id: 'fold-area', group: 'organise', title: 'Move an area into another', words: 'Fold one area into another, every file and link moved, with one Undo after.', target: cmd('fold-area') },
  { id: 'people-page', group: 'organise', title: 'People and organisations', words: 'Everyone you know, with what connects to them.', target: cmd('people') },
  { id: 'canvases', group: 'organise', title: 'Canvases', words: 'Lay notes and ideas out on a free canvas.', target: cmd('new-canvas') },
  { id: 'relations', group: 'organise', title: 'Relations between notes', words: 'See how the open note connects to everything else.', target: cmd('local-graph') },
  { id: 'backlinks', group: 'organise', title: 'Backlinks', words: 'Every note that links here, listed beside it.', target: cmd('backlinks') },
  { id: 'outgoing', group: 'organise', title: 'Outgoing links', words: 'Everything this note points to, in one list.', target: cmd('outgoing') },
  { id: 'bookmarks-page', group: 'organise', title: 'Bookmarks', words: 'Pin notes, folders and searches where you can reach them.', target: cmd('bookmarks') },
  { id: 'assets-page', group: 'organise', title: 'Files and assets', words: 'Logos, pictures and files, kept once and reused.', target: cmd('assets') },
  { id: 'starters', group: 'organise', title: 'Starter templates', words: 'A CRM, habits, reading and seven more, each in one click.', target: cmd('starter-template') },
  { id: 'weekly-tidy', group: 'organise', title: 'Weekly tidy', words: 'One tidy list a week. Duplicates merged, broken links fixed, empty notes binned, each with Undo.', target: cmd('weekly-tidy') },
  // Views and databases
  { id: 'tables-view', group: 'views', title: 'Table views', words: 'Notes as a table by their properties, with sums.', target: cmd('new-view') },
  { id: 'boards-view', group: 'views', title: 'Board views', words: 'Drag notes between columns; the note keeps the move.', target: cmd('new-view-board') },
  { id: 'calendars-view', group: 'views', title: 'Calendar views', words: 'Notes on a month grid by the day they hold.', target: cmd('new-view-calendar') },
  { id: 'cards-view', group: 'views', title: 'Cards and lists', words: 'The same notes as cards or a plain list.', target: cmd('new-view-cards') },
  { id: 'formulas', group: 'views', title: 'Formulas in views', words: 'New columns worked out from other properties.', target: cmd('new-view') },
  { id: 'rollups', group: 'views', title: 'Rollups in views', words: 'Totals across linked records, such as a project’s hours.', target: cmd('new-view') },
  { id: 'view-forms', group: 'views', title: 'Forms from views', words: 'A form from a view’s fields, each answer a new record.', target: cmd('new-view') },
  { id: 'saved-views', group: 'views', title: 'Saved views', words: 'Every view is a file you own: it syncs and opens like a note.', target: cmd('open-views-folder') },
  { id: 'records-views', group: 'views', title: 'Views across projects', words: 'Build your own tables, boards, timelines and charts.', target: cmd('records-new') },
  { id: 'all-actions', group: 'views', title: 'Every action', words: 'All actions across projects, in one view.', target: cmd('records-actions') },
  { id: 'all-meetings-view', group: 'views', title: 'Every meeting', words: 'All meetings across projects, in one view.', target: cmd('records-meetings') },
  { id: 'people-across', group: 'views', title: 'Everyone across projects', words: 'All people across projects, in one view.', target: cmd('records-people') },
  { id: 'all-files', group: 'views', title: 'Every file', words: 'All files by what each is for, in one view.', target: cmd('records-files') },
  // Projects and tasks
  { id: 'projects-home', group: 'projects', title: 'Projects', words: 'Every project at a glance: health, next steps, due days.', target: cmd('projects') },
  { id: 'new-project', group: 'projects', title: 'New projects from shapes', words: 'Start from a shape with steps, dates and risks ready.', target: cmd('new-project') },
  { id: 'tasks-page', group: 'projects', title: 'Tasks', words: 'Every tick box in your notes, filtered and ticked here.', target: cmd('tasks') },
  { id: 'today-page', group: 'projects', title: 'Today', words: 'The day’s work across every project.', target: cmd('today') },
  { id: 'project-timeline', group: 'projects', title: 'Project timelines', words: 'Every project’s dates on one line, clashes called out.', target: cmd('timeline') },
  { id: 'week-review', group: 'projects', title: 'Weekly review', words: 'What moved, what slipped and what to chase, weekly.', target: cmd('weekly-review') },
  { id: 'workspace', group: 'projects', title: 'Project workspaces', words: 'A project’s actions, files, people and notes as views.', target: cmd('project-workspace') },
  { id: 'portfolio', group: 'projects', title: 'Portfolio board', words: 'Every project on one canvas.', target: cmd('portfolio-board') },
  { id: 'project-canvas', group: 'projects', title: 'Projects as canvases', words: 'A project’s pieces laid out to move by hand.', target: cmd('project-canvas') },
  // Meetings
  { id: 'meetings-page', group: 'meetings', title: 'Meetings', words: 'Upcoming and past, with attendees and follow-ups.', target: cmd('meetings') },
  { id: 'new-meeting', group: 'meetings', title: 'Meeting notes', words: 'Agenda, notes, decisions and actions, kept together.', target: cmd('new-meeting') },
  { id: 'record', group: 'meetings', title: 'Record meetings', words: 'Record from the note, with transcripts brought in. Voices are told apart as Speaker 1, Speaker 2 and so on, named once each.', target: cmd('record-meeting') },
  { id: 'series', group: 'meetings', title: 'Meeting series', words: 'Meetings that come round, each started from the last.', target: pack('meetings', 'series') },
  { id: 'prep', group: 'meetings', title: 'Prep packs', words: 'Before a meeting, what is open with the people coming.', target: pack('meetings', 'prep') },
  { id: 'event-to-note', group: 'meetings', title: 'Turn events into meeting notes', words: 'Any event becomes a meeting note with one click.', target: cmd('meetings') },
  // Find and ask
  { id: 'search-notes', group: 'find', title: 'Search everything', words: 'Inside notes too, with filters for kind and day.', target: cmd('search') },
  { id: 'picture-words', group: 'find', title: 'Find words in pictures and scans', words: 'Photos of receipts and scanned pages are read and searched, with where each line sits.', target: cmd('ocr-settings') },
  { id: 'jump', group: 'find', title: 'Jump to any note', words: 'Find a note by its name, or start a new one.', target: cmd('switcher') },
  { id: 'graph-page', group: 'find', title: 'Graph', words: 'How your notes link, drawn as one map.', target: cmd('graph') },
  { id: 'ask-help', group: 'find', title: 'Ask the assistant', words: 'Ask in plain words, with sources for every claim.', target: cmd('ask') },
  { id: 'chat-notes', group: 'find', title: 'Chat with notes', words: 'A longer talk with the vault beside you.', target: cmd('chat') },
  { id: 'notebooks', group: 'find', title: 'Notebooks', words: 'Ask a whole folder, with cited answers.', target: cmd('notebook') },
  { id: 'flashcards', group: 'find', title: 'Flashcards', words: 'Cards from a notebook, back for review when due.', target: cmd('notebook') },
  { id: 'related', group: 'find', title: 'Related notes', words: 'Notes like this one, suggested beside it.', target: cmd('related-notes') },
  { id: 'autolink', group: 'find', title: 'Suggested links', words: 'Links this note should probably make.', target: cmd('autolink') },
  { id: 'outline', group: 'find', title: 'Outlines', words: 'Long notes with their headings as a map.', target: cmd('outline') },
  // Capture and import
  { id: 'quick', group: 'capture', title: 'Quick capture', words: 'A note from anywhere, filed later from the Inbox.', target: cmd('quick-capture') },
  { id: 'capture-to', group: 'capture', title: 'Capture to a project', words: 'Straight into a project’s log, the Inbox or a note.', target: cmd('capture-to') },
  { id: 'inbox-page', group: 'capture', title: 'Inbox', words: 'Captures waiting to be filed, each in one click.', target: cmd('inbox') },
  { id: 'dictate', group: 'capture', title: 'Dictation', words: 'Speak and the words land where the cursor is.', target: cmd('dictate') },
  { id: 'import-apps', group: 'capture', title: 'Import from other apps', words: 'Notion, Evernote, Google Keep, Readwise, Logseq and Roam.', target: cmd('import') },
  { id: 'import-csv', group: 'capture', title: 'Import spreadsheets', words: 'Each row a note, with a table of them.', target: cmd('import-csv') },
  { id: 'open-pc-file', group: 'capture', title: 'Open files from the PC', words: 'Markdown files from anywhere, opened where they sit.', target: cmd('open-file') },
  // Private and safe
  { id: 'private-notes', group: 'private', title: 'Private notes', words: 'Encrypted notes only this vault opens.', target: cmd('private') },
  { id: 'lock', group: 'private', title: 'Lock private notes', words: 'One click locks them until you return.', target: cmd('private-lock') },
  { id: 'secrets-page', group: 'private', title: 'Secrets', words: 'Keys and passwords in a locked store, never in notes.', target: cmd('secrets') },
  { id: 'secrets-scan', group: 'private', title: 'Find secrets in notes', words: 'Secrets pasted by accident, found and moved to safety.', target: cmd('secrets-scan') },
  { id: 'audit', group: 'private', title: 'Audit trail', words: 'Who read what, and when.', target: cmd('secrets-activity') },
  { id: 'privacy-levels', group: 'private', title: 'Privacy levels', words: 'Who reads each level: you, the helper, or an agent.', target: cmd('privacy-settings') },
  { id: 'versions', group: 'private', title: 'Earlier versions', words: 'Bring back how any note used to read.', target: cmd('recovery') },
  { id: 'bin-page', group: 'private', title: 'Bin', words: 'Thirty days to change your mind.', target: cmd('bin') },
  { id: 'backups', group: 'private', title: 'Backups and sync', words: 'Copies kept safe, and folders kept in step.', target: page('settings', 'backups') },
  { id: 'export-everything', group: 'private', title: 'Export everything', words: 'Every note, file and table in one zip you keep: no lock-in.', target: cmd('export-everything') },
  // AI and other apps
  { id: 'agents-page', group: 'spark', title: 'Agents', words: 'Your agents, what each may do, and what they ask.', target: cmd('ai-agents') },
  { id: 'locked', group: 'private', title: 'Keep private notes and secrets locked', words: 'One locked place on this PC: unlock once and both open. Nothing else reads them.', target: page('locked') },
  { id: 'shared-spaces', group: 'organise', title: 'Share a space with your household or team', words: 'A space you share with the people you choose: today’s shared dates, open tasks and who owes what, kept in one folder the bot looks after. Everything else stays private.', target: cmd('shared-spaces') },
  { id: 'change-sets', group: 'spark', title: 'Review changes waiting for you', words: 'Several edits the side chat or an agent proposed, waiting as one set: see each before and after, accept or reject.', target: page('changes') },
  { id: 'other-ai-apps', group: 'spark', title: 'Use the Vault from other AI apps', words: 'Claude Code, Claude Desktop, Cursor and VS Code read your notes, or change them with Undo, as far as you allow.', target: page('settings', 'agents') },
  { id: 'plugins', group: 'spark', title: 'Plugins', words: 'Small add-ons with a command and a Home card each, off until you switch them on.', target: page('settings', 'plugins') },
  { id: 'export-pdf', group: 'spark', title: 'Export to PDF', words: 'A note laid out as pages, saved where you say.', target: cmd('export-pdf') },
  { id: 'present', group: 'spark', title: 'Present as slides', words: 'A note as slides, straight from the page.', target: cmd('present') },
  { id: 'publish-site', group: 'spark', title: 'Publish as a website', words: 'Chosen pages as a finished site, in a folder or on your own host.', target: cmd('publish') },
];

/** One line per pack for the Packs group (the registry's own words; the packs' pages say the rest). */
const PACK_WORDS: Record<string, string> = {
  health: 'Training, sleep, food, habits and check-ins.',
  family: 'Who is where, milestones, rewards and albums.',
  finance: 'Bills, spending, accounts and budgets.',
  documents: 'Passports, licences and policies, each found fast.',
  house: 'Appliances, upkeep and warranty reminders.',
  vehicles: 'Cars with fuel, servicing and rego reminders.',
  career: 'Applications, interviews and follow-ups.',
  travel: 'Trips with bookings, budgets and reminders.',
  meetings: 'Agenda, notes, decisions and actions, kept together.',
  weekly: 'A short update each week, due when you say.',
  sites: 'Sites with rooms, devices and patch points.',
  vendors: 'Suppliers with quotes, orders and contracts.',
  business: 'Customers, campaigns, posts and support.',
  systems: 'Machines and services with runbooks and checks.',
  goals: 'Goals with habits, milestones and reviews.',
  lists: 'Shopping and other lists, on Today while open.',
  publications: 'Books and papers from draft to release.',
};

const PACK_ABILITIES: Ability[] = LIFE_MODULES.map((m) => ({
  id: `pack-${m.id}`,
  group: 'packs',
  title: m.name,
  words: PACK_WORDS[m.id] ?? m.name,
  target: pack(m.id),
}));

export const ABILITIES: Ability[] = [...ABILITIES_HEAD, ...PACK_ABILITIES];

export const abilityById = (id: string): Ability | undefined => ABILITIES.find((a) => a.id === id);

export const abilitiesByGroup = (group: AbilityGroupId): Ability[] => ABILITIES.filter((a) => a.group === group);

/** The registry as the website's features page reads it (tools/export-abilities.mjs writes docs/abilities.json). */
export function abilitiesJson(): { groups: AbilityGroup[]; abilities: { id: string; group: AbilityGroupId; title: string; words: string }[] } {
  return { groups: ABILITY_GROUPS, abilities: ABILITIES.map((a) => ({ id: a.id, group: a.group, title: a.title, words: a.words })) };
}

const wordsOf = (a: Ability): string => {
  const group = ABILITY_GROUPS.find((g) => g.id === a.group)?.title ?? a.group;
  return `${a.title} ${a.words} ${group}`.toLowerCase();
};

/** The abilities matching plain words (every word must appear in the title, line or group). */
export function searchAbilities(query: string): Ability[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...ABILITIES];
  return ABILITIES.filter((a) => {
    const hay = wordsOf(a);
    return words.every((w) => hay.includes(w));
  });
}

// ── The guard: commands and pages that are deliberately not abilities ────────────────────────────────────────────
// Window chrome (tabs, panes, panels, keys, zoom), single-keystroke formatting, per-note upkeep (rename, move, merge)
// and the pack tours: all reached through the commands palette or where they are used, none of them a Vault ability
// the page needs to list. A command or page added later belongs here or in ABILITIES; the test fails otherwise.

/** Command ids (state/commands.ts, state/captureFlows.ts) that are not Vault abilities. */
export const NON_FEATURE_COMMANDS: string[] = [
  // The registry's own opener (More, the palette, Settings, Home): the page lists abilities, not itself.
  'abilities',
  // Window chrome
  'palette', 'home', 'settings', 'hotkeys', 'theme', 'zoom-in', 'zoom-out', 'zoom-reset', 'reveal-library', 'open-folder',
  // About and updates (components/about): the app's own version and updates, not a feature of your notes.
  'check-updates', 'whats-new', 'about-ironleaf', 'account-sign-in', 'account-plan',
  'new-tab', 'close-tab', 'reopen-tab', 'close-others', 'next-tab', 'prev-tab', 'split-right', 'split-down', 'pin-tab',
  'back', 'forward', 'toggle-left', 'toggle-right', 'rail-on', 'rail-off', 'toggle-tabs', 'toggle-status-line',
  'toggle-mode', 'toggle-source', 'save', 'bookmark-search',
  // Single-keystroke writing (the Notes ability covers writing itself)
  'bold', 'italic', 'strike', 'highlight', 'inline-code', 'comment', 'task', 'format-bar',
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
  'paragraph', 'bullets', 'numbers', 'quote', 'divider', 'date', 'time',
  'fold-all', 'unfold-all', 'cursor-above', 'cursor-below', 'move-line-up', 'move-line-down', 'copy-line-up',
  'copy-line-down', 'delete-line', 'select-line', 'find', 'replace', 'close-find',
  'table-row-below', 'table-row-above', 'table-col-right', 'table-col-left',
  'table-delete-row', 'table-delete-col', 'table-align-left', 'table-align-center', 'table-align-right', 'table-format',
  'suggestion-next', 'suggestion-prev', 'suggestion-keep', 'suggestion-discard',
  // Per-note upkeep (used where the note is)
  'rename', 'move', 'duplicate', 'delete', 'bookmark', 'reveal-explorer', 'reveal-system', 'open-default', 'copy-path',
  'merge', 'extract', 'add-property', 'history', 'insert-template', 'save-as-template',
  // Shortcuts to abilities listed above (the palette still runs each one)
  'new-note-tab', 'new-plain-note', 'new-person', 'new-resource', 'new-idea', 'new-note-from-template',
  'new-folder', 'random', 'unique-note', 'notes', 'brand-kit',
  'doc-canvas', 'doc-canvas-update', 'project-to-doc', 'doc-to-project',
  'capture-flow-1', 'capture-flow-2', 'capture-flow-3', 'capture-flow-4', 'capture-flow-5',
  'files-move-attachments',
  // A helper of an ability above (the Synced blocks entry covers it; the palette still runs it on a selection)
  'make-synced-block',
  // The area move's Undo (the Move an area entry covers it; it rides on the message after the move)
  'fold-area-undo',
  // The guided tours (each pack's page offers its own)
  'tour-pack', 'tour-finance', 'tour-documents', 'tour-business', 'tour-vendors', 'tour-systems', 'tour-sites',
  'tour-publications', 'tour-career', 'tour-meetings',
  // The packs chooser (8 Nov 2026, the quiet More): Settings › Packs, whose packs the registry lists above.
  'packs',
];

/** ViewTypes (state/workspace.ts) that are not Vault abilities: each opens through its command, which the registry
 *  covers (a note, a canvas, a view, a file, the graph…), or is window furniture (an empty tab, the registry's own
 *  page). A page added later belongs here or in ABILITIES; the test fails otherwise. */
export const NON_FEATURE_PAGES: string[] = [
  'shared-space', // one shared space's own page, opened from Shared spaces (the ability above)
  'shared-spaces', // opened through its command (8 Nov 2026, the quiet More), which the registry covers
  'note', 'canvas', 'view', 'media', 'graph', 'today', 'home', 'projects', 'templates', 'bin',
  'private', 'assets', 'review', 'timeline', 'tasks', 'type', 'notebook', 'records', 'drawing', 'loose', 'area',
  'inbox', 'people', 'secrets', 'module', 'meetings', 'bookmarks', 'import', 'versions', 'tidy', 'empty',
  'project-file', // a file in a project's folder, opened from its row (t239) — a viewer, never a looked-for page
  // The registry's own page: it lists abilities, not itself.
  'abilities',
];
