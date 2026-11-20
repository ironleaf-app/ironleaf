// node --test tests/uplift-92-lists.test.mjs — the 9.2 uplift's lists batch (F31, F34, F39, F41,
// F43–F48): folder rows open their folder; a status change is one batch; person cards match one way;
// failed ticks roll back; adds toast their name with an Open link; order stages, lapsed quotes, car
// dues and draft readiness read true; vendors pick exact, near or explicit new. Each check guards the
// words or the mechanism its fix put in, so it fails without the fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('every folder row opens what it names (F31, F39)', () => {
  const folders = read('src/renderer/src/panels/ChatFolders.tsx');
  assert.ok(folders.includes('drill(e.path)'), 'a folder row drills into that folder');
  assert.ok(folders.includes('Nothing listed under this folder.'), 'an empty drilled folder says so');
  assert.ok(folders.includes('Back to the top of the card'), 'with a way back');
  assert.doesNotMatch(folders, /onOpen\(card\.project, ev/, 'folders never open the project');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('const isPersonCard'), 'one person-or-org test');
  assert.equal((inbox.match(/isPersonCard\(/g) ?? []).length, 2, 'File… and the fallback share it');
  assert.doesNotMatch(inbox, /person\|people\|contact\)\$\//, 'no short regex that drops orgs');
});

test('status changes and notebook ticks apply honestly (F34, F41)', () => {
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes('runEditBatch({'), 'one batch per status change');
  assert.ok(page.includes('Status set to ${PROP_STATUS_WORDS[v]}.'), 'said once');
  assert.ok(page.includes('edit(propStatusEdits(v, p).map'), 'the menu sends one batch');
  assert.ok(page.includes('(change: ProjectEdit | ProjectEdit[], words?: string)'), 'batched through the one queue');
  const nb = read('src/renderer/src/views/NotebookView.tsx');
  assert.ok(nb.includes('window.nv.notebook.state(nb.folder).then(onChange'), 'a failed write rolls the tick back');
});

test('adds toast their name with an Open link, never auto-open (F43)', () => {
  const room = read('src/renderer/src/views/modules/work/SitesPage.tsx');
  assert.ok(room.includes('Added the room ${valueWords(v, \'room\')} at ${s.name}.'), 'the room named with its site');
  assert.ok(room.includes('run: () => openSite(s.path)'), 'opening the site that holds it');
  const habit = read('src/renderer/src/views/modules/life/GoalsPage.tsx');
  assert.ok(habit.includes("run: () => openModule('goals', 'habits')"), 'the habit opening its list');
  const wiz = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.ok(wiz.includes("run: () => openDetail('vendors', 'vendor', rel)"), 'wizard vendors open');
  assert.ok(wiz.includes("run: () => openDetail('vendors', at, rel)"), 'wizard quotes, orders and contracts open');
  assert.doesNotMatch(wiz, /await openDetail\('vendors', '[a-z]+', r\.path\)/, 'nothing auto-opens');
});

test('stages, lapses, dues and readiness read true (F44–F47)', () => {
  const vendors = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.ok(vendors.includes('ORDER_STAGES'), 'one stage map');
  assert.ok(vendors.includes("{ label: 'Raised', at: (s) => s === 'Raised' }"), 'raised highlights raised');
  assert.ok(vendors.includes('const lapsesSoon') && vendors.includes('const hasLapsed'), 'lapse or lapsed, never mixed');
  assert.ok(vendors.includes('`${lapsed.length} lapsed`'), 'lapsed counted apart');
  assert.ok(vendors.includes('<span className="tag red">Lapsed</span>'), 'lapsed tagged red');
  const cars = read('src/renderer/src/views/modules/w3b/Vehicles87.tsx');
  assert.ok(cars.includes('first.late ? `overdue'), 'the dues line comes from the dues');
  const weekly = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  assert.ok(weekly.includes('export function draftReady'), 'readiness is a predicate');
  assert.ok(weekly.includes('u.sections.length > 0 && u.sections.every(filled)'), 'sections with lines, never zero');
  assert.ok(weekly.includes('draftReady(u) && <HomeCard'), 'the card gated on it');
});

test('vendors pick exact, near-match or explicit new (F48)', () => {
  const form = read('src/renderer/src/views/modules/RecordForm.tsx');
  assert.ok(form.includes('function VendorPick'), 'a real vendor picker');
  assert.ok(form.includes('Did you mean…'), 'near matches offered');
  assert.ok(form.includes('A new vendor “{trimmed}”.'), 'new said before it is made');
  assert.doesNotMatch(form, /value=\{String\(v \?\? ''\)\}>[\s\S]{0,400}Something else…[\s\S]{0,200}vendor/m, 'no native select for vendors');
  const vendors = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.equal((vendors.match(/kind: 'vendor'/g) ?? []).length, 3, 'quote, order and contract share it');
});

test('chips and menus already read plain (F55, F79)', () => {
  const chip = read('src/renderer/src/components/plan/OwnerChip.tsx');
  assert.ok(chip.includes('onClick ? ('), 'a chip without an action renders no button');
  const row = read('src/renderer/src/components/plan/PlanRow.tsx');
  assert.doesNotMatch(row, /<OwnerChip[^>]*onClick/, 'the row passes no action into its button');
});
