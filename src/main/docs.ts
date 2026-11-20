// Docs on the main side (src/shared/doc-file.ts): a project that is really documentation turned into a doc, a doc turned
// into a project, a new doc, and Undo for each. Everything goes through the host the app gives it (the same writes as the
// window's: indexed, shown in open tabs, kept in file recovery; moves that keep links working; deletes to Recently
// deleted, never a permanent delete), so this module needs no Electron and is tested with a made-up library.

import { docCanvasPath, docPath, docToProject, isDocText, newDocText, NOT_PAGES, parseDoc, projectToDoc, redirectLinks, safeDocName, setDocProp, type DocPage, type LinkRedirect } from '../shared/doc-file';
import { repointProjectCanvas } from '../shared/doc-canvas';
import { isProjectText, parseProject, projectPath, projectsFolder } from '../shared/project-file';
import type { CanvasBoard } from '../shared/project-canvas';

export interface DocsHost {
  /** A note's words as the index has them (undefined when it isn't there). */
  content(rel: string): string | undefined;
  /** Every note: its path, title and properties. */
  notes(): { path: string; title: string; props: Record<string, unknown>; links: { target: string }[] }[];
  /** What a link written in `from` reaches (a note or a file), or null. */
  resolve(target: string, from: string): string | null;
  /** Every file and folder. */
  listing(): Promise<{ files: { rel: string; kind: string }[]; folders: string[] }>;
  exists(rel: string): Promise<boolean>;
  /** A note written as every write is (indexed, open tabs, file recovery); its folder made when needed. */
  write(rel: string, text: string): Promise<void>;
  readText(rel: string): Promise<string>;
  /** A canvas (or other text file) written. */
  writeText(rel: string, text: string): Promise<void>;
  /** Moved or renamed with every link to it kept working. */
  move(from: string, to: string): Promise<string>;
  /** To Recently deleted (its notes kept by file recovery too), never a permanent delete. */
  trash(rel: string): Promise<void>;
  /** "18 Oct 2026". */
  today(): string;
  /** 2026-10-18. */
  isoToday(): string;
  docsFolder(): string;
}

/** What a conversion did, kept to undo it (while Ironleaf is open; file recovery keeps every version after that). */
interface Step {
  /** The file it made (the doc, or the project). */
  made: string;
  madeText: string;
  /** Other files it made (a doc's canvas): to Recently deleted on Undo. */
  alsoMade: string[];
  /** Canvases and notes changed: written back when they are still as it left them. */
  changed: { path: string; before: string; after: string }[];
  /** Files sent to Recently deleted, with their words (written back on Undo). */
  trashed: { path: string; text: string }[];
  /** Moves, in order (undone in reverse). */
  moves: [string, string][];
  words: string;
}

export interface ConvertResult {
  path: string;
  words: string;
  /** Files that moved ([from, to]): open tabs follow them. */
  moves: [string, string][];
  /** Files sent to Recently deleted. */
  trashed: string[];
}

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
const inside = (p: string, dir: string) => !!dir && p.startsWith(`${dir}/`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export class Docs {
  private history = new Map<string, Step>();
  constructor(private host: DocsHost) {}

  /** A free path for a new file ("Name.md", else "Name 2.md"…). */
  private async free(path: string): Promise<string> {
    if (!(await this.host.exists(path))) return path;
    const dot = path.lastIndexOf('.');
    for (let i = 2; i < 1000; i++) {
      const next = `${path.slice(0, dot)} ${i}${path.slice(dot)}`;
      if (!(await this.host.exists(next))) return next;
    }
    throw new Error('No free name was found.');
  }

  /** How a link to `target` is written so it reaches it alone once `gone` are gone: its name, else its path. */
  private linkText(target: string, gone: Set<string>): string {
    const title = stem(target).toLowerCase();
    const clash = this.host.notes().some((n) => n.path !== target && !gone.has(n.path) && stem(n.path).toLowerCase() === title);
    return clash ? target.replace(/\.md$/i, '') : stem(target);
  }

  /** Links in every note (and file cards on every canvas) that reached `redirect`'s files sent on; their old words kept. */
  private async redirectEverywhere(redirect: Map<string, LinkRedirect & { path: string }>, skip: Set<string>): Promise<{ changed: Step['changed']; links: number }> {
    const changed: Step['changed'] = [];
    let links = 0;
    for (const n of this.host.notes()) {
      if (skip.has(n.path)) continue;
      if (!n.links.some((l) => redirect.has(this.host.resolve(l.target, n.path) ?? ''))) continue;
      const before = this.host.content(n.path);
      if (before === undefined) continue;
      const r = redirectLinks(before, (t) => this.host.resolve(t, n.path), redirect);
      if (!r.count || r.text === before) continue;
      await this.host.write(n.path, r.text);
      changed.push({ path: n.path, before, after: r.text });
      links += r.count;
    }
    // Canvases name files on their cards: a card of a file that is going shows the doc (at its section) instead.
    for (const f of (await this.host.listing()).files.filter((x) => x.kind === 'canvas' && /\.canvas$/i.test(x.rel))) {
      if (skip.has(f.rel)) continue;
      let before: string;
      try {
        before = await this.host.readText(f.rel);
      } catch {
        continue;
      }
      let board: CanvasBoard;
      try {
        board = JSON.parse(before) as CanvasBoard;
      } catch {
        continue;
      }
      let count = 0;
      const nodes = (board.nodes ?? []).map((n) => {
        const to = n.type === 'file' && n.file ? redirect.get(n.file) : undefined;
        if (!to) return n;
        count++;
        return { ...n, file: to.path, ...(to.heading && !n.subpath ? { subpath: `#${to.heading}` } : {}) };
      });
      if (!count) continue;
      const after = JSON.stringify({ ...board, nodes }, null, '\t');
      await this.host.writeText(f.rel, after);
      changed.push({ path: f.rel, before, after });
      links += count;
    }
    return { changed, links };
  }

  /** A project's own pages, as the former host app finds them: the notes in its folder (up to four levels down) other than
   *  its file, not in Activity, Tasks, Files or Captures, not a project or a doc; in path order. */
  pagesOf(project: string): DocPage[] {
    const dir = folderOf(project);
    if (!dir) return [];
    return this.host
      .notes()
      .filter((n) => {
        if (n.path === project || !inside(n.path, dir)) return false;
        const rest = n.path.slice(dir.length + 1);
        if (rest.split('/').length > 4) return false;
        if (rest.includes('/') && NOT_PAGES.has(rest.split('/')[0].toLowerCase())) return false;
        const text = this.host.content(n.path) ?? '';
        return !isProjectText(text) && !isDocText(text);
      })
      .map((n) => n.path)
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({ path, title: stem(path), text: this.host.content(path) ?? '' }));
  }

  /**
   * A project turned into a doc, in place of it: every word kept (src/shared/doc-file.ts projectToDoc), its canvas
   * re-pointed at the doc, links to the project and its pages sent to the doc (at the pages' sections), what else was
   * in its folder (Activity, files) kept in the doc's own folder, and the project file and merged pages to the Recycle
   * Bin. Undo puts it all back.
   */
  async projectToDoc(project: string): Promise<ConvertResult> {
    const step: Step = { made: '', madeText: '', alsoMade: [], changed: [], trashed: [], moves: [], words: '' };
    try {
      return await this.convert(project, step);
    } catch (err) {
      // Part way: what it had changed is put back, and nothing is left half done.
      if (step.made) await this.rollBack(step).catch(() => {});
      throw err;
    }
  }

  /** What a conversion had done so far, put back (it failed part way). */
  private async rollBack(step: Step): Promise<void> {
    for (const t of step.trashed) {
      if (await this.host.exists(t.path)) continue;
      if (/\.canvas$/i.test(t.path)) await this.host.writeText(t.path, t.text);
      else await this.host.write(t.path, t.text);
    }
    for (const c of step.changed) {
      if (/\.canvas$/i.test(c.path)) await this.host.writeText(c.path, c.before).catch(() => {});
      else if (this.host.content(c.path) === c.after) await this.host.write(c.path, c.before);
    }
    for (const f of [step.made, ...step.alsoMade]) if (f && (await this.host.exists(f))) await this.host.trash(f).catch(() => {});
  }

  private async convert(project: string, step: Step): Promise<ConvertResult> {
    const text = this.host.content(project);
    if (text === undefined) throw new Error('That project isn’t there any more.');
    if (!isProjectText(text)) throw new Error('That note isn’t a project.');
    const name = parseProject(text, project).name || stem(project);
    const target = docPath(name, this.host.docsFolder());
    if (await this.host.exists(target)) throw new Error(`There’s already a doc called “${name}” (${target}). Put what the project says into it, or rename one of them first.`);
    const pages = this.pagesOf(project);
    // Its canvas: the one named after it beside it, else the first canvas in its folder.
    const dir = folderOf(project);
    const canvases = dir ? (await this.host.listing()).files.filter((f) => f.kind === 'canvas' && /\.canvas$/i.test(f.rel) && folderOf(f.rel) === dir).map((f) => f.rel) : [];
    const oldCanvas = canvases.find((c) => stem(c.replace(/\.canvas$/i, '.md')) === stem(project)) ?? canvases[0] ?? '';
    const newCanvas = oldCanvas ? docCanvasPath(target) : '';
    const made = projectToDoc(text, pages, { name, ...(newCanvas ? { canvas: newCanvas } : {}), isoToday: this.host.isoToday() });
    const gone = new Set([project, ...made.merged.map((m) => m.path)]);
    const docLink = this.linkText(target, gone);
    const redirect = new Map<string, LinkRedirect & { path: string }>([[project, { docLink, heading: '', path: target }]]);
    for (const m of made.merged) redirect.set(m.path, { docLink, heading: m.heading, path: target });
    // Links between its own pages, inside the doc, reach its sections.
    const docText = redirectLinks(made.text, (t) => this.host.resolve(t, project), redirect).text;
    Object.assign(step, { made: target, madeText: docText });
    await this.host.write(target, docText);
    // The project's canvas, re-pointed at the doc and kept beside it (the old one to Recently deleted below).
    if (oldCanvas) {
      let board: CanvasBoard;
      try {
        board = JSON.parse(await this.host.readText(oldCanvas)) as CanvasBoard;
      } catch {
        board = { nodes: [], edges: [] };
      }
      const pagesMap = new Map(made.merged.map((m) => [m.path, m.heading]));
      await this.host.writeText(newCanvas, JSON.stringify(repointProjectCanvas(board, { project, docPath: target, docText, pages: pagesMap }), null, '\t'));
      step.alsoMade.push(newCanvas);
    }
    const sent = await this.redirectEverywhere(redirect, new Set([...gone, target, ...(oldCanvas ? [oldCanvas, newCanvas] : [])]));
    step.changed.push(...sent.changed);
    // The project file, its merged pages and its old canvas to Recently deleted (their words kept by file recovery and
    // for Undo); the former host app's task notes (Activity) and its files stay where they are. A folder left empty goes.
    for (const p of [...gone, ...(oldCanvas ? [oldCanvas] : [])]) {
      const words = /\.canvas$/i.test(p) ? await this.host.readText(p).catch(() => undefined) : this.host.content(p);
      if (words === undefined) continue;
      await this.host.trash(p);
      step.trashed.push({ path: p, text: words });
    }
    if (dir && stem(dir).toLowerCase() === stem(project).toLowerCase() && !(await this.host.listing()).files.some((f) => inside(f.rel, dir)) && (await this.host.exists(dir))) await this.host.trash(dir);
    const pagesWords = made.merged.filter((m) => m.heading !== 'Changes').length;
    step.words = `Turned “${name}” into a doc${pagesWords ? `: ${plural(pagesWords, 'page')} became sections` : ''}${sent.links ? `, ${plural(sent.links, 'link')} now ${sent.links === 1 ? 'reaches' : 'reach'} it` : ''}. The project${made.merged.length ? ' and its pages are' : ' is'} in Recently deleted.`;
    this.history.set(target, step);
    return { path: target, words: step.words, moves: [], trashed: step.trashed.map((t) => t.path) };
  }

  /**
   * A doc turned into a project (kept simple): the same words as a project file (Projects/<Name>/<Name>.md) with a
   * project's properties, links sent to it, the doc to Recently deleted. Undo puts it back.
   */
  async docToProject(doc: string): Promise<ConvertResult> {
    const text = this.host.content(doc);
    if (text === undefined) throw new Error('That doc isn’t there any more.');
    const name = parseDoc(text, doc).name || stem(doc);
    const top = (await this.host.listing()).folders.filter((f) => !f.includes('/'));
    const target = await this.free(projectPath(projectsFolder(top), name));
    const projectText = docToProject(text, { today: this.host.isoToday() });
    const step: Step = { made: target, madeText: projectText, alsoMade: [], changed: [], trashed: [], moves: [], words: '' };
    await this.host.write(target, projectText);
    const gone = new Set([doc]);
    const redirect = new Map<string, LinkRedirect & { path: string }>([[doc, { docLink: this.linkText(target, gone), heading: '', path: target }]]);
    const sent = await this.redirectEverywhere(redirect, new Set([doc, target]));
    step.changed.push(...sent.changed);
    await this.host.trash(doc);
    step.trashed.push({ path: doc, text });
    step.words = `Turned “${name}” into a project${sent.links ? `; ${plural(sent.links, 'link')} now ${sent.links === 1 ? 'reaches' : 'reach'} it` : ''}. The doc is in Recently deleted.`;
    this.history.set(target, step);
    return { path: target, words: step.words, moves: [], trashed: [doc] };
  }

  /** A new doc (the Docs section's New doc): from a doc template's words, or blank. */
  async create(name: string, templateText?: string): Promise<string> {
    const title = safeDocName(name);
    const target = await this.free(docPath(title, this.host.docsFolder()));
    let text = templateText?.trim() ? templateText : newDocText({ name: title, summary: 'What this is, in a few sentences: what it is for, who uses it and where it runs.', today: this.host.today() });
    if (!isDocText(text)) text = setDocProp(text, 'type', 'doc');
    await this.host.write(target, text);
    return target;
  }

  /** Whether a conversion that made `path` can be undone now. */
  canUndo(path: string): boolean {
    return this.history.has(path);
  }

  /** A conversion undone: the files it sent to Recently deleted written back, moves undone, notes and canvases it changed put
   *  back (those changed since are left), the file it made to Recently deleted. */
  async undo(path: string): Promise<ConvertResult> {
    const step = this.history.get(path);
    if (!step) throw new Error('There’s nothing to undo here.');
    const now = this.host.content(step.made);
    if (now !== undefined && now !== step.madeText) {
      this.history.delete(path);
      throw new Error('It was changed since, so it can’t be undone in one go. The earlier versions are in File recovery and Recently deleted.');
    }
    const moves: [string, string][] = [];
    for (const [from, to] of [...step.moves].reverse()) {
      if (!(await this.host.exists(to)) || (await this.host.exists(from))) continue;
      await this.host.move(to, from);
      moves.push([to, from]);
    }
    for (const t of step.trashed) {
      if (await this.host.exists(t.path)) continue;
      if (/\.canvas$/i.test(t.path)) await this.host.writeText(t.path, t.text);
      else await this.host.write(t.path, t.text);
    }
    const movedBack = (p: string) => moves.reduce((x, [a, b]) => (x === a ? b : x.startsWith(`${a}/`) ? b + x.slice(a.length) : x), p);
    let kept = 0;
    for (const c of step.changed) {
      const at = movedBack(c.path);
      const current = /\.canvas$/i.test(at) ? await this.host.readText(at).catch(() => undefined) : this.host.content(at);
      if (current === undefined) continue;
      if (current !== c.after) {
        kept++;
        continue;
      }
      if (/\.canvas$/i.test(at)) await this.host.writeText(at, c.before);
      else await this.host.write(at, c.before);
    }
    for (const f of [step.made, ...step.alsoMade]) if (await this.host.exists(f)) await this.host.trash(f);
    this.history.delete(path);
    const what = step.words.replace(/^Turned “([^”]+)” into a (doc|project).*$/, (_m, n: string, k: string) => `${n} is a ${k === 'doc' ? 'project' : 'doc'} again`);
    return { path: step.trashed[0]?.path ?? path, words: `Undone: ${what}.${kept ? ` ${plural(kept, 'note')} changed since ${kept === 1 ? 'was' : 'were'} left as ${kept === 1 ? 'it is' : 'they are'}.` : ''}`, moves, trashed: [step.made] };
  }
}
