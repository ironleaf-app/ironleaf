// node --test tests/voice-u2.test.mjs — u2 one voice (5 Nov 2026, audit
// the product voice audit): the renamed words, in every door.
// Each check fails without its fix; page tests cover the rest (see neuros
// below for which test owns what).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('one Bin: titles, tabs and doors', () => {
  const bin = read('src/renderer/src/views/BinView.tsx');
  assert.ok(bin.includes('<h1 className="w4a-title">Bin</h1>'), 'Bin title');
  assert.ok(bin.includes('<b>Bin</b>'), 'Bin crumb');
  assert.ok(bin.includes('aria-label="Bin"'), 'Bin list name');
  assert.ok(bin.includes('aria-label="More for the Bin"'), 'Bin overflow name');
  assert.ok(!bin.includes('>Recently deleted<'), 'no Recently deleted left where a person reads');
  assert.ok(!read('src/renderer/src/views/Workspace.tsx').includes('Recently deleted'), 'no Recently deleted tab');
  // Tab names live in one place since 9 Nov 2026 (tabSync placeName, read by the tab and the strip alike).
  assert.ok(read('src/renderer/src/state/tabSync.ts').includes("case 'bin': return 'Bin'"), 'bin tab');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("name: 'Open the Bin'"), 'palette opens the Bin');
  assert.ok(read('src/renderer/src/views/ProjectPage.tsx').includes("label: 'Open the Bin'"), 'project page opens the Bin');
  assert.ok(read('src/renderer/src/state/imports.ts').includes('to the Bin.`'), 'import undo lands in the Bin');
});

test('Bin empties name their kind; the button matches its question', () => {
  const bin = read('src/renderer/src/views/BinView.tsx');
  for (const words of ['No notes here.', 'No conversations here.', 'No automations here.', 'No agents or skills here.']) assert.ok(bin.includes(words), `filter empty: ${words}`);
  assert.ok(!bin.includes('Nothing of that kind here'), 'no unnamed kind left');
  assert.ok(bin.includes('Remove all') && !bin.includes('>Empty all<') && !bin.includes("'Empty all'") && !bin.includes('Emptying'), 'Remove all, never Empty');
  assert.ok(bin.includes('aria-label="Remove everything from the Bin?"'), 'the ask names the Bin');
});

test('no Recycle Bin anywhere a person reads', () => {
  for (const f of ['src/renderer/src/views/NotesPage.tsx', 'src/renderer/src/views/SecretsView.tsx', 'src/renderer/src/views/HomeView.tsx', 'src/renderer/src/views/Workspace.tsx', 'src/renderer/src/state/layout.ts', 'src/main/weekly-tidy.ts', 'src/shared/weekly-tidy.ts']) {
    assert.ok(!read(f).includes('Recycle Bin'), `${f} says Bin`);
  }
  assert.ok(read('src/renderer/src/views/NotesPage.tsx').includes('Moved to Recently deleted.'), 'notes toast (merge 5 Nov: main wins on Bin words, n5 Recently deleted)');
  assert.ok(read('src/renderer/src/views/SecretsView.tsx').includes('It goes to the Bin, still locked.'), 'secrets confirm locks');
});

test('your notes, never the Vault, in sentences', () => {
  // Back in More (9 Nov 2026): Ctrl+K, Settings and the tab name it too.
  assert.ok(read('src/renderer/src/panels/Places.tsx').includes("label: 'What Ironleaf can do'"), 'More lists it again');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("{ id: 'abilities', name: 'See what Ironleaf can do'"), 'the palette names it');
  assert.ok(read('src/renderer/src/components/Settings.tsx').includes('title="What Ironleaf can do"'), 'Settings lists it');
  assert.ok(read('src/renderer/src/state/tabSync.ts').includes("case 'abilities': return 'What Ironleaf can do'"), 'tab names it');
  assert.ok(read('src/renderer/src/components/ConnectAiSettings.tsx').includes('title="Connect an AI"'), 'agents row');
  assert.ok(!read('src/renderer/src/components/AgentsSettings.tsx').includes('Use the Vault'), 'no Use the Vault left');
  assert.ok(read('src/main/cli.ts').includes('Settings › Connect an AI'), 'CLI points at the row');
});

test('Home leads with the deed; recent views show up', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('<b>Bring each part of your life into one place.</b>'), 'areas lead');
  assert.ok(!home.includes('Your vault is not organised by area yet'), 'no system report left');
  assert.ok(home.includes('Pages you open will show up here.'), 'recent line');
});

test('palette: plain entry, blank note, open footer', () => {
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("name: 'Ask or find anything'"), 'palette entry');
  assert.ok(commands.includes("name: 'New blank note'"), 'blank note');
  assert.ok(!commands.includes('Show all commands') && !commands.includes('New plain note'), 'no engineer words left');
  assert.ok(read('src/renderer/src/components/Modals.tsx').includes('<kbd>↵</kbd> open'), 'footer opens');
});

test('Capture and Keyboard shortcuts name their sections', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes("label: 'Capture'") && settings.includes("label: 'Keyboard shortcuts'"), 'rail labels');
  assert.ok(!settings.includes("label: 'Quick add'") && !settings.includes("label: 'Keys'"), 'no short names left');
  assert.ok(read('src/renderer/src/state/recorder.ts').includes('Settings › Capture › Voice and meetings'), 'recorder points at Capture');
  assert.ok(read('src/renderer/src/views/TasksView.tsx').includes('Capture files it as a task'), 'tasks title');
});

test('Inbox, Import and toasts in plain words', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('title="Nothing waiting"') && inbox.includes('Things you capture with nowhere to go land here.'), 'inbox empty');
  const imp = read('src/renderer/src/views/ImportView.tsx');
  assert.ok(imp.includes("label: 'Notes as text files (Markdown)'"), 'import option');
  assert.ok(!imp.includes("label: 'Markdown files'"), 'no bare format left');
  assert.ok(read('src/renderer/src/panels/NoticeBell.tsx').includes('title="Couldn\'t open notices"'), 'bell opens');
  assert.ok(read('src/renderer/src/state/layoutLogs.ts').includes("toast('Took it back out.')"), 'log undo');
  assert.ok(read('src/renderer/src/panels/ChatPanel.tsx').includes('list what’s in a folder on this PC'), 'chat stocks plainly');
});

test('welcome note opens with the notes, teaches the new words', () => {
  const welcome = read('src/main/welcome.ts');
  assert.ok(welcome.includes('They are yours: any text editor can open them.'), 'lead (merge 5 Nov: main wins with short welcome for first-ten-minutes)');
  assert.ok(welcome.includes('Ctrl+O to jump to a note, and Ctrl+K for every command.'), 'command keys');
  assert.ok(welcome.includes('## Get going') && welcome.includes("Open today's note"), 'going');
});

test('new drawings are canvases; old names still tidy', () => {
  assert.ok(!read('src/renderer/src/state/actions.ts').includes('Untitled drawing'), 'actions name canvas');
  assert.ok(!read('src/main/app.ts').includes('Untitled drawing'), 'main names canvas');
  const drawing = read('src/renderer/src/views/DrawingView.tsx');
  assert.ok(drawing.includes('/^Untitled (drawing|canvas)( \\d+)?\\.nvdraw$/i'), 'empty old and new tidy away');
});
