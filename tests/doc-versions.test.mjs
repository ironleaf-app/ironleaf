// node --test tests/doc-versions.test.mjs — a document's facts (src/shared/doc-versions.ts, t239): status (draft,
// sent, signed, or plain none), signer and signed-on, and versions chained by `replaces`, so "Latest" is a fact and
// never a guess from the file name. Notes carry them as front matter; a file in a project's folder as sub-lines under
// its Documents entry. Made-up documents only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-docver-'));
let D;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/doc-versions.ts'), platform: 'node', output: { file: path.join(work, 'd.mjs'), format: 'esm' }, logLevel: 'silent' });
  D = await import(pathToFileURL(path.join(work, 'd.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const F = (facts) => ({ status: null, signer: '', signedOn: '', replaces: '', ...facts });
const N = (path, title, facts = {}) => ({ path, title, facts: F(facts) });

test('front matter reads: status, signer, signed-on and replaces', () => {
  assert.deepEqual(D.readDocFacts({ doc_status: 'signed', signed_by: 'June Park', signed_on: '2026-10-03', replaces: '[[Contract v1]]' }), F({ status: 'signed', signer: 'June Park', signedOn: '2026-10-03', replaces: '[[Contract v1]]' }));
  assert.equal(D.readDocFacts({ doc_status: 'Sent' }).status, 'sent', 'any case reads');
  assert.equal(D.readDocFacts({ doc_status: 'active' }).status, null, 'another kind of status is not a document status');
  assert.equal(D.readDocFacts({ status: 'Active' }).status, null, 'a contract lifecycle status never leaks in');
});

test('an older document without the fields reads plain, with nothing invented', () => {
  assert.deepEqual(D.readDocFacts({ type: 'contract', vendor: 'ShadeCo' }), F({}));
  assert.deepEqual(D.readDocFacts(undefined), F({}));
  assert.deepEqual(D.readDocFactsMore(undefined), F({}));
  assert.deepEqual(D.readDocFactsMore('  a person’s own sub-note\n  - keep it'), F({}), 'a person’s own sub-lines are not facts');
  assert.equal(D.hasDocFacts(F({})), false);
  assert.equal(D.docStatusWords(F({}), '3 Oct'), '');
});

test('a file’s sub-lines read the same keys', () => {
  assert.deepEqual(D.readDocFactsMore('  doc_status: signed\n  signed_by: June Park\n  signed_on: 2026-10-03\n  replaces: [[Contract v1.pdf]]'), F({ status: 'signed', signer: 'June Park', signedOn: '2026-10-03', replaces: '[[Contract v1.pdf]]' }));
});

test('facts written back keep the person’s own sub-lines', () => {
  assert.equal(D.docFactsToMore(F({ status: 'sent' }), '  see June first'), '  see June first\ndoc_status: sent');
  assert.equal(D.docFactsToMore(F({ status: 'signed', signer: 'June Park' }), '  doc_status: draft\n  see June first'), '  see June first\ndoc_status: signed\nsigned_by: June Park', 'old keys replaced, the rest kept');
  assert.equal(D.docFactsToMore(F({}), '  see June first'), '  see June first');
  assert.equal(D.docFactsToMore(F({}), undefined), undefined);
});

test('replaces resolves by path, path ending or title — never a guess', () => {
  const docs = [N('Docs/Contract v1.md', 'Contract v1'), N('Docs/Contract v2.md', 'Contract v2'), N('Other/Contract v1.md', 'Contract v1')];
  assert.equal(D.resolveReplaces(docs, '[[Docs/Contract v1.md]]')?.path, 'Docs/Contract v1.md');
  assert.equal(D.resolveReplaces(docs.slice(0, 2), '[[Contract v1]]')?.path, 'Docs/Contract v1.md', 'a bare name finds the one match');
  assert.equal(D.resolveReplaces(docs, '[[Contract v1]]'), null, 'two matches resolve to nothing');
  assert.equal(D.resolveReplaces(docs, '[[Contract v2|the new one]]')?.path, 'Docs/Contract v2.md', 'aliases read');
  assert.equal(D.resolveReplaces(docs, ''), null);
});

test('the chain: version numbers, latest as a fact, earlier nearest first', () => {
  const docs = [N('Docs/Contract v1.md', 'Contract v1'), N('Docs/Contract v2.md', 'Contract v2', { replaces: '[[Contract v1]]' }), N('Docs/Contract v3.md', 'Contract v3', { replaces: '[[Contract v2]]' })];
  const v3 = D.docChain(docs, 'Docs/Contract v3.md');
  assert.equal(v3.version, 3);
  assert.equal(v3.latest, true);
  assert.deepEqual(v3.earlier.map((d) => d.path), ['Docs/Contract v2.md', 'Docs/Contract v1.md']);
  assert.equal(v3.newer, null);
  assert.equal(v3.all.length, 3);
  const v1 = D.docChain(docs, 'Docs/Contract v1.md');
  assert.equal(v1.version, 1);
  assert.equal(v1.latest, false);
  assert.equal(v1.newer?.path, 'Docs/Contract v2.md');
  assert.deepEqual(v1.earlier, []);
});

test('latest never comes from the file name', () => {
  // v10 sorts before v2 by name; the chain still knows v2 is the latest of these two.
  const docs = [N('Docs/Contract v10.md', 'Contract v10'), N('Docs/Contract v2.md', 'Contract v2', { replaces: '[[Contract v10]]' })];
  assert.equal(D.docChain(docs, 'Docs/Contract v2.md').latest, true);
  assert.equal(D.docChain(docs, 'Docs/Contract v10.md').latest, false);
});

test('a loop in replaces stops instead of spinning', () => {
  const docs = [N('a.md', 'a', { replaces: '[[b]]' }), N('b.md', 'b', { replaces: '[[a]]' })];
  const c = D.docChain(docs, 'a.md');
  assert.ok(c.version <= 3 && c.all.length <= 3, `stops (v${c.version}, ${c.all.length} in chain)`);
});

test('a file and a note chain across the boundary', () => {
  const docs = [N('Shopfit Contract v1.pdf', 'Shopfit Contract v1.pdf'), N('Docs/Shopfit Contract v2.md', 'Shopfit Contract v2', { replaces: '[[Shopfit Contract v1.pdf]]' })];
  const c = D.docChain(docs, 'Docs/Shopfit Contract v2.md');
  assert.equal(c.version, 2);
  assert.equal(c.latest, true);
  assert.deepEqual(c.earlier.map((d) => d.path), ['Shopfit Contract v1.pdf']);
});

test('the head words: version, count and status', () => {
  assert.equal(D.docVersionWords(2, true), 'v2, latest');
  assert.equal(D.docVersionWords(2, false), 'v2');
  assert.equal(D.docVersionWords(1, true), 'v1, latest');
  assert.equal(D.docCountWords(2), '2 versions');
  assert.equal(D.docCountWords(1), '');
  assert.equal(D.docStatusWords(F({ status: 'signed', signer: 'June Park' }), '3 Oct'), 'Signed by June Park on 3 Oct');
  assert.equal(D.docStatusWords(F({ status: 'signed' }), '3 Oct'), 'Signed on 3 Oct');
  assert.equal(D.docStatusWords(F({ status: 'sent' }), ''), 'Sent');
  assert.equal(D.docStatusWords(F({ status: 'draft' }), ''), 'Draft');
  assert.deepEqual(D.DOC_STATUSES, ['draft', 'sent', 'signed']);
  assert.equal(D.NEXT_STATUS[''], 'draft');
  assert.equal(D.NEXT_STATUS.draft, 'sent');
  assert.equal(D.NEXT_STATUS.sent, 'signed');
  assert.equal(D.NEXT_STATUS.signed, null);
});
