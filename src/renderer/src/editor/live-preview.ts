// Live Preview: the note looks as it will read (headings sized, emphasis applied, links as links, tick-boxes, pictures,
// tables, maths, diagrams, callouts) while it stays plain Markdown underneath. The Markdown shows again where the cursor
// is: for words, the element under the cursor; for blocks (headings, quotes, tables, code), the lines it is on.

import { codeFolding, foldedRanges, foldEffect, foldService, syntaxTree, unfoldEffect } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { frontMatterRange, propsReadable } from '../../../shared/frontmatter';
import { readChange } from '../../../shared/doc-file';
import { parseWikilink } from '../../../shared/markdown';
import { columnDividerLabel, columnSeparators, isColumnMarker, parseColumns } from '../../../shared/page-columns';
import { firstRepeatLine } from '../../../shared/notes-list';
import { calloutBlocks, calloutKind } from '../lib/callouts';
import { fileUrl, resolveFile } from '../lib/resolve';
import { BLOCKED_REMOTE_FILE, isRemoteFileSource } from '../../../shared/remote-file';
import { revealField, revealShow } from './flash';
import { embedFillsParagraph } from './markdown-ext';
import { BulletWidget, CalloutFoldWidget, CalloutTitleWidget, ChartWidget, CheckboxWidget, ColumnDividerWidget, EmbedWidget, HiddenBlockWidget, ImageWidget, MathWidget, MentionWidget, MermaidWidget, RuleWidget, TableWidget, TextWidget } from './widgets';

/** What Live Preview needs from the note's tab. */
export interface PreviewContext {
  path: string;
  /** Settings › Editor › Properties in notes: as text keeps their YAML in Live Preview. */
  propertiesAsText(): boolean;
  isResolved(target: string): boolean;
  /** Bumped when notes change (embedded notes are drawn again). */
  version(): number;
  /** Whether the note is a doc (src/shared/doc-file.ts): its page reads as a doc. */
  isDoc?(): boolean;
  /** A link's kind when it names a person, project or meeting, drawn as a chip (8.0 section E). */
  mentionKind?(target: string): 'person' | 'project' | 'meeting' | null;
  /** A doc's head (its about line and contents), drawn by the window, placed under its title. */
  docHead?(): HTMLElement | null;
}

const setFocus = StateEffect.define<boolean>();
export const refreshPreview = StateEffect.define<null>();

/**
 * Whether a line's marks (##, **, [[ ]]) show where the caret is: only once the person is working in the note — the
 * editor has the keys AND they put the caret somewhere or typed. A note just opened (the caret placed at its start by
 * the app) reads clean, never "## What we talked about".
 */
export const focusField = StateField.define<{ focused: boolean; working: boolean }>({
  create: () => ({ focused: false, working: false }),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) if (e.is(setFocus)) next = e.value ? { ...next, focused: true } : { focused: false, working: false };
    if (!next.working && (tr.docChanged || tr.isUserEvent('select') || tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move'))) next = { ...next, working: true };
    return next;
  },
});
const marksShow = (state: EditorState) => {
  const f = state.field(focusField, false);
  return !!f && f.focused && f.working;
};

const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing));

const hide = Decoration.replace({});

/** Whether a lit reveal touches a range: a reveal unwraps what it points at, so the lit line shows even where the
 *  person has not started working (p14: a table row's flash landed on lines a widget hid). */
function revealTouches(state: EditorState, from: number, to: number): boolean {
  const r = state.field(revealField, false);
  if (!r) return false;
  const doc = state.doc;
  const first = Math.min(Math.max(r.from + 1, 1), doc.lines);
  const last = Math.min(Math.max(r.to + 1, first), doc.lines);
  return doc.line(first).from <= to && doc.line(last).to >= from;
}

/** Whether the selection touches a range (the editor focused). */
function touches(state: EditorState, from: number, to: number): boolean {
  if (revealTouches(state, from, to)) return true;
  if (!marksShow(state)) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** Whether the selection is on any of the lines a range spans. */
function onLines(state: EditorState, from: number, to: number): boolean {
  if (revealTouches(state, from, to)) return true;
  if (!marksShow(state)) return false;
  const a = state.doc.lineAt(from).number;
  const b = state.doc.lineAt(Math.max(from, to)).number;
  return state.selection.ranges.some((r) => state.doc.lineAt(r.from).number <= b && state.doc.lineAt(r.to).number >= a);
}

const HEADING = /^ATXHeading(\d)$/;
const SETEXT = /^SetextHeading(\d)$/;
const CALLOUT_LINE = /^(\s*>\s?)\[!([\w-]+)\]([+-]?)(\s*)(.*)$/;

/** Whether the lines after a callout's first line are folded away (from the end of its first line). */
function calloutFolded(state: EditorState, lineEnd: number): boolean {
  let folded = false;
  foldedRanges(state).between(lineEnd, lineEnd, (from) => {
    if (from === lineEnd) folded = true;
  });
  return folded;
}

function lineDeco(cls: string) {
  return Decoration.line({ class: cls });
}

/** Inline decorations for what is on screen. */
function buildInline(view: EditorView, ctx: PreviewContext): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const doc = state.doc;
  const seenLines = new Set<number>();
  const seenQuotes = new Set<number>();

  // Replacing across a line break is only allowed for blocks (blockField), so inline replacements stay on one line.
  const sameLine = (from: number, to: number) => doc.lineAt(from).number === doc.lineAt(to).number;
  const hideRange = (from: number, to: number) => {
    if (to > from && sameLine(from, to)) out.push(hide.range(from, to));
  };
  const replaceWith = (deco: Decoration, from: number, to: number) => {
    if (to > from && sameLine(from, to)) out.push(deco.range(from, to));
  };
  // Marks through here or not at all: a half-typed link ([[a|]], [[#]], [[N#^]]) leaves empty ranges, and an empty
  // mark crashes the field (5 Nov 2026, the audit: "Mark decorations may not be empty", live preview dead after).
  const markRange = (deco: Decoration, from: number, to: number) => {
    if (to > from && sameLine(from, to)) out.push(deco.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node: SyntaxNodeRef) => {
        const name = node.name;
        let m: RegExpExecArray | null;
        if ((m = HEADING.exec(name))) {
          const line = doc.lineAt(node.from);
          if (!seenLines.has(line.from)) {
            seenLines.add(line.from);
            out.push(lineDeco(`cm-nv-heading cm-nv-h${m[1]}`).range(line.from));
          }
          if (!onLines(state, node.from, node.to)) {
            const marks = node.node.getChildren('HeaderMark');
            for (const mark of marks) {
              const after = mark.to < line.to && doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to;
              if (mark.from === line.from || mark.from === node.from) hideRange(mark.from, after);
              else hideRange(Math.max(line.from, mark.from - (doc.sliceString(mark.from - 1, mark.from) === ' ' ? 1 : 0)), mark.to);
            }
          }
          return;
        }
        if ((m = SETEXT.exec(name))) {
          const first = doc.lineAt(node.from);
          out.push(lineDeco(`cm-nv-heading cm-nv-h${m[1]}`).range(first.from));
          const last = doc.lineAt(node.to);
          if (last.number !== first.number && !onLines(state, node.from, node.to)) {
            out.push(lineDeco('cm-nv-setext-underline').range(last.from));
            hideRange(last.from, last.to);
          }
          return;
        }
        switch (name) {
          case 'ColourHighlight': {
            // <mark class="nv-green">…</mark> (lib/highlights.ts): the words in their colour, the tags out of sight.
            const marks = node.node.getChildren('ColourHighlightMark');
            const colour = marks[0] ? /nv-(\w+)/.exec(doc.sliceString(marks[0].from, marks[0].to))?.[1] ?? 'yellow' : 'yellow';
            if (marks.length === 2 && marks[1].from > marks[0].to) out.push(Decoration.mark({ class: `cm-nv-highlight cm-nv-highlight-${colour}` }).range(marks[0].to, marks[1].from));
            if (!touches(state, node.from, node.to)) for (const mark of marks) hideRange(mark.from, mark.to);
            return;
          }
          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough':
          case 'Highlight': {
            if (name === 'Highlight') out.push(Decoration.mark({ class: 'cm-nv-highlight' }).range(node.from, node.to));
            if (!touches(state, node.from, node.to)) {
              const markName = name === 'Strikethrough' ? 'StrikethroughMark' : name === 'Highlight' ? 'HighlightMark' : 'EmphasisMark';
              for (const mark of node.node.getChildren(markName)) hideRange(mark.from, mark.to);
            }
            return;
          }
          case 'InlineCode': {
            const marks = node.node.getChildren('CodeMark');
            if (marks.length === 2) markRange(Decoration.mark({ class: 'cm-nv-inline-code' }), marks[0].to, marks[1].from);
            if (!touches(state, node.from, node.to)) for (const mark of marks) hideRange(mark.from, mark.to);
            return false;
          }
          case 'InlineMath': {
            if (!touches(state, node.from, node.to)) replaceWith(Decoration.replace({ widget: new MathWidget(doc.sliceString(node.from + 1, node.to - 1), false) }), node.from, node.to);
            else out.push(Decoration.mark({ class: 'cm-nv-math-source' }).range(node.from, node.to));
            return false;
          }
          case 'Link': {
            const marks = node.node.getChildren('LinkMark');
            const url = node.node.getChild('URL');
            if (marks.length >= 2) {
              const textFrom = marks[0].to;
              const textTo = marks[1].from;
              const href = url ? doc.sliceString(url.from, url.to) : '';
              if (textTo > textFrom) out.push(Decoration.mark({ class: 'cm-nv-link', attributes: { 'data-href': href } }).range(textFrom, textTo));
              if (!touches(state, node.from, node.to) && url) {
                hideRange(marks[0].from, marks[0].to);
                hideRange(marks[1].from, node.to);
              } else if (url) markRange(Decoration.mark({ class: 'cm-nv-url-source' }), marks[1].from, node.to);
            }
            return false;
          }
          case 'Image': {
            if (touches(state, node.from, node.to)) return false;
            const url = node.node.getChild('URL');
            const marks = node.node.getChildren('LinkMark');
            if (!url || marks.length < 2) return false;
            let src = doc.sliceString(url.from, url.to);
            const altText = doc.sliceString(marks[0].to, marks[1].from).replace(/\|\d+(x\d+)?$/, '');
            // A picture on another computer is never asked for (src/shared/remote-file.ts): a placeholder instead.
            if (isRemoteFileSource(src)) {
              replaceWith(Decoration.replace({ widget: new TextWidget(`${BLOCKED_REMOTE_FILE}${altText ? `: ${altText}` : ''}`, 'nv-blocked-file') }), node.from, node.to);
              return false;
            }
            if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) {
              let decoded = src;
              try {
                decoded = decodeURI(src);
              } catch {
                // Kept as written.
              }
              const file = resolveFile(decoded, ctx.path);
              if (file) src = fileUrl(file);
            }
            const altRaw = doc.sliceString(marks[0].to, marks[1].from);
            const size = /\|(\d+)(?:x\d+)?$/.exec(altRaw);
            replaceWith(Decoration.replace({ widget: new ImageWidget(src, altRaw.replace(/\|\d+(x\d+)?$/, ''), size ? size[1] : null) }), node.from, node.to);
            return false;
          }
          case 'Wikilink': {
            const inner = doc.sliceString(node.from + 2, node.to - 2);
            const link = parseWikilink(inner);
            const fullTarget = link.target + (link.heading ? `#${link.heading}` : '');
            const resolved = !link.target || ctx.isResolved(link.target);
            const cls = `cm-nv-wikilink${resolved ? '' : ' is-unresolved'}`;
            const attrs = { 'data-target': fullTarget };
            if (touches(state, node.from, node.to)) {
              out.push(Decoration.mark({ class: 'cm-nv-wikilink-source', attributes: attrs }).range(node.from, node.to));
              return false;
            }
            // A person, project or meeting is a chip (8.0 section E): its initial or dot, then its name.
            const mention = link.target ? ctx.mentionKind?.(link.target) : null;
            if (mention) {
              const shown = link.alias ?? (link.target.split('/').pop() ?? link.target);
              out.push(Decoration.replace({ widget: new MentionWidget(mention, shown, fullTarget) }).range(node.from, node.to));
              return false;
            }
            const innerFrom = node.from + 2;
            const pipe = inner.indexOf('|');
            hideRange(node.from, innerFrom);
            const linkMark = Decoration.mark({ class: cls, attributes: attrs });
            if (pipe >= 0) {
              hideRange(innerFrom, innerFrom + pipe + 1);
              markRange(linkMark, innerFrom + pipe + 1, node.to - 2);
            } else {
              const hash = inner.indexOf('#');
              if (hash > 0) {
                markRange(linkMark, innerFrom, innerFrom + hash);
                // A block reference's caret ([[Note#^id]]) is the link's mark, not its words (V12, 28 Oct 2026).
                const caret = inner[hash + 1] === '^' ? 1 : 0;
                replaceWith(Decoration.replace({ widget: new TextWidget(' › ', `${cls} cm-nv-wikilink-sep`) }), innerFrom + hash, innerFrom + hash + 1 + caret);
                markRange(linkMark, innerFrom + hash + 1 + caret, node.to - 2);
              } else if (hash === 0) {
                hideRange(innerFrom, innerFrom + 1);
                markRange(linkMark, innerFrom + 1, node.to - 2);
              } else {
                markRange(linkMark, innerFrom, node.to - 2);
              }
            }
            hideRange(node.to - 2, node.to);
            return false;
          }
          case 'Embed': {
            const line = doc.lineAt(node.from);
            const text = doc.sliceString(node.from, node.to);
            const parent = node.node.parent;
            // Alone on its line and the whole paragraph: drawn as a block (see blockField). Alone on its line inside
            // a longer paragraph (a clipped article's pictures): drawn here, inline, not left as raw text.
            if (line.text.trim() === text && parent && embedFillsParagraph(parent.name, doc.sliceString(parent.from, parent.to), text)) return false;
            if (touches(state, node.from, node.to)) {
              out.push(Decoration.mark({ class: 'cm-nv-wikilink-source' }).range(node.from, node.to));
              return false;
            }
            const link = parseWikilink(doc.sliceString(node.from + 3, node.to - 2));
            out.push(Decoration.replace({ widget: new EmbedWidget(link.target, link.heading ?? '', link.alias ?? '', ctx.path, false, ctx.version()) }).range(node.from, node.to));
            return false;
          }
          case 'NvComment':
            out.push(Decoration.mark({ class: 'cm-nv-comment' }).range(node.from, node.to));
            return false;
          case 'NvTag':
            out.push(Decoration.mark({ class: 'cm-nv-tag', attributes: { 'data-tag': doc.sliceString(node.from + 1, node.to) } }).range(node.from, node.to));
            return false;
          case 'FootnoteRef':
            out.push(Decoration.mark({ class: 'cm-nv-footref' }).range(node.from, node.to));
            return false;
          case 'URL': {
            const parent = node.node.parent?.name;
            if (parent === 'Link' || parent === 'Image') return false;
            out.push(Decoration.mark({ class: 'cm-nv-url', attributes: { 'data-href': doc.sliceString(node.from, node.to) } }).range(node.from, node.to));
            return false;
          }
          case 'Autolink': {
            const marks = node.node.getChildren('LinkMark');
            if (!touches(state, node.from, node.to)) for (const mark of marks) hideRange(mark.from, mark.to);
            return;
          }
          case 'Escape':
            if (!touches(state, node.from, node.to)) hideRange(node.from, node.from + 1);
            return false;
          case 'Comment':
            // An HTML comment in a line of text.
            if (!touches(state, node.from, node.to)) hideRange(node.from, node.to);
            return false;
          case 'TaskMarker': {
            const text = doc.sliceString(node.from, node.to);
            const done = text[1] !== ' ';
            const line = doc.lineAt(node.from);
            if (done) out.push(lineDeco('cm-nv-task-done').range(line.from));
            const within = marksShow(state) && state.selection.ranges.some((r) => r.from > node.from && r.to < node.to);
            if (!within) out.push(Decoration.replace({ widget: new CheckboxWidget(done) }).range(node.from, node.to));
            return false;
          }
          case 'ListMark': {
            const line = doc.lineAt(node.from);
            const text = doc.sliceString(node.from, node.to);
            const isTask = /^\s*\[.\]/.test(doc.sliceString(node.to + 1, Math.min(line.to, node.to + 6)));
            // A list line (a task, a decision, an item) may run wider than the prose's measure on a wide window (layout
            // round 3: long task and decision lines wrapped to three lines beside an empty screen).
            out.push(lineDeco(isTask ? 'cm-nv-list-line cm-nv-task-line' : 'cm-nv-list-line').range(line.from));
            if (onLines(state, node.from, node.to)) return false;
            if (/^[-*+]$/.test(text)) {
              const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
              if (isTask) hideRange(node.from, end);
              else out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            } else {
              out.push(Decoration.mark({ class: 'cm-nv-list-number' }).range(node.from, node.to));
            }
            return false;
          }
          case 'Blockquote': {
            // Only the outermost quote draws the lines (nested quotes share them), and only once: a fold splits what is
            // on screen into parts, and a quote across them would otherwise be drawn (and get its arrow) twice.
            if (node.node.parent?.name === 'Blockquote' || seenQuotes.has(node.from)) return;
            seenQuotes.add(node.from);
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            const callout = CALLOUT_LINE.exec(first.text);
            const kind = callout ? calloutKind(callout[2]) : null;
            // A folded callout ("[!tip]-", or folded by its arrow) shows only its first line, as a box of its own.
            const folded = !!kind && !!callout?.[3] && last.number > first.number && calloutFolded(state, first.to);
            for (let n = first.number; n <= last.number; n++) {
              const line = doc.line(n);
              const cls = kind ? `cm-nv-callout cm-nv-callout-${kind.type}${n === first.number ? ' cm-nv-callout-first' : ''}${n === last.number || (folded && n === first.number) ? ' cm-nv-callout-last' : ''}` : `cm-nv-quote${n === first.number ? ' cm-nv-quote-first' : ''}${n === last.number ? ' cm-nv-quote-last' : ''}`;
              out.push(lineDeco(cls).range(line.from));
            }
            if (kind && callout && !onLines(state, first.from, first.to)) {
              const markFrom = first.from + callout[1].length;
              const markTo = markFrom + 3 + callout[2].length + callout[3].length + callout[4].length;
              out.push(Decoration.replace({ widget: new CalloutTitleWidget(kind.icon, callout[5].trim() ? null : kind.label) }).range(markFrom, markTo));
              markRange(Decoration.mark({ class: 'cm-nv-callout-title' }), markTo, first.to);
            }
            // Its arrow: folds and unfolds it on screen; the note's words are not changed.
            if (kind && callout?.[3] && last.number > first.number) out.push(Decoration.widget({ widget: new CalloutFoldWidget(folded), side: -1 }).range(first.to));
            return;
          }
          case 'QuoteMark': {
            if (onLines(state, node.from, node.to)) return false;
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            hideRange(node.from, end);
            return false;
          }
          case 'HorizontalRule': {
            const line = doc.lineAt(node.from);
            out.push(lineDeco('cm-nv-hr-line').range(line.from));
            if (!onLines(state, node.from, node.to)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            return false;
          }
          case 'FencedCode': {
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            const info = node.node.getChild('CodeInfo');
            const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : '';
            if ((lang === 'mermaid' || lang === 'chart') && !onLines(state, node.from, node.to)) return false;
            for (let n = first.number; n <= last.number; n++) {
              const line = doc.line(n);
              out.push(lineDeco(`cm-nv-codeblock${n === first.number ? ' cm-nv-codeblock-begin' : ''}${n === last.number ? ' cm-nv-codeblock-end' : ''}`).range(line.from));
            }
            if (!onLines(state, node.from, node.to)) {
              const marks = node.node.getChildren('CodeMark');
              if (marks[0]) out.push(Decoration.replace({ widget: new TextWidget(lang, 'cm-nv-code-lang') }).range(first.from, first.to));
              if (marks.length > 1 && last.number !== first.number) hideRange(last.from, last.to);
            }
            return false;
          }
          case 'BlockMath':
          case 'Table':
          case 'CommentBlock':
            return false;
          case 'NvCommentBlock': {
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            for (let n = first.number; n <= last.number; n++) out.push(lineDeco('cm-nv-comment-line').range(doc.line(n).from));
            return false;
          }
          default:
            return;
        }
      },
    });
    // Block ids (" ^id" at a line's end, or alone on a line; V12, 28 Oct 2026): hidden away from the cursor's lines, as
    // the reading view leaves them out; never inside code.
    for (let n = doc.lineAt(from).number, end = doc.lineAt(to).number; n <= end; n++) {
      const line = doc.line(n);
      if (!line.text.includes('^')) continue;
      const m = BLOCK_ID_AT_END.exec(line.text);
      if (!m || onLines(state, line.from, line.to)) continue;
      const at = line.from + (m.index ?? 0);
      if (/Code|Comment/.test(syntaxTree(state).resolveInner(at + m[0].length - 1, 1).name)) continue;
      hideRange(at, line.to);
    }
  }
  return Decoration.set(out, true);
}

const BLOCK_ID_AT_END = /(?:^|[ \t])\^[A-Za-z0-9][A-Za-z0-9-]{0,63}[ \t]*$/;

/** Blocks drawn whole (tables, maths, diagrams, embeds alone on a line) and blocks hidden (the properties). */
function buildBlocks(state: EditorState, ctx: PreviewContext): DecorationSet {
  const out: Range<Decoration>[] = [];
  const doc = state.doc;
  const head = doc.sliceString(0, Math.min(doc.length, 50000));
  const fm = frontMatterRange(head);
  // The properties are edited in the panel above the note (or in Source mode), so their YAML stays out of the way
  // wherever the cursor is.
  if (fm && fm.to > 0 && propsReadable(head) && !ctx.propertiesAsText()) {
    const end = doc.lineAt(Math.max(0, fm.to - 1)).to;
    out.push(Decoration.replace({ block: true, widget: new HiddenBlockWidget('properties') }).range(0, end));
  }
  // A note's first heading when it only repeats the page title (8.7 w2b round 3 for the daily note, round 4 for
  // any note): the page head already says it, so the line hides here without touching the file (Source mode still
  // shows it for editing).
  const title = ctx.path.split('/').pop()!.replace(/\.md$/i, '');
  const at = firstRepeatLine(doc.sliceString(0, Math.min(doc.length, 50000)), title);
  if (at !== null && at < doc.lines) {
    const line = doc.line(at + 1);
    const next = at + 1 < doc.lines ? doc.line(at + 2) : null;
    const to = next && !next.text.trim() ? next.to : line.to;
    if (!onLines(state, line.from, to)) out.push(Decoration.replace({ block: true, widget: new HiddenBlockWidget('repeat-title') }).range(line.from, to));
  }
  // Page columns' dividers (8.8 round 2): each marker of a finished block hidden behind its divider, the file
  // keeping its markers. An unfinished block's markers stay as quiet words while they are typed.
  const dividers = new Map<number, { label: string; actions: boolean; count: number }>();
  {
    // No column markers, no column work (fnv3 F25): the whole-note parse is skipped on ordinary notes.
    const text = doc.toString().includes('<!-- columns') ? doc.toString() : '';
    const lines = text ? text.split('\n') : [];
    for (const b of text ? parseColumns(text) : []) {
      dividers.set(b.start + 1, { label: columnDividerLabel(0, b.count), actions: true, count: b.count });
      columnSeparators(lines, b).forEach((s, i) => dividers.set(s + 1, { label: columnDividerLabel(i + 1, b.count), actions: false, count: b.count }));
      dividers.set(b.end + 1, { label: 'End of columns', actions: false, count: b.count });
    }
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;
      if (fm && node.to <= fm.to && name !== 'Document') return false;
      switch (name) {
        case 'Table': {
          // Tables inside quotes and lists stay as Markdown (their > and indents belong to the quote or list).
          if (node.node.parent?.name !== 'Document') return false;
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          if (!onLines(state, first.from, last.to)) out.push(Decoration.replace({ block: true, widget: new TableWidget(doc.sliceString(first.from, last.to), ctx.path) }).range(first.from, last.to));
          return false;
        }
        case 'BlockMath': {
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          if (onLines(state, first.from, last.to)) {
            for (let n = first.number; n <= last.number; n++) out.push(lineDeco('cm-nv-math-source-line').range(doc.line(n).from));
            return false;
          }
          const tex = doc.sliceString(node.from, node.to).trim().replace(/^\$\$/, '').replace(/\$\$$/, '');
          out.push(Decoration.replace({ block: true, widget: new MathWidget(tex, true) }).range(first.from, last.to));
          return false;
        }
        case 'FencedCode': {
          const info = node.node.getChild('CodeInfo');
          const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : '';
          if (lang !== 'mermaid' && lang !== 'chart') return false;
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          if (onLines(state, first.from, last.to)) return false;
          const lines = doc.sliceString(first.from, last.to).split('\n');
          const source = lines.slice(1, /^\s*(```|~~~)/.test(lines[lines.length - 1]) ? -1 : undefined).join('\n');
          out.push(Decoration.replace({ block: true, widget: lang === 'chart' ? new ChartWidget(source) : new MermaidWidget(source) }).range(first.from, last.to));
          return false;
        }
        case 'CommentBlock': {
          // HTML comments on their own lines (the former host app's markers among them): out of the way while
          // reading. Page columns' markers hide behind dividers (round 2), so the markers never show as text; an
          // unfinished block's markers stay as quiet words while they are typed.
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          if (first.number === last.number && isColumnMarker(doc.sliceString(first.from, last.to))) {
            const d = dividers.get(first.number);
            if (d) {
              out.push(Decoration.replace({ block: true, widget: new ColumnDividerWidget(d.label, d.actions, d.count) }).range(first.from, last.to));
              return false;
            }
            out.push(lineDeco('cm-nv-column-mark').range(first.from));
            return false;
          }
          if (!onLines(state, first.from, last.to)) out.push(Decoration.replace({ block: true, widget: new HiddenBlockWidget('comment') }).range(first.from, last.to));
          return false;
        }
        case 'Paragraph': {
          const line = doc.lineAt(node.from);
          const text = line.text.trim();
          const m = /^!\[\[([^[\]\n]+)\]\]$/.exec(text);
          if (m && doc.lineAt(node.to).number === line.number && !onLines(state, line.from, line.to)) {
            const link = parseWikilink(m[1]);
            out.push(Decoration.replace({ block: true, widget: new EmbedWidget(link.target, link.heading ?? '', link.alias ?? '', ctx.path, true, ctx.version()) }).range(line.from, line.to));
          }
          return false;
        }
        case 'Document':
        case 'Blockquote':
        case 'BulletList':
        case 'OrderedList':
        case 'ListItem':
          return;
        default:
          return name.startsWith('ATX') || name.startsWith('Setext') ? false : undefined;
      }
    },
  });
  return Decoration.set(out, true);
}

// A ## heading that might open the changelog (mirrors shared/doc-file.ts CHANGES_RE): a pre-filter only. Whether it
// is Changes is structural (dated change lines under it), decided below, never by these words alone.
const DOC_CHANGES = /^##[ \t]+(changes|change log|changelog|history|revision history)[ \t]*#*[ \t]*$/i;

/**
 * A doc reads as a doc (src/shared/doc-file.ts): its summary a little larger, and Changes a quiet dated list. Its
 * head (title, about line, contents) reads above the editor, with every other note's head (t239: the head widget
 * it used to place here never attached, so nothing showed). The words stay ordinary Markdown, edited as any note.
 */
function buildDoc(state: EditorState, ctx: PreviewContext): DecorationSet {
  if (!ctx.isDoc?.()) return Decoration.none;
  const out: Range<Decoration>[] = [];
  const doc = state.doc;
  const fm = frontMatterRange(doc.sliceString(0, Math.min(doc.length, 50000)));
  const startLine = fm && fm.to > 0 ? doc.lineAt(Math.min(doc.length, fm.to)).number + (doc.lineAt(Math.min(doc.length, fm.to)).from === fm.to ? 0 : 1) : 1;
  let n = Math.min(startLine, doc.lines);
  while (n < doc.lines && !doc.line(n).text.trim()) n++;
  const titled = /^#[ \t]+\S/.test(doc.line(n).text);
  // The Changes section, structurally (9.2 uplift F148): the first ## candidate whose body holds a dated change
  // line. A section merely headed "History" about family history reads as body, never a changelog.
  let changesHead = -1;
  {
    let fence = false;
    for (let i = titled ? n + 1 : n; i <= doc.lines && changesHead < 0; i++) {
      const text = doc.line(i).text;
      if (/^\s*(```|~~~)/.test(text)) {
        fence = !fence;
        continue;
      }
      if (fence || !DOC_CHANGES.test(text)) continue;
      let fenced = false;
      for (let j = i + 1; j <= doc.lines; j++) {
        const t = doc.line(j).text;
        if (/^\s*(```|~~~)/.test(t)) {
          fenced = !fenced;
          continue;
        }
        if (!fenced && /^##?[ \t]+\S/.test(t)) break;
        const c = readChange(t);
        if (c && c.date) {
          changesHead = i;
          break;
        }
      }
    }
  }
  let fence = false;
  let part: 'summary' | 'body' | 'changes' = 'summary';
  for (let i = titled ? n + 1 : n; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    if (!fence && /^##?[ \t]+\S/.test(text)) {
      if (i === changesHead) {
        part = 'changes';
        out.push(lineDeco('cm-nv-doc-changes-head').range(line.from));
        continue;
      }
      part = 'body';
      continue;
    }
    if (!text.trim()) continue;
    if (part === 'summary') out.push(lineDeco('cm-nv-doc-summary').range(line.from));
    else if (part === 'changes') out.push(lineDeco('cm-nv-doc-change').range(line.from));
  }
  return Decoration.set(out, true);
}

/** Live Preview for a note: the inline layer (what is on screen) and the block layer (the whole note). */
export function livePreview(ctx: PreviewContext): Extension {
  const inline = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildInline(view, ctx);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPreview) || e.is(setFocus) || e.is(revealShow) || e.is(foldEffect) || e.is(unfoldEffect)))) {
          this.decorations = buildInline(update.view, ctx);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  const blocks = StateField.define<DecorationSet>({
    create: (state) => buildBlocks(state, ctx),
    update(value, tr) {
      if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.effects.some((e) => e.is(setFocus) || e.is(revealShow) || e.is(refreshPreview))) return buildBlocks(tr.state, ctx);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const docLayer = StateField.define<DecorationSet>({
    create: (state) => buildDoc(state, ctx),
    update(value, tr) {
      if (tr.docChanged || tr.effects.some((e) => e.is(refreshPreview))) return buildDoc(tr.state, ctx);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [focusField, focusTracker, blocks, docLayer, inline, calloutFolding, EditorView.editorAttributes.of({ class: 'cm-nv-live' })];
}

/** The lines a callout can fold away: from the end of its first line to the end of its last (only "[!kind]-" or "+"). */
const calloutFoldRange = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const m = CALLOUT_LINE.exec(line.text);
  if (!m || !m[3]) return null;
  let last = line.number;
  while (last < state.doc.lines && /^\s{0,3}>/.test(state.doc.line(last + 1).text)) last++;
  return last > line.number ? { from: lineEnd, to: state.doc.line(last).to } : null;
});

/** Once per note: whether its "[!kind]-" callouts have been folded yet (so unfolding one sticks while it stays open). */
const foldedOnOpen = StateEffect.define<null>();
const foldedOnOpenField = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => value || tr.effects.some((e) => e.is(foldedOnOpen)),
});

/**
 * Callouts written "[!kind]-" open folded, showing just their title, as they do in Reading (19 Oct 2026, 5.0.0). Their
 * arrow folds and unfolds them on screen without changing the note; the cursor arriving inside one opens it.
 */
const calloutFolding: Extension = [
  codeFolding(),
  calloutFoldRange,
  foldedOnOpenField,
  ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        if (view.state.field(foldedOnOpenField, false)) return;
        // Not while the view is being built: CodeMirror takes no changes then.
        queueMicrotask(() => {
          if (!view.dom.isConnected || view.state.field(foldedOnOpenField, false)) return;
          const { doc, selection } = view.state;
          const effects: StateEffect<unknown>[] = [foldedOnOpen.of(null)];
          for (const block of calloutBlocks(doc.toString())) {
            if (block.fold !== '-' || block.last <= block.first || block.last >= doc.lines) continue;
            const from = doc.line(block.first + 1).to;
            const to = doc.line(block.last + 1).to;
            if (selection.ranges.some((r) => r.to > from && r.from <= to)) continue;
            effects.push(foldEffect.of({ from, to }));
          }
          view.dispatch({ effects });
        });
      }
    },
  ),
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const arrow = (event.target as HTMLElement).closest('.cm-nv-callout-fold');
      if (!arrow) return false;
      event.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(arrow));
      const range = view.state.facet(foldService).map((f) => f(view.state, line.from, line.to)).find(Boolean);
      if (!range) return true;
      view.dispatch({ effects: calloutFolded(view.state, line.to) ? unfoldEffect.of(range) : foldEffect.of(range) });
      return true;
    },
  }),
];

/** Source mode still shows links as links (found or not), tags and tick-box lines, but every character stays. */
export function sourceDecorations(ctx: PreviewContext): Extension {
  return [
    focusField,
    focusTracker,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = this.build(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPreview)))) this.decorations = this.build(update.view);
        }
        build(view: EditorView): DecorationSet {
          const out: Range<Decoration>[] = [];
          for (const { from, to } of view.visibleRanges) {
            syntaxTree(view.state).iterate({
              from,
              to,
              enter: (node) => {
                if (node.name === 'Wikilink' || node.name === 'Embed') {
                  const skip = node.name === 'Embed' ? 3 : 2;
                  const link = parseWikilink(view.state.doc.sliceString(node.from + skip, node.to - 2));
                  const resolved = !link.target || ctx.isResolved(link.target);
                  out.push(Decoration.mark({ class: `cm-nv-wikilink-source${resolved ? '' : ' is-unresolved'}`, attributes: { 'data-target': link.target + (link.heading ? `#${link.heading}` : '') } }).range(node.from, node.to));
                  return false;
                }
                if (node.name === 'NvTag') {
                  out.push(Decoration.mark({ class: 'cm-nv-tag-source', attributes: { 'data-tag': view.state.doc.sliceString(node.from + 1, node.to) } }).range(node.from, node.to));
                  return false;
                }
                if (node.name === 'URL' && node.node.parent?.name !== 'Link' && node.node.parent?.name !== 'Image') {
                  out.push(Decoration.mark({ class: 'cm-nv-url-source', attributes: { 'data-href': view.state.doc.sliceString(node.from, node.to) } }).range(node.from, node.to));
                  return false;
                }
                return;
              },
            });
          }
          return Decoration.set(out, true);
        }
      },
      { decorations: (v) => v.decorations },
    ),
  ];
}
