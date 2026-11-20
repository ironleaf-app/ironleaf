// A task line in a note, read for the editor (8.0 section E, 29 Oct 2026): its owner and its day, as chips beside
// the words while writing. The line itself stays the one plain way the rest of Ironleaf reads (src/shared/tasks.ts,
// src/shared/hub.ts, src/shared/project-file.ts): "- [ ] What — Owner · by 24 Oct", or the canonical "📅 2026-10-24"
// the Tasks page writes. A day typed in plain words ("fri", "next tue", "13 nov") is read here and, once the cursor
// leaves the line, written as that canonical day (see plainDateRewrite), so it never slides to next week. Pure, so
// the tests check it without a window.

import { DAY_PHRASE, PART_OF_DAY_RE, isoDay, looseDayWords, readDay } from './days';
import { TASK_LINE } from './markdown';
import { parseTaskLine } from './tasks';
const WEEKDAY = '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
/** A day in plain words at the end of a task line (the whole phrase, for reading and for writing it canonically).
 *  A weekday with its numbered day comes first, whole ("Thursday the 19th"), so the weekday alone is never
 *  taken with the numbered day left dangling (6 Nov 2026, HOLD 5). */
const PLAIN_AT_END = new RegExp(
  `${WEEKDAY},?\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)(?:\\s+(?:of\\s+)?${MONTH}(?:,?\\s+\\d{4})?)?|(?:next\\s+|this\\s+)?${WEEKDAY}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+\\d{4})?|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|tomorrow|today|tonight|in\\s+\\d+\\s+(?:days?|weeks?)`,
  'i',
);
const CANONICAL_DUE = /(?:📅|🗓️?)\s*\d{4}-\d{2}-\d{2}|\[?due::?\s*\d{4}-\d{2}-\d{2}|@due\(\s*\d{4}-\d{2}-\d{2}/i;

const stripLink = (s: string) =>
  s
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => (alias ?? target.split('/').pop() ?? target).trim())
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, (_m, words: string) => words)
    .replace(/^@/, '')
    .trim();

export interface TaskChips {
  done: boolean;
  /** The words of the task, without its owner tail or its day. */
  words: string;
  /** Who has it, as shown (links read as their name); every owner chips, the note owner included (p16). */
  owner: string | null;
  /** The owner as written, and where it sits in the line ([from, to) in the line). */
  ownerRaw: string | null;
  ownerSpan: [number, number] | null;
  /** Its day, YYYY-MM-DD, however it was written. */
  due: string | null;
  /** The day's words as a chip shows them ("Today", "Tomorrow", "Fri 13 Nov"). */
  dueWords: string | null;
  /** Where the day is written in the line ([from, to) in the line), lead word ("by") included. */
  dueSpan: [number, number] | null;
  /** The day was typed in plain words (not the canonical 📅 day). */
  plain: boolean;
  /** Separators the chips replace (the tail's dash, the dots between chips): hidden where chips show, so no
   *  stray "–" or "·" sits beside them. Only separators and spaces, never prose ([from, to) in the line). */
  hideSpans: [number, number][];
}

/** A due day's tone, the one colour rule for Live chips and Reading spans (10.0 third round F9): done dims
 *  however late, a past day reads red, today reads as today, anything else is quiet. */
export function dueChipTone(due: string, todayIso: string, done: boolean): 'today' | 'overdue' | 'done' | '' {
  if (done) return 'done';
  if (due < todayIso) return 'overdue';
  if (due === todayIso) return 'today';
  return '';
}

/** "Today", "Tomorrow", "Yesterday", else "Fri 13 Nov" (with the year when it is not this one). */
export function dueChipWords(iso: string, ref: Date = new Date()): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wd} ${d.getDate()} ${mo}${d.getFullYear() !== ref.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

const norm = (s: string) => s.toLowerCase().replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();

/** Whether a name is the person's own (their whole name, or their first name alone). */
export function isOwnName(name: string | null | undefined, ownNames: readonly string[]): boolean {
  if (!name) return false;
  const n = norm(stripLink(name));
  if (!n) return false;
  return ownNames.some((own) => {
    const o = norm(own);
    return !!o && (n === o || n === o.split(' ')[0]);
  });
}

/**
 * A task line's owner and day, with where each is written., the format project files and meetings write, read by
 * today.ts and project-hub.ts); the day is the canonical 📅 day, a "by/due" day, or a plain-words day at the
 * line's end. A reminder line (⏰) is left to the reminders.
 */
export function taskChips(line: string, ref: Date = new Date(), ownNames: readonly string[] = []): TaskChips | null {
  const parsed = parseTaskLine(line, ref);
  if (!parsed || parsed.reminder) return null;
  const head = TASK_LINE.exec(line);
  if (!head) return null;
  const textAt = head[1].length + head[2].length + head[3].length;
  const text = head[4];

  let ownerRaw: string | null = null;
  let ownerSpan: [number, number] | null = null;
  // The tail after the dash: "— Who · by when" segments, in order (src/shared/project-file.ts reads the same way). A
  // plain hyphen counts only with a middot ("x - Sam · by fri"; Nov 2026 audit): "Buy milk - dark" is prose, not a who.
  const tail = /\s+[—–]\s+(.+)$/.exec(text);
  const hyphen = !tail ? /\s+-\s+(.+)$/.exec(text) : null;
  const match = tail ?? (hyphen?.[1]?.includes('·') ? hyphen : null);
  const body = match?.[1] ?? null;
  if (body && match) {
    let at = match.index + match[0].length - body.length;
    const parts = body.split(/\s+·\s+/);
    const seps = [...body.matchAll(/\s+·\s+/g)];
    parts.forEach((part, i) => {
      const trimmed = part.replace(CANONICAL_DUE, '').trim();
      const start = at + part.indexOf(trimmed);
      if (trimmed && !/^(?:by|due|before|on)\b/i.test(trimmed) && !readDay(trimmed, ref)) {
        if (!ownerRaw) {
          ownerRaw = trimmed;
          ownerSpan = [textAt + start, textAt + start + trimmed.length];
        }
      }
      // Past the separator's own width (Nov 2026 audit): "  ·  " is five characters, not three.
      at += part.length + (seps[i]?.[0].length ?? 0);
    });
  }

  let due: string | null = parsed.due;
  let dueSpan: [number, number] | null = null;
  let plain = false;
  const canonical = CANONICAL_DUE.exec(text);
  if (canonical && due) {
    dueSpan = [textAt + canonical.index, textAt + canonical.index + canonical[0].length];
  } else {
    // A "by …" day, or a plain-words day standing at the end. When tasks.ts already read the due, the span
    // must read that same day (p16): the first phrase in the words ("failed on Friday") is not the due when
    // the tail names one ("due 2026-11-05"), so a later phrase that reads the due wins over the first.
    const isLead = (s: string) => /^(?:,\s*|\s+)?\(?\s*(?:by|before|due(?:\s+on|\s+by)?|no\s+later\s+than|until|on)\b/i.test(s);
    const isoOfMatch = (m: RegExpExecArray): string | null => {
      const day = readDay((m[1] ?? m[2] ?? m[3] ?? m[0]).trim().replace(/^\(/, ''), ref);
      return day ? isoDay(day) : null;
    };
    let phrased = DAY_PHRASE.exec(text);
    if (phrased && parsed.due && isLead(phrased[0])) {
      const firstIso = isoOfMatch(phrased);
      if (firstIso && firstIso !== parsed.due) {
        const g = new RegExp(DAY_PHRASE.source, `${DAY_PHRASE.flags}g`);
        let gm: RegExpExecArray | null;
        while ((gm = g.exec(text)) !== null) {
          if (gm[0].length === 0) { g.lastIndex++; continue; }
          if (isLead(gm[0]) && isoOfMatch(gm) === parsed.due) { phrased = gm; break; }
          if (g.lastIndex > text.length + 1) break;
        }
      }
    }
    const endMatch = phrased && isLead(phrased[0]) ? phrased : null;
    const bare = endMatch ? null : new RegExp(`[\\s,·(]+(${PLAIN_AT_END.source})[.!]?\\s*$`, 'i').exec(text);
    const m = endMatch ?? bare;
    if (m) {
      const phrase = (m[1] ?? m[2] ?? m[3] ?? m[0]).trim();
      const day = readDay(phrase.replace(/^\(/, ''), ref);
      // Loose words stay words, never a chip (6 Nov 2026, e2, as the minutes and the PDF keep it): a
      // span or a bare weekday on its own weekday names no known day, and a part of a day straight
      // after a figureless day ("by Thursday morning") makes the whole phrase loose, never half read.
      const partAfter = PART_OF_DAY_RE.test(text.slice(m.index + m[0].length));
      const loose = looseDayWords(phrase.replace(/^\(/, ''), ref) || (partAfter && !/\d/.test(phrase));
      if (day && !loose) {
        due = isoDay(day);
        plain = true;
        const from = textAt + m.index + (m[0].startsWith(' ') || m[0].startsWith(',') ? 1 : 0);
        dueSpan = [m.index === 0 ? textAt : from, textAt + m.index + m[0].replace(/[.!]?\s*$/, '').length];
      }
    }
  }
  if (due && !dueSpan && parsed.due) {
    // Read by tasks.ts (a 📅 day with a time, a day's note linked): shown as a chip, its span is the mark itself.
    const at = text.search(/📅|🗓|due::?|@due/i);
    if (at >= 0) dueSpan = [textAt + at, textAt + text.length];
  }

  // A double dash ("— Alex Chen — due 2026-11-05") or a comma ("— Priya Nair, due 2026-11-06") reads as one
  // part, so the owner would swallow the due: the owner stops where the due starts, trailing separators off, so
  // each chip owns its own words (p14, Nov 2026; p16-owner-tail, 4 Nov 2026: a date in an owner line is never a person).
  if (ownerSpan && dueSpan && dueSpan[0] > ownerSpan[0] && dueSpan[0] < ownerSpan[1]) {
    const cut = line.slice(ownerSpan[0], dueSpan[0]).replace(/[\s·—–,;:\-]+$/, '').trim();
    if (cut) {
      ownerRaw = cut;
      ownerSpan = [ownerSpan[0], ownerSpan[0] + cut.length];
    } else {
      ownerRaw = null;
      ownerSpan = null;
    }
  }

  // Every owner chips, the note owner included (p16): ownNames stays on the signature for its callers, but
  // no longer keeps a name as bare text with a stray dash and dot.
  void ownNames;
  const owner = ownerRaw ? stripLink(ownerRaw) : null;
  const ownerAt: [number, number] | null = owner ? ownerSpan : null;
  // The words without the tail or the day, as a list shows them (the tail's own extra words stay in the line).
  let words = parsed.words;
  if (match && (ownerRaw || due)) words = text.slice(0, match.index).trim() || words;
  else if (dueSpan && plain) words = `${text.slice(0, dueSpan[0] - textAt)} ${text.slice(dueSpan[1] - textAt)}`.replace(/\s{2,}/g, ' ').trim() || words;
  // The separators the chips replace (p14): the tail's dash when the first chip sits where the tail starts, and
  // whatever sits between two chips when it is only separators and spaces. A separator between visible words
  // stays.
  const hideSpans: [number, number][] = [];
  const linked = !!ownerRaw?.includes('[[');
  if (match && body) {
    const dashAt = textAt + match.index;
    const bodyAt = textAt + match.index + match[0].length - body.length;
    const dueInTail = !!dueSpan && dueSpan[0] >= bodyAt;
    if (((ownerAt && !linked && ownerAt[0] === bodyAt) || (dueInTail && dueSpan![0] === bodyAt)) && bodyAt > dashAt) hideSpans.push([dashAt, bodyAt]);
    // A linked owner is drawn as a mention, which carries no margin of its own: the dash hides and
    // one space of the separator stays, so no em dash shows beside the chip (6 Nov 2026, e2).
    else if (ownerAt && linked && ownerAt[0] === bodyAt && bodyAt > dashAt + 1) hideSpans.push([dashAt + 1, bodyAt]);
  }
  if (ownerAt && dueSpan) {
    const gap: [number, number] | null = ownerAt[1] <= dueSpan[0] ? [ownerAt[1], dueSpan[0]] : dueSpan[1] <= ownerAt[0] ? [dueSpan[1], ownerAt[0]] : null;
    if (gap && gap[1] > gap[0] && /^[\s·—–,;:\-]+$/.test(line.slice(gap[0], gap[1]))) hideSpans.push(gap);
  }
  return {
    done: parsed.done,
    words,
    owner,
    ownerRaw,
    ownerSpan: ownerAt,
    due,
    dueWords: due ? dueChipWords(due, ref) : null,
    dueSpan,
    plain,
    hideSpans,
  };
}

/**
 * Writing a plain-words day the canonical way once the cursor leaves its line: "- [ ] Call Sam by fri" becomes
 * "- [ ] Call Sam 📅 2026-11-13". Null when the line is not a task, has a canonical day already, or holds no
 * plain-words day. The change is in line places ([from, to) in the line), as the editor takes them.
 */
export function plainDateRewrite(line: string, ref: Date = new Date()): { from: number; to: number; insert: string } | null {
  if (line.includes('⏰')) return null;
  const chips = taskChips(line, ref);
  if (!chips?.due || !chips.plain || !chips.dueSpan) return null;
  const [from, to] = chips.dueSpan;
  // A trailing block id (" ^id") stays after the day.
  const block = /\s\^[A-Za-z0-9-]+\s*$/.exec(line);
  const insert = `📅 ${chips.due}`;
  if (block && to > block.index) return { from, to: block.index, insert: `${insert} ` };
  return { from, to, insert };
}

/** Selected words as one task line (any list or box marks they already carry are not doubled). */
export function taskLineFor(words: string): string {
  const clean = words
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?/, '').replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean)
    .join(' ');
  return clean ? `- [ ] ${clean}` : '- [ ] ';
}

/** What selecting words offers (8.0 section E): each with the words the chat is given, so nothing is sent unseen. */
export const SELECTION_ACTIONS = [
  { id: 'task', label: 'Make a task', hint: 'Turn the selected words into a tick-box task here' },
  { id: 'summarise', label: 'Summarise', hint: 'Ask the assistant for a short summary', ask: 'Summarise this in a few plain sentences:' },
  { id: 'reply', label: 'Draft a reply', hint: 'Ask the assistant to draft a reply', ask: 'Draft a reply to this, in my voice, ready to send:' },
  { id: 'actions', label: 'Turn into actions', hint: 'Ask the assistant for the actions in it', ask: 'Turn this into clear actions, each with who does it and by when where it says:' },
] as const;
export type SelectionActionId = (typeof SELECTION_ACTIONS)[number]['id'];

/** The slash menu's coverage (8.0 section E): what a busy person adds, each with plain words and an icon name. */
export const SLASH_COVERAGE = [
  { id: 'task', label: 'Task', icon: 'task' },
  { id: 'heading', label: 'Heading', icon: 'heading' },
  { id: 'table', label: 'Table', icon: 'table' },
  { id: 'callout', label: 'Callout', icon: 'note' },
  { id: 'meeting', label: 'Meeting notes', icon: 'people' },
  { id: 'decision', label: 'Decision', icon: 'check' },
  { id: 'date', label: 'Date', icon: 'calendar' },
  { id: 'person', label: 'Person', icon: 'person' },
  { id: 'file', label: 'File', icon: 'file' },
  { id: 'chart', label: 'Chart', icon: 'chart' },
] as const;
