// node --test tests/t211-project-people.test.mjs — a project's people are only its vault's real people,
// the same on every walk, the owner once (t211, 11 Nov 2026). t208's walk of t200's 3,000-note vault showed the
// project hub's people as "AC AC SO" on one walk and "AC SC JP" on the next; the vault has six people and none is
// "SC". The attention's people followed link-insertion order (the note walk's order), so two builds of the same
// vault listed them differently; the hub listed "Alex Chen" beside "Alex Chen (owner)" as two (t208 fixed the
// header's stack alone). The hub dedupes by name however the file writes it, and the attention lists by name,
// however the vault was walked.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.join(import.meta.dirname, '..');
async function libs() {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-t211-'));
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const e1 = path.join(work, 'e1.ts');
    writeFileSync(e1, `export * from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};\n`);
    await build({ input: e1, platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
    const R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
    const e2 = path.join(work, 'e2.ts');
    writeFileSync(e2, `export * as H from ${JSON.stringify(path.join(root, 'src/shared/project-hub.ts'))};\nexport * as TL from ${JSON.stringify(path.join(root, 'src/shared/timeline.ts'))};\n`);
    await build({ input: e2, platform: 'node', output: { file: path.join(work, 'h.mjs'), format: 'esm' }, logLevel: 'silent' });
    const { H, TL } = await import(pathToFileURL(path.join(work, 'h.mjs')).href);
    return { R, H, TL };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const P = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
function vaultNotes() {
  const people = ['Alex Chen', 'Priya Nair', 'Sam Ortega', 'June Park', 'Tom Bradley', 'Lucy Hammond'];
  const notes = people.map((p) => ({ path: `People/${p}.md`, title: p, label: p, mtime: 1, props: { type: 'person' }, content: `---\ntype: person\n---\n# ${p}\n\nWorks with [[Harbourline Cart Fix]] most weeks.\n` }));
  notes.push({
    path: P, title: 'Harbourline Cart Fix', label: 'Harbourline Cart Fix', mtime: 1,
    props: { type: 'project', status: 'active', owner: 'Alex Chen' },
    content: ['---', 'type: project', 'status: active', 'owner: Alex Chen', '---', '# Harbourline Cart Fix', '', "## What's next", '',
      '- [ ] Chase the failed carts — Alex Chen — due 2026-11-05',
      '- [ ] Retry twice before failing — Priya Nair — due 2026-11-06',
      '- [ ] Book the soak test window — Sam Ortega — due 2026-11-09',
      '- [ ] Reconcile the invoices — June Park — due 2026-11-11',
      '- [ ] Taste the menus — Lucy Hammond — due 2026-11-15',
      '', '## People', '', '- Alex Chen (owner)', '- Priya Nair', ''].join('\n'),
  });
  notes.push({
    path: 'Meetings/2026-11-03 Cart standup.md', title: '2026-11-03 Cart standup', label: '2026-11-03 Cart standup', mtime: 1,
    props: { type: 'meeting', date: '2026-11-03', attendees: ['Alex Chen', 'Priya Nair'], project: P },
    content: `---\ntype: meeting\ndate: 2026-11-03\n---\n# 2026-11-03 Cart standup\n\n## Actions\n\n- [ ] Fix the tax line and resend — Priya Nair — due 2026-11-07\n- [ ] Check the resend — June Park — due 2026-11-08\n`,
  });
  return notes;
}
function resolver(notes) {
  return (t) => {
    const base = String(t).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    return notes.find((n) => n.path === base || n.title === base)?.path ?? null;
  };
}

test('the same vault built twice lists the same project people in the same order', async () => {
  const { R } = await libs();
  const notes = vaultNotes();
  const a = R.buildRecordModel({ notes: [...notes].sort((x, y) => x.path.localeCompare(y.path)), resolve: resolver(notes), today: '2026-11-11' });
  const b = R.buildRecordModel({ notes: [...notes].sort((x, y) => y.path.localeCompare(x.path)), resolve: resolver(notes), today: '2026-11-11' });
  const pa = R.projectAttention(a, P).people.map((r) => r.title);
  const pb = R.projectAttention(b, P).people.map((r) => r.title);
  assert.deepEqual(pa, pb, `two walks, one list (stood ${pa.join(', ')} vs ${pb.join(', ')})`);
  assert.deepEqual(pa, [...pa].sort((x, y) => x.localeCompare(y)), 'by name, however walked');
});

test('the hub names the owner once, however the file writes it', async () => {
  const { R, H, TL } = await libs();
  const notes = vaultNotes();
  // and bare (t208 saw "Alex Chen" beside "Alex Chen (owner)").
  const proj = notes.find((n) => n.path === P);
  proj.content = proj.content.replace('- Alex Chen (owner)\n- Priya Nair', '- Alex Chen (owner)\n- Alex Chen\n- Priya Nair');
  const m = R.buildRecordModel({ notes, resolve: resolver(notes), today: '2026-11-11' });
  const p = m.projects.get(P);
  const hub = H.hubModel({ project: p.project, props: p.props, today: TL.todayDay(), ...(m.me ? { me: m.me } : {}), connected: R.connectedActions(m, P) });
  const names = hub.people.map((x) => x.name.replace(/\s*\(owner\)\s*$/i, '').trim().toLowerCase());
  assert.equal(names.filter((n) => n === 'alex chen').length, 1, `the owner once (stood ${hub.people.map((x) => x.name).join(', ')})`);
});

test("a project's people are only real people of its vault", async () => {
  const { R, H, TL } = await libs();
  const notes = vaultNotes();
  const m = R.buildRecordModel({ notes, resolve: resolver(notes), today: '2026-11-11' });
  const known = new Set(notes.filter((n) => n.props.type === 'person').map((n) => n.title.toLowerCase()));
  const p = m.projects.get(P);
  const hub = H.hubModel({ project: p.project, props: p.props, today: TL.todayDay(), ...(m.me ? { me: m.me } : {}), connected: R.connectedActions(m, P) });
  for (const x of hub.people) {
    const bare = x.name.replace(/\s*\(owner\)\s*$/i, '').trim().toLowerCase();
    assert.ok(known.has(bare), `${x.name} is someone the vault knows`);
  }
  for (const r of R.projectAttention(m, P).people) {
    assert.ok(known.has(r.title.toLowerCase()) || r.type === 'org', `${r.title} is someone the vault knows`);
  }
});
