// node --test tests/site-publish.test.mjs — Publish as a website (9.0 w122publish, 31 Oct 2026): chosen Vault pages
// as a finished static site, on a made-up vault in a temporary folder (never anyone's real vault). Choosing (one
// page, a project, a folder, a tag, a hand-picked list); never published (private notes, Secrets, health, a pack's
// marked records, publish: false, hidden properties), each named; the site whole (home, side navigation, one page
// per note drawn as the Vault draws it, links kept or turned to words, never broken, pictures and files copied,
// search with its index in the page, light and dark by the reader's setting, the person's accent, sharing titles,
// opened straight from the folder with no server); re-publish writing only what changed and removing dropped pages;
// the former host app destination path driven through a fake host.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-site-'));
let S;
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src', 'shared', 'site-publish.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  await build({ input: path.join(root, 'src', 'main', 'site-publish.ts'), platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent', external: ['electron'] });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const STORE = { version: 1, folders: {}, types: {}, items: {}, access: {}, photos: 'ask', ignored: [] };
const HEALTH_STORE = { version: 1, folders: { Health: 'health' }, types: {}, items: {}, access: {}, photos: 'ask', ignored: [] };

const NOTES = [
  { path: 'Baking/Sourdough.md', title: 'Sourdough', props: { type: 'recipe' }, tags: ['baking'] },
  { path: 'Baking/Icing.md', title: 'Icing', props: { type: 'recipe' }, tags: ['baking'] },
  { path: 'Projects/Riverside/Riverside.md', title: 'Riverside', props: { type: 'project' }, tags: [] },
  { path: 'Projects/Riverside/Stall roster.md', title: 'Stall roster', props: {}, tags: [] },
  { path: 'Projects/Harbour/Harbour.md', title: 'Harbour', props: { type: 'project' }, tags: [] },
  { path: 'Private notes/Diary.md', title: 'Diary', props: {}, tags: [] },
  { path: 'Health/Check-in.md', title: 'Check-in', props: { type: 'health-checkin' }, tags: [] },
  { path: 'Me/Finance/Bills/Power bill.md', title: 'Power bill', props: { type: 'bill' }, tags: [] },
  { path: 'Draft.md', title: 'Draft', props: { publish: false }, tags: [] },
];

const paths = (r) => r.included.map((n) => n.path).sort();

test('choosing: one page, a project, a folder, a tag, a hand-picked list', () => {
  assert.deepEqual(paths(S.resolveSitePages({ kind: 'page', path: 'Baking/Sourdough.md' }, NOTES, STORE)), ['Baking/Sourdough.md']);
  assert.deepEqual(paths(S.resolveSitePages({ kind: 'project', path: 'Projects/Riverside/Riverside.md' }, NOTES, STORE)), ['Projects/Riverside/Riverside.md', 'Projects/Riverside/Stall roster.md']);
  assert.deepEqual(paths(S.resolveSitePages({ kind: 'folder', folder: 'Baking' }, NOTES, STORE)), ['Baking/Icing.md', 'Baking/Sourdough.md']);
  assert.deepEqual(paths(S.resolveSitePages({ kind: 'tag', tag: 'baking' }, NOTES, STORE)), ['Baking/Icing.md', 'Baking/Sourdough.md']);
  assert.deepEqual(paths(S.resolveSitePages({ kind: 'tag', tag: '#Baking' }, NOTES, STORE)), ['Baking/Icing.md', 'Baking/Sourdough.md']);
  const list = S.resolveSitePages({ kind: 'list', paths: ['Baking/Icing.md', 'Projects/Harbour/Harbour.md', 'Baking/Icing.md', 'Missing.md'] }, NOTES, STORE);
  assert.deepEqual(paths(list), ['Baking/Icing.md', 'Projects/Harbour/Harbour.md']);
});

test('never published: private, Secrets stay out of words, health, a pack mark, publish: false, each named', () => {
  const r = S.resolveSitePages({ kind: 'folder', folder: '' }, NOTES, HEALTH_STORE);
  const out = new Map(r.excluded.map((e) => [e.path, e.reason]));
  assert.equal(out.get('Private notes/Diary.md'), 'Private notes stay private.');
  assert.equal(out.get('Health/Check-in.md'), 'Marked Health.');
  assert.equal(out.get('Me/Finance/Bills/Power bill.md'), 'Marked Personal.');
  assert.equal(out.get('Draft.md'), 'Marked publish: false.');
  assert.ok(!paths(r).includes('Private notes/Diary.md'), 'no private note in the site');
  assert.ok(out.get('Baking/Sourdough.md') === undefined, 'an open note is in');
});

test('a note marked through its own property, its type default and its folder', () => {
  const own = S.resolveSitePages({ kind: 'page', path: 'Baking/Sourdough.md' }, [{ path: 'Baking/Sourdough.md', title: 'Sourdough', props: { sensitivity: 'health' }, tags: [] }], STORE);
  assert.deepEqual(paths(own), []);
  assert.equal(own.excluded[0].reason, 'Marked Health.');
  const byType = S.resolveSitePages({ kind: 'page', path: 'Baking/Sourdough.md' }, NOTES, { ...STORE, types: { recipe: 'personal' } });
  assert.equal(byType.excluded[0].reason, 'Marked Personal.');
});

test('hidden properties publish none; shown ones never carry the private four', () => {
  const props = { type: 'recipe', serves: 8, sensitivity: 'open', publish: true, private: false, visibility: 'open' };
  const shown = S.propsHtml(props);
  assert.ok(shown.includes('Serves') && shown.includes('8'), 'a visible property shows');
  assert.ok(!shown.includes('Sensitivity') && !shown.includes('Publish') && !shown.includes('Private') && !shown.includes('Visibility'), 'the private four never publish');
  assert.equal(S.propsHtml({ sensitivity: 'open' }), '', 'nothing but hidden ones shows nothing');
});

// ── The built site ────────────────────────────────────────────────────────────────────────────────────────────────

const CAKE_TEXT = `---
type: recipe
serves: 8
---

# Lemon cake

A plain cake for Sunday afternoons.

## Method

Stir the batter. See [[Icing]] for the topping, and [[Private notes/Diary]] for no one.

![The cake](Photos/cake.png)

- [ ] Buy lemons
- [x] Heat the oven

| What | How much |
| --- | --- |
| Flour | 300 g |

> [!tip] The tin
> Line it with paper.

\`\`\`js
bake(180);
\`\`\`

[locked](secret:AbC123xYz9)

A raw <script>alert(1)</script> tag and a [bad link](javascript:alert(1)).
`;

const ICING_TEXT = `# Icing

Sugar and lemon. Back to [[Lemon cake|Sourdough]].

![[Lemon cake]]

[The mill's guide](https://example.com/flour).
`;

function vaultOf(files) {
  const map = new Map(Object.entries(files));
  const names = new Map([...map.keys()].map((k) => [k.toLowerCase(), k]));
  return {
    resolve: (target, from) => {
      const t = String(target ?? '').replace(/\\/g, '/').trim();
      if (!t || /^(https?:|mailto:|data:|#|secret:)/i.test(t)) return null;
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
      const cands = [`${dir}/${t}`.replace(/^\//, ''), t, `${t}.md`, `${dir}/${t}.md`.replace(/^\//, '')];
      for (const c of cands) {
        const hit = names.get(c.toLowerCase());
        if (hit) return hit;
      }
      const base = t.split('/').pop().toLowerCase();
      for (const [low, k] of names) if (low.split('/').pop() === base || low.split('/').pop() === `${base}.md`) return k;
      return null;
    },
    read: (rel) => {
      const hit = names.get(String(rel).toLowerCase());
      if (!hit) return null;
      const v = map.get(hit);
      return typeof v === 'string' ? new TextEncoder().encode(v) : (v ?? null);
    },
  };
}

function built(opts = {}) {
  const vault = vaultOf({
    'Baking/Lemon cake.md': CAKE_TEXT,
    'Baking/Icing.md': ICING_TEXT,
    'Baking/Photos/cake.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    'Private notes/Diary.md': '# Diary\n',
  });
  return S.buildSite({
    site: { name: 'Mia’s baking', description: 'Cakes worth making.', accent: '#4a7fc9' },
    pages: [
      { path: 'Baking/Lemon cake.md', title: 'Lemon cake', props: { type: 'recipe', serves: 8 }, text: CAKE_TEXT },
      { path: 'Baking/Icing.md', title: 'Icing', props: {}, text: ICING_TEXT },
    ],
    vault,
    showProperties: opts.showProperties ?? true,
  });
}

const fileOf = (b, p) => new TextDecoder().decode(b.files.find((f) => f.path === p).data);

test('home: a calm header with the pages as cards, most recently changed first', () => {
  const vault = vaultOf({
    'Baking/Lemon cake.md': CAKE_TEXT,
    'Baking/Icing.md': ICING_TEXT,
    'Baking/Photos/cake.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  });
  // In the site's order Icing sorts first, but Lemon changed after it: home leads with Lemon.
  const b = S.buildSite({
    site: { name: 'Mia’s baking', description: 'Cakes worth making.', accent: '#4a7fc9' },
    pages: [
      { path: 'Baking/Icing.md', title: 'Icing', props: {}, text: ICING_TEXT, mtime: 1000 },
      { path: 'Baking/Lemon cake.md', title: 'Lemon cake', props: { type: 'recipe', serves: 8 }, text: CAKE_TEXT, mtime: 2000 },
    ],
    vault,
    showProperties: true,
  });
  const home = fileOf(b, 'index.html');
  assert.ok(home.includes('<header class="home-head"><h1>Mia’s baking</h1>'), 'the site name as a calm header');
  assert.ok(home.includes('<p>Cakes worth making.</p>'), 'its description under it');
  const cards = home.split('<ul class="home-cards">')[1];
  assert.ok(cards, 'the pages as cards');
  assert.ok(cards.indexOf('lemon-cake.html') < cards.indexOf('icing.html'), 'most recently changed first');
  const nav = home.split('<nav class="side"')[1].split('</nav>')[0];
  assert.ok(nav.indexOf('icing.html') < nav.indexOf('lemon-cake.html'), 'the navigation keeps the site’s order');
  assert.ok(cards.includes('<span class="home-card-title">Lemon cake</span>'), 'each card titled');
  assert.ok(cards.includes('A plain cake for Sunday afternoons.'), 'each card with its first line');
  assert.ok(cards.includes('<img src="files/cake.png" alt="" loading="lazy"'), 'the lemon card shows its picture, lazy and decorative');
  assert.equal((home.match(/<img /g) ?? []).length, 1, 'only the page with a picture shows one');
  assert.ok(home.includes('<footer class="site">Published from the Vault.</footer>'), 'the small footer');
  const css = fileOf(b, 'style.css');
  assert.ok(css.includes('.home-cards'), 'the cards styled, light and dark by the reader’s setting');
});

test('home, side navigation, one page per note, the words drawn as the Vault draws them', () => {
  const b = built();
  const home = fileOf(b, 'index.html');
  assert.ok(home.includes('<h1>Mia’s baking</h1>') && home.includes('Cakes worth making.'), 'home names and describes the site');
  assert.ok(home.includes('lemon-cake.html') && home.includes('icing.html'), 'home lists the pages');
  assert.ok(home.includes('<nav class="side"'), 'the side navigation');
  const cake = fileOf(b, 'baking/lemon-cake.html');
  assert.ok(cake.includes('<h2 id="method">Method</h2>'), 'headings with ids');
  assert.ok(cake.includes('<table>') && cake.includes('<th>What</th>'), 'tables');
  assert.ok(cake.includes('type="checkbox" disabled') && cake.includes('checked'), 'checklists');
  assert.ok(cake.includes('class="callout green"') && cake.includes('The tin'), 'callouts');
  assert.ok(cake.includes('<code>bake(180);</code>'), 'code');
  assert.ok(cake.includes('<img src="../files/cake.png"'), 'the picture copied and shown, relative to the page');
  assert.ok(b.files.some((f) => f.path === 'files/cake.png'), 'the picture file in the site');
  assert.ok(!cake.includes('<script>alert'), 'raw HTML never runs');
  assert.ok(!cake.includes('javascript:'), 'unsafe links dropped');
  assert.ok(cake.includes(S.SECRET_STANDIN) && !cake.includes('AbC123xYz9'), 'a secret is the stand-in, never its id');
});

test('links between published pages kept, links out turned to plain words, embeds as links', () => {
  const b = built();
  const cake = fileOf(b, 'baking/lemon-cake.html');
  assert.ok(cake.includes('<a href="icing.html">Icing</a>'), 'a link to a published page kept');
  assert.ok(!cake.includes('Diary') || cake.includes(S.PRIVATE_STANDIN), 'a private link is the stand-in');
  assert.ok(!cake.includes('Private notes/Diary'), 'no private path leaks');
  const icing = fileOf(b, 'baking/icing.html');
  assert.ok(icing.includes('<a href="lemon-cake.html">Sourdough</a>'), 'an alias kept');
  assert.ok(icing.includes('<a href="lemon-cake.html">Lemon cake</a>'), 'an embed of a note is a link to its page');
  assert.ok(icing.includes('href="https://example.com/flour"'), 'a web link kept');
  for (const f of b.files.filter((x) => x.path.endsWith('.html'))) {
    const html = new TextDecoder().decode(f.data);
    assert.ok(!html.includes('.md"') && !html.includes('.md#'), `${f.path}: never a link to a note file`);
  }
});

test('search over the pages with its index in the page, sharing titles, accent, light and dark', () => {
  const b = built();
  const search = fileOf(b, 'search.html');
  assert.ok(search.includes('window.__siteIndex='), 'the index in the page');
  assert.ok(search.includes('Lemon cake') && search.includes('Sugar and lemon'), 'the index covers the pages');
  assert.ok(!search.includes('fetch('), 'nothing fetched: the folder opens with no server');
  const cake = fileOf(b, 'baking/lemon-cake.html');
  assert.ok(cake.includes('<title>Lemon cake · Mia’s baking</title>'), 'a proper title');
  assert.ok(cake.includes('name="description"') && cake.includes('property="og:title"'), 'sharing words');
  assert.ok(cake.includes('--accent:#4a7fc9'), "the person's accent");
  const css = fileOf(b, 'style.css');
  assert.ok(css.includes('prefers-color-scheme:dark'), 'dark by the reader’s setting');
  assert.ok(css.includes('--bg:#ffffff'), 'white first');
  for (const f of b.files.filter((x) => x.path.endsWith('.html'))) {
    const html = new TextDecoder().decode(f.data);
    assert.ok(!/href="\//.test(html) && !/src="\//.test(html), `${f.path}: relative links only, for file://`);
  }
});

test('hidden properties publish none', () => {
  const b = built({ showProperties: false });
  assert.ok(!fileOf(b, 'baking/lemon-cake.html').includes('class="props"'), 'no properties when hidden');
  const shown = built({ showProperties: true });
  assert.ok(fileOf(shown, 'baking/lemon-cake.html').includes('Serves'), 'visible ones show');
});

test('re-publish writes only what changed and removes dropped pages', () => {
  const a = built();
  const prev = S.manifestOf(a.files);
  const same = S.planSiteWrite(prev, a.files);
  assert.deepEqual([same.write, same.remove, same.same], [[], [], true]);
  const changed = a.files.map((f) => (f.path === 'baking/icing.html' ? { ...f, data: new TextEncoder().encode('new') } : f)).filter((f) => f.path !== 'files/cake.png');
  const plan = S.planSiteWrite(prev, changed);
  assert.deepEqual(plan.write, ['baking/icing.html']);
  assert.deepEqual(plan.remove, ['files/cake.png']);
  assert.equal(plan.same, false);
});

test('the sites file round-trips and reads leniently', () => {
  const site = { id: 'sAbC123xYz90', name: 'Mia’s baking', description: '', source: { kind: 'folder', folder: 'Baking' }, folder: '/tmp/baking', accent: '#4a7fc9', host: null, createdAt: '2026-10-31', publishedAt: '', lastWords: '' };
  const back = S.parseSites(S.writeSites([site, { nope: 1 }, null]));
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], site);
  assert.deepEqual(S.parseSites('not json'), []);
  assert.deepEqual(S.parseSites(''), []);
  assert.ok(/^[A-Za-z0-9_-]{6,40}$/.test(S.newSiteId()), 'a fresh id fits the file');
  assert.equal(S.describeSource({ kind: 'list', paths: ['a.md', 'b.md'] }), '2 chosen pages');
});

test('published marks: each page with its sites', () => {
  const sites = [
    { id: 'sone', name: 'Baking', description: '', source: { kind: 'folder', folder: 'Baking' }, folder: '/tmp/a', accent: '#f2785a', host: null, createdAt: '', publishedAt: '2026-10-31', lastWords: '' },
    { id: 'stwo', name: 'Drafts', description: '', source: { kind: 'folder', folder: '' }, folder: '', accent: '#f2785a', host: null, createdAt: '', publishedAt: '', lastWords: '' },
  ];
  const marks = S.siteMarks(sites, new Map([['sone', ['Baking/Icing.md']], ['stwo', ['Baking/Icing.md']]]));
  assert.deepEqual(marks, [{ path: 'Baking/Icing.md', sites: [{ id: 'sone', name: 'Baking' }] }]);
});

// ── The main side: folders, re-publish, unpublish, the host path ─────────────────────────────────────────────────

const put = (abs, data) => {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
};

function fixtureVault() {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-site-vault-'));
  put(path.join(dir, 'Baking', 'Lemon cake.md'), CAKE_TEXT);
  put(path.join(dir, 'Baking', 'Icing.md'), ICING_TEXT);
  put(path.join(dir, 'Baking', 'Photos', 'cake.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  put(path.join(dir, 'Private notes', 'x.nvlock'), 'sealed');
  put(path.join(dir, '.neuralvault', 'sensitivity.json'), '{}');
  return dir;
}

function serviceOf(o) {
  const trashed = [];
  const channels = new Map();
  const sent = [];
  const hostCalls = [];
  const svc = M.registerSitePublish({
    handle: (c, fn) => channels.set(c, fn),
    send: (c, p) => sent.push([c, p]),
    root: () => o.dir,
    readText: (rel) => readFileSync(path.join(o.dir, ...rel.split('/')), 'utf8'),
    notes: () => [
      { path: 'Baking/Lemon cake.md', title: 'Lemon cake', props: { type: 'recipe', serves: 8 }, tags: [] },
      { path: 'Baking/Icing.md', title: 'Icing', props: {}, tags: [] },
      { path: 'Private notes/Diary.md', title: 'Diary', props: {}, tags: [] },
    ],
    resolve: (target, from) => vaultOf({ 'Baking/Lemon cake.md': '', 'Baking/Icing.md': '', 'Baking/Photos/cake.png': '' }).resolve(target, from),
    readFile: (rel) => {
      try {
        return new Uint8Array(readFileSync(path.join(o.dir, ...rel.split('/'))));
      } catch {
        return null;
      }
    },
    sensitivity: () => STORE,
    accent: () => '#4a7fc9',
    showProperties: () => true,
    pickFolder: async () => o.folder ?? null,
    trash: async (abs) => {
      trashed.push(abs);
      await rmSync(abs, { force: true });
    },
    hostPublish: o.hostPublish ?? null,
    log: () => {},
  });
  return { svc, channels, sent, trashed, hostCalls, call: (c, ...a) => channels.get(c)(...a) };
}

test('publish writes the folder; re-publish updates and removes; unpublish in one step', async () => {
  const dir = fixtureVault();
  const folder = path.join(mkdtempSync(path.join(tmpdir(), 'nv-site-out-')), 'baking');
  try {
    const t = serviceOf({ dir, folder });
    const saved = await t.call('site:save', { name: 'Mia’s baking', description: 'Cakes.', source: { kind: 'folder', folder: 'Baking' }, folder: '', accent: '', host: null });
    assert.ok(saved.id, 'the site kept');
    const resolved = await t.call('site:resolve', saved.id);
    assert.equal(resolved.included.length, 2);
    const preview = await t.call('site:preview', saved.id);
    assert.ok(preview.url.startsWith('file://') && preview.url.endsWith('baking/icing.html'), `the preview opens on the first page: ${preview.url}`);
    assert.ok(existsSync(path.join(preview.dir, 'index.html')), 'home staged a click away');
    assert.ok(existsSync(path.join(preview.dir, 'search.html')), 'the staged search page');
    const done = await t.call('site:publish', saved.id);
    assert.ok(done.words.includes('2 pages'), `said plainly what it did: ${done.words}`);
    assert.ok(existsSync(path.join(folder, 'index.html')), 'home written');
    assert.ok(existsSync(path.join(folder, 'baking', 'lemon-cake.html')), 'a page written');
    assert.ok(existsSync(path.join(folder, 'files', 'cake.png')), 'the picture copied');
    const again = await t.call('site:publish', saved.id);
    assert.ok(again.words.includes('already'), `nothing changed says so: ${again.words}`);
    // Drop a page: re-publish removes it (to the bin) and says so.
    await t.call('site:save', { ...saved, source: { kind: 'page', path: 'Baking/Icing.md' } });
    const updated = await t.call('site:publish', saved.id);
    assert.ok(!existsSync(path.join(folder, 'baking', 'lemon-cake.html')), 'the dropped page removed');
    assert.ok(t.trashed.some((p) => p.endsWith('lemon-cake.html')), 'removed to the bin, never deleted for good');
    assert.ok(updated.words.includes('1 page'), `said what changed: ${updated.words}`);
    const marks = await t.call('site:marks');
    assert.deepEqual(marks, [{ path: 'Baking/Icing.md', sites: [{ id: saved.id, name: 'Mia’s baking' }] }]);
    const un = await t.call('site:unpublish', saved.id, true);
    assert.ok(un.words.includes('Unpublished'), `unpublished in one step: ${un.words}`);
    assert.ok(!existsSync(path.join(folder, 'index.html')), 'the folder’s site gone');
    assert.deepEqual(await t.call('site:marks'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(folder), { recursive: true, force: true });
  }
});

test('publish refuses an empty choice and names the excluded', async () => {
  const dir = fixtureVault();
  try {
    const t = serviceOf({ dir });
    const saved = await t.call('site:save', { name: 'Empty', description: '', source: { kind: 'page', path: 'Private notes/Diary.md' }, folder: '', accent: '', host: null });
    await assert.rejects(() => t.call('site:publish', saved.id), /Private notes stay private/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the host destination path, through a fake host', async () => {
  const dir = fixtureVault();
  const folder = path.join(mkdtempSync(path.join(tmpdir(), 'nv-site-host-')), 'baking');
  const calls = [];
  const fake = async (req) => {
    calls.push(req);
    if (req.op === 'hosts') return { hosts: [{ id: 'netlify', name: 'Netlify', free: 'Free plan.', help: 'Paste a token.', keys: [{ id: 'token', label: 'Token', secret: true }], connected: false, account: '' }], last: '' };
    if (req.op === 'connect') return { connected: true, account: 'mia@example.com' };
    if (req.op === 'publish') return { site: { id: 'h1', host: 'netlify', hostName: 'Netlify', title: 'Mia’s baking', url: 'https://mia-baking.netlify.app', adminUrl: '', publishedAt: '2026-10-31', note: '' } };
    if (req.op === 'unpublish' && !req.confirm) return { ask: { title: 'Unpublish?', text: 'Sure?', confirm: 'Unpublish', cancel: 'Keep' } };
    if (req.op === 'unpublish') return { unpublished: true, note: 'Gone from Netlify.' };
    throw new Error(`unexpected ${req.op}`);
  };
  try {
    const t = serviceOf({ dir, folder, hostPublish: fake });
    const hosts = await t.call('site:hosts');
    assert.equal(hosts.hosts[0].id, 'netlify');
    assert.equal(hosts.available, true);
    const saved = await t.call('site:save', { name: 'Mia’s baking', description: '', source: { kind: 'folder', folder: 'Baking' }, folder, accent: '', host: { id: 'netlify', settings: {} } });
    const done = await t.call('site:publish', saved.id);
    assert.ok(done.words.includes('netlify.app'), `the host address said: ${done.words}`);
    assert.deepEqual(calls.map((c) => c.op), ['hosts', 'publish']);
    assert.equal(calls[1].dir, folder);
    const ask = await t.call('site:unpublish', saved.id, false);
    assert.ok(ask.ask && ask.ask.title === 'Unpublish?', 'the host asked first');
    const un = await t.call('site:unpublish', saved.id, true);
    assert.ok(un.words.includes('Gone from Netlify'), 'the host note kept');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(folder), { recursive: true, force: true });
  }
});

test('without the host app there are no host destinations, only the folder', async () => {
  const dir = fixtureVault();
  try {
    const t = serviceOf({ dir });
    const hosts = await t.call('site:hosts');
    assert.equal(hosts.available, false);
    assert.deepEqual(hosts.hosts, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
