// The note editor's parts: Markdown (with Ironleaf's extensions), Live Preview or Source, link and slash suggestions,
// pasting and dropping files, clicks on links, tags and tick-boxes, find and replace, folding, and the keys. Settings that
// change while a note is open (line numbers, spelling, brackets, folding, the mode) are swapped in place.

import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, StateField, type Extension } from '@codemirror/state';
import { crosshairCursor, Decoration, drawSelection, dropCursor, EditorView, highlightActiveLine, keymap, lineNumbers, placeholder, rectangularSelection, WidgetType, type DecorationSet } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { Prefs } from '../../../shared/prefs';
import { isMac } from '../lib/hotkeys';
import { linkTarget, shownInPlace, writeLink } from '../lib/links';
import { resolveNote } from '../lib/resolve';
import { getState, prefs } from '../state/store';
import { docs } from '../state/docs';
import { blockPlaces, withoutBlockId } from '../../../shared/blocks';
import { mentionKindFor } from '../state/noteTypes';
import { isDocPath } from '../lib/docPath';
import { isPrivatePath } from '../../../shared/private';
import { flashField, revealField } from './flash';
import { indentListItem, tableTab } from './commands';
import { holdSelectionForDrag } from './dragText';
import { htmlToMarkdown } from '../lib/htmlPaste';
import { formatBar } from './formatBar';
import { livePreview, sourceDecorations, type PreviewContext } from './live-preview';
import { reminderPills } from './reminders';
import { taskChipPills } from './taskChips';
import { SELECTION_ACTIONS } from '../../../shared/note-task';
import { ironleafMarkdown, nvTags } from './markdown-ext';
import { calloutCompletions, slashCompletions } from './slash';
import { propertiesHidden, suggestionsExtension } from './suggestions';
import { mentionCompletions, typeLinkOptions } from './typeLinks';
import { rankNotes } from '../lib/rankedNotes';

export interface EditorHost {
  path: string;
  openLink(target: string, newTab: boolean): void;
  openUrl(url: string): void;
  openTag(tag: string): void;
  /** `held`: Ctrl (or Cmd) is down, which previews even with previews switched off. */
  hover(target: string, anchor: HTMLElement, held?: boolean): void;
  insertTemplate(view: EditorView): void;
  linkToNote(view: EditorView): void;
  /** Saves a pasted or dropped file among the notes; the link text to use (or null). */
  saveFile(file: File): Promise<string | null>;
  /** Files dropped from File Explorer: their link texts. */
  importFiles(paths: string[]): Promise<string[]>;
  onChange(text: string): void;
  dateFormat(): string;
  timeFormat(): string;
  wikilinks(): boolean;
  version(): number;
  /** A doc's head element for this tab (views/DocHead.tsx draws into it). */
  docHead?(): HTMLElement | null;
  /** The note's foot element for this tab (components/NoteFoot.tsx draws into it). */
  foot?(): HTMLElement | null;
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-nv-hl-h1' },
  { tag: t.heading2, class: 'cm-nv-hl-h2' },
  { tag: t.heading3, class: 'cm-nv-hl-h3' },
  { tag: [t.heading4, t.heading5, t.heading6], class: 'cm-nv-hl-h4' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, class: 'cm-nv-hl-link' },
  { tag: t.url, class: 'cm-nv-hl-url' },
  { tag: t.monospace, class: 'cm-nv-hl-code' },
  { tag: t.quote, class: 'cm-nv-hl-quote' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], class: 'cm-nv-hl-mark' },
  { tag: nvTags.mark, class: 'cm-nv-hl-mark' },
  { tag: nvTags.highlight, class: 'cm-nv-hl-highlight' },
  { tag: nvTags.comment, class: 'cm-nv-hl-comment' },
  { tag: nvTags.math, class: 'cm-nv-hl-math' },
  { tag: nvTags.tag, class: 'cm-nv-hl-tag' },
  { tag: nvTags.footnote, class: 'cm-nv-hl-footnote' },
  // Fenced code, coloured as the reading view colours it (lib/hydrate.ts emits the same tok- classes and styles.css
  // paints both, light and dark): one style holds everything, because a fallback style only applies when no main
  // style exists at all (5 Nov 2026, the audit: live code rendered monochrome beside coloured Reading).
  { tag: t.keyword, class: 'tok-keyword' },
  { tag: t.string, class: 'tok-string' },
  { tag: t.number, class: 'tok-number' },
  { tag: t.bool, class: 'tok-bool' },
  { tag: t.atom, class: 'tok-atom' },
  { tag: t.comment, class: 'tok-comment' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], class: 'tok-definition' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'tok-function' },
  { tag: t.typeName, class: 'tok-typeName' },
  { tag: t.className, class: 'tok-className' },
  { tag: t.propertyName, class: 'tok-propertyName' },
  { tag: t.punctuation, class: 'tok-punctuation' },
  { tag: t.meta, class: 'tok-meta' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-text)', lineHeight: '1.6', overflowX: 'hidden' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '0 0 45vh' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
});

/** The inline title and properties sit above the first line, inside the scrolling page (a block at the top). */
class HeaderWidget extends WidgetType {
  constructor(readonly container: HTMLElement) {
    super();
  }
  eq(other: HeaderWidget) {
    return other.container === this.container;
  }
  toDOM() {
    return this.container;
  }
  ignoreEvent() {
    return true;
  }
  destroy() {
    // The container belongs to the note's tab and is used again.
  }
  get estimatedHeight() {
    return this.container.offsetHeight || 80;
  }
}

/** The note's foot (the notes that link here, mention it, are like it) sits after the last line, inside the page. */
class FootWidget extends HeaderWidget {
  get estimatedHeight() {
    return this.container.offsetHeight || 48;
  }
}

function footField(host: EditorHost) {
  const at = (len: number) => {
    const el = host.foot?.();
    return el ? Decoration.set([Decoration.widget({ widget: new FootWidget(el), block: true, side: 1 }).range(len)]) : Decoration.none;
  };
  return StateField.define<DecorationSet>({
    create: (state) => at(state.doc.length),
    update: (value, tr) => (tr.docChanged ? at(tr.state.doc.length) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}

function headerField(container: HTMLElement) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.set([Decoration.widget({ widget: new HeaderWidget(container), block: true, side: -1 }).range(0)]),
    update: (value, tr) => (tr.docChanged ? Decoration.set([Decoration.widget({ widget: new HeaderWidget(container), block: true, side: -1 }).range(0)]) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}

/** [[ suggests notes (and other files), [[Note# its headings, [[# this note's headings, [[Note#^ its blocks. */
function linkCompletions(host: EditorHost) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const before = context.matchBefore(/!?\[\[[^[\]\n|]*$/);
    if (!before) return null;
    const open = before.text.indexOf('[[') + 2;
    const typed = before.text.slice(open);
    const from = before.from + open;
    const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]';
    const finish = (insert: string) => (view: EditorView, _c: Completion, f: number, to: number) => {
      const text = closed ? insert : `${insert}]]`;
      view.dispatch({ changes: { from: f, to, insert: text }, selection: { anchor: f + text.length + (closed ? 2 : 0) }, userEvent: 'input.complete' });
    };
    const hash = typed.indexOf('#');
    if (hash >= 0) {
      const target = typed.slice(0, hash);
      // A caret after the hash asks for block ids (5 Nov 2026, the audit: headings only, never blocks). Another
      // note's blocks read through its open document, so an id typed but not yet saved still completes.
      if (typed[hash + 1] === '^') {
        const query = typed.slice(hash + 2).toLowerCase();
        const path = target ? resolveNote(target, host.path) : host.path;
        let text = '';
        if (!target || path === host.path) text = context.state.doc.toString();
        else if (path) {
          try {
            text = await docs.acquire(path);
          } catch {
            text = '';
          } finally {
            docs.release(path);
          }
        }
        const lines = text.split(/\r?\n/);
        return {
          from: from + hash + 2,
          options: blockPlaces(text)
            .filter((b) => !query || b.id.toLowerCase().includes(query))
            .slice(0, 80)
            .map((b) => {
              const first = withoutBlockId(lines[b.from] ?? '').trim();
              // Only the id: the typed `Target#^` before `from` stays (t136, 9 Nov 2026: writing the whole
              // `Target#^id` again made `[[A#A#^x]]`).
              return { label: b.id, detail: first.slice(0, 60) || undefined, type: 'nv-block', apply: finish(b.id) };
            }),
          filter: false,
        };
      }
      const query = typed.slice(hash + 1).toLowerCase();
      const path = target ? resolveNote(target, host.path) : host.path;
      const headings = target ? (path ? getState().byPath.get(path)?.headings ?? [] : []) : [...context.state.doc.toString().matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1]);
      return {
        from: from + hash + 1,
        // Only the heading: the typed `Target#` before `from` stays (t136, 9 Nov 2026: writing the whole
        // `Target#heading` again made `[[Harbourline Cart Fix#Harbourline Cart Fix#Summary]]`).
        options: headings.filter((h) => !query || h.toLowerCase().includes(query)).slice(0, 80).map((h) => ({ label: h, type: 'nv-heading', apply: finish(h) })),
        filter: false,
      };
    }
    const query = typed.toLowerCase();
    const { notes, files } = getState();
    // Ranked as search ranks notes (lib/rankedNotes.ts; 21 Oct 2026, gap G25): the best fit first, then notes changed
    // lately, linked to most, or near this one.
    const noteOptions: Completion[] = rankNotes(typed, notes, host.path, 120).map(({ note: n, match: hit }) => {
      const insert = linkTarget(n.path, host.path);
      return {
        label: hit,
        detail: hit !== n.title ? `→ ${n.title}` : n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '',
        type: 'nv-note',
        apply: finish(hit !== n.title ? `${insert}|${hit}` : insert),
      };
    });
    const fileOptions: Completion[] = files
      .filter((f) => f.kind !== 'note' && (!query || f.rel.toLowerCase().includes(query)))
      .slice(0, 60)
      .map((f) => {
        const name = f.rel.split('/').pop()!;
        return { label: name, detail: f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '', type: 'nv-file', apply: finish(linkTarget(f.rel, host.path)) };
      });
    const options = [...noteOptions, ...fileOptions];
    if (typed && !notes.some((n) => n.title.toLowerCase() === query)) {
      options.push({ label: typed, detail: 'New note', type: 'nv-new', apply: finish(typed) });
      // Or made now as a person, a meeting, an idea… without leaving this note (editor/typeLinks.ts). Made links
      // keep the made name (9.2 uplift F154): the path locates, the name shows, as their neighbours do.
      options.push(...typeLinkOptions(typed, (view, f, to, name, _type, made) => {
        const insert = linkTarget(made, host.path);
        return finish(insert === name ? insert : `${insert}|${name}`)(view, options[0], f, to);
      }));
    }
    return { from, options, filter: false };
  };
}

/** Where a table cell's words are in the Markdown (to put the cursor there when a drawn table is clicked). */
function cellOffset(source: string, row: number, col: number): number {
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < row && i < lines.length; i++) offset += lines[i].length + 1;
  const line = lines[row] ?? '';
  const want = line.trimStart().startsWith('|') ? col : col - 1;
  const skip = (j: number) => {
    while (line[j] === ' ') j++;
    return offset + j;
  };
  if (want < 0) return skip(0);
  let pipes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '|' || line[i - 1] === '\\') continue;
    if (pipes === want) return skip(i + 1);
    pipes++;
  }
  return offset;
}

function events(host: EditorHost) {
  const mod = (e: MouseEvent | KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const target = event.target as HTMLElement;
      const box = target.closest('.cm-nv-checkbox') as HTMLInputElement | null;
      if (box && view.state.facet(EditorState.readOnly)) { event.preventDefault(); return true; }
      if (box) {
        const pos = view.posAtDOM(box);
        const marker = view.state.sliceDoc(pos, pos + 3);
        if (/^\[.\]$/.test(marker)) {
          view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: marker[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' });
          event.preventDefault();
          return true;
        }
      }
      const live = target.closest('.cm-nv-wikilink') as HTMLElement | null;
      if (live && !target.closest('.cm-nv-wikilink-source')) {
        event.preventDefault();
        host.openLink(live.dataset.target ?? '', mod(event));
        return true;
      }
      const source = target.closest('.cm-nv-wikilink-source') as HTMLElement | null;
      if (source && mod(event)) {
        event.preventDefault();
        host.openLink(source.dataset.target ?? '', event.shiftKey);
        return true;
      }
      const embedLink = target.closest('.cm-nv-embed a.internal-link, .cm-nv-table a.internal-link') as HTMLElement | null;
      if (embedLink) {
        event.preventDefault();
        host.openLink(embedLink.dataset.href ?? '', mod(event));
        return true;
      }
      const link = target.closest('.cm-nv-link, .cm-nv-url') as HTMLElement | null;
      if (link) {
        const href = link.dataset.href ?? '';
        event.preventDefault();
        if (/^(https?:|mailto:)/i.test(href)) host.openUrl(href);
        else host.openLink(decodeURI(href).replace(/\.md$/i, ''), mod(event));
        return true;
      }
      const sourceUrl = target.closest('.cm-nv-url-source') as HTMLElement | null;
      if (sourceUrl && mod(event)) {
        event.preventDefault();
        host.openUrl(sourceUrl.dataset.href ?? '');
        return true;
      }
      const tag = target.closest('.cm-nv-tag, .cm-nv-tag-source') as HTMLElement | null;
      if (tag && (tag.classList.contains('cm-nv-tag') || mod(event))) {
        event.preventDefault();
        host.openTag(tag.dataset.tag ?? '');
        return true;
      }
      const cell = target.closest('.cm-nv-table td, .cm-nv-table th') as HTMLElement | null;
      if (cell) {
        const table = cell.closest('.cm-nv-table') as HTMLElement;
        const line = view.state.doc.lineAt(view.posAtDOM(table));
        let last = line.number;
        while (last < view.state.doc.lines && /^\s*\|/.test(view.state.doc.line(last + 1).text)) last++;
        const sourceText = view.state.sliceDoc(line.from, view.state.doc.line(last).to);
        const at = line.from + cellOffset(sourceText, Number(cell.dataset.row), Number(cell.dataset.col));
        event.preventDefault();
        view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true });
        view.focus();
        return true;
      }
      // A press inside the selected words holds them for a drag (editor/dragText.ts).
      if (holdSelectionForDrag(event, view)) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    mouseover(event) {
      const target = event.target as HTMLElement;
      const link = target.closest('.cm-nv-wikilink, .cm-nv-wikilink-source') as HTMLElement | null;
      if (link && (mod(event) || link.classList.contains('cm-nv-wikilink'))) host.hover(link.dataset.target ?? '', link, mod(event));
      return false;
    },
    paste(event, view) {
      if (view.state.facet(EditorState.readOnly)) return false;
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        // The place pasted is the place the cursor was (fnv3 F22), not wherever it wandered while saving.
        const at = { from: view.state.selection.main.from, to: view.state.selection.main.to };
        void (async () => {
          const links: string[] = [];
          for (const file of files) {
            const link = await host.saveFile(file);
            if (link) links.push(link);
          }
          if (!links.length) return;
          const insert = links.join('\n');
          // The cursor lands after the link (t136, 9 Nov 2026: mapping left it before the link, so Enter
          // split above it and typing went in front) — unless the person moved on while it saved, whose
          // cursor is left where their typing is.
          const sel = view.state.selection.main;
          const stick = sel.from === at.from && sel.to === Math.min(at.to, view.state.doc.length);
          view.dispatch({ changes: { from: at.from, to: Math.min(at.to, view.state.doc.length), insert }, ...(stick ? { selection: { anchor: at.from + insert.length } } : {}) });
        })();
        return true;
      }
      // Rich words copied from a page keep their shape as Markdown (fnv3 F22), never flattened or raw.
      const html = event.clipboardData?.getData('text/html') ?? '';
      if (html && /<(?:h[1-6]|ul|ol|li|table|tr|a|b|strong|i|em)\b/i.test(html)) {
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(htmlToMarkdown(html)));
        return true;
      }
      // A web address pasted over words makes them a link.
      const text = event.clipboardData?.getData('text/plain') ?? '';
      const sel = view.state.selection.main;
      if (/^https?:\/\/\S+$/.test(text.trim()) && !sel.empty && !view.state.sliceDoc(sel.from, sel.to).includes('\n')) {
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(`[${view.state.sliceDoc(sel.from, sel.to)}](${text.trim()})`));
        return true;
      }
      return false;
    },
    drop(event, view) {
      if (view.state.facet(EditorState.readOnly)) return false;
      const dt = event.dataTransfer;
      // A tab being moved (to a pane's edge or another pane) is the workspace's, not a link to put here.
      if (!dt || dt.types.includes('application/x-nv-tab')) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      const internal = dt.getData('application/x-nv-paths');
      if (internal) {
        event.preventDefault();
        const paths = internal.split('\n').filter(Boolean);
        // An asset dragged from the Assets page brings its alt text (written as the embed's words).
        const alt = paths.length === 1 ? dt.getData('application/x-nv-alt').trim() : '';
        const links = paths.map((p) => writeLink(p, host.path, { embed: shownInPlace(p), ...(alt ? { alias: alt } : {}) }));
        view.dispatch({ changes: { from: pos, insert: links.join('\n') }, selection: { anchor: pos + links.join('\n').length } });
        view.focus();
        return true;
      }
      const files = [...dt.files];
      if (files.length) {
        event.preventDefault();
        const paths = files.map((f) => window.nv.files.pathOf(f)).filter(Boolean);
        void (async () => {
          const links = paths.length ? await host.importFiles(paths) : await Promise.all(files.map((f) => host.saveFile(f))).then((l) => l.filter((x): x is string => !!x));
          if (!links.length) return;
          const insert = links.join('\n');
          // As a paste above: after the link when the cursor never left the drop, else where it went.
          const sel = view.state.selection.main;
          const stick = sel.from === pos && sel.to === pos;
          view.dispatch({ changes: { from: pos, insert }, ...(stick ? { selection: { anchor: pos + insert.length } } : {}) });
        })();
        return true;
      }
      return false;
    },
  });
}

export interface Compartments {
  mode: Compartment;
  gutter: Compartment;
  pairs: Compartment;
  spell: Compartment;
  fold: Compartment;
  editable: Compartment;
  indent: Compartment;
  /** Undo history, compartmented so a wholesale replacement from disk can reset it (fnv3 F26). */
  hist: Compartment;
}

export function newCompartments(): Compartments {
  return { mode: new Compartment(), gutter: new Compartment(), pairs: new Compartment(), spell: new Compartment(), fold: new Compartment(), editable: new Compartment(), indent: new Compartment(), hist: new Compartment() };
}

/** Tab indents with a tab or spaces, this wide (Settings › Editor). */
export const indentExtension = (p: Pick<Prefs, 'indentWithTabs' | 'tabSize'>) => [indentUnit.of(p.indentWithTabs ? '\t' : ' '.repeat(p.tabSize)), EditorState.tabSize.of(p.tabSize)];

// Live Preview hides the properties' YAML (unless shown as text): a suggested change to them is drawn as a block instead.
export const modeExtension = (mode: 'live' | 'source', ctx: PreviewContext) => (mode === 'live' ? [livePreview(ctx), propertiesHidden.of(!ctx.propertiesAsText()), reminderPills(), taskChipPills()] : sourceDecorations(ctx));
export const gutterExtension = (on: boolean) => (on ? lineNumbers() : []);
export const pairsExtension = (on: boolean) => (on ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []);
export const spellExtension = (on: boolean) => EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'sentences' });
export const foldExtension = (on: boolean) =>
  on
    ? foldGutter({
        markerDOM: (open) => {
          const el = document.createElement('span');
          el.className = `cm-nv-fold${open ? ' is-open' : ''}`;
          el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
          return el;
        },
      })
    : [];
export const editableExtension = (on: boolean) => [EditorView.editable.of(on), EditorState.readOnly.of(!on)];

export function buildExtensions(host: EditorHost, header: HTMLElement, c: Compartments, mode: 'live' | 'source', prefs: Prefs, canEdit: boolean): Extension[] {
  const ctx = previewContext(host);
  return [
    c.hist.of(history()),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    EditorView.lineWrapping,
    c.indent.of(indentExtension(prefs)),
    EditorState.allowMultipleSelections.of(true),
    yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages, extensions: ironleafMarkdown, addKeymap: false }) }),
    syntaxHighlighting(highlight),
    highlightSelectionMatches(),
    // The installed editor's own polish (5 Nov 2026, the audit): matching brackets light, Enter keeps the indent,
    // the line being worked on carries a wash.
    bracketMatching(),
    indentOnInput(),
    highlightActiveLine(),
    search({ top: true }),
    autocompletion({ override: [linkCompletions(host), mentionCompletions(() => host.path), calloutCompletions, slashCompletions({ dateFormat: host.dateFormat, timeFormat: host.timeFormat, insertTemplate: host.insertTemplate, linkToNote: host.linkToNote })], icons: false, closeOnBlur: true, maxRenderedOptions: 80 }),
    keymap.of([
      // Tab takes the highlighted suggestion first (t136, 9 Nov 2026: it indented instead, leaving the suggestions
      // open), then moves in tables, then indents the list item itself — a plain indent only when none applies.
      { key: 'Tab', run: (v) => acceptCompletion(v) || tableTab(v, false) || indentListItem(v, false) || indentMore(v), shift: (v) => tableTab(v, true) || indentListItem(v, true) || indentLess(v) },
      // Redo answers Ctrl+Shift+Z on every system (t136, 9 Nov 2026: CodeMirror binds it on macOS and Linux only —
      // on Windows, where the app ships, it did nothing).
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      ...completionKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...historyKeymap,
      // Enter on an empty bullet leaves the list (t136, 9 Nov 2026: CodeMirror's own Enter kept the marker and
      // opened a blank line above, so the next words landed on `- `). Its list behaviour, configured to remove the
      // marker instead of spacing the list out; suggestions and Find still answer Enter first, plain lines fall to
      // the default below, and Backspace takes empty markup off (markdown() would add both itself at high priority).
      { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
      { key: 'Backspace', run: deleteMarkupBackward },
      ...defaultKeymap,
    ]),
    c.mode.of(modeExtension(mode, ctx)),
    c.gutter.of(gutterExtension(prefs.lineNumbers)),
    c.pairs.of(pairsExtension(prefs.autoPair)),
    c.spell.of(spellExtension(prefs.spellcheck)),
    c.fold.of(foldExtension(prefs.foldHeadings)),
    c.editable.of(editableExtension(canEdit)),
    headerField(header),
    // A cited passage lit for a moment (editor/flash.ts).
    flashField,
    revealField,
    footField(host),
    placeholder('Start writing…  Type [[ to link a note, / for more.'),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) host.onChange(u.state.doc.toString());
    }),
    events(host),
    formatBar({ wikilinks: host.wikilinks, askAbout: askAboutFor(host.path), selectionAction: selectionActionFor(host.path) }),
    // The assistant's suggested changes waiting in this note (state/suggestions.ts).
    suggestionsExtension(host.path),
    theme,
  ];
}

/**
 * The formatting bar's Ask about this: the chat opens on the right, about this note, with the selected words quoted in
 * its message box for the person to finish their question (nothing is sent until they press Send). A private note's
 * words never go to the assistant (src/main/private-notes.ts), so it has no such button.
 */
function askAboutFor(path: string): ((words: string) => void) | undefined {
  if (isPrivatePath(path)) return undefined;
  return (words) => {
    const title = path.split('/').pop()!.replace(/\.md$/i, '');
    const quoted = words.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');
    void import('../state/chat').then((m) => m.draftInChat(`About this in “${title}”:\n\n${quoted}\n\n`, path));
  };
}

/**
 * What selecting words offers besides Ask (8.0 section E): the Ask choices draft their words in the chat, never
 * sent unseen. A private note's words go nowhere, so it has none of these.
 */
function selectionActionFor(path: string): ((action: string, words: string) => void) | undefined {
  if (isPrivatePath(path)) return undefined;
  return (action, words) => {
    const choice = SELECTION_ACTIONS.find((a) => a.id === action);
    if (!choice || !('ask' in choice)) return;
    const title = path.split('/').pop()!.replace(/\.md$/i, '');
    const quoted = words.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');
    void import('../state/chat').then((m) => m.draftInChat(`${choice.ask}\n\nFrom “${title}”:\n\n${quoted}\n\n`, path));
  };
}

export function previewContext(host: EditorHost): PreviewContext {
  return {
    path: host.path,
    propertiesAsText: () => prefs().propertiesShow === 'source',
    isResolved: (target) => !!resolveNote(target, host.path) || getState().files.some((f) => f.kind !== 'note' && (f.rel === target || f.rel.split('/').pop() === target)),
    version: () => host.version(),
    isDoc: () => isDocPath(host.path),
    docHead: () => host.docHead?.() ?? null,
    // Chipped by the one shared type reading (9.2 uplift F28): the same notes chip in every renderer.
    mentionKind: (target) => {
      const resolved = resolveNote(target, host.path);
      if (!resolved || !getState().byPath.get(resolved)) return null;
      return mentionKindFor(resolved);
    },
  };
}
