// A document's facts (t239, 12 Nov 2026; approved plan item 4: "Documents carry their version, status (draft, sent,
// signed) and signer", and critic 2 F08: versions are loose files with no "latest"). A document or a file on a
// project carries: status (draft, sent, signed, or none), signer and signed-on when signed, and versions — a newer
// file links the one it replaces, so "Latest" is a fact, never a guess from the file name. Notes carry them as typed
// front matter (doc_status, signed_by, signed_on, replaces); a file in a project's folder carries them as sub-lines
// under its Documents entry (the same keys), so a person can read and write both. `replaces` is written as a
// [[link]], so renaming either side keeps it working like every other link. Pure: no Node, no DOM.

export type DocStatus = 'draft' | 'sent' | 'signed';
export const DOC_STATUSES: DocStatus[] = ['draft', 'sent', 'signed'];
export const STATUS_WORDS: Record<DocStatus, string> = { draft: 'Draft', sent: 'Sent', signed: 'Signed' };
/** The status after this one, for the one-click change on the page (signed wraps back to none). */
export const NEXT_STATUS: Record<string, DocStatus | null> = { '': 'draft', draft: 'sent', sent: 'signed', signed: null };

export interface DocFacts {
  status: DocStatus | null;
  signer: string;
  signedOn: string;
  /** What this version replaces: a path or [[link]], '' when it replaces nothing. */
  replaces: string;
}

export const NO_FACTS: DocFacts = { status: null, signer: '', signedOn: '', replaces: '' };

const clean = (v: unknown) => String(v ?? '').trim();
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase();

/** A [[link]] (or path) as its target: alias and heading dropped. */
export function replacesTarget(replaces: string): string {
  const t = clean(replaces);
  const m = /^\[\[([^\]]+)\]\]$/.exec(t);
  const inner = m ? m[1] : t;
  return inner.split('|')[0].split('#')[0].trim();
}

/** A note's facts from its indexed properties (an older note without them reads plain, nothing invented). */
export function readDocFacts(props: Record<string, unknown> | undefined): DocFacts {
  if (!props) return { ...NO_FACTS };
  const status = clean(props.doc_status).toLowerCase();
  return {
    status: status === 'draft' || status === 'sent' || status === 'signed' ? status : null,
    signer: clean(props.signed_by),
    signedOn: clean(props.signed_on),
    replaces: clean(props.replaces),
  };
}

/** A file's facts from its Documents entry's sub-lines (the same keys, one per line: `signed_by: June Park`). */
export function readDocFactsMore(more: string | undefined): DocFacts {
  const facts: DocFacts = { ...NO_FACTS };
  if (!more) return facts;
  for (const line of more.split('\n')) {
    const m = /^\s*(doc_status|signed_by|signed_on|replaces)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === 'doc_status') {
      const s = m[2].toLowerCase();
      if (s === 'draft' || s === 'sent' || s === 'signed') facts.status = s;
    } else if (m[1] === 'signed_by') facts.signer = m[2];
    else if (m[1] === 'signed_on') facts.signedOn = m[2];
    else facts.replaces = m[2];
  }
  return facts;
}

/** Facts written back into sub-lines, keeping the person's own lines (only the four keys are replaced). */
export function docFactsToMore(facts: DocFacts, more: string | undefined): string | undefined {
  const rest = (more ?? '').split('\n').filter((l) => l.trim() && !/^\s*(doc_status|signed_by|signed_on|replaces)\s*:/.test(l));
  const lines = [...rest];
  if (facts.status) lines.push(`doc_status: ${facts.status}`);
  if (facts.signer) lines.push(`signed_by: ${facts.signer}`);
  if (facts.signedOn) lines.push(`signed_on: ${facts.signedOn}`);
  if (facts.replaces) lines.push(`replaces: ${facts.replaces}`);
  return lines.length ? lines.join('\n') : undefined;
}

export interface DocNode {
  path: string;
  title: string;
  facts: DocFacts;
  /** A file in a project's folder: the project listing it (notes carry none). */
  project?: string;
}

/** Chain nodes for notes (title and path as the index keeps them). */
export function docNodesFromNotes(notes: { path: string; title: string; props?: Record<string, unknown> }[]): DocNode[] {
  return notes.map((n) => ({ path: n.path, title: n.title, facts: readDocFacts(n.props) }));
}

/** Chain nodes for a project's Documents entries (a file's title is its description, else its name). */
export function docNodesFromDocuments(project: string, entries: { path: string; what?: string; more?: string }[]): DocNode[] {
  return entries.map((d) => ({ path: d.path, title: d.what?.trim() || d.path.replace(/\\/g, '/').split('/').pop() || d.path, facts: readDocFactsMore(d.more), project }));
}

/** A replaces target resolved to the document it names: exact path first, then path ending, then title (never a guess: an ambiguous name resolves to nothing). */
export function resolveReplaces(docs: DocNode[], replaces: string): DocNode | null {
  const target = replacesTarget(replaces);
  if (!target) return null;
  const n = norm(target);
  const byPath = docs.filter((d) => norm(d.path) === n);
  if (byPath.length === 1) return byPath[0];
  if (byPath.length > 1) return null;
  const ending = docs.filter((d) => `/${norm(d.path)}`.endsWith(`/${n}`));
  if (ending.length === 1) return ending[0];
  if (ending.length > 1) return null;
  const byTitle = docs.filter((d) => d.title.trim().toLowerCase() === target.toLowerCase());
  return byTitle.length === 1 ? byTitle[0] : null;
}

export interface DocChain {
  facts: DocFacts;
  /** 1 for the first version, counted back down the replaces links (cycle-safe). */
  version: number;
  /** True when nothing replaces this one: latest is who nothing points at, not a name. */
  latest: boolean;
  /** Earlier versions, nearest first. */
  earlier: DocNode[];
  /** The version replacing this one, if any. */
  newer: DocNode | null;
  /** Every version in the chain, oldest first. */
  all: DocNode[];
}

/** One document's place in its chain, from every document that could link it. */
export function docChain(docs: DocNode[], start: string): DocChain {
  const byNorm = new Map(docs.map((d) => [norm(d.path), d] as const));
  const self = byNorm.get(norm(start));
  const facts = self?.facts ?? { ...NO_FACTS };
  // Back: what this replaces, and what that replaces (a loop stops where it started).
  const earlier: DocNode[] = [];
  const seen = new Set([norm(start)]);
  let at: DocNode | null | undefined = self;
  for (;;) {
    const prev: DocNode | null = at?.facts.replaces ? resolveReplaces(docs, at.facts.replaces) : null;
    if (!prev || seen.has(norm(prev.path))) break;
    seen.add(norm(prev.path));
    earlier.push(prev);
    at = prev;
  }
  // Forward: what replaces this (nearest only; a loop stops where it started; nothing when the start isn't listed).
  const newer = self ? (docs.find((d) => !seen.has(norm(d.path)) && !!d.facts.replaces && resolveReplaces(docs, d.facts.replaces)?.path === self.path) ?? null) : null;
  if (newer) seen.add(norm(newer.path));
  // The rest of the chain past the newer one, for the count.
  const after: DocNode[] = [];
  let head: DocNode | null | undefined = newer;
  for (;;) {
    const next: DocNode | null = head ? (docs.find((d) => !seen.has(norm(d.path)) && d.facts.replaces && resolveReplaces(docs, d.facts.replaces)?.path === head!.path) ?? null) : null;
    if (!next) break;
    seen.add(norm(next.path));
    after.push(next);
    head = next;
  }
  return { facts, version: earlier.length + 1, latest: !newer, earlier, newer, all: [...earlier.slice().reverse(), ...(self ? [self] : []), ...(newer ? [newer] : []), ...after] };
}

/** "v2, latest" or "v1" or "v3" for the page's head. */
export const docVersionWords = (version: number, latest: boolean): string => `v${version}${latest ? ', latest' : ''}`;

/** "2 versions" for a project row (only past one; a lone document says nothing). */
export const docCountWords = (count: number): string => (count < 2 ? '' : `${count} versions`);

/** "Signed by June Park on 3 Oct", "Sent", "Draft", or '' when plain. The date's words come from the caller. */
export function docStatusWords(facts: DocFacts, whenWords: string): string {
  if (facts.status === 'signed') return `Signed${facts.signer ? ` by ${facts.signer}` : ''}${whenWords ? ` on ${whenWords}` : ''}`;
  if (facts.status === 'sent') return 'Sent';
  if (facts.status === 'draft') return 'Draft';
  return '';
}

/** Whether the facts say anything at all (a plain older document says nothing). */
export const hasDocFacts = (facts: DocFacts): boolean => !!(facts.status || facts.signer || facts.signedOn || facts.replaces);
// A newer copy of the same document (t243, 12 Nov 2026): version marks, copies and dates stripped, so a repeat
// PDF becomes the next version, never a second document. "ShadeCo quote v2.pdf" is "ShadeCo quote.pdf" again;
// "ShadeCo invoice.pdf" is not.
const VERSION_MARKS = [/\s+v\d+$/i, /\s*\(\d+\)$/, /\s*-\s*(final|revised|updated|draft|signed|copy)(\s+\d+)?$/i, /\s+\d{4}-\d{2}-\d{2}$/, /\s+\d{1,2}-[a-z]{3}-\d{2,4}$/i];
/** A file's name as its document's identity: lower-cased, version marks off, spaces and dashes one. */
export function documentIdentity(name: string): string {
  let stem = String(name ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  stem = stem.replace(/\.[a-z0-9]{1,8}$/i, '');
  let last = '';
  while (last !== stem) {
    last = stem;
    for (const mark of VERSION_MARKS) stem = stem.replace(mark, '');
    stem = stem.trim();
  }
  return stem.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Whether two names are copies of the same document (never true on an empty identity). */
export function sameDocument(a: string, b: string): boolean {
  const x = documentIdentity(a);
  return !!x && x === documentIdentity(b);
}
