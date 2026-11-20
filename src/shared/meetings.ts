// A meeting note's actions (17 Oct 2026). The lines under its Actions heading, its open tick boxes, "Sam to send
// the quote by Friday", "@Priya chase the lighting vendor" — read into what / who / by when, with the project the note
// belongs to. A meeting in a project has its actions as that project's tasks from the moment they are written
// (t238: no filing, no copies). Read here, on the note's own words, with no model: the plain cases are certain.
// ("Find more with AI" asks the chat's assistant for the rest, shown the same way; nothing is written without the
// person's tick.)
//
// Old notes carry a filed mark — "- [ ] Send the quote — Sam — by Friday → [[Harbour Fit-out]]" — from when actions
// were carried into projects by hand; the vault tidy strips it, and the read still honours it meanwhile.

import { DAY_PHRASE, PART_OF_DAY_RE, calendarDayOf, dayWords, isoDay, looseDayWords, readDay } from './days';
import { linkWords } from './markdown';
import { projectOwnsFolder } from './project-file';
import { ownerCompatible } from './today-count';

export interface MeetingAction {
  /** The line in the note (0 is the first, the properties counted), and the line as written. */
  line: number;
  raw: string;
  what: string;
  who?: string;
  /** The numbered voice ("spk2") that took it, when that voice has no name yet: never shown as a person. */
  voice?: string;
  /** The day as written ("Friday", "24 Oct") and as read from the meeting's date (YYYY-MM-DD) when it could be. */
  whenWords?: string;
  due?: string;
  /** How it was found: under an Actions heading, an open tick box, "Name to …", an @mention, or by the assistant. */
  how: 'actions' | 'task' | 'phrase' | 'mention' | 'assistant';
  /** Already added: the project named in its mark. */
  filedTo?: string;
}

/** Headings whose lines are actions; and Decisions, whose lines never are (a decision isn't a job). Shared with the
 *  meeting write-up (meeting-notes.ts) and the Meetings module (work-meetings.ts), so a section the reader reads is one
 *  the writers write to, never a second section beside it. */
export const ACTION_HEADING = /^(?:\d+[.)]?\s*)?(?:actions?|action\s+items?|action\s+points?|next\s+steps?|to[\s-]?dos?|follow[\s-]?ups?|tasks?|who\s+does\s+what|actions?\s+and\s+owners?)\b/i;
export const DECISION_HEADING = /^(?:\d+[.)]?\s*)?decisions?(\s+made)?\b/i;
/** Headings whose lines are an agenda: ticking one marks it covered, never done as a job (12 Nov 2026, t240:
 *  agenda text is not a task, in any door that reads tasks). "Discussion" on its own is the minutes' write-up,
 *  never an agenda — only "discussion points" said in full counts. */
export const AGENDA_HEADING = /^(?:\d+[.)]?\s*)?(agenda|raise|to raise|items? to raise|topics?|to discuss|discussion points|what we(?:'|’)?ll (?:cover|discuss)|standing agenda|for discussion)\b/i;
/** The meeting template's own example line (Templates/Notes/Meeting notes): never an action. */
const PLACEHOLDER = /^what needs doing\s*[—–-]+\s*who\s*[—–-]+\s*by when$/i;
/** The mark a filed action carries at its end. */
export const FILED_MARK = /\s*(?:→|->)\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/;
/** The mark an action carries when a numbered voice took it but that voice has no name yet (7 Nov 2026, j1:
 *  the write-up runs at Stop, before anyone names a voice, so "Speaker 2: I'll ring them" had no one to give
 *  the job to and naming later changed nothing). It says which voice, never a person: an HTML comment, so no
 *  reader shows it, and naming the voice fills the owner in and takes it away (meeting-notes.ts). */
export const VOICE_MARK = /<!--nv:voice:(spk[1-9]\d*)-->/;
/** A voice mark for a speaker id ("spk2"). */
export const voiceMark = (id: string): string => `<!--nv:voice:${id}-->`;
/** A numbered voice's label standing as an owner ("Speaker 2"): a voice, never a person. */
const SPEAKER_OWNER = /^Speaker\s+([1-9]\d*)$/i;
const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([^\]])\]\s+)?(.*)$/;
const PREFIX = /^(?:action(?:\s+(?:item|point))?|todo|to\s+do|ap|ai)\s*[:\-–—]\s*/i;
/** Capitalised words that start sentences but are never a person ("We to …" isn't someone). */
const NOT_PEOPLE = new Set('i we you they he she it this that these those there here everyone everybody someone somebody nobody all both team need needs want going plan next then also agreed decided remember note please who what when where why how time today tomorrow back due move moved keep make get set check ask call send book add update review talk follow look find try start stop finish order bring take give put use pay run hold confirm chase draft write share email ring meet visit organise organize arrange prepare collect payment collection delivery the a an and or but if so as at on in of for with by from about after before during until our my your their his her its new old more less one two three action actions'.split(' '));
const NAME = "[A-Z][\\p{L}'’-]+(?:\\s+[A-Z][\\p{L}'’-]+)?";
const PHRASE = new RegExp(`^(@?${NAME}(?:\\s*(?:,|and|&)\\s*@?${NAME})*)\\s+(?:to|will|is\\s+to|are\\s+to|needs\\s+to|need\\s+to|has\\s+to|have\\s+to|agreed\\s+to|is\\s+going\\s+to|are\\s+going\\s+to|should|must|can)\\s+(\\S.*)$`, 'u');
const LEAD_NAME = new RegExp(`^(@?${NAME}(?:\\s*(?:,|and|&)\\s*@?${NAME})*)\\s*:\\s+(\\S.*)$`, 'u');
const MENTION = /(^|[\s(])@([\p{L}][\p{L}'’-]*(?:[._][\p{L}][\p{L}'’-]*)?)(?![\p{L}@.]*\.[a-z]{2,})/u;
/** Politeness before the verb ("Please send the quote"): never part of what is asked. */
const POLITE = /^(please|kindly|pls)[,\s]+/i;

const tidy = (s: string) =>
  linkWords(s)
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
const trimEnds = (s: string) => s.replace(/^[\s,;:—–-]+|[\s,;:—–.-]+$/g, '').trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const notAPerson = (name: string) => name.split(/\s*(?:,|and|&)\s*/).some((n) => NOT_PEOPLE.has(n.replace(/^@/, '').split(/\s+/)[0].toLowerCase()));

/** A what to compare by: no case, marks or extra words ("Send the quote." = "send the quote"). */
export const sameWhat = (s: string) =>
  tidy(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Glue words ignored when two deeds are compared by subject: articles, prepositions and day words — verbs and
 *  things stay, so "review the roster" and "send the roster" never match. */
const SUBJECT_GLUE = new Set(
  'the a an and or but of to in on for with by from at as into onto about after before this that these those my your his her their our its it up out off over under today tomorrow monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '),
);

/**
 * The same deed reworded ("receipt v2 review" in the standup, "Send the receipt v2 for review" in What's next;
 * 5 Nov 2026, v8-vault-assistant: one deed listed twice): the shorter's every word inside the longer, and anything
 * added is a lone verb — a bigger deed ("Book flights and hotel") stays its own. Short words with a figure (v2, q3)
 * count: versions tell deeds apart.
 */
export function sameSubject(a: string, b: string): boolean {
  const words = (s: string) => sameWhat(s).split(' ').filter((w) => (w.length > 2 || /\d/.test(w)) && !SUBJECT_GLUE.has(w));
  const aw = words(a);
  const bw = words(b);
  if (!aw.length || !bw.length) return false;
  const [short, long] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  if (!short.every((w) => long.includes(w))) return false;
  const extra = long.filter((w) => !short.includes(w));
  return extra.length === 0 || (extra.length === 1 && isVerbWord(extra[0]));
}

/** Whether two points or jobs read as the same said twice in different words (6 Nov 2026, the Fitzroy run kept the
 *  notes' "Have the roster for opening week done" beside the minutes' "Complete roster for opening week"): most of
 *  the shorter's words inside the longer. Word overlap, never one meeting's words. The minutes' own test, kept
 *  here beside sameWhat so prep tells things apart the same way (6 Nov 2026, o3-meeting-page item 3). */
export function sameJob(a: string, b: string): boolean {
  const words = (s: string) => sameWhat(s).replace(/(\d+)(st|nd|rd|th)\b/g, '$1').split(' ').filter(Boolean);
  const aw = words(a);
  const bw = words(b);
  if (!aw.length || !bw.length) return false;
  if (sameWhat(a) === sameWhat(b)) return true;
  const [shorter, longer] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  const inLonger = new Set(longer);
  const shared = shorter.filter((w) => inLonger.has(w)).length;
  return shared / shorter.length >= 0.7;
}

export interface ReadOptions {
  /** The meeting's day: "by Friday" is the Friday after it. */
  date?: Date;
  /** People the note and its project know (full names): "Sam" becomes "Sam Okafor" when only one Sam is known. */
  people?: string[];
  /** Who "I" and "me" are (the project's owner), when known. */
  me?: string;
}

/** Who, as a known person's full name when the words name exactly one. */
function person(words: string, opts: ReadOptions): string | undefined {
  const names = words
    .split(/\s*(?:,|\band\b|&)\s*/)
    .map((w) => w.replace(/^@/, '').replace(/[._]/g, ' ').trim())
    .filter(Boolean);
  if (!names.length) return undefined;
  const known = opts.people ?? [];
  const out = names.map((n) => {
    if (/^(i|me|myself)$/i.test(n)) return opts.me ?? 'Me';
    // A first name becomes the one full name that starts with it ("Sam" → "Sam Taylor"), even when a bare "Sam" is
    // known too (written as someone's who elsewhere); else the name as known, else as written.
    const first = /\s/.test(n) ? [] : known.filter((k) => /\s/.test(k.trim()) && k.toLowerCase().split(/\s+/)[0] === n.toLowerCase());
    if (first.length === 1) return first[0];
    const exact = known.find((k) => k.toLowerCase() === n.toLowerCase());
    return exact ?? n.split(/\s+/).map(cap).join(' ');
  });
  return out.length === 1 ? out[0] : `${out.slice(0, -1).join(', ')} and ${out.at(-1)}`;
}

/**
 * Whether a lead "Name:" names people (24 Oct 2026, the connected vault's rule): someone the note or project knows (a
 * full name, or a first name only one of them has), "I" or "me", or a whole name of two or more words. "Northgate: the
 * quote lapsed", "Budget: …" and "Tessaly: …" are a place, a topic or a supplier, so the line keeps its words whole.
 * With no people given at all (nothing to judge by), a lead names someone only with fuller evidence: a whole name, or
 * an action's verb after it ("Mia: list …" is Mia's; "Northgate: quote lapsed" keeps its words whole).
 */
function leadNamesPeople(names: string, opts: ReadOptions, rest = ''): boolean {
  const known = (opts.people ?? []).map((p) => p.toLowerCase().trim());
  if (!known.length) {
    const verb = isVerbWord(rest.replace(POLITE, '').split(/\s+/)[0] ?? '');
    return names
      .split(/\s*(?:,|\band\b|&)\s*/)
      .map((n) => n.replace(/^@/, '').trim())
      .filter(Boolean)
      .every((n) => /^(i|me|myself)$/i.test(n) || /\s/.test(n) || verb);
  }
  return names
    .split(/\s*(?:,|\band\b|&)\s*/)
    .map((n) => n.replace(/^@/, '').trim())
    .filter(Boolean)
    .every((n) => {
      const l = n.toLowerCase();
      if (/^(i|me|myself)$/.test(l) || /\s/.test(n)) return true;
      return known.includes(l) || known.filter((k) => k.split(/\s+/)[0] === l).length === 1;
    });
}

const ACTION_VERBS = new Set('add approve arrange ask attach book bring build buy call cancel chase check clean collect confirm contact copy create decide delete deliver design do draft email file find finish fix follow gather get give hold install invite join keep list look make meet move notify order organise organize pay phone photograph plan post prepare present print publish put read remind remove repair reply report respond return review ring run save schedule search send serve set share show sign start stop submit talk tell test tidy try turn update upload use visit wait write'.split(' '));

/** A verb as written: its base form, or a common ending of one ("sending", "chased", "tries"). */
function isVerbWord(word: string): boolean {
  const w = word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!w) return false;
  if (ACTION_VERBS.has(w)) return true;
  const stems = [w.replace(/ies$/, 'y'), w.replace(/(ing|ed)$/, ''), w.replace(/(ing|ed)$/, 'e'), w.replace(/es$/, ''), w.replace(/s$/, ''), w.replace(/(.)\1(ing|ed)$/, '$1')];
  return stems.some((s) => ACTION_VERBS.has(s));
}

/**
 * Whether words read as an action: a verb and a thing to do (Polish round 4, 29 Oct 2026). Never a bare
 * name ("Jesse", "Others"), a heading, a definition ('"Jesse" is Jesse Arlow') or a correction note.
 */
export function looksLikeAction(what: string): boolean {
  const words = tidy(what).replace(POLITE, '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/^corrections?\b/i.test(words[0]) || /^corrected\b/i.test(words[0])) return false;
  if (/^(is|are|was|were|means)\b/i.test(words[1])) return false;
  return isVerbWord(words[0]);
}

/** An action's words read into what / who / by when ("Sam to send the quote by Friday"). */
export function readAction(text: string, opts: ReadOptions = {}): { what: string; who?: string; voice?: string; whenWords?: string; due?: string } | null {
  // Which numbered voice took it, when the line carries the mark: kept apart from who (a voice is never a person).
  let voice = VOICE_MARK.exec(text)?.[1];
  let s = tidy(text.replace(VOICE_MARK, ' ')).replace(PREFIX, '').replace(POLITE, '');
  let who: string | undefined;
  let whenWords: string | undefined;
  // The template's and Ironleaf's own way: "what — who — by when", "what — who · by when".
  const parts = s.split(/\s+[—–]\s+|\s+--\s+/).map((p) => p.trim());
  if (parts.length >= 2) {
    // A comma before a date word splits too ("Priya, due 24 Oct"), so a date in an owner tail is never a person
    // (p16-owner-tail, 4 Nov 2026); any other comma stays inside the name it joins ("Smith, Jones").
    const tail = parts.slice(1).flatMap((p) => p.split(/\s+·\s+/)).flatMap((p) => p.split(/,\s*(?=(?:by|due|before|on)\s+)/i)).map((p) => p.trim()).filter(Boolean);
    const rest: string[] = [];
    for (const p of tail) {
      if (/^(who|when|by when|owner)$/i.test(p)) continue; // the template's own words, not filled in
      if (/^(not assigned|unassigned|none|nobody|no one|n\/a|tbc|tbd)$/i.test(p)) continue; // nobody took it (5 Nov 2026, minutes): neither who nor words
      const day = /^(?:by|due|before|on)\s+(.+)$/i.exec(p) ?? (readDay(p, opts.date) ? [p, p] : null);
      if (day && !whenWords) whenWords = day[1];
      else if (!who && p.split(/\s+/).length <= 4 && (/^@?[A-Z]/.test(p) || /^(me|i)$/i.test(p)) && !notAPerson(p)) who = p;
      else rest.push(p);
    }
    s = [parts[0], ...rest].join(' — ');
  }
  // "Owner: Sam" / "(Sam)" at the end.
  const ownerTag = /\s*[([]?\b(?:owner|who|assigned(?:\s+to)?|lead)\s*[:=]\s*([^)\]]+?)[)\]]?\s*$/i.exec(s);
  if (ownerTag && !who) {
    who = ownerTag[1].trim();
    s = s.slice(0, ownerTag.index);
  }
  // "Sam: send the quote", "Sam to send the quote", "Mia and Sam will…"
  const lead = LEAD_NAME.exec(s);
  if (!who && lead && !notAPerson(lead[1]) && (/^@/.test(lead[1]) || leadNamesPeople(lead[1], opts, lead[2]))) {
    who = lead[1];
    s = lead[2];
  }
  const phrase = PHRASE.exec(s);
  if (!who && phrase && !notAPerson(phrase[1])) {
    who = phrase[1];
    s = phrase[2];
  }
  const mention = MENTION.exec(s);
  if (mention) {
    if (!who) who = mention[2];
    s = (s.slice(0, mention.index) + mention[1] + s.slice(mention.index + mention[0].length)).replace(/^\s*(?:to|will)\s+/i, '');
  }
  const bracket = /\s*\(([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?)\)\s*$/u.exec(s);
  if (!who && bracket && !notAPerson(bracket[1]) && !readDay(bracket[1], opts.date)) {
    who = bracket[1];
    s = s.slice(0, bracket.index);
  }
  if (!whenWords) {
    const day = DAY_PHRASE.exec(s);
    // A day is the when only where an action says so: "by", "before" or "due" anywhere, or a day ending the line ("on
    // Friday", "(next week)"). A day inside a sentence ("Tessaly quote v2.2 lapsed on 19 Oct; reprice") or after what
    // already happened ("signed on Friday") is part of what is said, and stays in it.
    const rest = day ? s.slice(day.index + day[0].length) : '';
    const atEnd = /^[\s.!)]*$/.test(rest);
    const asked = !!day && /^(?:,\s*|\s+)?\(?\s*(?:by|before|due|no\s+later\s+than)\b/i.test(day[0]);
    const happened = !!day && /^(?:,\s*|\s+)?(?:on\s+|[^(]*$)/i.test(day[0]) && /\b[a-z]{3,}ed\s*$/i.test(s.slice(0, day.index));
    if (day && (asked || (atEnd && !happened))) {
      whenWords = (day[1] ?? day[2] ?? day[3]).trim();
      // A part of a day straight after belongs to the when ("by Thursday morning" is one loose phrase,
      // never the coming Thursday with "morning" left in the job: 6 Nov 2026, e2).
      let end = day.index + day[0].length;
      const part = PART_OF_DAY_RE.exec(s.slice(end));
      if (part) {
        whenWords = `${whenWords} ${part[1].toLowerCase()}`;
        end += part[0].length;
      }
      s = `${s.slice(0, day.index)} ${s.slice(end)}`.replace(/\s+([,;])/g, '$1');
      // The day's lead word left dangling ("Book the room for next Tuesday" read "Book the room for",
      // 12 Nov 2026, structure N7): for, to and from belong to the day, never to what is left.
      s = s.replace(/\s+(for|to|from)\s*$/i, '');
    }
    // A comma tail with loose words no day phrase reads (", by opening morning", as the notes step now
    // writes it, 6 Nov 2026, e2): the words are the when, whole, at the line's end.
    if (!whenWords) {
      const comma = /,\s+(?:by|due|before|on)\s+(.+?)\s*$/i.exec(s);
      if (comma && comma[1].split(/\s+/).length <= 5) {
        whenWords = comma[1].trim();
        s = s.slice(0, comma.index);
      }
    }
  }
  const what = cap(trimEnds(s.replace(/\s+/g, ' ')));
  if (who && /^(not assigned|unassigned|none|nobody|no one|n\/a|tbc|tbd)$/i.test(who.trim())) who = undefined; // nobody took it, however it was said
  // A voice label as the owner, however it got there, is the voice that took it, never a person (7 Nov 2026, j1).
  const saidVoice = who ? SPEAKER_OWNER.exec(who.trim()) : null;
  if (saidVoice) {
    voice = voice ?? `spk${saidVoice[1]}`;
    who = undefined;
  }
  if (!what || PLACEHOLDER.test(text.trim()) || /^(none|nil|n\/a|nothing(\s+(new|this\s+week|yet))?|tbc|tbd|what needs doing)\.?$/i.test(what)) return null;
  // Loose words carry no firm day (6 Nov 2026, e2, as the minutes and the PDF already keep it: "by
  // Friday" said on a Friday, "next week", "Thursday morning"): judged against the meeting's day.
  const due = whenWords && !looseDayWords(whenWords, opts.date ?? new Date()) ? readDay(whenWords, opts.date ?? new Date()) : null;
  return { what, ...(who ? { who: person(who, opts) } : {}), ...(voice ? { voice } : {}), ...(whenWords ? { whenWords: whenWords.replace(/^./, (c) => c.toUpperCase()) } : {}), ...(due ? { due: isoDay(due) } : {}) };
}

/** The lines of the properties at the top (they are never actions). */
function frontLines(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < Math.min(lines.length, 400); i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return i + 1;
  return 0;
}

/**
 * Every action in a meeting note, in order, each once: the lines under an Actions heading, open tick boxes anywhere,
 * "Name to …" lines that are clearly jobs (a person the note knows, or a day to do it by), and list lines with an
 * @mention. Ticked boxes, Decisions and the Agenda are left out (12 Nov 2026, t240: agenda text is not a task).
 * A filed line carries `filedTo`.
 */
export function findActions(text: string, opts: ReadOptions = {}): MeetingAction[] {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const out: MeetingAction[] = [];
  const seen: { key: string; who?: string }[] = [];
  const known = new Set((opts.people ?? []).flatMap((p) => [p.toLowerCase(), p.toLowerCase().split(/\s+/)[0]]));
  let section: 'actions' | 'decisions' | 'agenda' | 'other' = 'other';
  let actionLevel = 0;
  let fence = false;
  for (let i = frontLines(lines); i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    // A bold line on its own works as a heading too ("**Actions**", "Actions:"), as does a bare line that is exactly
    // the heading's words ("Actions", "Decisions" standing alone).
    const pseudo = !heading && /^\s*(?:\*\*|__)?([A-Za-z][\w\s&]{2,40}?)(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/.exec(line);
    const bare = !heading && !/[:*_]/.test(line) && /^(actions?|action items?|action points?|next steps?|to[\s-]?dos?|follow[\s-]?ups?|tasks?|who does what|actions? and owners?|decisions?( made)?|agenda|standing agenda)$/i.test(line.trim());
    if (heading || bare || (pseudo && (ACTION_HEADING.test(pseudo[1]) || DECISION_HEADING.test(pseudo[1]) || AGENDA_HEADING.test(pseudo[1])) && /[:*_]/.test(line))) {
      const words = heading ? heading[2] : pseudo ? pseudo[1] : line.trim();
      const level = heading ? heading[1].length : 7;
      if (ACTION_HEADING.test(words)) {
        section = 'actions';
        actionLevel = level;
      } else if (DECISION_HEADING.test(words)) section = 'decisions';
      else if (AGENDA_HEADING.test(words)) section = 'agenda';
      else if (section !== 'actions' || level <= actionLevel) section = 'other';
      continue;
    }
    // An agenda item ticked is covered, never done as a job: no line under an agenda heading is an action.
    if (section === 'agenda') continue;
    if (!line.trim()) continue;
    // A question line is never an action, wherever it sits (t238: `- ?` is the Questions kind's own mark).
    if (/^\s*(?:[-*+]|\d+[.)])\s+\?\s+/.test(line)) continue;
    const item = LIST.exec(line);
    const box = item?.[2];
    if (box !== undefined && box !== ' ') continue; // ticked, cancelled or moved
    let body = item ? item[3] : line.trim();
    const nested = !!item && item[1].replace(/\t/g, '  ').length >= 2;
    const filed = FILED_MARK.exec(body);
    if (filed) body = body.slice(0, filed.index);
    let how: MeetingAction['how'] | null = null;
    if (section === 'actions' && (item ? !nested || box === ' ' : !/^[>|]/.test(line.trim()))) how = 'actions';
    else if (box === ' ' && section !== 'decisions') how = 'task';
    else if (section !== 'decisions' && (item || PREFIX.test(body))) {
      const t = tidy(body).replace(PREFIX, '');
      if (PREFIX.test(tidy(body))) how = 'phrase';
      const p = PHRASE.exec(t) ?? LEAD_NAME.exec(t);
      if (!how && p && !notAPerson(p[1])) {
        const names = p[1].split(/\s*(?:,|and|&)\s*/).map((n) => n.replace(/^@/, '').toLowerCase());
        if (names.every((n) => known.has(n) || known.has(n.split(/\s+/)[0])) || DAY_PHRASE.test(p[2])) how = 'phrase';
      }
      if (!how && item && MENTION.test(t)) how = 'mention';
    }
    if (!how) continue;
    const read = readAction(body, opts);
    if (!read) continue;
    // Lines the person put under an Actions heading are theirs to offer; only the clear non-actions
    // (a bare name, a definition, a correction) are left out there. Lines found anywhere else (a tick
    // box in passing, a "Name to …" phrase, an @mention) must read as an action: a verb and a thing to do.
    if (how === 'actions' ? /^\S+$/.test(read.what.trim()) || /^corrections?\b/i.test(read.what) || /^corrected\b/i.test(read.what) || /^\S+\s+(is|are|was|were|means)\b/i.test(read.what) : !looksLikeAction(read.what)) continue;
    const key = sameWhat(read.what);
    // Each job once — but another owner's same words are another job (t179), never a re-telling.
    if (!key || seen.some((s) => s.key === key && ownerCompatible(s.who, read.who))) continue;
    seen.push({ key, ...(read.who ? { who: read.who } : {}) });
    out.push({ line: i, raw: line, ...read, how, ...(filed ? { filedTo: filed[1].trim().split('/').pop()!.replace(/\.md$/i, '') } : {}) });
  }
  return out;
}

/** A note that holds a meeting: its type, a meeting tag, a Meetings folder, or a meeting's name. An explicit type that
 *  isn't a meeting's (5 Nov 2026, v8-vault-assistant: a note named Kickoff with `type: note` counted as a meeting)
 *  wins over the folder and name guesses; a meeting tag still counts, as the person put it there. */
export function isMeetingNote(path: string, props: Record<string, unknown> = {}): boolean {
  const type = String(props.type ?? '').toLowerCase();
  if (/^(meeting|meeting notes?|minutes|catch-?up|1:1|one-on-one|workshop)$/.test(type)) return true;
  const tags = (Array.isArray(props.tags) ? props.tags : typeof props.tags === 'string' ? props.tags.split(/[,\s]+/) : []).map((t) => String(t).replace(/^#/, '').toLowerCase());
  if (tags.some((t) => /^(meetings?|minutes|catch-?ups?|stand-?ups?)$/.test(t))) return true;
  if (type.trim()) return false;
  const parts = path.split('/');
  if (parts.slice(0, -1).some((f) => /^(?:\d+[\s._-]*)?(meetings?|minutes|catch-?ups?|stand-?ups?|kick-?offs?|workshops?|retros?(pectives)?)$/i.test(f))) return true;
  const name = (parts.at(-1) ?? '').replace(/\.md$/i, '');
  return /\b(meeting|minutes|catch-?up|stand-?up|kick-?off|workshop|one-on-one|1:1|retro(spective)?)\b/i.test(name);
}

/** The day a meeting was held: its `date` property, a date in its name, else `fallback` (when it was made). */
export function meetingDate(path: string, props: Record<string, unknown> = {}, fallback: Date = new Date()): Date {
  const prop = props.date ?? props.when ?? props.day;
  // A YAML date is midnight UTC: its calendar day is the day written, read here as that day's local start.
  const fromProp = typeof prop === 'string' ? readDay(prop.slice(0, 40), fallback) : prop instanceof Date ? (calendarDayOf(prop) ? readDay(calendarDayOf(prop)!, fallback) : null) : null;
  if (fromProp) return fromProp;
  const name = path.split('/').pop() ?? '';
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(name);
  return (iso && readDay(iso[1], fallback)) || fallback;
}

/** One person, once (5 Nov 2026, p4-brand-doc-faults: "Ottilie Vu" in the properties and "Ottilie" in a "With" line
 *  printed twice): exact names once (case-insensitive, the first kept), and a bare first name dropped when exactly one
 *  fuller name starts with it ("Ottilie" with "Ottilie Vu"), in any order. Two fullers sharing a first name keep the bare
 *  one too: it could be either. */
export function dedupePeople(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names) {
    const t = String(n ?? '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  const uniq = [...seen.values()];
  const firstOf = (n: string) => n.split(/\s+/)[0].toLowerCase();
  const single = (n: string) => !/\s/.test(n.trim());
  const fullCount = new Map<string, number>();
  for (const n of uniq) if (!single(n)) fullCount.set(firstOf(n), (fullCount.get(firstOf(n)) ?? 0) + 1);
  return uniq.filter((n) => !single(n) || fullCount.get(n.toLowerCase()) !== 1);
}

/** People the note names in its properties (attendees: [Mia Tran, Sam Okafor]) and its "Who came:" line. */
export function notePeople(text: string, props: Record<string, unknown> = {}): string[] {
  const out = new Set<string>();
  for (const key of ['attendees', 'people', 'who', 'participants', 'with']) {
    const v = props[key];
    for (const x of Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,;]\s*/) : []) {
      const name = linkWords(String(x)).replace(/\s+/g, ' ').trim();
      if (name && name.length < 60) out.add(name);
    }
  }
  const came = /^\s*(?:\*\*)?(?:who came|attendees|present|attending|with)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/im.exec(text);
  if (came) for (const x of came[1].split(/\s*(?:,|;|\band\b|&)\s*/)) if (/^[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2}$/u.test(x.trim())) out.add(x.trim());
  return dedupePeople([...out]);
}

export interface ProjectRef {
  path: string;
  name: string;
}
export interface ProjectChoice extends ProjectRef {
  why: 'property' | 'folder' | 'link';
}

/**
 * The projects a note belongs to, the likeliest first: its `project` property, the project whose folder it's in, then the
 * projects it links to (in the order it names them). `resolve` turns a link's words into a note's path.
 */
export function projectsFor(note: { path: string; props?: Record<string, unknown>; links?: string[] }, projects: ProjectRef[], resolve: (target: string) => string | null = () => null): ProjectChoice[] {
  const out: ProjectChoice[] = [];
  const add = (p: ProjectRef | undefined, why: ProjectChoice['why']) => {
    if (p && p.path !== note.path && !out.some((x) => x.path === p.path)) out.push({ ...p, why });
  };
  const byWords = (words: string) => {
    const t = words.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    if (!t) return undefined;
    const path = resolve(t);
    return projects.find((p) => p.path === path) ?? projects.find((p) => p.name.toLowerCase() === t.toLowerCase() || p.path.toLowerCase().replace(/\.md$/, '').endsWith(`/${t.toLowerCase()}`));
  };
  const prop = note.props?.project ?? note.props?.projects;
  for (const v of Array.isArray(prop) ? prop : prop ? [prop] : []) add(byWords(String(v)), 'property');
  for (const p of projects) {
    // Only an owned folder suggests (5 Nov 2026, u3 moving-in: the one project-owner confidence).
    if (!projectOwnsFolder(p.path)) continue;
    const dir = p.path.slice(0, p.path.lastIndexOf('/') + 1);
    if (note.path.startsWith(dir) && !/\/(Activity|Tasks)\//.test(`/${note.path.slice(dir.length)}`)) add(p, 'folder');
  }
  for (const target of note.links ?? []) add(projects.find((p) => p.path === target) ?? byWords(target), 'link');
  return out;
}

/** The filed marks taken off every line that carries one (t238: meetings file nothing any more — a meeting in a
 *  project has its actions as that project's tasks — so the vault tidy strips the old " → [[Project]]" marks). */
export function unmarkFiled(text: string): string {
  return String(text ?? '')
    .split('\n')
    .map((l) => {
      const cr = l.endsWith('\r') ? '\r' : '';
      return l.replace(/\r$/, '').replace(FILED_MARK, '').replace(/\s+$/, '') + cr;
    })
    .join('\n');
}

/** An action as a next step in the project file (its day as project files keep them: "24 Oct"). */
export function asNextStep(a: Pick<MeetingAction, 'what' | 'who' | 'whenWords' | 'due'>, today: Date = new Date()): { what: string; who?: string; when?: string } {
  const due = a.due ? readDay(a.due, today) : null;
  const when = due ? dayWords(due, today) : a.whenWords;
  return { what: a.what, ...(a.who ? { who: a.who } : {}), ...(when ? { when } : {}) };
}

/**
 * The assistant's reply ("Find more with AI") read as actions: JSON {"actions":[{"what","who","when","quote"}]}, each
 * kept only when its quote is words from the note (so it can be marked there) and it isn't one already found.
 */
export function readAssistantActions(reply: unknown, text: string, found: MeetingAction[], opts: ReadOptions = {}): MeetingAction[] {
  const list = reply && typeof reply === 'object' && Array.isArray((reply as { actions?: unknown }).actions) ? (reply as { actions: unknown[] }).actions : [];
  const lines = text.split(/\r?\n/);
  const taken = new Set(found.map((a) => a.line));
  const words = new Set(found.map((a) => sameWhat(a.what)));
  const out: MeetingAction[] = [];
  for (const raw of list.slice(0, 30)) {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const what = typeof a.what === 'string' ? cap(trimEnds(tidy(a.what))).slice(0, 300) : '';
    const quote = typeof a.quote === 'string' ? a.quote.trim().slice(0, 400) : '';
    if (!what || !quote || !looksLikeAction(what)) continue;
    const line = lines.findIndex((l, i) => !taken.has(i) && l.toLowerCase().includes(quote.toLowerCase()));
    if (line < 0 || FILED_MARK.test(lines[line]) || words.has(sameWhat(what))) continue;
    const whenWords = typeof a.when === 'string' && a.when.trim() ? a.when.trim().slice(0, 40) : undefined;
    const due = whenWords && !looseDayWords(whenWords, opts.date ?? new Date()) ? readDay(whenWords, opts.date ?? new Date()) : null;
    const who = typeof a.who === 'string' && a.who.trim() ? person(a.who.trim().slice(0, 80), opts) : undefined;
    taken.add(line);
    words.add(sameWhat(what));
    out.push({ line, raw: lines[line], what, ...(who ? { who } : {}), ...(whenWords ? { whenWords } : {}), ...(due ? { due: isoDay(due) } : {}), how: 'assistant' });
  }
  return out;
}
