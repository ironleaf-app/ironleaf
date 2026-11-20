// Callouts: a quote whose first line starts with a kind in brackets, "> [!tip] Bake the day before", drawn as a tinted box
// with an icon and a title (Live Preview, Reading, previews, chat answers). The words stay a plain Markdown quote, so other
// Markdown apps show them as a quote with the [!tip] in front: nothing is lost. "[!tip]-" starts folded, "[!tip]+" can
// be folded but starts open. No imports here, so the editor, the page renderer and the tests all read the same rules.

export const CALLOUT_TYPES: Record<string, { label: string; icon: string; aliases?: string[] }> = {
  note: { label: 'Note', icon: 'pencil' },
  abstract: { label: 'Summary', icon: 'outline', aliases: ['summary', 'tldr'] },
  info: { label: 'Info', icon: 'info' },
  todo: { label: 'To do', icon: 'task' },
  tip: { label: 'Tip', icon: 'sparkle', aliases: ['hint', 'important'] },
  success: { label: 'Done', icon: 'check', aliases: ['check', 'done'] },
  question: { label: 'Question', icon: 'help', aliases: ['help', 'faq'] },
  warning: { label: 'Warning', icon: 'warning', aliases: ['caution', 'attention'] },
  failure: { label: 'Failed', icon: 'close', aliases: ['fail', 'missing'] },
  danger: { label: 'Danger', icon: 'warning', aliases: ['error'] },
  bug: { label: 'Bug', icon: 'warning' },
  example: { label: 'Example', icon: 'list' },
  quote: { label: 'Quote', icon: 'quote', aliases: ['cite'] },
};

/**
 * The kinds the slash menu's picker offers, most used first (19 Oct 2026, 5.0.0: the seven people reach for; the rest
 * still draw when typed, and the picker lists them after a divider).
 */
export const CALLOUT_PICKS = ['note', 'info', 'tip', 'success', 'question', 'warning', 'danger'] as const;

/** What each kind is for, in a few words (the picker's line under each kind). */
export const CALLOUT_HINTS: Record<string, string> = {
  note: 'Something to keep in mind',
  abstract: 'The short version',
  info: 'A useful fact',
  todo: 'Something still to do',
  tip: 'A better way to do it',
  success: 'Finished, or went well',
  question: 'Something to find out',
  warning: 'Take care here',
  failure: 'Did not work',
  danger: 'Could cause real harm',
  bug: 'Something broken',
  example: 'An example',
  quote: 'Someone’s words',
};

/** A callout's kind from what was written ([!tip], [!TLDR]…); unknown kinds look like notes but keep their name. */
export function calloutKind(raw: string): { type: string; label: string; icon: string } {
  const key = raw.toLowerCase();
  for (const [type, def] of Object.entries(CALLOUT_TYPES)) {
    if (type === key || def.aliases?.includes(key)) return { type, label: def.label, icon: def.icon };
  }
  return { type: 'note', label: raw.charAt(0).toUpperCase() + raw.slice(1), icon: 'pencil' };
}

/** A callout's first line: its quote lead ("> "), [!kind], fold sign, the space after, and the title. */
export const CALLOUT_HEAD = /^(\s{0,3}>\s?)\[!([\w-]+)\]([+-]?)([ \t]*)(.*)$/;

export interface CalloutHead {
  /** The kind as drawn (aliases folded in: [!tldr] is an abstract). */
  type: string;
  /** The kind as written, lower case. */
  written: string;
  label: string;
  icon: string;
  /** '' cannot fold, '+' folds and starts open, '-' starts folded. */
  fold: '' | '+' | '-';
  /** The title as written, else the kind's own name. */
  title: string;
  /** Characters from the line's start to the end of "[!kind]-" and the space after it (where the title begins). */
  titleAt: number;
}

export function parseCalloutHead(line: string): CalloutHead | null {
  const m = CALLOUT_HEAD.exec(line);
  if (!m) return null;
  const kind = calloutKind(m[2]);
  return {
    type: kind.type,
    written: m[2].toLowerCase(),
    label: kind.label,
    icon: kind.icon,
    fold: m[3] as CalloutHead['fold'],
    title: m[5].trim() || kind.label,
    titleAt: m[1].length + 3 + m[2].length + m[3].length + m[4].length,
  };
}

export interface CalloutBlock extends CalloutHead {
  /** The block's first and last lines (counted from 0). */
  first: number;
  last: number;
}

/**
 * Every callout in a note, with the lines it spans: its first line and each line after that still starts with ">".
 * Callouts in code blocks are left alone (they are examples, not callouts). Used to fold "[!kind]-" callouts when a
 * note opens.
 */
export function calloutBlocks(text: string): CalloutBlock[] {
  const lines = text.split(/\r?\n/);
  const out: CalloutBlock[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const fenceMark = /^\s{0,3}(```+|~~~+)/.exec(lines[i])?.[1];
    if (fenceMark) {
      if (!fence) fence = fenceMark[0];
      else if (fenceMark[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const head = parseCalloutHead(lines[i]);
    if (!head) continue;
    let last = i;
    while (last + 1 < lines.length && /^\s{0,3}>/.test(lines[last + 1])) last++;
    out.push({ ...head, first: i, last });
    i = last;
  }
  return out;
}

/** A callout of this kind written out: its first line and, if any, the words inside (each line quoted). */
export function calloutMarkdown(kind: string, title = '', body = ''): string {
  const head = `> [!${kind}]${title ? ` ${title}` : ''}`;
  if (!body) return head;
  return `${head}\n${body.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}`;
}
