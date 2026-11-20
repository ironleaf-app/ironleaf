// The Markdown Ironleaf reads beyond GitHub's: [[links]] and ![[embeds]], ==highlights== and <mark class="nv-green">
// coloured highlights</mark>, %%comments%%, $maths$ and $$maths blocks$$, #tags and [^footnote] references. Parser extensions for the editor (so each is a node in the syntax
// tree that Live Preview can draw and Source mode can colour).

import { Tag, tags as t } from '@lezer/highlight';
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';
import { COLOUR_CLOSE, COLOUR_OPEN } from '../lib/highlights';
import { isNotATag } from '../../../shared/markdown';

export const nvTags = {
  wikilink: Tag.define(t.link),
  embed: Tag.define(t.link),
  highlight: Tag.define(t.content),
  comment: Tag.define(t.comment),
  math: Tag.define(t.string),
  tag: Tag.define(t.labelName),
  footnote: Tag.define(t.labelName),
  mark: Tag.define(t.processingInstruction),
};

const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~¡‐-‧]/;

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': nvTags.highlight } },
    { name: 'HighlightMark', style: nvTags.mark },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter));
      },
      after: 'Emphasis',
    },
  ],
};

const ColourDelim = { resolve: 'ColourHighlight', mark: 'ColourHighlightMark' };

/**
 * A coloured highlight (src/renderer/src/lib/highlights.ts): only our own <mark class="nv-…"> and its </mark> are read,
 * as a pair of marks around words (so bold or a link inside still works); any other tag stays the HTML it is.
 */
const ColourHighlight: MarkdownConfig = {
  defineNodes: [
    // No syntax colour of its own: live preview paints the words in their own colour (the default highlight's yellow
    // painted over it: 19 Oct 2026, a green highlight showed yellow in the real app).
    { name: 'ColourHighlight' },
    { name: 'ColourHighlightMark', style: nvTags.mark },
  ],
  parseInline: [
    {
      name: 'ColourHighlight',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 60) return -1;
        const ahead = cx.slice(pos, Math.min(cx.end, pos + 32));
        const open = COLOUR_OPEN.exec(ahead);
        if (open) return cx.addDelimiter(ColourDelim, pos, pos + open[0].length, true, false);
        if (ahead.startsWith(COLOUR_CLOSE)) return cx.addDelimiter(ColourDelim, pos, pos + COLOUR_CLOSE.length, false, true);
        return -1;
      },
      before: 'HTMLTag',
    },
  ],
};

const Wikilink: MarkdownConfig = {
  defineNodes: [
    { name: 'Wikilink', style: { 'Wikilink/...': nvTags.wikilink } },
    { name: 'Embed', style: { 'Embed/...': nvTags.embed } },
    { name: 'WikilinkMark', style: nvTags.mark },
  ],
  parseInline: [
    {
      name: 'Wikilink',
      parse(cx: InlineContext, next: number, pos: number) {
        const start = pos;
        let embed = false;
        if (next === 33) {
          if (cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) return -1;
          embed = true;
          pos += 1;
        } else if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
        for (let i = pos + 2; i < cx.end - 1; i++) {
          const c = cx.char(i);
          if (c === 10 || c === 91) return -1;
          if (c === 93) {
            if (cx.char(i + 1) !== 93 || i === pos + 2) return -1;
            return cx.addElement(cx.elt(embed ? 'Embed' : 'Wikilink', start, i + 2, [cx.elt('WikilinkMark', start, pos + 2), cx.elt('WikilinkMark', i, i + 2)]));
          }
        }
        return -1;
      },
      before: 'Link',
    },
  ],
};

const FootnoteRef: MarkdownConfig = {
  defineNodes: [{ name: 'FootnoteRef', style: nvTags.footnote }],
  parseInline: [
    {
      name: 'FootnoteRef',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
        for (let i = pos + 2; i < cx.end && i < pos + 80; i++) {
          const c = cx.char(i);
          if (c === 32 || c === 10 || c === 91) return -1;
          if (c === 93) return i === pos + 2 ? -1 : cx.addElement(cx.elt('FootnoteRef', pos, i + 1));
        }
        return -1;
      },
      before: 'Wikilink',
    },
  ],
};

const InlineComment: MarkdownConfig = {
  defineNodes: [{ name: 'NvComment', style: nvTags.comment }],
  parseInline: [
    {
      name: 'NvComment',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 37 || cx.char(pos + 1) !== 37) return -1;
        for (let i = pos + 2; i < cx.end - 1; i++) if (cx.char(i) === 37 && cx.char(i + 1) === 37) return cx.addElement(cx.elt('NvComment', pos, i + 2));
        return -1;
      },
      before: 'Emphasis',
    },
  ],
};

/** A %% on its own line opens a comment that runs to the next line with %%. */
const BlockComment: MarkdownConfig = {
  defineNodes: [{ name: 'NvCommentBlock', block: true, style: nvTags.comment }],
  parseBlock: [
    {
      name: 'NvCommentBlock',
      parse(cx: BlockContext, line: Line) {
        const text = line.text.slice(line.pos);
        if (!text.startsWith('%%') || text.slice(2).includes('%%')) return false;
        const start = cx.lineStart + line.pos;
        while (cx.nextLine()) {
          if (line.text.includes('%%')) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('NvCommentBlock', start, end));
            return true;
          }
        }
        cx.addElement(cx.elt('NvCommentBlock', start, cx.prevLineEnd()));
        return true;
      },
      before: 'FencedCode',
    },
  ],
};

const InlineMath: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: { 'InlineMath/...': nvTags.math } },
    { name: 'MathMark', style: nvTags.mark },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 36 || cx.char(pos + 1) === 36) return -1;
        const after = cx.char(pos + 1);
        if (after === 32 || after === 9 || after === 10 || after === -1) return -1;
        for (let i = pos + 1; i < cx.end; i++) {
          const c = cx.char(i);
          if (c === 92) {
            i++;
            continue;
          }
          if (c === 10) return -1;
          if (c !== 36) continue;
          const prev = cx.char(i - 1);
          if (prev === 32 || prev === 9) continue;
          const following = cx.char(i + 1);
          if (following >= 48 && following <= 57) continue;
          return cx.addElement(cx.elt('InlineMath', pos, i + 1, [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', i, i + 1)]));
        }
        return -1;
      },
      before: 'Emphasis',
    },
  ],
};

const BlockMath: MarkdownConfig = {
  defineNodes: [{ name: 'BlockMath', block: true, style: nvTags.math }],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx: BlockContext, line: Line) {
        const text = line.text.slice(line.pos);
        if (!text.startsWith('$$')) return false;
        const start = cx.lineStart + line.pos;
        const rest = text.slice(2);
        if (rest.trimEnd().endsWith('$$') && rest.trim().length > 2) {
          const end = cx.lineStart + line.text.length;
          cx.nextLine();
          cx.addElement(cx.elt('BlockMath', start, end));
          return true;
        }
        while (cx.nextLine()) {
          if (line.text.trimEnd().endsWith('$$')) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('BlockMath', start, end));
            return true;
          }
        }
        cx.addElement(cx.elt('BlockMath', start, cx.prevLineEnd()));
        return true;
      },
      before: 'FencedCode',
    },
  ],
};

const TAG_BODY = /^[\p{L}\p{N}_/-]+/u;

const HashTag: MarkdownConfig = {
  defineNodes: [
    { name: 'NvTag', style: nvTags.tag },
    { name: 'NvTagMark', style: nvTags.mark },
  ],
  parseInline: [
    {
      name: 'NvTag',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 35) return -1;
        const prev = cx.slice(pos - 1, pos);
        if (prev && !/[\s(]/.test(prev)) return -1;
        const m = TAG_BODY.exec(cx.slice(pos + 1, Math.min(cx.end, pos + 200)));
        if (!m || /^[\d/-]+$/.test(m[0]) || isNotATag(m[0])) return -1;
        return cx.addElement(cx.elt('NvTag', pos, pos + 1 + m[0].length, [cx.elt('NvTagMark', pos, pos + 1)]));
      },
      before: 'Emphasis',
    },
  ],
};

/** Every extension, in the order the parser should try them. */
export const ironleafMarkdown: MarkdownConfig[] = [Wikilink, FootnoteRef, Highlight, ColourHighlight, InlineComment, BlockComment, InlineMath, BlockMath, HashTag];

/**
 * Whether an ![[embed]] alone on its line is drawn as a block: only when it is the whole paragraph (Live Preview's
 * block layer draws those; the inline layer draws any other, such as a clipped article's pictures on their own lines
 * inside a longer paragraph). Without the second test the inline layer punts and the block layer declines, and the
 * embed sits as raw text (8.8 round 2: the clipped note's picture showed as raw red text).
 */
export function embedFillsParagraph(parentName: string | undefined, parentText: string, embedText: string): boolean {
  return parentName === 'Paragraph' && parentText.trim() === embedText;
}
