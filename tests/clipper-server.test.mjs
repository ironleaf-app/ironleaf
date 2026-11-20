// node --test tests/clipper-server.test.mjs — the clipper's local side (src/main/clipper.ts; 8.8): the endpoint on
// 127.0.0.1 refuses other origins and unpaired browsers, pairs once with Settings' code, and files each kind of clip
// as a normal note with its source link and its pictures beside it. The extension's own client (extensions/clipper/
// api.js) drives it end to end, as the popup does.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ClipperApi } from '../extensions/clipper/api.js';

// The endpoint lives on this PC: no proxy stands between the test and it.
process.env.NO_PROXY = [...(process.env.NO_PROXY ? [process.env.NO_PROXY] : []), '127.0.0.1', 'localhost'].join(',');
process.env.no_proxy = process.env.NO_PROXY;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-clipsrv-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/clipper.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/clipper.ts'))};\nexport { readProps } from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** A 1x1 PNG's bytes, base64 (made-up picture data for the tests). */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const newsHtml = () => readFileSync(path.join(root, 'tests/fixtures/clipper/news.html'), 'utf8');

/** A made-up vault behind the endpoint: notes and pictures in memory, folders and one project. */
function fakeHost(on = { on: true }) {
  const notes = new Map();
  const files = new Map();
  const taken = new Set();
  const free = (folder, title, ext) => {
    const base = `${folder ? `${folder}/` : ''}${title}`;
    let rel = `${base}${ext}`;
    for (let i = 2; taken.has(rel); i++) rel = `${base} ${i}${ext}`;
    taken.add(rel);
    return rel;
  };
  return {
    notes,
    files,
    host: {
      dataDir: mkdtempSync(path.join(tmpdir(), 'nv-clipdata-')),
      version: '9.9.9',
      clipperOn: () => on.on,
      extensionDir: () => path.join(root, 'extensions/clipper'),
      ready: async () => {},
      requireCreate: async () => {},
      vaultName: () => 'Test Vault',
      places: async () => ({ folders: ['Clippings', 'Notes/Reading'], projects: [{ path: 'Projects/Shop/Shop.md', name: 'Shop' }] }),
      freeNote: async (folder, title) => free(folder, title, '.md'),
      findClip: async (url) => {
        for (const [rel, text] of notes) {
          const m = /^source: \"(.*)\"$/m.exec(text);
          if (m && M.canonicalClipUrl(m[1]) === url) return { path: rel, title: rel.split('/').pop().replace(/\.md$/, '') };
        }
        return null;
      },
      writeNote: async (rel, text) => void notes.set(rel, text),
      saveImage: async (folder, name, bytes) => {
        const rel = free(folder, name.replace(/\.[a-z0-9]+$/i, ''), name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.png');
        files.set(rel, bytes);
        return rel;
      },
      link: (rel) => `[[${rel}]]`,
      attachmentsFor: (note) => `${note.includes('/') ? note.slice(0, note.lastIndexOf('/')) : ''}/Files`.replace(/^\//, ''),
      log: () => {},
    },
  };
}

async function started(host) {
  const service = new M.ClipperService(host);
  const port = await service.start();
  return { service, port, base: `http://127.0.0.1:${port}`, stop: () => service.stop() };
}

const post = (base, p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('pairing: Settings’ code pairs a browser; anything else is refused', async () => {
  const { host } = fakeHost();
  const { service, base, stop } = await started(host);
  try {
    assert.ok(M.CLIPPER_PORTS.includes(service.port), 'a clipper port');
    const kept = JSON.parse(readFileSync(path.join(host.dataDir, 'clipper.json'), 'utf8'));
    assert.equal(M.codeValid(kept.code), true);
    assert.deepEqual(kept.tokens, []);
    let res = await post(base, '/pair', { code: 'wrongcode' });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /not right/);
    res = await post(base, '/pair', { code: kept.code.toLowerCase() });
    assert.equal(res.status, 200);
    const { token } = await res.json();
    assert.ok(token.length >= 30);
    assert.equal(JSON.parse(readFileSync(path.join(host.dataDir, 'clipper.json'), 'utf8')).tokens.length, 1);
    // Lower case with a space pairs too (typed as shown).
    res = await post(base, '/pair', { code: `${kept.code.slice(0, 4)} ${kept.code.slice(4)}`.toLowerCase() });
    assert.equal(res.status, 200);
  } finally {
    await stop();
  }
});

test('only this PC, only the extension, only paired browsers', async () => {
  const { host } = fakeHost();
  const { base, stop } = await started(host);
  try {
    const kept = JSON.parse(readFileSync(path.join(host.dataDir, 'clipper.json'), 'utf8'));
    const token = (await (await post(base, '/pair', { code: kept.code })).json()).token;
    const T = { 'x-neuralvault-clipper': token };
    // A web page's origin is refused even with the token.
    let res = await fetch(`${base}/places`, { headers: { ...T, origin: 'https://example.com' } });
    assert.equal(res.status, 403);
    res = await post(base, '/clip', { kind: 'bookmark', url: 'https://example.com/', title: 'x' }, { ...T, origin: 'https://example.com' });
    assert.equal(res.status, 403);
    // The extension's own origin is answered.
    res = await fetch(`${base}/places`, { headers: { ...T, origin: 'chrome-extension://abcdefghijklmnop' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnop');
    // A forwarded Host is refused (sent over a raw socket: request builders set the real one).
    const { Socket } = await import('node:net');
    const port = Number(new URL(base).port);
    const rawStatus = await new Promise((resolve) => {
      const sock = new Socket();
      let head = '';
      sock.on('data', (chunk) => {
        head += chunk.toString('utf8');
        if (head.includes('\r\n')) {
          sock.destroy();
          resolve(Number(/HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0));
        }
      });
      sock.on('error', () => resolve(0));
      sock.connect(port, '127.0.0.1', () => sock.write(`GET /places HTTP/1.1\r\nHost: evil.example:9999\r\n${T['x-neuralvault-clipper'] ? `X-Neuralvault-Clipper: ${T['x-neuralvault-clipper']}\r\n` : ''}Connection: close\r\n\r\n`));
    });
    assert.equal(rawStatus, 403);
    // Unpaired browsers are refused on places and clips, in words.
    res = await fetch(`${base}/places`);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /not paired/);
    res = await fetch(`${base}/places`, { headers: { 'x-neuralvault-clipper': 'made-up-token' } });
    assert.equal(res.status, 403);
    res = await post(base, '/clip', { kind: 'bookmark', url: 'https://example.com/', title: 'x' });
    assert.equal(res.status, 403);
    // Preflight for the extension's fetch.
    res = await fetch(`${base}/clip`, { method: 'OPTIONS', headers: { origin: 'chrome-extension://abcdefghijklmnop', 'access-control-request-method': 'POST' } });
    assert.equal(res.status, 204);
  } finally {
    await stop();
  }
});

test('while off, the endpoint says so plainly and files nothing', async () => {
  const on = { on: false };
  const { host } = fakeHost(on);
  const { base, stop } = await started(host);
  try {
    const kept = JSON.parse(readFileSync(path.join(host.dataDir, 'clipper.json'), 'utf8'));
    let res = await fetch(`${base}/status`);
    assert.deepEqual(await res.json(), { running: true, enabled: false, paired: false });
    res = await post(base, '/pair', { code: kept.code });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /clipper is off/);
    res = await post(base, '/clip', { kind: 'bookmark', url: 'https://example.com/', title: 'x' }, { 'x-neuralvault-clipper': 'whatever' });
    assert.equal(res.status, 403);
    on.on = true;
    res = await fetch(`${base}/status`);
    assert.equal((await res.json()).enabled, true);
  } finally {
    await stop();
  }
});

test('guessing the code is throttled', async () => {
  const { host } = fakeHost();
  const { base, stop } = await started(host);
  try {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post(base, '/pair', { code: 'AAAAAAAA' })).status;
    assert.equal(last, 429);
  } finally {
    await stop();
  }
});

async function pairedApi(host) {
  const { service, base, stop } = await started(host);
  const kept = JSON.parse(readFileSync(path.join(host.dataDir, 'clipper.json'), 'utf8'));
  const api = new ClipperApi({});
  await api.pair(kept.code);
  return { api, service, base, stop };
}

test('an article becomes a note with its source link and its pictures beside it', async () => {
  const { host, notes, files } = fakeHost();
  const { api, stop } = await pairedApi(host);
  try {
    const html = newsHtml();
    const done = await api.clip({ kind: 'article', url: 'https://www.harbourgazette.example/news/tunnel', title: 'Harbour tunnel decision due before Christmas', html, images: [{ url: 'https://images.harbourgazette.example/tunnel-1200.jpg', data: PIXEL, type: 'image/png' }], tags: ['reads'], note: 'For the commute.' });
    assert.equal(done.path, 'Clippings/Harbour tunnel decision due before Christmas.md');
    assert.match(done.words, /Clipped to your clippings/);
    const note = notes.get(done.path);
    assert.ok(note, 'the note is written');
    const props = M.readProps(note);
    assert.equal(props.source, 'https://www.harbourgazette.example/news/tunnel');
    assert.equal(props.site, 'Harbour Gazette');
    assert.equal(props.author, 'Priya Nair');
    assert.deepEqual(props.tags, ['reads']);
    assert.match(note, /For the commute\./);
    assert.match(note, /final decision on the second harbour tunnel/);
    assert.ok(!note.includes('images.harbourgazette.example/tunnel-1200.jpg'), 'no remote picture address left');
    const [imgRel] = [...files.keys()];
    assert.match(imgRel, /^Clippings\/Files\/.*\.png$/);
    assert.ok(note.includes(`![[${imgRel}]]`), 'the kept picture embedded');
    assert.deepEqual([...files.values()][0].subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  } finally {
    await stop();
  }
});

test('a selection, a bookmark and a screenshot each become their own note', async () => {
  const { host, notes, files } = fakeHost();
  const { api, stop } = await pairedApi(host);
  try {
    const sel = await api.clip({ kind: 'selection', url: 'https://example.com/essay', title: 'An essay', html: '<p>Keep <strong>this</strong> line.</p>', place: { kind: 'folder', path: 'Notes/Reading' } });
    assert.equal(sel.path, 'Notes/Reading/An essay.md');
    assert.match(notes.get(sel.path), /Keep \*\*this\*\* line\./);
    assert.match(notes.get(sel.path), /Clipped from \[An essay\]\(https:\/\/example\.com\/essay\)/);
    const mark = await api.clip({ kind: 'bookmark', url: 'https://shop.example/', title: 'A shop', description: 'Nice flour.', images: [{ url: 'https://shop.example/logo.png', data: PIXEL, type: 'image/png' }], place: { kind: 'project', path: 'Projects/Shop/Shop.md' } });
    assert.equal(mark.path, 'Projects/Shop/A shop.md');
    assert.match(mark.words, /Clipped to Shop/);
    assert.match(notes.get(mark.path), /Nice flour\./);
    assert.match(notes.get(mark.path), /\[Open the page\]\(https:\/\/shop\.example\/\)/);
    const shot = await api.clip({ kind: 'screenshot', url: 'https://example.com/chart', title: 'Q3 chart', screenshot: { url: '', data: PIXEL, type: 'image/png' }, note: 'For Friday.' });
    assert.match(shot.path, /^Clippings\/Q3 chart\.md$/);
    assert.match(notes.get(shot.path), /For Friday\./);
    assert.match(notes.get(shot.path), /Taken from \[Q3 chart\]\(https:\/\/example\.com\/chart\)/);
    assert.equal(files.size, 2, 'the bookmark picture and the screenshot kept');
    // A project gone since: said plainly, nothing filed.
    await assert.rejects(api.clip({ kind: 'bookmark', url: 'https://example.com/', title: 'x', place: { kind: 'project', path: 'Projects/Gone/Gone.md' } }), /isn’t there any more/);
  } finally {
    await stop();
  }
});

test('pictures that are not pictures are left out, never written', async () => {
  const { host, notes, files } = fakeHost();
  const { api, stop } = await pairedApi(host);
  try {
    const done = await api.clip({ kind: 'article', url: 'https://example.com/a', title: 'A', html: '<p>Words <img src="https://example.com/x.png" alt="X marks"></p>', images: [{ url: 'https://example.com/x.png', data: Buffer.from('not a picture').toString('base64'), type: 'image/png' }] });
    assert.equal(files.size, 0);
    assert.match(notes.get(done.path), /\*X marks \(picture not fetched\)\*/, 'said plainly, never bare words');
    // A picture too large is refused in words.
    await assert.rejects(api.clip({ kind: 'screenshot', url: 'https://example.com/', title: 'S', screenshot: { url: '', data: 'eA=='.repeat(12 * 1024 * 1024), type: 'image/png' } }), /too large|could not be read/);
  } finally {
    await stop();
  }
});

test('the extension’s client: pairing, places, clips and plain words on failure', async () => {
  const { host } = fakeHost();
  const { base, stop } = await started(host);
  try {
    const kept = JSON.parse(readFileSync(path.join(host.dataDir, 'clipper.json'), 'utf8'));
    const api = new ClipperApi({});
    const status = await api.status();
    assert.equal(status.running, true);
    assert.equal(status.paired, false);
    await assert.rejects(api.places(), /not paired yet/);
    await assert.rejects(api.pair('AAAAAAAA'), /not right/);
    await api.pair(kept.code);
    const places = await api.places();
    assert.deepEqual(places.folders, ['Clippings', 'Notes/Reading']);
    assert.deepEqual(places.projects, [{ path: 'Projects/Shop/Shop.md', name: 'Shop' }]);
    assert.equal((await api.status()).paired, true);
    assert.equal((await api.status()).vault, 'Test Vault');
    assert.ok(base.startsWith('http://127.0.0.1:'));
  } finally {
    await stop();
  }
  const gone = new ClipperApi({});
  await assert.rejects(gone.status(), /not running/);
  assert.equal((await gone.token()), null);
});

test('pictures are sniffed, never trusted as claimed', () => {
  assert.equal(M.sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(M.sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(M.sniffImage(Buffer.from('GIF89a12', 'ascii')), 'gif');
  assert.equal(M.sniffImage(Buffer.from('RIFF____WEBP', 'ascii')), 'webp');
  assert.equal(M.sniffImage(Buffer.from('not a picture')), null);
  assert.equal(M.codeValid(M.makePairingCode()), true);
});

test('Get the extension points outside app.asar when packaged, and the package unpacks the folder (20 Nov 2026)', async () => {
  const { readFileSync } = await import('node:fs');
  const C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
  assert.equal(C.outsideAsar('C:\\Program Files\\Ironleaf\\resources\\app.asar\\extensions\\clipper'), 'C:\\Program Files\\Ironleaf\\resources\\app.asar.unpacked\\extensions\\clipper');
  assert.equal(C.outsideAsar('/opt/Ironleaf/resources/app.asar/extensions/clipper'), '/opt/Ironleaf/resources/app.asar.unpacked/extensions/clipper');
  assert.equal(C.outsideAsar('/home/me/neuralvault/extensions/clipper'), '/home/me/neuralvault/extensions/clipper', 'a dev build is left alone');
  assert.equal(C.outsideAsar('/x/resources/app.asar.unpacked/extensions/clipper'), '/x/resources/app.asar.unpacked/extensions/clipper', 'never twice');
  assert.equal(C.outsideAsar('/x/my.app.asarnot/extensions'), '/x/my.app.asarnot/extensions');
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.match(app, /return app\.isPackaged \? outsideAsar\(own\) : own;/, 'the packaged app hands out the unpacked folder');
  const builder = JSON.parse(readFileSync(path.join(root, 'build-standalone/electron-builder.json'), 'utf8'));
  assert.equal(builder.asar, true);
  assert.ok(builder.asarUnpack.includes('extensions/**'), 'electron-builder unpacks the extension');
  assert.ok(builder.files.includes('extensions/**'), 'and ships it');
  const release = readFileSync(path.join(root, 'tools/release.mjs'), 'utf8');
  assert.match(release, /cpSync\(path\.join\(root, 'extensions', 'clipper'\), path\.join\(stageDir, 'extensions', 'clipper'\)/, 'the stage step copies it in');
});
