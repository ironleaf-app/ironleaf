// node --test tests/p15-packs-biz.test.mjs — p15 (4 Nov 2026): the Business, Systems, Goals, Lists and Publications
// pack pages at a 3456x1408 window, with real long content and with empty content, plus each New dialog.
// Rows start in the one tile slot so every row's words share one left edge; an empty section that says nothing is
// not shown, and the few that carry news keep one quiet line. Every New button opens its dialog. Fails without each
// change. Made-up names only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');
const LIFE = 'src/renderer/src/views/modules/life';
const W3B = 'src/renderer/src/views/modules/w3b';

test('w3b pages mount the record form host, so every New button opens its dialog', () => {
  const shell = src(`${W3B}/W3b.tsx`);
  assert.match(shell, /import \{ RecordFormHost \} from '\.\.\/RecordForm'/, 'PackPage imports the host');
  assert.match(shell, /<RecordFormHost \/>/, 'PackPage mounts the host');
});

test('business rows: every row starts in the one tile slot', () => {
  const page = src(`${LIFE}/BusinessPage.tsx`);
  assert.match(page, /function CustomerRow[\s\S]*?gtile xs/, 'customers start with a tile');
  assert.match(page, /function SupportTrow[\s\S]*?gtile xs/, 'support starts with a tile');
});

test('business rows say the product and the site’s own name', () => {
  const page = src(`${LIFE}/BusinessPage.tsx`);
  assert.match(page, /r\.product \? `\$\{r\.product\} \$\{r\.version\}` : r\.version/, 'releases lead with the product');
  assert.match(page, /\{w\.name\} · \{down \? 'down'/, 'websites show their own name, not the address');
  assert.doesNotMatch(page, /\{hostOf\(hrefOf\(w\.url\)/, 'no address-first website row survives');
});

test('business overview: Needs you holds support only, and empty sections that say nothing go', () => {
  const page = src(`${LIFE}/BusinessPage.tsx`);
  assert.doesNotMatch(page, /plural\(active\.length, 'customer'\)/, 'no customer count pill under Needs you');
  assert.match(page, /const showReleases = log\.length > 0;/, 'releases hide when empty');
  assert.match(page, /const showCustomers = customers\.length > 0;/, 'customers hide when empty');
  assert.match(page, /const showSupport = supportOn && m\.support\.length > 0;/, 'support hides until any exists');
  assert.match(page, /const showSites = sitesOn && m\.websites\.length > 0;/, 'websites hide when empty');
  assert.match(page, /Every support item is solved\./, 'support keeps its one quiet line once any exists');
});

test('systems rows name the service that is down or off, never a wrong no reply', () => {
  const page = src(`${LIFE}/SystemsPage.tsx`);
  assert.match(page, /const downSvcs = svcs\.filter/, 'down services are found');
  assert.match(page, /const offSvcs = svcs\.filter/, 'off services are found');
  assert.match(page, /`\$\{sv\.name\} is \$\{sv\.status\.toLowerCase\(\)\}`/, 'the row names the service and its state');
  assert.match(page, /svcWords\(downSvcs\) \|\| bad\?\.note/, 'a bad machine with answering hardware names its service first');
});

test('systems overview: empty sections that say nothing go', () => {
  const page = src(`${LIFE}/SystemsPage.tsx`);
  assert.match(page, /const showMachines = live\.length > 0;/, 'machines hide when empty');
  assert.match(page, /const showRunbooks = runbooksOn && m\.runbooks\.length > 0;/, 'runbooks hide until any exist');
  assert.match(page, /No runbook is due\./, 'runbooks keep their one quiet line once any exist');
});

test('goals overview: the Home preview shows only once habits exist', () => {
  const page = src(`${W3B}/Goals87.tsx`);
  assert.match(page, /\{m && habitsOn && !!habits\.length && <HomeCard/, 'no habits, no Home preview');
});

test('lists overview: zeroes and just-done states stay quiet', () => {
  const page = src(`${W3B}/Lists87.tsx`);
  assert.match(page, /\{m && !!kinds\.length && <PageProps/, 'no counts until something is under way');
  assert.ok(page.includes('m.lists.some(list => list.items.length > 0)') && page.includes('Everything on every list is done.'), 'only lists with items can be all done');
  assert.ok(page.includes('openList(list.path)'), 'every named list opens its own record');
  assert.match(page, /\{shopping && need\.length > 0 && <HomeCard/, 'the Home preview needs something still needed');
  assert.match(page, /more on the \{lists\.length > 1 \? 'lists' : 'list'\}/, 'one list reads as one list');
});

test('publications: edition rows say what is known, piece rows share the one left edge', () => {
  const page = src('src/renderer/src/views/modules/PublicationsPage.tsx');
  assert.match(page, /const meta = e\.delivered \|\| \(e\.pages \? `\$\{plural\(e\.pages, 'page'\)\}` : ''\);/, 'no filler middle');
  assert.doesNotMatch(page, /: 'archive'/, 'no archive noise on every row');
  assert.match(page, /gtile xs green/, 'picked pieces start with a tile');
  assert.match(page, /gtile xs slate/, 'missing pieces start with a tile');
});

test('publications main page: the menu starts and imports', () => {
  const page = src('src/renderer/src/views/modules/PublicationsPage.tsx');
  assert.match(page, /function PublicationsMain\([^)]*starting\(\): void; importing\(path: string\): void/, 'the main page takes the starters');
  assert.match(page, /starting=\{\(\) => setStarting\(true\)\} importing=\{setImporting\}/, 'the starters are passed');
  assert.match(page, /\{ finding: toggleFind, found: find, starting, importing \}/, 'the menu carries them');
});

test('pack rows: a tick fills the same slot as a status tile', () => {
  const css = src('src/renderer/src/styles/packs-87.css');
  assert.match(css, /\.p87 \.trow > \.check \{\n  width: 26px;\n  height: 26px;\n\}/, 'the tick matches the xs tile');
});

test('no em dashes in the touched pages’ words', () => {
  for (const f of [`${LIFE}/BusinessPage.tsx`, `${W3B}/Goals87.tsx`, `${W3B}/Lists87.tsx`, 'src/renderer/src/views/modules/PublicationsPage.tsx', `${W3B}/W3b.tsx`]) {
    assert.ok(!src(f).includes('—'), `${f} has no em dash`);
  }
  // SystemsPage keeps one pre-existing em dash in a code comment (machineWords); none in words a person sees.
  assert.equal(src(`${LIFE}/SystemsPage.tsx`).split('—').length - 1, 1, 'SystemsPage gains no new em dash');
});
