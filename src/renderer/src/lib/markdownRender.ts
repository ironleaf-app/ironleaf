// Notes as pages (Reading mode, previews, embeds, chat answers): Markdown with [[links]] and ![[embeds]], callouts,
// ==highlights== (and our coloured <mark class="nv-green"> ones), %%comments%% (hidden), maths, footnotes, tick-boxes,
// #tags and Mermaid diagrams. Raw HTML in the note is never run (markdown-it reads it as text; only our own coloured
// highlight tags are read, as exactly those), so the output is safe to put in the page.

import katex from 'katex';
import { blockOf, lineBlockId, withoutBlockId } from '../../../shared/blocks';
import { columnBlockAt, openColumns } from '../../../shared/page-columns';
import createMarkdownIt, { type MarkdownIt, type StateBlock, type StateCore, type StateInline, type Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { isBoxDone } from '../../../shared/finished';
import { frontMatterRange } from '../../../shared/frontmatter';
import { isNotATag, maskCode, parseWikilink } from '../../../shared/markdown';
import { dueChipTone, taskChips } from '../../../shared/note-task';
import { CALLOUT_TYPES, calloutKind } from './callouts';
import { COLOUR_CLOSE, COLOUR_OPEN } from './highlights';
import { fileUrl, isAudio, isImage, isPdf, isVideo, resolveAny, resolveFile } from './resolve';
import { BLOCKED_REMOTE_FILE, isRemoteFileSource } from '../../../shared/remote-file';
import { isViewPath } from '../../../shared/views';

export type RenderEnv = {
  /** The note being shown (for links relative to it). */
  from?: string;
  /** Tick-boxes can be clicked (Reading mode of the note itself, not previews). */
  interactive?: boolean;
  /** The note's properties shown as the text they are (Settings › Editor › Properties in notes: As text). */
  propertiesAsText?: boolean;
  /** The day due spans read against (tests pin it; the window reads now). */
  now?: Date;
};

/**
 * Settings › Editor › Show single line breaks: off by default (strict), lines join until a blank line, as Markdown does;
 * on, one Enter starts a new line in Reading too, as it does in the editor.
 */
let breaks = true;
export function setLineBreaks(on: boolean): void {
  if (on === breaks) return;
  breaks = on;
  renderer = null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The kinds and how a callout's first line is read live in callouts.ts (the editor and the tests use them too).
export { CALLOUT_TYPES, calloutKind };

// Small inline drawings of our own icons for callout titles (the same paths as Icon.tsx draws).
const ICON_PATHS: Record<string, string> = {
  pencil: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  outline: 'M9 6h11M11 12h9M11 18h9M4 6h1.5M6 12h1.5M6 18h1.5',
  info: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 11v5.5M12 8h.01',
  task: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM8 12.2l2.8 2.8 5.2-6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  help: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1.1.8-1.1 1.5v.6M12 17h.01',
  warning: 'M12 3.5 21.5 20h-19zM12 10v5M12 17.5h.01',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5',
  quote: 'M6 10.5h4V16H5v-4a6 6 0 0 1 3-5.2M15 10.5h4V16h-5v-4a6 6 0 0 1 3-5.2',
  chevron: 'M9 6l6 6-6 6',
  copy: 'M9.5 8h9A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 8 18.5v-9A1.5 1.5 0 0 1 9.5 8zM5 16V5.5A1.5 1.5 0 0 1 6.5 4H16',
};

export function iconSvg(name: string, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name] ?? ICON_PATHS.pencil}"/></svg>`;
}

/** Comments (%%…%%) and the properties block become blank lines, so every line keeps its number. */
function prepare(source: string, propertiesAsText = false): string {
  let text = source;
  const fm = frontMatterRange(text);
  // The properties: left out (they show above the note), or as a block of their text (same lines, so places still match).
  if (fm && propertiesAsText) {
    const lines = text.slice(0, fm.to).replace(/\r?\n$/, '').split(/\r?\n/);
    lines[0] = '```yaml';
    lines[lines.length - 1] = '```';
    text = lines.join('\n') + '\n' + text.slice(fm.to);
  } else if (fm) text = text.slice(0, fm.to).replace(/[^\n]/g, '') + text.slice(fm.to);
  const masked = maskCode(text);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(/%%[\s\S]*?%%/g)) {
    const start = m.index ?? 0;
    out += text.slice(last, start) + m[0].replace(/[^\n]/g, '');
    last = start + m[0].length;
  }
  return hideBlockIds(out + text.slice(last));
}

/** Block ids (" ^id" at a line's end, or alone on a line; V12, 28 Oct 2026) are the place a link points at, not words to
 *  read: left out of the reading view, every line kept. */
function hideBlockIds(text: string): string {
  if (!text.includes('^')) return text;
  const masked = maskCode(text).split('\n');
  return text
    .split('\n')
    .map((l, i) => (l.includes('^') && lineBlockId(masked[i] ?? '') ? withoutBlockId(l) : l))
    .join('\n');
}

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  let pos = state.pos;
  let embed = false;
  if (src.charCodeAt(pos) === 0x21 && src.charCodeAt(pos + 1) === 0x5b && src.charCodeAt(pos + 2) === 0x5b) {
    embed = true;
    pos++;
  } else if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const close = src.indexOf(']]', pos + 2);
  if (close < 0 || close > state.posMax) return false;
  const inner = src.slice(pos + 2, close);
  if (!inner.trim() || /[[\]\n]/.test(inner)) return false;
  if (!silent) {
    const token = state.push(embed ? 'nv_embed' : 'nv_wikilink', '', 0);
    token.meta = parseWikilink(inner) as unknown as Record<string, unknown>;
    token.content = inner;
  }
  state.pos = close + 2;
  return true;
}

function highlightRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d || src.charCodeAt(start + 2) === 0x3d) return false;
  const end = src.indexOf('==', start + 2);
  if (end < 0 || end > state.posMax || end === start + 2 || /\s/.test(src[start + 2]) || /\s/.test(src[end - 1])) return false;
  if (!silent) {
    state.push('mark_open', 'mark', 1);
    const max = state.posMax;
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = max;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
}

/** <mark class="nv-green">words</mark>: a highlight in one of our six colours (lib/highlights.ts); nothing else in angle
 *  brackets is read. */
function colourMarkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3c) return false;
  const open = COLOUR_OPEN.exec(src.slice(start, Math.min(state.posMax, start + 32)));
  if (!open) return false;
  const from = start + open[0].length;
  const end = src.indexOf(COLOUR_CLOSE, from);
  if (end < 0 || end + COLOUR_CLOSE.length > state.posMax || end === from) return false;
  if (!silent) {
    const token = state.push('mark_open', 'mark', 1);
    token.attrSet('class', `nv-${open[1]}`);
    const max = state.posMax;
    state.pos = from;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = max;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + COLOUR_CLOSE.length;
  return true;
}

function inlineMathRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 || src.charCodeAt(start + 1) === 0x24) return false;
  const first = src[start + 1];
  if (!first || /\s/.test(first)) return false;
  for (let i = start + 1; i < state.posMax; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '\n') return false;
    if (c !== '$') continue;
    if (/\s/.test(src[i - 1]) || /\d/.test(src[i + 1] ?? '')) continue;
    if (!silent) {
      const token = state.push('nv_math_inline', 'span', 0);
      token.content = src.slice(start + 1, i);
    }
    state.pos = i + 1;
    return true;
  }
  return false;
}

function tagRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x23) return false;
  if (start > 0 && !/[\s(]/.test(src[start - 1])) return false;
  const m = /^[\p{L}\p{N}_/-]+/u.exec(src.slice(start + 1, state.posMax));
  if (!m || /^[\d/-]+$/.test(m[0]) || isNotATag(m[0])) return false;
  if (!silent) {
    const token = state.push('nv_tag', 'a', 0);
    token.content = m[0];
  }
  state.pos = start + 1 + m[0].length;
  return true;
}

function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const first = state.src.slice(start, max);
  if (!first.startsWith('$$')) return false;
  if (silent) return true;
  let content = '';
  let line = startLine;
  const rest = first.slice(2);
  if (rest.trimEnd().endsWith('$$') && rest.trim().length > 2) {
    content = rest.trimEnd().slice(0, -2);
  } else {
    const parts = [rest];
    for (line = startLine + 1; line < endLine; line++) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      if (text.trimEnd().endsWith('$$')) {
        parts.push(text.trimEnd().slice(0, -2));
        break;
      }
      parts.push(text);
    }
    content = parts.join('\n');
  }
  state.line = Math.min(line, endLine - 1) + 1;
  const token = state.push('nv_math_block', 'div', 0);
  token.content = content;
  token.map = [startLine, state.line];
  return true;
}

/** Callouts: a quote that starts with [!kind] becomes a titled box (folded when written [!kind]-). */
function calloutRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open') continue;
    const inline = tokens[i + 2];
    if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/m.exec(inline.content.split('\n')[0]);
    if (!m || inline.content.indexOf(m[0]) !== 0) continue;
    const kind = calloutKind(m[1]);
    const fold = m[2];
    const title = m[3].trim() || kind.label;
    const open = tokens[i];
    open.tag = 'div';
    open.attrSet('class', `callout callout-${kind.type}${fold === '-' ? ' is-collapsed' : ''}${fold ? ' is-foldable' : ''}`);
    open.attrSet('data-callout', m[1].toLowerCase());
    // The matching close becomes a div too.
    let depth = 0;
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === 'blockquote_open') depth++;
      if (tokens[j].type === 'blockquote_close' && --depth === 0) {
        tokens[j].tag = 'div';
        const end = new state.Token('nv_callout_body_close', 'div', -1);
        tokens.splice(j, 0, end);
        break;
      }
    }
    const rest = inline.content.split('\n').slice(1).join('\n');
    const titleToken = new state.Token('nv_callout_title', 'div', 0);
    titleToken.content = title;
    titleToken.meta = { icon: kind.icon, fold };
    const bodyOpen = new state.Token('nv_callout_body_open', 'div', 1);
    if (rest.trim()) {
      inline.content = rest;
      inline.children = [];
      state.md.inline.parse(rest, state.md, state.env, inline.children);
      tokens.splice(i + 1, 0, titleToken, bodyOpen);
    } else {
      // Only a title: its paragraph goes.
      tokens.splice(i + 1, 3, titleToken, bodyOpen);
    }
  }
}

/** Tick-boxes: list items that start with [ ] or [x]. A task's due day reads as the same chip words Live shows
 *  (10.0 third round F9, one reader for both modes): the written span becomes a reading-due span, the written
 *  words kept on hover. */
function taskRule(state: StateCore): void {
  const tokens = state.tokens;
  const lines = state.src.split('\n');
  const now = ((state.env ?? {}) as RenderEnv).now ?? new Date();
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
    const m = /^\[([ xX/\-><!?*])\][ \t]/.exec(inline.content) ?? (/^\[([ xX/\-><!?*])\]$/.exec(inline.content));
    if (!m) continue;
    const item = tokens[i - 2];
    // Done-ness reads the one box rule (5 Nov 2026, u3 moving-in: `[/]` in-progress used to render ticked); the mark
    // rides along for its glyph (a half box, a cancelled box).
    const done = isBoxDone(m[1]);
    item.attrJoin('class', `task-list-item${done ? ' is-checked' : ''}`);
    item.attrSet('data-task', m[1]);
    const first = inline.children?.[0];
    if (first?.type === 'text') first.content = first.content.slice(m[0].length);
    const box = new state.Token('nv_checkbox', 'input', 0);
    box.meta = { done, line: item.map?.[0] ?? -1, mark: m[1] };
    inline.children?.unshift(box);
    dueChipInline(state, inline, item, lines, m[0].length, now);
  }
}

/** A task line's written due day as the Live chip words: the due span taskChips read becomes an nv_due span with
 *  the chip words and tone (the same helper Live tones through). Only plain-text spans rewrite: a day in code,
 *  or split across markup the offsets cannot cover, stays as written. `stripped` is the "[ ] " head taskRule
 *  took off the inline children. */
function dueChipInline(state: StateCore, inline: Token, item: Token, lines: string[], stripped: number, now: Date): void {
  const atLine = item.map?.[0];
  if (atLine === undefined) return;
  const srcLine = lines[atLine];
  if (!srcLine) return;
  const contentStart = srcLine.indexOf('[');
  if (contentStart < 0) return;
  const chips = taskChips(srcLine, now);
  if (!chips?.due || !chips.dueSpan || !chips.dueWords) return;
  const from = chips.dueSpan[0] - (contentStart + stripped);
  const to = chips.dueSpan[1] - (contentStart + stripped);
  if (!(from >= 0 && to > from)) return;
  const kids = inline.children ?? [];
  const edits: { k: number; a: number; b: number }[] = [];
  let at = 0;
  for (let k = 0; k < kids.length; k++) {
    const c = kids[k];
    if (c.type === 'text') {
      const a = Math.max(from, at);
      const b = Math.min(to, at + c.content.length);
      if (a < b) edits.push({ k, a: a - at, b: b - at });
      at += c.content.length;
    } else if (c.type === 'code_inline') {
      if (Math.max(from, at) < Math.min(to, at + c.content.length)) return;
      at += c.content.length;
    } else if (c.content) {
      // Markup with length (a soft break, maths): the offsets past it cannot be trusted.
      if (at < to) return;
    }
  }
  let covered = 0;
  for (const e of edits) covered += e.b - e.a;
  if (!edits.length || covered !== to - from) return;
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const span = new state.Token('nv_due', 'span', 0);
  span.meta = { words: chips.dueWords, tone: dueChipTone(chips.due, todayIso, chips.done), written: srcLine.slice(chips.dueSpan[0], chips.dueSpan[1]) };
  const out: Token[] = [];
  let placed = false;
  for (let k = 0; k < kids.length; k++) {
    const e = edits.find((x) => x.k === k);
    if (!e) {
      out.push(kids[k]);
      continue;
    }
    const c = kids[k];
    if (e.a > 0) {
      const before = new state.Token('text', '', 0);
      before.content = c.content.slice(0, e.a);
      out.push(before);
    }
    if (!placed) {
      out.push(span);
      placed = true;
    }
    if (e.b < c.content.length) {
      const after = new state.Token('text', '', 0);
      after.content = c.content.slice(e.b);
      out.push(after);
    }
  }
  inline.children = out;
}

/** Every block gets its line in the note (to tick boxes, follow the outline and keep the place between modes). */
function lineRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.type !== 'inline') token.attrSet('data-line', String(token.map[0]));
  }
}

/** Page columns (8.8): <!-- columns:2 --> … <!-- column --> … <!-- end columns --> drawn side by side. Top-level
 *  only, so lists and quotes keep their own shape; each column's Markdown is rendered as a note of its own. */
function columnBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.level !== 0) return false;
  const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
  if (openColumns(first) === null) return false;
  const lines: string[] = [];
  for (let l = startLine; l < endLine; l++) lines.push(state.src.slice(state.bMarks[l], state.eMarks[l]));
  const block = columnBlockAt(lines, 0);
  if (!block) return false;
  if (silent) return true;
  state.line = startLine + block.end + 1;
  const token = state.push('nv_columns', 'div', 0);
  token.map = [startLine, state.line];
  token.meta = { count: block.count, columns: block.columns } as unknown as Record<string, unknown>;
  return true;
}

function makeRenderer(): MarkdownIt {
  const md = createMarkdownIt({ html: false, linkify: true, breaks, typographer: false });
  md.use(footnote as unknown as (md: MarkdownIt) => void);
  md.block.ruler.before('fence', 'nv_columns', columnBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.inline.ruler.before('link', 'nv_wikilink', wikilinkRule);
  md.inline.ruler.before('emphasis', 'nv_mark', highlightRule);
  md.inline.ruler.before('emphasis', 'nv_colour_mark', colourMarkRule);
  md.inline.ruler.before('emphasis', 'nv_math_inline', inlineMathRule);
  md.inline.ruler.push('nv_tag', tagRule);
  md.block.ruler.before('fence', 'nv_math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.core.ruler.push('nv_callouts', calloutRule);
  md.core.ruler.push('nv_tasks', taskRule);
  md.core.ruler.push('nv_lines', lineRule);

  const rules = md.renderer.rules;
  rules.nv_wikilink = (tokens, idx, _o, envIn) => {
    const env = envIn as RenderEnv;
    const { target, heading, alias } = tokens[idx].meta as { target: string; heading?: string; alias?: string };
    // A link reads as the note's name, never its path (5 Nov 2026, the audit: Reading showed "People/Alex Chen"
    // where Live Preview chips "Alex Chen"); the address stays the full target.
    const name = target.includes('/') ? target.slice(target.lastIndexOf('/') + 1) : target;
    const label = alias ?? (heading ? (target ? `${name} › ${heading.replace(/^\^/, '')}` : heading.replace(/^\^/, '')) : name);
    const resolved = target ? resolveAny(target, env?.from) : env?.from ?? null;
    const href = target + (heading ? `#${heading}` : '');
    return `<a class="internal-link${resolved ? '' : ' is-unresolved'}" data-href="${esc(href)}" href="#">${esc(label)}</a>`;
  };
  rules.nv_embed = (tokens, idx, _o, envIn) => {
    const env = envIn as RenderEnv;
    const { target, heading, alias } = tokens[idx].meta as { target: string; heading?: string; alias?: string };
    const file = target ? resolveFile(target, env?.from) : null;
    const size = /^(\d+)(?:x(\d+))?$/.exec(alias ?? '');
    const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ''}` : '';
    if (file && isImage(file)) return `<img class="nv-embed-image" src="${esc(fileUrl(file))}" alt="${esc(size ? '' : alias ?? target)}"${dims} data-path="${esc(file)}">`;
    if (file && isPdf(file)) return `<iframe class="nv-embed-pdf" src="${esc(fileUrl(file))}${heading ? `#${esc(heading)}` : ''}" title="${esc(target)}"></iframe>`;
    if (file && isAudio(file)) return `<audio class="nv-embed-audio" controls preload="metadata" src="${esc(fileUrl(file))}"></audio>`;
    if (file && isVideo(file)) return `<video class="nv-embed-video" controls preload="metadata" src="${esc(fileUrl(file))}"${dims}></video>`;
    // A view over notes (21 Oct 2026): filled in by hydrate() once the page is on screen.
    if (file && isViewPath(file)) return `<span class="nv-embed nv-embed-view" data-path="${esc(file)}" data-part="${esc(heading ?? '')}"></span>`;
    return `<span class="nv-embed nv-embed-note" data-target="${esc(target)}" data-heading="${esc(heading ?? '')}" data-from="${esc(env?.from ?? '')}"></span>`;
  };
  rules.nv_math_inline = (tokens, idx) => katex.renderToString(tokens[idx].content, { throwOnError: false, displayMode: false });
  rules.nv_math_block = (tokens, idx) => `<div class="math-block" data-line="${tokens[idx].map?.[0] ?? ''}">${katex.renderToString(tokens[idx].content, { throwOnError: false, displayMode: true })}</div>`;
  rules.nv_columns = (tokens, idx, _o, envIn) => {
    const env = envIn as RenderEnv;
    const { count, columns } = tokens[idx].meta as { count: number; columns: string[] };
    // Each column reads as a note of its own; its tick-boxes stay untickable here (their lines are the column's, not
    // the note's), ticked in the editor instead.
    const cells = columns.map((c) => `<div class="nv-column">${c.trim() ? renderMarkdown(c, { ...env, interactive: false }) : ''}</div>`).join('');
    return `<div class="nv-columns" style="--nv-cols:${count}" data-line="${tokens[idx].map?.[0] ?? ''}">${cells}</div>`;
  };
  rules.nv_tag = (tokens, idx) => `<a class="tag" data-tag="${esc(tokens[idx].content)}" href="#">#${esc(tokens[idx].content)}</a>`;
  rules.nv_checkbox = (tokens, idx, _o, envIn) => {
    const env = envIn as RenderEnv;
    const { done, line, mark } = tokens[idx].meta as { done: boolean; line: number; mark: string };
    return `<input type="checkbox" class="task-checkbox" data-line="${line}" data-mark="${esc(mark ?? (done ? 'x' : ' '))}"${done ? ' checked' : ''}${env?.interactive ? '' : ' disabled'}>`;
  };
  rules.nv_due = (tokens, idx) => {
    const { words, tone, written } = tokens[idx].meta as { words: string; tone: string; written: string };
    return `<span class="reading-due${tone ? ` is-${tone}` : ''}" title="Written “${esc(written)}”">${esc(words)}</span>`;
  };
  rules.nv_callout_title = (tokens, idx) => {
    const { icon, fold } = tokens[idx].meta as { icon: string; fold: string };
    return `<div class="callout-title"><span class="callout-icon">${iconSvg(icon)}</span><span class="callout-title-text">${md.renderInline(tokens[idx].content)}</span>${fold ? `<span class="callout-fold">${iconSvg('chevron', 14)}</span>` : ''}</div>`;
  };
  rules.nv_callout_body_open = () => '<div class="callout-content">';
  rules.nv_callout_body_close = () => '</div>';

  const fence = rules.fence!;
  rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const line = token.map?.[0] ?? '';
    if (lang === 'mermaid') return `<div class="nv-mermaid" data-line="${line}" data-src="${esc(token.content)}"></div>`;
    // A chart block (src/shared/chart-kit.ts): drawn live from the notes it names (lib/charts.ts).
    if (lang === 'chart') return `<div class="nv-chart" data-line="${line}" data-src="${esc(token.content)}"></div>`;
    if (!lang) return fence(tokens, idx, options, env, self);
    return `<div class="code-block" data-line="${line}"><div class="code-block-head"><span>${esc(lang)}</span><button class="code-copy" title="Copy">${iconSvg('copy', 14)}</button></div><pre data-lang="${esc(lang)}"><code>${esc(token.content)}</code></pre></div>`;
  };

  const image = rules.image!;
  rules.image = (tokens, idx, options, envIn, self) => {
    const env = envIn as RenderEnv;
    const token = tokens[idx];
    const src = String(token.attrGet('src') ?? '');
    // A picture on another computer (//host/x.png, \\host\share\x.png, file://host/…) is never asked for: on Windows
    // that opens an SMB connection which sends this PC's sign-in to the host (src/shared/remote-file.ts).
    if (isRemoteFileSource(src)) return `<span class="nv-blocked-file" title="${esc(BLOCKED_REMOTE_FILE)}: ${esc(src)}">${esc(BLOCKED_REMOTE_FILE)}${token.content ? `: ${esc(token.content.replace(/\|\d+(x\d+)?$/, ''))}` : ''}</span>`;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      let decoded = src;
      try {
        decoded = decodeURI(src);
      } catch {
        // Kept as written.
      }
      const file = resolveFile(decoded, env?.from);
      if (file) token.attrSet('src', fileUrl(file));
    }
    // ![alt|300](picture.png) sets the width.
    const alt = token.content;
    const size = /\|(\d+)(?:x(\d+))?$/.exec(alt);
    if (size) {
      token.attrSet('width', size[1]);
      if (size[2]) token.attrSet('height', size[2]);
      token.children = token.children?.map((c) => (c.type === 'text' ? Object.assign(c, { content: c.content.replace(/\|\d+(x\d+)?$/, '') }) : c)) ?? null;
    }
    return image(tokens, idx, options, envIn, self);
  };

  rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    const href = String(token.attrGet('href') ?? '');
    if (/^nv-file:/i.test(href)) {
      // A file in a project's folder (the assistant's links, src/shared/file-index.ts): opened by the chat.
      token.attrJoin('class', 'project-file-link');
      token.attrSet('data-file', href);
      token.attrSet('href', '#');
    } else if (/^(https?:|mailto:)/i.test(href)) {
      token.attrJoin('class', 'external-link');
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
      let decoded = href;
      try {
        decoded = decodeURI(href);
      } catch {
        // Kept as written.
      }
      token.attrJoin('class', 'internal-link');
      token.attrSet('data-href', decoded.replace(/\.md(#|$)/i, '$1'));
      token.attrSet('href', '#');
    }
    return self.renderToken(tokens, idx, options);
  };
  return md;
}

let renderer: MarkdownIt | null = null;

export function renderMarkdown(source: string, env: RenderEnv = {}): string {
  renderer ??= makeRenderer();
  return renderer.render(prepare(source, env.propertiesAsText), { ...env });
}

export function renderInline(source: string, env: RenderEnv = {}): string {
  renderer ??= makeRenderer();
  return renderer.renderInline(source, { ...env });
}

/** If a click landed on a rendered [[link]] (or a Markdown link to a note), the note it names. */
export function wikilinkFromClick(event: { target: EventTarget | null }): string | null {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a.internal-link');
  return anchor?.getAttribute('data-href') ?? null;
}

/** The part of a note under one heading (to its next heading of the same or a higher level). */
export function sectionOf(text: string, heading: string): string | null {
  const lines = text.split(/\r?\n/);
  const want = heading.trim().toLowerCase();
  let start = -1;
  let level = 0;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i])) fence = !fence;
    if (fence) continue;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!h) continue;
    if (start < 0 && h[2].toLowerCase() === want) {
      start = i;
      level = h[1].length;
    } else if (start >= 0 && h[1].length <= level) {
      return lines.slice(start, i).join('\n');
    }
  }
  if (start >= 0) return lines.slice(start).join('\n');
  // A block reference: the whole block its ^id names (a paragraph, a list item with its own items, a quote, a table).
  return blockOf(text, heading)?.text ?? null;
}
