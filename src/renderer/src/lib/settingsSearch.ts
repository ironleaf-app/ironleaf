// Settings search (5.0.0, 19 Oct 2026; as the former host app's Settings search): the box at the top of Settings finds a
// setting by its name or what it says, across every group, and takes you to it. Settings are rows written out in
// components/Settings.tsx (and CaptureSettings, AgentsSettings), not a table, so this is their index: each row's title as
// shown (the row is found by it: Row's data-setting), its group, its words, and other words people use for it.
// tests/settings-search.test.mjs checks every row title in those files is here, so a new setting that isn't findable
// fails the tests. Nothing here touches the page.
//
// 8.7 w4a (30 Oct 2026): the sixteen sections fold into the mock-ups' ten groups (SETTINGS_GROUPS, in the rail's order).
// Old section ids still arrive from menus, the palette and notices (LEGACY_SECTIONS), so each resolves to its group;
// nothing they opened is lost.

import { HOME_CARDS } from '../../../shared/home-cards';
import { LIFE_MODULES } from '../../../shared/life-modules';

export type SettingsSectionId = 'account' | 'teams' | 'about' | 'general' | 'look' | 'home' | 'packs' | 'quick-add' | 'backups' | 'keys' | 'models' | 'privacy' | 'agents' | 'plugins' | 'publish';

/** The groups down the rail, in order, with the line under each group name. */
export const SETTINGS_GROUPS: { id: SettingsSectionId; label: string; words: string }[] = [
  { id: 'general', label: 'General', words: 'Your notes, how writing works, and note types.' },
  { id: 'look', label: 'Look', words: 'Theme, colours, sizes and fonts.' },
  { id: 'home', label: 'Home cards', words: 'Pick what shows on Home, and put them in order with the move buttons.' },
  { id: 'packs', label: 'Packs', words: 'Switch on what your life needs. Off means fully gone from view. Your files are kept.' },
  { id: 'quick-add', label: 'Capture', words: 'The small box over whatever you are doing: capture it without leaving it.' },
  { id: 'backups', label: 'Backups and sync', words: 'Copies of your notes, on this PC and where you say.' },
  { id: 'keys', label: 'Keyboard shortcuts', words: 'Choose any keys to change them. Changed ones can go back to the default.' },
  { id: 'models', label: 'AI', words: 'Your own AI connections: which model answers, your keys, and how careful it is with your notes.' },
  { id: 'privacy', label: 'Privacy and secrets', words: 'Who may read what. Logins and ID numbers stay locked, never in plain notes.' },
  { id: 'agents', label: 'Connect an AI', words: 'Claude, ChatGPT, Cursor, VS Code and other AI apps use your notes through MCP, as far as you allow.' },
  { id: 'plugins', label: 'Plugins', words: 'Small add-ons with a command and a Home card each, off until you switch them on.' },
  { id: 'publish', label: 'Publish', words: 'Your notes as websites: what goes in each, where each goes.' },
  { id: 'about', label: 'About and updates', words: 'The version you have, updates, and what changed in each version.' },
  { id: 'account', label: 'Account and plan', words: 'Optional. Sign in for Sync, Teams or to support Ironleaf; your notes never need an account.' },
  { id: 'teams', label: 'Teams', words: 'Your team: members and roles, shared vaults, and the policy your team sets.' },
];

/** The job groups the rail shows (10.0 Endless Tech, as the former host app's Settings; 3 Nov 2026 polish: the former
 *  host app's five parents): the 13 sections under You, AI, Connections, Your work and Help. Section ids are
 *  unchanged, so every old link and search result keeps working; this only orders the rail. */
export const SETTINGS_JOB_GROUPS: { id: string; label: string; sections: SettingsSectionId[] }[] = [
  { id: 'you', label: 'You', sections: ['general', 'look', 'home', 'account', 'teams'] },
  { id: 'ai', label: 'AI', sections: ['models', 'agents'] },
  { id: 'connections', label: 'Connections', sections: ['publish', 'plugins'] },
  { id: 'your-work', label: 'Your work', sections: ['packs', 'quick-add', 'backups', 'privacy'] },
  { id: 'help', label: 'Help', sections: ['about', 'keys'] },
];

/** Where the old sixteen sections went: every old id resolves to its group, so old links keep working. */
export const LEGACY_SECTIONS: Record<string, SettingsSectionId> = {
  general: 'general',
  appearance: 'look',
  editor: 'general',
  files: 'general',
  search: 'general',
  daily: 'home',
  types: 'general',
  templates: 'general',
  capture: 'quick-add',
  recovery: 'backups',
  backup: 'backups',
  keys: 'keys',
  models: 'models',
  ai: 'models',
  agents: 'agents',
  privacy: 'privacy',
  modules: 'packs',
  updates: 'about',
  plan: 'account',
};

/** An id from anywhere (a menu, the palette, a notice, an old link) as the group to show. */
export function resolveSection(id: string | undefined): SettingsSectionId {
  if (id && (SETTINGS_GROUPS.some((g) => g.id === id) || id in LEGACY_SECTIONS)) return (LEGACY_SECTIONS[id] ?? id) as SettingsSectionId;
  return 'general';
}

/** Every door from the former host app's Settings › Ironleaf (its 14 rows) as the Vault row it lands on (4 Nov 2026
 *  polish: each door lands on, scrolls to and briefly highlights its own row, not its section's top). The section
 *  is where resolveSection already lands the id; the row is the row's title as shown (its data-setting), or a
 *  heading's when the landing has no row of its own (Keys' "Every command", Privacy's "Who may read what", the
 *  Packs title). */
export const SETTINGS_REVEAL: Record<string, { section: SettingsSectionId; row: string }> = {
  general: { section: 'general', row: 'About and updates' },
  modules: { section: 'packs', row: 'Packs' },
  files: { section: 'general', row: 'Files you add to a note go' },
  types: { section: 'general', row: 'Your note types' },
  templates: { section: 'general', row: 'Templates' },
  capture: { section: 'quick-add', row: 'Quick capture' },
  editor: { section: 'general', row: 'New tabs open in' },
  daily: { section: 'home', row: 'Day notes go' },
  privacy: { section: 'privacy', row: 'Who may read what' },
  search: { section: 'general', row: 'Search inside project files' },
  recovery: { section: 'backups', row: 'Earlier versions' },
  backup: { section: 'backups', row: 'Git backup' },
  keys: { section: 'keys', row: 'Every command' },
  agents: { section: 'agents', row: 'Connect an AI' },
};

export interface SettingEntry {
  section: SettingsSectionId;
  /** The row's title exactly as shown (or a heading's, for a part of a group with no row of its own). */
  title: string;
  /** What the row says under its title, or a short description of it. */
  hint?: string;
  /** Other words people look for it by. */
  words?: string;
  /** A command in Settings › Keys (its id): choosing it shows that command's keys. */
  command?: string;
}

/** Other words two packs are looked for by (what the old hard-coded rows had); every other pack is found by its own line. */
const MODULE_EXTRA: Record<string, string> = {
  health: 'fitness training gym workout food water sleep weight body habits streaks gp doctor appointments results check-in',
  family: 'family kids children school activities events calendar milestones rewards photos albums',
};

export const SETTINGS_INDEX: SettingEntry[] = [
  // General
  { section: 'general', title: 'About and updates', hint: 'The version you have, updates and the version history.', words: 'about version update' },
  // Account and plan (components/account/AccountSettings.tsx)
  { section: 'account', title: 'Your account', hint: 'Optional: sign in with Kaitiaki ID for Sync, Teams or to support Ironleaf.', words: 'account sign in log in login sign out kaitiaki id profile email' },
  { section: 'account', title: 'Your plan', hint: 'Your plan and what it includes; Manage billing opens the billing portal.', words: 'plan subscription billing licence license supporter sync teams invoice payment cancel' },
  { section: 'account', title: 'Upgrade', hint: 'Sync, Teams or Supporter, bought in your browser.', words: 'upgrade buy purchase checkout pro paid' },
  { section: 'teams', title: 'Members', hint: 'Your team’s members and roles; owners and admins invite and remove.', words: 'team members invite roles admin owner remove seats colleagues' },
  { section: 'teams', title: 'Shared vaults', hint: 'Notes shared by the team, end-to-end encrypted.', words: 'shared vault team vault share notes with team collaborate' },
  { section: 'teams', title: 'Team policy', hint: 'What your team sets for everyone’s Ironleaf.', words: 'team policy managed by your team audit trail' },
  { section: 'account', title: 'Devices', hint: 'The PCs and phones on your account: rename or remove them.', words: 'devices computers phones remove rename' },
  // About and updates (components/about/AboutPage.tsx)
  { section: 'about', title: 'Check for updates automatically', hint: 'Once a day from ironleaf.kaitiaki-it.com. Nothing about you or your notes is sent.', words: 'about version update upgrade new release check now latest' },
  { section: 'about', title: 'Download updates automatically', hint: 'A new version downloads in the background; you choose when to restart.', words: 'update download background install restart' },
  { section: 'about', title: 'What’s new in this version', hint: 'The notes for the version you have.', words: 'whats new release notes changes changelog version' },
  { section: 'about', title: 'Version history', hint: 'Every release, newest first, each with its notes.', words: 'history changelog releases versions old earlier notes' },
  // What the Vault can do (8.8): every ability in one place, from About.
  { section: 'general', title: 'What Ironleaf can do', hint: 'Every ability, grouped, each with its Open.', words: 'abilities features help guide what can tour' },
  { section: 'general', title: 'Where your notes are kept', hint: 'The folder your notes are in, and whether it syncs: move it, or show it in its folder.', words: 'vault library folder location move onedrive sync where vault is these notes are' },
  { section: 'general', title: 'Your vaults', hint: 'Every vault on this PC, and which is open.', words: 'vaults switch open home documents' },
  { section: 'general', title: 'Your PCs', hint: 'The PCs sharing this vault, and what each has done.', words: 'pcs devices sync' },
  { section: 'general', title: 'Your vault is somewhere else?', hint: 'Open its folder, and Ironleaf keeps your notes there from now on.', words: 'vault another folder usb drive sync' },
  { section: 'general', title: 'Another folder of notes', hint: 'Open a folder of Markdown notes that lives somewhere else, without making it your vault.', words: 'open folder markdown' },
  { section: 'general', title: 'New notes go', hint: 'At the top of your notes, in the open note’s folder, or a folder you choose.', words: 'new note location folder' },
  { section: 'general', title: 'Folder for new notes', hint: 'Where new notes go, when you choose a folder.', words: 'new note folder' },
  { section: 'general', title: 'Files you add to a note go', hint: 'Beside the note, in its Files folder (with where each came from and its versions), or all in one folder.', words: 'attachments images paste drop folder files beside record versions' },
  { section: 'general', title: 'That folder', hint: 'The one folder files go in, when they don’t go beside their note.', words: 'attachments folder' },
  { section: 'general', title: 'Files already in one folder', hint: 'Moves the files in the attachments folder beside the notes that link to them, with a safety copy and Undo.', words: 'attachments move migrate tidy files beside notes' },
  { section: 'general', title: 'Weekly tidy', hint: 'This week’s small fixes, each with its own fix button, opened in full.', words: 'weekly tidy fixes duplicates broken links empty notes misplaced reminders review approve merge' },
  { section: 'general', title: 'Your assets are kept in', hint: 'A folder in your notes for logos, pictures, icons and documents (the Assets page).', words: 'assets logos brand folder' },
  { section: 'general', title: 'When a note is renamed or moved', hint: 'Links to it in other notes are changed to match, so they keep working.', words: 'rename move update links' },
  { section: 'general', title: 'Write new links as [[Note name]]', hint: 'Off writes standard Markdown links.', words: 'wikilinks markdown links brackets' },
  { section: 'general', title: 'A new link names its note by', hint: 'The shortest name, the path from the note, or the path from the top.', words: 'link format path relative absolute shortest' },
  { section: 'general', title: 'Folders left out of search, the graph and suggestions', hint: 'They stay in the file list and open as usual.', words: 'exclude excluded ignore hide folders' },
  { section: 'general', title: 'Folders kept out of view', hint: 'Hidden from Notes, Today, the graph, Related and the chat. Search still finds them.', words: 'hide quiet folders show bring back out of view archive reference noise' },
  { section: 'general', title: 'Show pictures, PDFs and other files', hint: 'Off shows only notes and canvases.', words: 'file list all files images pdf' },
  { section: 'general', title: 'Ask before deleting', hint: 'Folders, pictures and other files. A note goes at once with Undo on the message; everything deleted goes to Recently deleted either way.', words: 'confirm delete recycle bin trash' },
  // Tray and start-up (components/TraySettings.tsx; 20 Nov 2026).
  { section: 'general', title: 'Keep Ironleaf running in the tray when I close the window', hint: 'Reminders, AI access, sync and backup keep going with the window closed.', words: 'tray background close minimise minimize hide system tray notification area quit running' },
  { section: 'general', title: 'Start Ironleaf when I sign in', hint: 'Ironleaf starts in the tray when you sign in.', words: 'start with windows startup start-up autostart boot sign in login launch' },
  // Links from other apps and the command line (components/ExternalSettings.tsx; 21 Oct 2026, gap G26).
  { section: 'general', title: 'Links that change notes', hint: 'A ironleaf:// link that would make a note or add to one asks first, unless you allow that kind.', words: 'uri url scheme ironleaf:// links allow list confirm ask other apps' },
  { section: 'general', title: 'The ironleaf command', hint: 'Ironleaf from a terminal: open, read, search, create, append, daily:append, property:set and tasks.', words: 'cli command line terminal powershell script shell' },
  { section: 'general', title: 'Markdown files from outside your notes', hint: 'Open with › Ironleaf, drag a .md file onto the window, or Open a Markdown file from this PC.', words: 'open with file association loose md markdown outside vault explorer' },
  // Searching inside project files (was its own section).
  { section: 'general', title: 'Search inside project files', hint: 'Find words inside the Word, Excel, PowerPoint, PDF, text and CSV files in your projects’ folders.', words: 'index documents office pdf word excel full text' },
  { section: 'general', title: 'What is read', hint: 'Which files are read inside, and how big.', words: 'limits size pages index' },
  { section: 'general', title: 'Read words in pictures and scans', hint: 'Windows reads photos and scanned pages, and search finds their words with where each line sits.', words: 'ocr pictures scans photos receipts recognise recognised text images language read again' },
  { section: 'general', title: 'Language', hint: 'The language Windows reads.', words: 'ocr pictures scans reading language recognise recognised' },
  // Writing (was the Editor section; dictation lives in Quick add now).
  { section: 'general', title: 'New tabs open in', hint: 'Live Preview, Source or Reading.', words: 'mode view live preview source reading default' },
  { section: 'general', title: 'Comfortable line length', hint: 'Keeps lines to a width that is easy to read, however wide the window.', words: 'readable width line length wide' },
  { section: 'general', title: 'The note’s name as its title', hint: 'Shown above the note; type there to rename it.', words: 'inline title heading rename' },
  { section: 'general', title: 'Check spelling', hint: 'Marks words spelt wrong as you type.', words: 'spellcheck spelling dictionary' },
  { section: 'general', title: 'Close brackets and marks', hint: 'Typing ( [ { or a quote adds its pair.', words: 'auto pair brackets quotes' },
  { section: 'general', title: 'Fold headings', hint: 'An arrow beside each heading folds what is under it.', words: 'collapse fold headings' },
  { section: 'general', title: 'Line numbers', hint: 'Numbers down the side of a note.', words: 'gutter numbers' },
  { section: 'general', title: 'A note’s properties', hint: 'Its details at the top (tags, status, dates…).', words: 'frontmatter yaml metadata properties' },
  { section: 'general', title: 'One Enter starts a new line in Reading too', hint: 'Off: lines run together until a blank line, as Markdown has it.', words: 'line breaks strict markdown newline' },
  { section: 'general', title: 'Indent with tabs', hint: 'Off indents with spaces.', words: 'tabs spaces indent' },
  { section: 'general', title: 'Indent width', hint: '2, 4 or 8.', words: 'tab size indent spaces' },
  // Note types (components/NoteTypesSettings.tsx)
  { section: 'general', title: 'Your note types', hint: 'What a note can be: its icon, fields, folder and a page of every note of that type. Rename, hide or reorder them.', words: 'types people person contacts meetings resources ideas docs projects rename hide reorder kinds categories' },
  { section: 'general', title: 'Add a type of your own', hint: 'A recipe, a client site, a supplier: its own icon, colour, fields and folder.', words: 'custom type new kind category fields template folder' },
  // Templates
  // (No second types entry since 8 Nov 2026, the quiet More: "Note types" named the same list as
  // "Your note types" above, so the one entry names it once.)
  { section: 'general', title: 'Templates', hint: 'Starting points for notes, the shape of a new project, and how reports are laid out.', words: 'templates page meeting notes report' },
  { section: 'general', title: 'Templates folder', hint: 'Every note in it is a template.', words: 'templates folder' },
  { section: 'general', title: 'Date', hint: 'How {{date}} is written in a template.', words: 'date format template' },
  { section: 'general', title: 'Time', hint: 'How {{time}} is written in a template.', words: 'time format template' },
  // Look (was Appearance)
  { section: 'look', title: 'Theme', hint: 'Light, dark, or matching Windows.', words: 'dark mode light mode colour scheme night' },
  { section: 'look', title: 'Colours', hint: 'The page and side bar, in the look you pick: White, Bright, Sky, Mint, Lavender and more.', words: 'color colour palette background white bright sky mint lavender blush sunny paper ocean lagoon forest rose cocoa dusk mist cream theme' },
  { section: 'look', title: 'Accent colour', hint: 'Buttons, links, the cursor, highlights and what is selected.', words: 'color accent highlight custom pick' },
  { section: 'look', title: 'Text size in notes', hint: 'The size of the words in your notes.', words: 'font size bigger smaller text' },
  { section: 'look', title: 'Interface size', hint: 'The whole window larger or smaller: side bars, menus, pages and words.', words: 'zoom scale bigger smaller size of everything magnify' },
  { section: 'look', title: 'Density', hint: 'Compact fits more rows in the side bar, the file list, tabs and lists.', words: 'compact comfortable spacing tight dense rows' },
  { section: 'look', title: 'Open pages in tabs', hint: 'Pages in tabs along the top, or one page at a time.', words: 'tabs tab strip one page at a time single page back forward' },
  { section: 'look', title: 'Status line', hint: 'Words, links and saved along the bottom of the window.', words: 'status bar word count characters saved footer bottom' },
  { section: 'look', title: 'An empty tab shows', hint: 'Home, or a quiet page.', words: 'home today new tab start page' },
  { section: 'look', title: 'Places on the left side and in More', hint: 'Which places show down the left side.', words: 'ribbon sidebar side bar hide show buttons' },
  { section: 'look', title: 'Along the bottom', hint: 'What the status line at the foot of the window shows.', words: 'status bar word count backlinks saved' },
  { section: 'look', title: 'On project pages', hint: 'Buttons and cards on every project’s page.', words: 'project page hide show' },
  { section: 'look', title: 'Preview links on hover', hint: 'Rest the pointer on a link to see the note it leads to in a small card.', words: 'hover preview popover link card ctrl' },
  { section: 'look', title: 'Suggested questions in the chat', hint: 'Shown while a chat is empty, to match where you are.', words: 'chat suggestions prompts assistant' },
  { section: 'look', title: 'The window', hint: 'The font for menus, lists and buttons.', words: 'font typeface interface ui' },
  { section: 'look', title: 'Notes', hint: 'The font for the words in your notes.', words: 'font typeface text' },
  { section: 'look', title: 'Code', hint: 'The font for code blocks and Source view.', words: 'font monospace typeface' },
  // Home cards (was Today and reviews, plus the Home arrangement)
  { section: 'home', title: 'Home cards', hint: 'Which cards show on Home, and in what order.', words: 'home cards change arrange reorder show hide' },
  { section: 'home', title: 'On Today', hint: 'What Today shows.', words: 'today home cards sections brief morning week month calendar daily note tasks due activity quick actions' },
  { section: 'home', title: 'Day notes go', hint: 'Where each day’s note goes.', words: 'daily note today journal folder day' },
  { section: 'home', title: 'Days found elsewhere', hint: 'Day-shaped notes found in another folder, pointed at in one click.', words: 'daily note folder elsewhere move found another app days' },
  { section: 'home', title: 'Day note names', hint: 'How each day’s note is named (YYYY-MM-DD…).', words: 'daily note date format name day' },
  { section: 'home', title: 'Day notes start with', hint: 'A note whose words start each day’s note.', words: 'daily note template day' },
  { section: 'home', title: 'Weekly review reminder', hint: 'The weekly review’s reminder, on the day and time you choose.', words: 'weekly review reminder friday' },
  { section: 'home', title: 'When', hint: 'The day and time of the weekly review’s reminder.', words: 'weekly review day time' },
  // Packs: every life module, switched on and off in one place, each found by its short name and its earlier names.
  ...moduleEntries(),
  // Quick add (was Quick capture, plus voice and meetings recording)
  { section: 'quick-add', title: 'Quick capture', hint: 'A small box over whatever you’re doing: note something down, add a next step, or take a screenshot.', words: 'capture inbox screenshot snip quick note add' },
  { section: 'quick-add', title: 'Keys', hint: 'The keys that open Quick capture from anywhere in Windows.', words: 'capture shortcut hotkey global' },
  { section: 'quick-add', title: 'With no project', hint: 'Where a note or task filed under No project goes.', words: 'capture inbox daily no project' },
  { section: 'quick-add', title: 'Pictures and files', hint: 'Whether captured pictures and files go to your assets.', words: 'capture screenshot assets pictures' },
  { section: 'quick-add', title: 'Capture flows', hint: 'Capture to… a project’s log, the Inbox, today’s note or a note, with the time (Ctrl+Shift+J).', words: 'capture to log project inbox flow append timestamp hotkey' },
  { section: 'quick-add', title: 'Web clipper', hint: 'Clip pages from Chrome or Edge into your notes. It talks only to this PC.', words: 'clipper extension browser chrome edge web clip article bookmark screenshot' },
  { section: 'quick-add', title: 'Pairing code', hint: 'The code the browser extension asks for once.', words: 'clipper pair code extension connect browser' },
  { section: 'quick-add', title: 'Get the extension', hint: 'Load the clipper folder in Chrome or Edge.', words: 'clipper extension install chrome edge load unpacked folder' },
  { section: 'quick-add', title: 'Dictation microphone', hint: 'Speak instead of typing, in a note, the chat or quick capture.', words: 'voice typing speech microphone dictate clean' },
  { section: 'quick-add', title: 'Meeting microphone', hint: 'The microphone meetings are recorded with.', words: 'meeting recording microphone mic headset input device record' },
  { section: 'quick-add', title: 'After notes are made', hint: 'Keep a meeting’s recording, or send it to Recently deleted, once its notes are made.', words: 'meeting recording record audio delete keep recycle bin transcript' },
  { section: 'quick-add', title: 'Record the PC’s sound too', hint: 'A meeting recorded on Windows takes the other people on a call too, not only your microphone.', words: 'meeting recording system audio speakers call loopback microphone' },
  // Backups and sync (was Backup and sync plus File recovery, Recently deleted and Import behind it)
  { section: 'backups', title: 'Git backup', hint: 'A Git history of your notes, copied to a remote you choose.', words: 'backup git github gitea history commit push remote repository version' },
  { section: 'backups', title: 'When notes change', hint: 'How often the backup or sync looks for changes.', words: 'backup sync often every minutes' },
  { section: 'backups', title: 'Remote', hint: 'Where the Git backup is copied: a private repository, an ssh address or a folder.', words: 'git remote github repository push nas usb' },
  { section: 'backups', title: 'Signing in', hint: 'How the Git backup signs in to its remote: a token.', words: 'git token sign in github password' },
  { section: 'backups', title: 'Last backup', hint: 'When the Git backup last ran, and what went wrong.', words: 'backup last run error now' },
  { section: 'backups', title: 'Folder', hint: 'An encrypted copy of your notes in OneDrive, Dropbox, a NAS or a USB drive.', words: 'sync encrypted encryption onedrive dropbox nas usb passphrase end-to-end folder' },
  { section: 'backups', title: 'Sync', hint: 'Sync the encrypted copy both ways with your other PCs.', words: 'sync two-way conflict other pc passphrase encrypted' },
  { section: 'backups', title: 'Last sync', hint: 'When the encrypted copy last synced, and what went wrong.', words: 'sync last run error now' },
  { section: 'backups', title: 'Choose a passphrase', hint: 'The passphrase only which opens the encrypted copy.', words: 'sync passphrase password' },
  { section: 'backups', title: 'Passphrase for this copy', hint: 'The passphrase the encrypted copy was set up with.', words: 'sync passphrase password' },
  { section: 'backups', title: 'Keep a copy of a changed note every', hint: 'How often a copy is kept as notes change.', words: 'backup snapshot recovery history interval' },
  { section: 'backups', title: 'Keep copies for', hint: 'How many days copies are kept.', words: 'backup recovery days history' },
  { section: 'backups', title: 'Earlier versions', hint: 'Bring back a copy, including notes you deleted.', words: 'restore recover recovery undelete version history backup' },
  { section: 'backups', title: 'Backup and sync', hint: 'While the backup and sync are being read.', words: 'backup sync' },
  { section: 'backups', title: 'Bin', hint: 'One bin for your notes, 30 days, with Restore.', words: 'bin trash deleted restore recycle recently' },
  { section: 'backups', title: 'Import', hint: 'Spreadsheets, Markdown files and folders of notes, brought in.', words: 'import csv markdown folder notion evernote merge' },
  { section: 'backups', title: 'Export everything', hint: 'One zip with every note, file and table, saved where you choose.', words: 'export zip portable markdown csv backup takeaway move leave other app' },
  { section: 'backups', title: 'Include my private notes', hint: 'Private notes, secrets and health records as plain words, only after unlocking.', words: 'export private secrets health unlocked decrypted include' },
  // Keys (each command is found by its name too; see commandEntries)
  { section: 'keys', title: 'Every command', hint: 'The keys for every command, changed to your own.', words: 'shortcuts hotkeys keyboard bindings keys' },
  // AI: the person's own connections (components/AiSettings.tsx)
  { section: 'models', title: 'Connections', hint: 'Your own AI connections: Anthropic, OpenAI, Google Gemini, Ollama, or any OpenAI-compatible address.', words: 'ai model provider claude gpt gemini ollama lm studio openrouter groq chat llm key api local connection add' },
  { section: 'models', title: 'Add connection', hint: 'Connect a provider with your own key, or a model running on this PC.', words: 'ai add connection key api provider anthropic openai google gemini ollama custom local' },
  { section: 'models', title: 'Model for chat', hint: 'Which model the chat, Ask and suggestions use.', words: 'ai model default choose chat claude gpt gemini llm' },
  { section: 'models', title: 'Thinking', hint: 'How much the chosen model thinks before it answers.', words: 'reasoning effort thinking level' },
  { section: 'models', title: 'Transcription', hint: 'The connection and model that write recordings and dictation down.', words: 'speech to text transcribe transcription whisper dictation recording meeting voice' },
  { section: 'models', title: 'Ask before the assistant changes a note', hint: 'Whether its changes to a note wait in the note, each to keep or discard, or go in straight away with Undo.', words: 'approve suggestions proposals keep discard review edits assistant ai changes' },
  // Other AI apps on this PC (Ironleaf's own local MCP server).
  { section: 'agents', title: 'Connect an AI', hint: 'Claude Desktop, Claude Code, ChatGPT, Cursor, VS Code and other AI apps use your notes through MCP, as far as you allow.', words: 'mcp claude chatgpt cursor vscode other apps ai local server url http token setup connector notion' },
  { section: 'agents', title: 'Local URL', hint: 'A Streamable HTTP address on this PC, with a token, for apps that connect by URL.', words: 'mcp http url token streamable' },
  { section: 'agents', title: 'Port', hint: 'The local URL’s port: 47731 unless another program needs it.', words: 'mcp http url port 47731' },
  { section: 'agents', title: 'What they may do', hint: 'Read only, or Read and write.', words: 'mcp permission read write level other apps' },
  // Privacy and secrets
  { section: 'privacy', title: 'Who may read what', hint: 'The levels each AI app reads.', words: 'sensitivity levels access agents chat bots work confidential personal family health open privacy' },
  { section: 'privacy', title: 'Family-private photos', hint: 'Used only with your OK each time, or never.', words: 'photos pictures kids consent family private' },
  { section: 'privacy', title: 'Areas and folders', hint: 'The level each area of life gives everything inside it.', words: 'sensitivity folder area default level health family work' },
  { section: 'privacy', title: 'Stay unlocked for', hint: 'How long Locked stays open after one unlock: 1, 4 or 8 hours, until you sign out of Windows, or the stricter minutes.', words: 'remember unlock once hours sign out windows lock locked secrets private notes' },
  { section: 'privacy', title: 'Ask again after', hint: 'In the stricter way, they lock after this long with no use.', words: 'strict lock minutes unused timeout secrets private' },
  { section: 'privacy', title: 'Lock when Windows locks or this PC sleeps', hint: 'Off unless you turn it on: locking Windows or sleep leaves Secrets as they are. Signing out of Windows always locks them.', words: 'windows lock screen sleep suspend sign out secrets private notes' },
  { section: 'privacy', title: 'Secrets', hint: 'Passwords, passcodes, licence keys and ID numbers, locked in your vault.', words: 'passwords passcodes pins keys licence vault locked secrets' },
  { section: 'privacy', title: 'Find secrets in notes', hint: 'Passwords, passcodes, card numbers and keys already written in notes, moved into Secrets.', words: 'scan scanner passwords card numbers find' },
  { section: 'privacy', title: 'Private notes into levels', hint: 'Sort your Private notes into levels so the assistants you allow can use them.', words: 'private notes migrate move levels' },
  { section: 'privacy', title: 'Private notes', hint: 'Health, family and money notes, locked on this PC.', words: 'private notes encrypted locked open' },
  { section: 'privacy', title: 'Activity', hint: 'Who or what read or changed which sensitive item, and when.', words: 'audit trail log activity history who read export' },
  // Home's cards, each findable by its name.
  ...HOME_CARDS.map((c): SettingEntry => ({ section: 'home', title: c.title, hint: c.words, words: `home card ${c.id}` })),
  // Plugins, a first small door (each plugin's own row carries its name, so only the fixed row is indexed).
  { section: 'plugins', title: 'Add your own', hint: 'A plugin is a folder with a manifest (plugin.json) and one script (plugin.js).', words: 'plugin folder manifest script write develop api docs example word count' },
  // Publish as a website (9.0 w122publish; components/PublishSettings.tsx).
  { section: 'publish', title: 'Your sites', hint: 'Every website kept: what is in it, where it goes, when it went.', words: 'publish website site static hosting netlify cloudflare github pages server' },
  { section: 'publish', title: 'New site', hint: 'Chosen pages as a finished site, in a folder or on your own host.', words: 'publish new website create site' },
];

/** Each command (state/commands.ts) as something to find: its keys are in Settings › Keys. Aliases
 *  (8 Nov 2026, the quiet More) are left out: the survivor names the keys once. */
export function commandEntries(commands: { id: string; name: string; aliasOf?: string }[]): SettingEntry[] {
  return commands.filter((c) => !c.aliasOf).map((c) => ({ section: 'keys', title: c.name, hint: 'Its keys, in Keys.', words: 'shortcut hotkey keys command', command: c.id }));
}

/** Every pack's row in Settings › Packs, in the catalogue's own words, with each pack's earlier names as well: an old
 *  name ("Health and Fitness") still finds the pack. The index's packs rows come from here, so there is one copy. */
export function moduleEntries(): SettingEntry[] {
  return LIFE_MODULES.map((m) => ({ section: 'packs', title: m.name, hint: m.words, words: `pack module ${m.id} switch on off ${MODULE_EXTRA[m.id] ?? ''} ${(m.aliases ?? []).join(' ')}` }));
}

/** Lower case, without accents, with typographic quotes as plain ones: "Note’s" is found by "notes" and "note's". */
const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .toLowerCase();
const wordsOf = (text: string): string[] => plain(text).replace(/'/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export interface SettingHit {
  entry: SettingEntry;
  score: number;
}

/**
 * The settings a search finds, best first: every word typed scores where it begins a word of the setting's title,
 * what it says, its other words or its group's name. A word in the title counts most, the group's name next. A word
 * nothing matches scores nothing but excludes nothing (9.2 uplift F24): an extra or slightly-off word ranks the
 * setting below, instead of the search finding nothing. At most `limit`.
 */
export function searchSettings(query: string, entries: SettingEntry[], sectionLabels: Partial<Record<SettingsSectionId, string>>, limit = 30): SettingHit[] {
  const asked = wordsOf(query);
  if (!asked.length) return [];
  const whole = plain(query).replace(/'/g, '').trim();
  const hits: SettingHit[] = [];
  entries.forEach((entry, order) => {
    const title = wordsOf(entry.title);
    const section = wordsOf(sectionLabels[entry.section] ?? entry.section);
    const rest = wordsOf(`${entry.hint ?? ''} ${entry.words ?? ''}`);
    let score = 0;
    let matched = 0;
    for (const w of asked) {
      const inTitle = title.some((t) => t.startsWith(w));
      const inSection = section.some((t) => t.startsWith(w));
      const inRest = rest.some((t) => t.startsWith(w));
      if (inTitle || inSection || inRest) {
        matched++;
        score += inTitle ? (title.includes(w) ? 12 : 9) : inSection ? 4 : 2;
        continue;
      }
      // Word forms (W5-15): "notes" and "deleting" find "note" and "delete" by
      // their stem, scored below any exact-prefix word.
      const stem = w.replace(/(ing|ed|es|s)$/, '');
      if (stem.length >= 3 && stem !== w) {
        const sTitle = title.some((t) => t.startsWith(stem));
        const sSection = section.some((t) => t.startsWith(stem));
        const sRest = rest.some((t) => t.startsWith(stem));
        if (sTitle || sSection || sRest) {
          matched++;
          score += sTitle ? 5 : sSection ? 2 : 1;
        }
      }
    }
    if (!matched) return;
    const t = plain(entry.title).replace(/'/g, '');
    if (t === whole) score += 40;
    else if (t.startsWith(whole)) score += 20;
    else if (t.includes(whole)) score += 10;
    // How many words matched outranks how well (F24's tiers): an entry matching every word always stands above
    // one matching fewer, however well; within a tier the points decide.
    score += matched * 1000000;
    // Commands come after settings that score the same; among equals, the order Settings shows them in.
    hits.push({ entry, score: score - (entry.command ? 3 : 0) - order / 10000 });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
