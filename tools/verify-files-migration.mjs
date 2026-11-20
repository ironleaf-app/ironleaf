// Checks a move of files into place on a copy of a vault, with nothing from Ironleaf's own code (Wave 4 part c,
// 24 Oct 2026): every file that was there before is still somewhere with the same bytes, every note is still there, and
// every link that reached a file before reaches a file with the same bytes after. Links are found and followed here the
// way a notes app reads them ([[wikilinks]], ![[embeds]], [words](paths)), by path, from the note's folder, or by name.
//   node tools/verify-files-migration.mjs <vault before> <vault after> [--json]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const [beforeArg, afterArg, flag] = process.argv.slice(2);
if (!beforeArg || !afterArg) {
  console.error('Usage: node tools/verify-files-migration.mjs <vault before> <vault after> [--json]');
  process.exit(2);
}

/** Every file (forward-slash paths), Ironleaf's own folder and its records of files (.files.json, the asset store's
 *  assets.json, which follow the files they describe) left out; older versions kept. */
function walk(root, dir = '', out = []) {
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (rel === '.neuralvault' || e.name === '.git' || e.name === 'node_modules') continue;
      walk(root, rel, out);
    } else if (e.isFile() && e.name !== '.files.json' && e.name !== 'assets.json') out.push(rel); // Ironleaf's own records of files follow the files
  }
  return out;
}

const sha = (root, rel) => createHash('sha256').update(readFileSync(path.join(root, ...rel.split('/')))).digest('hex');
const isNote = (p) => /\.md$/i.test(p);

function norm(p) {
  const out = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(s);
  }
  return out.join('/');
}

/** The links in a note, in order: each as written. */
function linksOf(text) {
  const masked = text.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length)).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  const out = [];
  for (const m of masked.matchAll(/!?\[\[([^\]\n]+?)\]\]|!?\[[^\]\n]*\]\(\s*<?([^()<>\s]+?)>?(?:\s+"[^"]*")?\s*\)/g)) {
    if (m[1] !== undefined) {
      const t = m[1].split('|')[0].split('#')[0].trim();
      if (t) out.push({ t, md: false });
    } else {
      const raw = m[2];
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue;
      let t = raw.split('#')[0];
      try {
        t = decodeURI(t);
      } catch {}
      if (t) out.push({ t, md: true });
    }
  }
  return out;
}

function resolver(files) {
  const set = new Set(files);
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const byBase = new Map();
  for (const f of files) {
    const b = f.split('/').pop().toLowerCase();
    for (const k of [b, b.replace(/\.md$/i, '')]) {
      const l = byBase.get(k) ?? [];
      l.push(f);
      byBase.set(k, l);
    }
  }
  return (t, from, md) => {
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const tries = [];
    const near = norm(dir ? `${dir}/${t}` : t);
    const top = norm(t);
    if (md) tries.push(near, top);
    else tries.push(top, near);
    for (const c of tries) {
      if (!c) continue;
      for (const v of [c, `${c}.md`]) {
        if (set.has(v)) return v;
        if (lower.has(v.toLowerCase())) return lower.get(v.toLowerCase());
      }
    }
    if (md) return null;
    // By name (and a path written from anywhere): the shortest path that ends with it.
    const tl = t.toLowerCase().replace(/^\/+/, '');
    const base = tl.split('/').pop();
    const cands = (byBase.get(base) ?? []).filter((f) => {
      const fl = f.toLowerCase();
      return !tl.includes('/') || fl === tl || fl.endsWith(`/${tl}`) || fl === `${tl}.md` || fl.endsWith(`/${tl}.md`);
    });
    return cands.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
  };
}

const B = path.resolve(beforeArg);
const A = path.resolve(afterArg);
const before = walk(B);
const after = walk(A);
const afterSha = new Map();
for (const f of after) {
  const h = sha(A, f);
  afterSha.set(h, [...(afterSha.get(h) ?? []), f]);
}
const report = { files: 0, filesOk: 0, notes: 0, notesOk: 0, links: 0, linksOk: 0, missingFiles: [], missingNotes: [], brokenLinks: [], moved: 0 };
const afterSet = new Set(after);
const bShas = new Map();
for (const f of before) {
  if (isNote(f)) {
    report.notes++;
    if (afterSet.has(f)) report.notesOk++;
    else report.missingNotes.push(f);
    continue;
  }
  report.files++;
  const h = sha(B, f);
  bShas.set(f, h);
  if (afterSha.has(h)) {
    report.filesOk++;
    if (!afterSet.has(f)) report.moved++;
  } else report.missingFiles.push(f);
}
const resolveB = resolver(before);
const resolveA = resolver(after);
for (const note of before.filter(isNote)) {
  if (!afterSet.has(note)) continue;
  const lb = linksOf(readFileSync(path.join(B, ...note.split('/')), 'utf8'));
  const la = linksOf(readFileSync(path.join(A, ...note.split('/')), 'utf8'));
  lb.forEach((l, i) => {
    const r = resolveB(l.t, note, l.md);
    if (!r || isNote(r)) return; // links to notes, and links that reached nothing before, aren't this move's to keep
    report.links++;
    const want = bShas.get(r) ?? sha(B, r);
    const now = la[i] ? resolveA(la[i].t, note, la[i].md) : null;
    const ok = now && !isNote(now) && sha(A, now) === want;
    if (ok) report.linksOk++;
    else report.brokenLinks.push(`${note}: “${l.t}” reached ${r} before, ${now ? `reaches ${now} now (other contents)` : 'reaches nothing now'}`);
  });
}
if (flag === '--json') console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Files: ${report.filesOk} of ${report.files} are still there with the same bytes (${report.moved} moved).`);
  console.log(`Notes: ${report.notesOk} of ${report.notes} are still there.`);
  console.log(`Links to files: ${report.linksOk} of ${report.links} still reach the same contents.`);
  for (const x of [...report.missingFiles.map((f) => `Missing file: ${f}`), ...report.missingNotes.map((f) => `Missing note: ${f}`), ...report.brokenLinks]) console.log(`  ${x}`);
}
const ok = report.filesOk === report.files && report.notesOk === report.notes && report.linksOk === report.links;
console.log(ok ? 'PASS: every file and link survived.' : 'FAIL');
process.exit(ok ? 0 : 1);
