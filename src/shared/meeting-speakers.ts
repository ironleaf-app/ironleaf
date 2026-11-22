// Telling the speakers apart in a recorded meeting (6 Nov 2026). They record as they do today, with nothing to set up:
// the transcript shows Speaker 1, Speaker 2 and so on instead of one lump of "Others". On a call the microphone stays
// "You" (that split is already certain); in a room with one microphone everyone becomes a numbered speaker. During or
// after the meeting they set a name on each speaker once, and every line takes it. The labels are an extra layer over
// the transcript the recorder already writes (src/shared/recorder.ts): labelPieces relabels pieces from the engine's
// turns, and when the engine fails, runs out of memory or is not ready the pieces stay exactly as they are today (You,
// Others), said once in plain words. A meeting recorded today never gets worse. Names are kept apart from the lines: a
// line says which voice spoke ("Speaker 1"), the note's properties say who each voice is. Naming never rewrites lines
// (so "Speaker 10" can never catch "Speaker 1", a hand-edited line is never touched, and undo only restores the
// names). An older version reading the note sees "Speaker 1" lines and ignores the properties, so it never breaks.
// Nothing about a voice is kept after a meeting apart from the labels on its lines: no voiceprints are stored
// anywhere. Pure: no DOM, no Electron, so the node tests run every rule here.

import { changeProps, isMap, readProps } from './frontmatter';
import type { RecPiece, TranscriptLine } from './recorder';

// ── Speaker ids and their plain words ────────────────────────────────────────────────────────────────────────────────

/** A found voice: "spk1", "spk2", … in the order its voice was first heard. */
export type SpeakerId = string;

/** "spk1" for the first voice heard, then "spk2", … */
export const speakerId = (n: number): SpeakerId => `spk${n}`;

/** Whether a string is a speaker id ("spk1"). */
export const isSpeakerId = (v: unknown): v is SpeakerId => typeof v === 'string' && /^spk([1-9]\d*)$/.test(v);

/** "spk3" back as 3 (null: not one). */
export function speakerNum(id: string): number | null {
  const m = /^spk([1-9]\d*)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** A voice in words a person sees: "Speaker 1". Never "diarisation" or "embedding" on screen. */
export function speakerDisplay(id: string): string {
  const n = speakerNum(id);
  return n === null ? id.slice(0, 40) : `Speaker ${n}`;
}

/** A transcript label back as its voice ("Speaker 1" → "spk1"; null for "You", "Others" and names). Whole words only:
 *  "Speaker 10" never reads as "Speaker 1". */
export function parseSpeakerDisplay(who: string): SpeakerId | null {
  const m = /^\s*Speaker\s+([1-9]\d*)\s*$/i.exec(who);
  return m ? speakerId(Number(m[1])) : null;
}

/** Whether a transcript label is a numbered speaker ("Speaker 2", any case). */
export const isSpeakerDisplay = (who: string): boolean => parseSpeakerDisplay(who) !== null;

/** Said once when the voices couldn't be told apart: the transcript stays as it is today, and all else carries on. */
export function speakersFallbackWords(): string {
  return 'The speakers couldn’t be told apart this time, so the transcript shows You and Others as usual.';
}

// ── Which side a voice was found on ──────────────────────────────────────────────────────────────────────────────────
// A voice found on the microphone side is never merged with one on the PC side: they are clustered apart (the certain
// facts hold), and the clustering itself refuses cross-side merges as well, so even a mixed feed cannot join them.

/** Which sound a voice was found in: the microphone, the PC's sound, or one mixed stream (a room, a crash tail). */
export type SpeakerSide = 'mic' | 'pc' | 'mix';

/** A found voice: its side, and where its voice plays from (a short clip). */
export interface SpeakerMark {
  id: SpeakerId;
  side: SpeakerSide;
  /** Seconds into the recording where the clip starts, and how long it plays. */
  clipAt: number;
  clipLen: number;
}

/** How long a speaker's clip plays (a short clip of their voice, to tell them apart by ear). */
export const SPEAKER_CLIP_SECONDS = 6;

/** A voice's clip inside the recording: clamped to it, never past its end. */
export function clipRange(mark: Pick<SpeakerMark, 'clipAt' | 'clipLen'>, audioSeconds: number): { at: number; len: number } {
  const at = Math.max(0, Math.min(Math.max(0, audioSeconds - 0.5), mark.clipAt));
  return { at: Math.round(at * 10) / 10, len: Math.max(0.5, Math.min(mark.clipLen, Math.max(0, audioSeconds - at))) };
}

// ── The engine's turns on the transcript ─────────────────────────────────────────────────────────────────────────────

/** One stretch the engine gave to a voice: whose, and when (seconds into the recording). */
export interface SpeakerTurn {
  id: SpeakerId;
  start: number;
  end: number;
  side: SpeakerSide;
}

/** The most voices one meeting keeps: past this the nearest voices join, so a person is never shown a crowd. */
export const MAX_SPEAKERS = 8;

/** How much of [a, b) [c, d) share (seconds). */
const overlap = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c));

/** Whether a piece may be given to a numbered voice: never the microphone on a call (that side stays "You", certain),
 *  and never a piece already carrying an imported name (work-meetings transcripts stay as they are). */
export function splittable(sources: 'mic' | 'mic+pc' | 'pc' | undefined, side: RecPiece['side'], who: string | undefined): boolean {
  if (who && !isSpeakerDisplay(who) && who !== 'You' && who !== 'Others') return false;
  if (sources === 'mic+pc') return side === 'pc';
  return true;
}

/** Heard seconds a voice needs inside a piece before its words are cut out as a line of their own: under this it is
 *  a flicker (a cough heard as a voice), never a line. A short interjection ("Right.") still clears it. */
const SPLIT_MIN_SECONDS = 0.35;

/** One voice's run inside a piece: where its first heard second is, and how many seconds of it were heard. */
interface VoiceRange {
  id: SpeakerId;
  from: number;
  covered: number;
}

/** A piece's runs in order (turns clipped to the piece, same voices joined, flickers left out and their neighbours
 *  joined again). The runs drive the split below: each run's share of the heard seconds is its share of the words. */
function voiceRanges(feed: readonly SpeakerTurn[], from: number, to: number): VoiceRange[] {
  const out: VoiceRange[] = [];
  for (const t of [...feed].sort((a, b) => a.start - b.start)) {
    const a = Math.max(from, t.start);
    const b = Math.min(to, t.end);
    if (b <= a) continue;
    const last = out[out.length - 1];
    if (last && last.id === t.id) last.covered += b - a;
    else out.push({ id: t.id, from: a, covered: b - a });
  }
  const kept: VoiceRange[] = [];
  for (const r of out) {
    if (r.covered < SPLIT_MIN_SECONDS) continue;
    const last = kept[kept.length - 1];
    if (last && last.id === r.id) last.covered += r.covered;
    else kept.push({ ...r });
  }
  return kept;
}

/** Words that end with a dot without ending a sentence, as the hearing services write them. */
const NO_SENTENCE_END = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'eg', 'ie', 'am', 'pm', 'no']);

/** A piece's words as sentences (their ends kept; "6 a.m." and "Dr Lee" stay whole). Joined with spaces they give
 *  the words back, so a split never loses or doubles a word. Shared with the meeting page's long summaries (t273). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    if (!'.!?…'.includes(text[i])) continue;
    let j = i + 1;
    while (j < text.length && '.!?…'.includes(text[j])) j++;
    while (j < text.length && '"”’)]'.includes(text[j])) j++;
    if (j < text.length && text[j] !== ' ') continue;
    const before = /([A-Za-z]+)$/.exec(text.slice(at, i))?.[1] ?? '';
    if (text[i] === '.' && (before.length === 1 || NO_SENTENCE_END.has(before.toLowerCase()))) continue;
    out.push(text.slice(at, j).trim());
    at = j;
    i = j - 1;
  }
  if (text.slice(at).trim()) out.push(text.slice(at).trim());
  return out.filter(Boolean);
}

/**
 * An untimed piece's words cut at its voice changes: sentences in order across the runs, each run taking its share
 * of the heard seconds as its share of the words (words themselves when the hearing left no sentence ends to cut
 * at). No speech service the former host app sends a piece to gives its words times (checked 6 Nov 2026,
 * e1-speaker-turns: this PC's model, OpenAI, Gemini and the rest answer words only through
 * src/shared/recorder.ts's route), so without this a twenty-second piece of short traded lines sat under one voice
 * however well the engine heard them apart (the ff7b take: its turns had 31 of 31 lines right, its pieces 16).
 * Null when the words stay one line.
 */
function splitTextAcross(text: string, ranges: readonly VoiceRange[], pieceStart: number): { start: number; text: string; speaker: string }[] | null {
  if (ranges.length < 2) return null;
  const sentences = splitSentences(text);
  const units = sentences.length >= ranges.length ? sentences : text.split(/\s+/).filter(Boolean);
  if (units.length < 2) return null;
  const totalChars = units.reduce((s, u) => s + u.length + 1, 0);
  const totalCovered = ranges.reduce((s, r) => s + r.covered, 0);
  if (!totalChars || !totalCovered) return null;
  const cuts: number[] = [];
  let heard = 0;
  let floor = 0;
  for (let r = 0; r < ranges.length - 1; r++) {
    heard += ranges[r].covered;
    const target = (heard / totalCovered) * totalChars;
    let best = floor;
    let bestOff = Infinity;
    let chars = 0;
    for (let u = 0; u <= units.length; u++) {
      if (u >= floor && Math.abs(chars - target) < bestOff - 1e-9) {
        bestOff = Math.abs(chars - target);
        best = u;
      }
      if (u < units.length) chars += units[u].length + 1;
    }
    cuts.push(best);
    floor = best;
  }
  const segs: { start: number; text: string; speaker: string }[] = [];
  let prev = -Infinity;
  ranges.forEach((range, r) => {
    const words = units.slice(r === 0 ? 0 : cuts[r - 1], r === ranges.length - 1 ? units.length : cuts[r]).join(' ').trim();
    if (!words) return;
    const speaker = speakerDisplay(range.id);
    const last = segs[segs.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${words}`;
      return;
    }
    const start = Math.max(0, Math.round((Math.max(range.from, pieceStart + prev + 0.01) - pieceStart) * 100) / 100);
    prev = start;
    segs.push({ start, text: words, speaker });
  });
  return new Set(segs.map((s) => s.speaker)).size > 1 ? segs : null;
}

/** The one voice heard on a side (null: two voices, or none — nothing certain to claim with). Only the side's
 *  own turns count: a mixed-stream voice never claims another side's pieces. */
function onlyVoice(feed: readonly SpeakerTurn[], side: SpeakerSide): SpeakerId | null {
  const ids = [...new Set(feed.filter((t) => t.side === side).map((t) => t.id))];
  return ids.length === 1 ? ids[0] : null;
}

/**
 * The engine's turns laid over the transcript's pieces as an extra layer: each splittable done piece takes the voice
 * holding most of its seconds; its timed segments each take the voice holding most of their own span, and a piece
 * with no times in its words (every hearing route today) is cut at its voice changes instead (splitTextAcross), so
 * each person's words sit on their own line however short the traded lines are. Pieces the turns say nothing about
 * keep their label, unless one voice alone was heard on their side (then they are its). Gives the pieces, the
 * voices found (each with its clip), and whether anything changed; null when
 * no label moves (no turn touches a splittable piece and no side has one voice alone, or every label already
 * says what the turns say), so the caller
 * keeps the transcript exactly as it is today.
 */
export function labelPieces(
  pieces: readonly RecPiece[],
  turns: readonly SpeakerTurn[],
  sources: 'mic' | 'mic+pc' | 'pc' | undefined,
): { pieces: RecPiece[]; marks: SpeakerMark[]; changed: boolean } | null {
  const clean = turns.filter((t) => isSpeakerId(t.id) && Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start);
  if (!clean.length) return null;
  const bySide = new Map<SpeakerSide, SpeakerTurn[]>();
  for (const t of clean) {
    const list = bySide.get(t.side) ?? [];
    list.push(t);
    bySide.set(t.side, list);
  }
  let changed = false;
  const next = pieces.map((p) => {
    if (p.status !== 'done' || !splittable(sources, p.side, p.who)) return p;
    const side: SpeakerSide = sources === 'mic+pc' ? 'pc' : p.side === 'mic' || p.side === 'pc' ? p.side : 'mix';
    const feed = sources === 'mic+pc' ? [...(bySide.get('pc') ?? []), ...(bySide.get('mix') ?? [])] : [...(bySide.get(side) ?? []), ...(bySide.get('mix') ?? [])];
    if (!feed.length) return p;
    const from = p.start;
    const to = p.start + p.seconds;
    // The voice holding most of the piece.
    const held = new Map<SpeakerId, number>();
    for (const t of feed) {
      const o = overlap(from, to, t.start, t.end);
      if (o > 0) held.set(t.id, (held.get(t.id) ?? 0) + o);
    }
    // One voice heard on this side claims the pieces its turns never touched (18 Nov 2026, t301: a one-to-one
    // call kept stray "Others" lines where the turns said nothing — those are that side's only voice, certain).
    // Two voices, or none heard at all (the engine failed), keep their labels as before.
    const top = held.size ? [...held].sort((a, b) => b[1] - a[1] || speakerNum(a[0])! - speakerNum(b[0])!)[0][0] : onlyVoice(feed, side);
    if (!top) return p;
    const said = speakerDisplay(top) as RecPiece['who'];
    // Untimed words are cut at the voice changes; timed segments each take the voice holding most of their own
    // span. Segments that between them say exactly the piece's words are an earlier cut of those same words, so
    // they are cut again from the whole (better turns may move the split; the same turns remake it exactly).
    const whole = (p.text ?? '').replace(/\s+/g, ' ').trim();
    const joined = (p.segments ?? []).map((s) => s.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const untimed = !p.segments?.length || (!!whole && joined === whole);
    let segments: RecPiece['segments'];
    if (untimed) {
      segments = whole ? (splitTextAcross(whole, voiceRanges(feed, from, to), p.start) ?? undefined) : undefined;
    } else {
      segments = p.segments!.map((s, i) => {
        const a = p.start + Math.max(0, s.start);
        const b = i + 1 < p.segments!.length ? p.start + Math.max(0, p.segments![i + 1].start) : to;
        let best: SpeakerId | null = null;
        let bestHeld = 0;
        for (const t of feed) {
          const o = overlap(a, Math.max(b, a), t.start, t.end);
          if (o > bestHeld) {
            best = t.id;
            bestHeld = o;
          }
        }
        return best ? { ...s, speaker: speakerDisplay(best) } : s;
      });
    }
    // Changed only when a label actually moves (re-running over labelled pieces is a no-op, so callers can relabel
    // whenever a piece lands without rewriting the transcript or refiring their saves).
    const sameSegments = JSON.stringify(segments ?? null) === JSON.stringify(p.segments ?? null);
    if (p.who === said && sameSegments) return p;
    changed = true;
    const nextPiece: RecPiece = { ...p, who: said };
    if (segments) nextPiece.segments = segments;
    else delete nextPiece.segments;
    return nextPiece;
  });
  if (!changed) return null;
  // The voices found, in the order first heard, each with its clip (its first long-enough stretch).
  const order = new Map<SpeakerId, { side: SpeakerSide; at: number }>();
  for (const t of [...clean].sort((a, b) => a.start - b.start)) {
    if (!order.has(t.id)) order.set(t.id, { side: t.side, at: t.start });
    const cur = order.get(t.id)!;
    if (t.end - t.start >= SPEAKER_CLIP_SECONDS && cur.at !== t.start && order.get(t.id)!.at > t.start) order.set(t.id, { side: t.side, at: t.start });
  }
  const marks = [...order].slice(0, MAX_SPEAKERS).map(([id, v]): SpeakerMark => ({ id, side: v.side, clipAt: Math.round(v.at * 10) / 10, clipLen: SPEAKER_CLIP_SECONDS }));
  return { pieces: next, marks, changed };
}

// ── Names on voices ────────────────────────────────────────────────────────────────────────────────────────────────
// A name is set once per voice per meeting and shows on every line that voice spoke. Names live apart from the lines
// (in the note's properties and the job's memory), so naming never rewrites a line, never touches a hand edit, and
// undoes by restoring the names. There is no voice memory: nothing about a voice leaves the meeting.

/** Voice ids to the names set on them ("spk1" → "Sam Okafor"). */
export type SpeakerNames = Record<string, string>;

/** A name as kept: trimmed, one line, link marks out (a name must never make a link of its own), capped. */
export function cleanSpeakerName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Labels that are never a name on a voice ("You" is the microphone on a call, not a person). */
const NOT_A_SPEAKER_NAME = /^(you|yours?|yourself|me|myself|i|other|others?|other people|speaker(\s+\d+)?|none|nobody|no one|unassigned|n\/a|tbc|tbd)$/i;

/** Whether a name may be set on a voice (null: it may; else why not, in plain words). */
export function speakerNameRefused(name: string): string | null {
  const t = cleanSpeakerName(name);
  if (!t) return 'Type a name first.';
  if (NOT_A_SPEAKER_NAME.test(t.replace(/^@/, ''))) return 'That word isn’t a name. Type the person’s name.';
  return null;
}

/** A name set on a voice (the names with it in place; unchanged when it is refused or the same). */
export function setSpeakerName(names: SpeakerNames, id: SpeakerId, name: string): SpeakerNames {
  if (!isSpeakerId(id) || speakerNameRefused(name)) return names;
  const t = cleanSpeakerName(name);
  return names[id] === t ? names : { ...names, [id]: t };
}

/** A voice's name taken away (its lines show "Speaker N" again). */
export function clearSpeakerName(names: SpeakerNames, id: SpeakerId): SpeakerNames {
  if (!(id in names)) return names;
  const next = { ...names };
  delete next[id];
  return next;
}

/** Whether two voices share one name (allowed: one voice split in two still names one person; the minutes say it once). */
export function speakersSharingName(names: SpeakerNames): string[] {
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const [id, name] of Object.entries(names)) {
    const low = name.toLowerCase();
    if (seen.has(low)) dup.push(id);
    else seen.set(low, id);
  }
  return dup;
}

/** The microphone's label ("You") reads as the owner's name wherever a transcript is shown (18 Nov 2026, t301:
 *  the mic is the vault owner by name). "Others" never maps: it names nobody. Kept here, not shared with the
 *  notes' own labels: this module never imports them (they import it). */
const isMicLabel = (who: string): boolean => /^\s*you\s*$/i.test(who);

/** A transcript label as shown: the voice's name when one is set, the microphone in the owner's name when known,
 *  else the label as written ("Speaker 2" stays). */
export function shownWho(who: string | undefined, names: SpeakerNames, me?: string): string | undefined {
  if (!who) return who;
  const id = parseSpeakerDisplay(who);
  if (id) return names[id] ? names[id] : who;
  const mine = typeof me === 'string' ? me.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return mine && isMicLabel(who) ? mine : who;
}

/** Transcript lines as shown: each numbered voice in its name when one is set, the microphone in the owner's name
 *  when known (the lines themselves unchanged). */
export function shownLines(lines: readonly TranscriptLine[], names: SpeakerNames, me?: string): TranscriptLine[] {
  if (!Object.keys(names).length && !me) return [...lines];
  return lines.map((l) => ({ ...l, who: shownWho(l.who, names, me) }));
}

/** Written words with each named voice in its name ("Speaker 1 settled…" reads with the name set on spk1): whole
 *  labels only, so "Speaker 10" never catches "Speaker 1". The stored words are never changed by this: every door
 *  a person reads through (the reading view, the PDF and shared copies, the assistant) shows the name, and naming
 *  or unnaming a voice is all it takes to change them back (6 Nov 2026, the ff3d take: the names sat in the
 *  properties while the Summary and the PDF still said "Speaker 1/2"). */
export function relabelSpeakerMentions(text: string, names: SpeakerNames): string {
  let out = String(text ?? '');
  for (const [id, name] of Object.entries(names)) {
    const n = speakerNum(id);
    if (n === null || !name) continue;
    out = out.replace(new RegExp(`\\bSpeaker\\s+${n}\\b`, 'gi'), () => name);
  }
  return out;
}

/** Every recording's names as one map: a voice two recordings name differently is left out (never guessed). */
export function allSpeakerNames(text: string): SpeakerNames {
  const seen = new Map<string, string>();
  const clash = new Set<string>();
  for (const part of Object.values(readAllSpeakerNames(text)))
    for (const [id, name] of Object.entries(part)) {
      const had = seen.get(id);
      if (had && had.toLowerCase() !== name.toLowerCase()) clash.add(id);
      else seen.set(id, name);
    }
  const out: SpeakerNames = {};
  for (const [id, name] of seen) if (!clash.has(id)) out[id] = name;
  return out;
}

/** The sections the write-up itself makes (its Summary and the rest), where "Speaker N" is our label in our words. */
const MADE_SECTION = /^(summary|decisions|actions|key figures|open|open questions|questions|discussion)$/i;

/** A whole note as a person reads it: every named voice in its name, but only where we wrote the label: the speaker
 *  labels on transcript lines and the sections the write-up made (6 Nov 2026, break-it 11: a person's own
 *  "# Speaker 1 setup for the hall" read with a name in it). Their title, their own sections and the words a
 *  speaker actually said keep "Speaker N" as written. The note on disk keeps "Speaker N", so an older version
 *  still reads it and a name can be changed or taken away without a line being touched. With the owner's name,
 *  the microphone's own "You" labels read as them too (18 Nov 2026, t301: the mic is the vault owner by name). */
export function withSpeakerNames(text: string, me?: string): string {
  const names = allSpeakerNames(text);
  const mine = typeof me === 'string' ? me.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!Object.keys(names).length && !mine) return String(text ?? '');
  let section: 'none' | 'prose' | 'transcript' | 'own' = 'none';
  let inProps = false;
  return String(text ?? '')
    .split('\n')
    .map((line, i) => {
      const bare = line.replace(/\r$/, '');
      if (i === 0 && /^\uFEFF?---[ \t]*$/.test(bare)) inProps = true;
      else if (inProps) {
        if (/^(---|\.\.\.)[ \t]*$/.test(bare)) inProps = false;
        return line;
      }
      if (inProps) return line;
      const h = /^##[ \t]+(.*?)[ \t]*$/.exec(bare);
      if (h) section = /^transcript$/i.test(h[1]) ? 'transcript' : MADE_SECTION.test(h[1]) ? 'prose' : 'own';
      if (section === 'prose') return relabelSpeakerMentions(line, names);
      if (section === 'transcript') {
        let out = line;
        for (const [id, name] of Object.entries(names)) {
          const n = speakerNum(id);
          if (n === null || !name) continue;
          out = out.replace(new RegExp(`^(\\s*>\\s*\\*\\*[^*]+\\*\\*\\s*)\\*Speaker\\s+${n}:\\*`, 'i'), (_m, head) => `${head}*${name}:*`);
        }
        if (mine) out = out.replace(/^(\s*>\s*\*\*[^*]+\*\*\s*)\*You:\*/i, (_m, head) => `${head}*${mine}:*`);
        return out;
      }
      return line;
    })
    .join('\n');
}

/** Voices a name is set on that the written parts (not the transcript's own labels) still call "Speaker N": the
 *  minutes were made before the naming, so making them again is what puts the names into the words on disk. The
 *  transcript's own folded lines never count; a folded Discussion topic's words do (12 Nov 2026, t240: folded
 *  detail still names its speakers). */
export function staleSpeakerLabels(text: string): SpeakerId[] {
  const names = allSpeakerNames(text);
  if (!Object.keys(names).length) return [];
  const lines = String(text ?? '')
    .replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')
    .split(/\r?\n/);
  let section = '';
  const body: string[] = [];
  for (const l of lines) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h && h[1].length <= 2) section = h[2].trim().toLowerCase();
    if (section === 'transcript') continue;
    // Folded lines count only inside the Discussion (a folded topic's words); the person's own quotes elsewhere
    // keep "Speaker N" as written, as before.
    if (/^\s*>/.test(l) && !/^discussion( by topic| topics?)?$/i.test(section)) continue;
    body.push(l);
  }
  const joined = body.join('\n');
  return Object.keys(names)
    .filter((id) => new RegExp(`\\bSpeaker\\s+${speakerNum(id)}\\b`, 'i').test(joined))
    .sort((a, b) => speakerNum(a)! - speakerNum(b)!);
}

/** Name suggestions for a voice: the meeting's people first, then the vault's People, each once, meeting order kept. */
export function speakerSuggestions(meetingPeople: readonly string[], vaultPeople: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...meetingPeople, ...vaultPeople]) {
    const t = p.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 60);
}

// ── Undo ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One naming step back: the names, the voices and their turns as they were (a joined voice splits again). */
export interface SpeakerPast {
  names: SpeakerNames;
  marks: SpeakerMark[];
  turns?: SpeakerTurn[];
}

/** The most naming steps kept back. */
export const SPEAKER_UNDO_KEPT = 50;

/** A step remembered (unchanged steps are not kept twice). */
export function pushSpeakerPast(past: readonly SpeakerPast[], step: SpeakerPast): SpeakerPast[] {
  const last = past[past.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(step)) return [...past];
  return [...past, step].slice(-SPEAKER_UNDO_KEPT);
}

/** The step before this one (null: nothing to undo), and the past without it. */
export function undoSpeakerPast(past: readonly SpeakerPast[]): { step: SpeakerPast; past: SpeakerPast[] } | null {
  if (!past.length) return null;
  return { step: past[past.length - 1], past: past.slice(0, -1) };
}

// ── Keeping names in the note ────────────────────────────────────────────────────────────────────────────────────────
// The note's properties hold each recording's names under its part ("Part 1" for the only or first part, else the
// part's heading), so names survive a restart and a re-run. An older version ignores the properties and shows
// "Speaker N". Notes written before 12 Nov 2026 keep the first part under "" (t240): it still reads, and moves to
// "Part 1" on the next write.

/** The note property holding the recordings' speaker names: a key of our own that nobody would type, in the
 *  app's hyphenated style for its machine properties (6 Nov 2026, break-it 1: "speakers" is a word a person or
 *  another app uses, and naming a voice destroyed theirs). A person's own `speakers:` is never touched, in any
 *  shape; the one exception is our own old nested map under it (only test notes ever had it, never shipped),
 *  which still reads and moves to this key on the next write. */
export const SPEAKERS_PROP = 'neuralvault-speaker-names';

/** Our first key for the same map, read once for the move and never written again. */
const OLD_SPEAKERS_PROP = 'speakers';

/** A part's names out of one property value ({} when it is not our nested map at all; junk reads as none). */
function namesFrom(value: unknown, partKey: string): SpeakerNames {
  const map = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[partKey] : undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out: SpeakerNames = {};
  for (const [id, name] of Object.entries(map as Record<string, unknown>)) {
    if (isSpeakerId(id) && typeof name === 'string' && !speakerNameRefused(name)) out[id] = cleanSpeakerName(name);
  }
  return out;
}

/** Every part's names out of one property value ({} when it is not our nested map). */
function allNamesFrom(value: unknown): Record<string, SpeakerNames> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, SpeakerNames> = {};
  for (const key of Object.keys(value)) {
    const names = namesFrom(value, key);
    if (Object.keys(names).length) out[key] = names;
  }
  return out;
}

/** Whether a `speakers:` value is our old nested map (parts of spk names) rather than a person's own words, list
 *  or map of their own: only ours may move; theirs stays exactly as written. */
function isOurOldMap(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (part) => part && typeof part === 'object' && !Array.isArray(part) && Object.keys(part as Record<string, unknown>).every(isSpeakerId),
  );
}

/** The key a transcript part's names are kept under (its heading when it has one, else "Part N"). */
export function speakerPartKey(index: number, heading?: string): string {
  const h = heading?.trim();
  if (h) return h.slice(0, 120);
  return `Part ${Math.max(0, index) + 1}`;
}

/** A first part kept under our old "" key moved to "Part 1" (the new key's names win a voice both name). */
function withFirstPart(all: Record<string, SpeakerNames>): Record<string, SpeakerNames> {
  if (!all[''] || !Object.keys(all['']).length) return all;
  return { ...all, 'Part 1': { ...all[''], ...(all['Part 1'] ?? {}) } };
}

/** A part's speaker names read back ({} when none were kept; junk reads as none, never an error). Our key first,
 *  our old nested map under `speakers:` still read once for the move; a person's own `speakers:` reads as none.
 *  A first part kept under "" still reads under "Part 1". */
export function readSpeakerNames(text: string, partKey: string): SpeakerNames {
  try {
    const props = readProps(text) as Record<string, unknown>;
    const was = isOurOldMap(props[OLD_SPEAKERS_PROP]) ? namesFrom(props[OLD_SPEAKERS_PROP], partKey) : {};
    const now = namesFrom(props[SPEAKERS_PROP], partKey);
    if (partKey === 'Part 1') {
      const legacy = namesFrom(props[SPEAKERS_PROP], '');
      const legacyOld = isOurOldMap(props[OLD_SPEAKERS_PROP]) ? namesFrom(props[OLD_SPEAKERS_PROP], '') : {};
      return { ...legacyOld, ...legacy, ...was, ...now };
    }
    return { ...was, ...now };
  } catch {
    return {};
  }
}

/** Every part's speaker names read back ({} when none); the old map's parts ride under the new key's, and a
 *  first part kept under "" rides under "Part 1". */
export function readAllSpeakerNames(text: string): Record<string, SpeakerNames> {
  try {
    const props = readProps(text) as Record<string, unknown>;
    const out: Record<string, SpeakerNames> = isOurOldMap(props[OLD_SPEAKERS_PROP]) ? allNamesFrom(props[OLD_SPEAKERS_PROP]) : {};
    for (const [key, names] of Object.entries(allNamesFrom(props[SPEAKERS_PROP]))) out[key] = { ...(out[key] ?? {}), ...names };
    return withFirstPart(out);
  } catch {
    return {};
  }
}

/** The recordings' speaker names kept to the parts still in the note (a re-recorded part's old names go with it;
 *  a first part kept under "" moves to "Part 1" rather than going with it). */
export function pruneSpeakerNames(text: string, keys: readonly string[]): string {
  try {
    const all = withFirstPart(readAllSpeakerNames(text));
    const keep = keys.filter((k) => all[k] && Object.keys(all[k]).length);
    if (keep.length === Object.keys(all).length && keep.every((k) => all[k]) && !all['']) return text;
    const hadOurs = isOurOldMap((readProps(text) as Record<string, unknown>)[OLD_SPEAKERS_PROP]);
    return changeProps(text, (doc) => {
      const map = doc.contents;
      if (!isMap(map)) return;
      const next: Record<string, SpeakerNames> = {};
      for (const k of keep) next[k] = all[k];
      if (Object.keys(next).length) doc.set(SPEAKERS_PROP, doc.createNode(next));
      else doc.delete(SPEAKERS_PROP);
      if (hadOurs) doc.delete(OLD_SPEAKERS_PROP);
    });
  } catch {
    return text;
  }
}

/** Said where a name was set when it cannot be saved into the note (6 Nov 2026, break-it 6: properties another
 *  program wrote, a title with a colon among them, made naming silently do nothing). The name is kept for the
 *  meeting by the caller; this only says why it is not in the note yet. */
export function speakerNamesUnsavedWords(): string {
  return 'That name couldn’t be saved into the note because the properties at the top can’t be read. It is kept for this meeting. Fix the properties in Source mode, then set the name again to save it.';
}

/** A part's speaker names written into the note's properties, saying whether they landed ({} takes the part's
 *  names away; other parts untouched; a person's own `speakers:` untouched in every shape, our old map moved, and
 *  a first part kept under "" moved to "Part 1"). Never writes an empty key. */
export function tryWriteSpeakerNames(text: string, partKey: string, names: SpeakerNames): { text: string; saved: boolean; words: string } {
  const kept: Record<string, string> = {};
  for (const [id, name] of Object.entries(names)) {
    if (isSpeakerId(id) && !speakerNameRefused(name)) kept[id] = cleanSpeakerName(name);
  }
  try {
    const hadOurs = isOurOldMap((readProps(text) as Record<string, unknown>)[OLD_SPEAKERS_PROP]);
    const next = changeProps(text, (doc) => {
      const map = doc.contents;
      if (!isMap(map)) return;
      const all = withFirstPart(readAllSpeakerNames(text));
      delete all[''];
      const key = partKey.trim() ? partKey : 'Part 1';
      if (Object.keys(kept).length) all[key] = kept;
      else delete all[key];
      if (partKey.trim() !== key) delete all[partKey];
      if (Object.keys(all).length) doc.set(SPEAKERS_PROP, doc.createNode(all));
      else doc.delete(SPEAKERS_PROP);
      if (hadOurs) doc.delete(OLD_SPEAKERS_PROP);
    });
    return { text: next, saved: true, words: '' };
  } catch {
    return { text, saved: false, words: speakerNamesUnsavedWords() };
  }
}

/** A part's speaker names written into the note's properties ({} takes the part's names away; other parts untouched). */
export function writeSpeakerNames(text: string, partKey: string, names: SpeakerNames): string {
  return tryWriteSpeakerNames(text, partKey, names).text;
}

// ── The final pass keeping its names ─────────────────────────────────────────────────────────────────────────────────
// Live labels are rough; at the end one pass over the whole recording settles them. A name already set is never lost
// or moved to another voice silently: voices carrying different names are never merged (the clustering is told), a
// split name stays on the longest overlap, and anything uncertain is shown rather than guessed.

/** Pairs the final pass must never merge: voices carrying different names (each pair lowest-first, each once). */
export function nameConstraints(names: SpeakerNames): [SpeakerId, SpeakerId][] {
  const ids = Object.keys(names).filter(isSpeakerId).sort();
  const out: [SpeakerId, SpeakerId][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (names[ids[i]].toLowerCase() !== names[ids[j]].toLowerCase()) out.push([ids[i], ids[j]]);
  }
  return out;
}

/** How the settled voices carry the live ones' names: each settled voice takes the name of the live voice holding
 *  most of its seconds (same side only), a split name staying on the longest overlap; the rest stay unnamed, shown
 *  rather than guessed. Gives the names and which voices lost one (for the notice). */
export function carrySpeakerNames(
  live: readonly SpeakerTurn[],
  settled: readonly SpeakerTurn[],
  names: SpeakerNames,
): { names: SpeakerNames; lost: SpeakerId[] } {
  const settledIds = [...new Set(settled.filter((t) => isSpeakerId(t.id)).map((t) => t.id))];
  const next: SpeakerNames = {};
  for (const id of settledIds) {
    const mine = settled.filter((t) => t.id === id);
    const held = new Map<string, number>();
    for (const s of mine) for (const l of live) {
      if (!isSpeakerId(l.id) || l.side !== s.side || !names[l.id]) continue;
      const o = overlap(s.start, s.end, l.start, l.end);
      if (o > 0) held.set(names[l.id], (held.get(names[l.id]) ?? 0) + o);
    }
    if (held.size) next[id] = [...held].sort((a, b) => b[1] - a[1])[0][0];
  }
  // A name split across settled voices stays on the longest overlap only (the clustering was told not to merge
  // different names, so a split names one person twice at worst — shown, never guessed).
  const byName = new Map<string, SpeakerId[]>();
  for (const [id, name] of Object.entries(next)) {
    const list = byName.get(name.toLowerCase()) ?? [];
    list.push(id);
    byName.set(name.toLowerCase(), list);
  }
  const lost: SpeakerId[] = [];
  for (const [, ids] of byName) {
    if (ids.length < 2) continue;
    const seconds = (id: string) => settled.filter((t) => t.id === id).reduce((s, t) => s + (t.end - t.start), 0);
    const keep = [...ids].sort((a, b) => seconds(b) - seconds(a))[0];
    for (const id of ids) {
      if (id !== keep) {
        delete next[id];
        lost.push(id);
      }
    }
  }
  // A name no settled voice carries is lost too, and named (6 Nov 2026, break-it 4): one whose live voice has no
  // overlap in the settled turns, and the loser when two named voices settle into one (the winner stays on the
  // voice, the loser is named in the notice, so both stay visible for the person to choose between).
  const carried = new Set(Object.values(next).map((n) => n.toLowerCase()));
  for (const [liveId, name] of Object.entries(names)) {
    if (isSpeakerId(liveId) && name && !carried.has(name.toLowerCase()) && !lost.includes(liveId)) lost.push(liveId);
  }
  return { names: next, lost };
}

/** Said when the final pass left a voice unnamed that a name had covered (shown, never guessed). */
export function speakersSettledWords(lost: readonly SpeakerId[]): string {
  if (!lost.length) return '';
  const who = lost.map(speakerDisplay).join(' and ');
  return `The final listen changed the voices, so ${who} ${lost.length === 1 ? 'is' : 'are'} unnamed again. Set the name${lost.length === 1 ? '' : 's'} if you know who it was.`;
}

// ── Joining two voices by hand ─────────────────────────────────────────────────────────────────────────────────────
// The engine sometimes hears one person as two voices. Joining moves every line (and the name, when only one side has
// one) onto the surviving voice; a name both sides have stays. Voices from different sides never join (the certain
// facts hold in the hand as in the engine). Undone like a naming.

/** Two voices joined: every line of `from` moves to `to` (pieces and their timed segments alike). */
export function mergeVoicePieces(pieces: readonly RecPiece[], from: SpeakerId, to: SpeakerId): RecPiece[] {
  if (!isSpeakerId(from) || !isSpeakerId(to) || from === to) return [...pieces];
  const said = speakerDisplay(to);
  return pieces.map((p) => {
    const who = p.who && parseSpeakerDisplay(p.who) === from ? said : p.who;
    const segments = p.segments?.map((s) => (s.speaker && parseSpeakerDisplay(s.speaker) === from ? { ...s, speaker: said } : s));
    return who === p.who && !segments?.some((s, i) => s !== p.segments![i]) ? p : { ...p, ...(who ? { who: who as RecPiece['who'] } : {}), ...(segments ? { segments } : {}) };
  });
}

/** Two voices' names joined: the surviving voice keeps its name, else takes the other's. */
export function mergeVoiceNames(names: SpeakerNames, from: SpeakerId, to: SpeakerId): SpeakerNames {
  if (!isSpeakerId(from) || !isSpeakerId(to) || from === to || !(from in names) && !(to in names)) return names;
  const next = { ...names };
  if (!next[to] && next[from]) next[to] = next[from];
  delete next[from];
  return next;
}

/** Said after two voices join (whose lines moved where). */
export function mergeVoiceWords(from: SpeakerId, to: SpeakerId, name: string | undefined): string {
  return name ? `${speakerDisplay(from)} is now ${name}: every line moved to ${speakerDisplay(to)}.` : `${speakerDisplay(from)} is now part of ${speakerDisplay(to)}.`;
}

// ── Live turns from pieces ─────────────────────────────────────────────────────────────────────────────────────────
// The live pass's turns rebuild from the pieces' own labels (their voice, start and length): after a crash the final
// pass still carries the names set during the meeting, with nothing extra kept on disk.

/** The live pass's turns as the pieces remember them (numbered voices only, in time order). */
export function liveTurnsFromPieces(pieces: readonly RecPiece[], side: SpeakerSide): SpeakerTurn[] {
  return pieces
    .filter((p) => p.who && parseSpeakerDisplay(p.who))
    .map((p) => ({ id: parseSpeakerDisplay(p.who!)!, start: p.start, end: Math.round((p.start + p.seconds) * 1000) / 1000, side }))
    .sort((a, b) => a.start - b.start);
}

/** Turns from labelled lines: each run of one voice with its moments (a line lasts till the next begins, the last
 *  ten seconds). A re-run's names carried on the right voices from the labels already in the note. */
export function turnsFromLines(lines: readonly TranscriptLine[], side: SpeakerSide): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];
  const sorted = [...lines].sort((a, b) => a.at - b.at);
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    const id = l.who ? parseSpeakerDisplay(l.who) : null;
    if (!id) continue;
    const end = i + 1 < sorted.length ? sorted[i + 1].at : l.at + 10;
    const last = turns[turns.length - 1];
    if (last && last.id === id && Math.abs(l.at - last.end) < 0.5) last.end = Math.round(end * 100) / 100;
    else turns.push({ id, start: Math.round(l.at * 100) / 100, end: Math.round(Math.max(end, l.at + 0.5) * 100) / 100, side });
  }
  return turns;
}

// ── Voices for the minutes, the actions and the PDF ─────────────────────────────────────────────────────────────────
// The minutes, the actions and the branded PDF use the names: an unnamed voice stays "Speaker 2" everywhere, the
// minutes never guess a name from a voice, and an action is never given to someone unnamed as if it were known.

/** What the write-up is told about the voices: each numbered voice with its name when one is set. The caution
 *  lives in SPEAKER_ASK, said once (6 Nov 2026, the first real owners run: told flatly "Speaker 1 is Alex" with
 *  twenty-second mixed segments, the model gave every "I'll…" in them to Alex and Kate, six owners wrong of
 *  twelve; the pieces are cut at the voice changes now, e1-speaker-turns, so each line is one stretch of one
 *  voice, and the ask is about not trusting a label over the words, not about mixed segments). */
export function speakersPromptLines(marks: readonly SpeakerMark[], names: SpeakerNames): string[] {
  return marks
    .filter((m) => isSpeakerId(m.id))
    .sort((a, b) => speakerNum(a.id)! - speakerNum(b.id)!)
    .map((m) => (names[m.id] ? `- ${speakerDisplay(m.id)} is ${names[m.id]}.` : `- ${speakerDisplay(m.id)} (not named).`));
}

/** Voices rebuilt from a transcript part's own labels (first heard first, each clip where it first speaks). */
export function marksFromLines(lines: readonly TranscriptLine[], side: SpeakerSide): SpeakerMark[] {
  const first = new Map<SpeakerId, number>();
  for (const l of lines) {
    const id = l.who ? parseSpeakerDisplay(l.who) : null;
    if (id && !first.has(id)) first.set(id, l.at);
  }
  return [...first].sort((a, b) => a[1] - b[1]).slice(0, MAX_SPEAKERS).map(([id, at]): SpeakerMark => ({ id, side, clipAt: Math.round(at * 10) / 10, clipLen: SPEAKER_CLIP_SECONDS }));
}

/** How a voice label may and may not be used (6 Nov 2026, the ff3d take: two mixed clusters were named, and the
 *  Discussion gave four jobs to the wrong people from the labels alone, while every action stayed blank): the
 *  label is a hint about sound, the words decide who. */
const SPEAKER_ASK =
  'A voice label is how a stretch sounded, not proof of who spoke: where people trade quick lines a short line can still sit under the wrong voice, and a stretch the voices could not be told apart in keeps one label for everyone in it, so an "I\'ll…" with other people\'s words around it in one long stretch must never be given to the person that voice is named for. Never give a statement or a job to a named person from the voice label alone. Work out who from the words, the way people at the meeting would: someone addressed by name who answers or agrees next owns what they agreed to, whatever voice label their words carry; a job handed to a person by name in the same breath ("Kate\'s going to…", "Noah will…", "can you…" to a named person) is that person\'s; only a short segment that is plainly one person\'s single turn gives its "I\'ll…" to the voice that spoke it: when that voice is named to a person above, the job is that person\'s; when it is not named yet, "who" is that voice\'s label exactly as written ("Speaker 2"), which never prints as a person and only remembers which voice took the job, so a name set on that voice later fills the owner in. Only the meeting\'s own people can own a job: a name merely mentioned (a supplier, a customer) never does. Where the words do not show who, leave "who" empty and write the point without a name ("The roster needs doing by the 20th"): never "Speaker N will…", never invent a name for a voice, and never write "Others" for one. Blank beats wrong: a wrong owner is worse than none.';

/** The extra lines the write-up is asked with when the transcript tells voices apart (none when it doesn't). */
export function speakersPromptAddition(marks: readonly SpeakerMark[], names: SpeakerNames): string {
  const lines = speakersPromptLines(marks, names);
  if (!lines.length) return '';
  return ['The transcript tells its speakers apart by voice. Who each voice is:', ...lines, SPEAKER_ASK].join('\n');
}

/** The write-up's lines for a note of several recordings: each part's voices under its own heading (numbered voices
 *  start again each recording, so "Speaker 1" means its part's first voice). None when no part tells voices apart. */
export function speakersPromptForParts(parts: readonly { heading?: string; marks: readonly SpeakerMark[]; names: SpeakerNames }[]): string {
  const voiced = parts.filter((p) => speakersPromptLines(p.marks, p.names).length);
  if (!voiced.length) return '';
  if (voiced.length === 1 && !voiced[0].heading) return speakersPromptAddition(voiced[0].marks, voiced[0].names);
  const blocks = voiced.map((p) => [`In ${p.heading || 'the recording'}:`, ...speakersPromptLines(p.marks, p.names)].join('\n'));
  return ['The transcript tells its speakers apart by voice, each recording separately. Who each voice is:', ...blocks, SPEAKER_ASK].join('\n');
}

/** An action's owner from the voice that took it: the name when one is set, else nobody (never "Speaker N" as if
 *  known, never a guess). */
export function actionOwnerFor(who: string | undefined, names: SpeakerNames): string {
  if (!who) return '';
  const id = parseSpeakerDisplay(who);
  if (id) return names[id] ?? '';
  return /^(you|yours?|yourself|me|myself|i|other|others?)$/i.test(who.trim()) ? '' : who.trim().slice(0, 80);
}

// ── Telling voices apart by how they sound ───────────────────────────────────────────────────────────────────────────
// The clustering both passes share: voices as points (their embeddings), joined while they sound alike. It prefers too
// few voices to too many (a rare wrong line annoys less than a crowd), never joins voices from different sides, and
// never joins pairs the final pass forbids (voices carrying different names). Deterministic: the same sounds give the
// same voices, so live and final agree wherever they can.

/** Two voiceprints' likeness (cosine, -1 … 1; 1 is the same voice). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** How alike two voices must sound to count as one (tuned for meetings: fewer, surer voices). */
export const CLUSTER_THRESHOLD = 0.55;

/**
 * Voiceprints joined into voices: each print starts alone, and the two likest voices join while they sound alike
 * enough (their average likeness past the threshold). Voices from different sides never join, nor pairs forbidden
 * (the final pass's named pairs). Past the cap the likest join anyway. Gives each print its voice (0, 1, … in the
 * order first heard). Empty in, empty out. Past CLUSTER_SAMPLE prints the join works on an even sample and the rest
 * take their likest voice, so a long meeting settles in minutes, not hours (the join is cubic in their count).
 */
export function clusterVoices(
  prints: readonly (ArrayLike<number>)[],
  opts: { threshold?: number; cap?: number; sides?: readonly SpeakerSide[]; forbid?: readonly (readonly [number, number])[] } = {},
): number[] {
  const n = prints.length;
  if (!n) return [];
  if (n > CLUSTER_SAMPLE) return clusterSampled(prints, opts);
  return clusterCore(prints, opts);
}

/** Past this many voiceprints the clustering samples (evenly, first and last always in) and assigns the rest. */
export const CLUSTER_SAMPLE = 400;

/** The join itself: each print alone, the two likest joining while alike enough (cubic: sampled above). */
function clusterCore(
  prints: readonly (ArrayLike<number>)[],
  opts: { threshold?: number; cap?: number; sides?: readonly SpeakerSide[]; forbid?: readonly (readonly [number, number])[] },
): number[] {
  const n = prints.length;
  if (!n) return [];
  const threshold = opts.threshold ?? CLUSTER_THRESHOLD;
  const cap = Math.max(1, Math.min(MAX_SPEAKERS, opts.cap ?? MAX_SPEAKERS));
  const sides = opts.sides;
  const forbidden = new Set<string>();
  for (const [a, b] of opts.forbid ?? []) {
    forbidden.add(`${Math.min(a, b)}:${Math.max(a, b)}`);
  }
  // Each voice: its prints, and the voices it must never join (forbidden prints' voices, carried as voices join).
  let voices: { prints: number[]; barred: Set<number> }[] = prints.map((_, i) => ({ prints: [i], barred: new Set<number>() }));
  const indexOf = new Map<number, number>();
  const reindex = () => {
    indexOf.clear();
    voices.forEach((v, i) => v.prints.forEach((p) => indexOf.set(p, i)));
  };
  reindex();
  for (const [a, b] of opts.forbid ?? []) {
    const va = indexOf.get(a);
    const vb = indexOf.get(b);
    if (va === undefined || vb === undefined || va === vb) continue;
    voices[va].barred.add(vb);
    voices[vb].barred.add(va);
  }
  const likeness = (x: number[], y: number[]): number => {
    let sum = 0;
    for (const a of x) for (const b of y) sum += cosine(prints[a], prints[b]);
    return sum / (x.length * y.length);
  };
  const mayJoin = (a: { prints: number[]; barred: Set<number> }, ai: number, b: { prints: number[]; barred: Set<number> }, bi: number): boolean => {
    if (a.barred.has(bi) || b.barred.has(ai)) return false;
    if (!sides) return true;
    const sa = new Set(a.prints.map((p) => sides[p]));
    const sb = new Set(b.prints.map((p) => sides[p]));
    // "mix" joins either (a crash tail belongs nowhere certain); mic and pc never join each other.
    if (sa.has('mic') && sb.has('pc')) return false;
    if (sa.has('pc') && sb.has('mic')) return false;
    return true;
  };
  for (;;) {
    let best: [number, number] | null = null;
    let bestLike = -2;
    for (let i = 0; i < voices.length; i++) {
      for (let j = i + 1; j < voices.length; j++) {
        if (!mayJoin(voices[i], i, voices[j], j)) continue;
        const like = likeness(voices[i].prints, voices[j].prints);
        // The likest pair; ties to the earliest heard, so the same sounds give the same voices.
        if (like > bestLike + 1e-9) {
          bestLike = like;
          best = [i, j];
        }
      }
    }
    if (!best) break;
    if (voices.length <= cap && bestLike < threshold) break;
    const [i, j] = best;
    const joined = { prints: [...voices[i].prints, ...voices[j].prints].sort((a, b) => a - b), barred: new Set<number>() };
    // Every voice's bars carried by print (indices shift as voices join; prints don't): the joined voice keeps every
    // bar either side had, and every survivor keeps its own, all re-mapped below.
    const carried = voices.map((v) => {
      const s = new Set<number>();
      for (const b of v.barred) for (const p of voices[b].prints) s.add(p);
      return s;
    });
    const kept = carried.filter((_, k) => k !== i && k !== j);
    kept.push(new Set<number>([...carried[i], ...carried[j]]));
    voices = voices.filter((_, k) => k !== i && k !== j);
    voices.push(joined);
    reindex();
    voices.forEach((v, k) => {
      v.barred.clear();
      for (const p of kept[k]) {
        const vb = indexOf.get(p);
        if (vb !== undefined && vb !== k) v.barred.add(vb);
      }
    });
  }
  // Voices in the order first heard (0, 1, …).
  const order = [...voices].sort((a, b) => a.prints[0] - b.prints[0]);
  const out = new Array<number>(n);
  order.forEach((v, i) => v.prints.forEach((p) => (out[p] = i)));
  return out;
}

/**
 * The join for more prints than CLUSTER_SAMPLE: the sample clustered as usual, the rest each taking their likest
 * sampled voice by centroid. The certain facts hold for the rest too: a print never joins a voice from the other
 * side, nor one holding its forbidden end (then it starts a voice of its own, so the guards beat the cap). Voices
 * renumbered in the order first heard over all prints. Deterministic: the sample is even, ties to the earliest.
 */
function clusterSampled(
  prints: readonly (ArrayLike<number>)[],
  opts: { threshold?: number; cap?: number; sides?: readonly SpeakerSide[]; forbid?: readonly (readonly [number, number])[] },
): number[] {
  const n = prints.length;
  const at = new Set<number>();
  for (let k = 0; k < CLUSTER_SAMPLE; k++) at.add(Math.min(n - 1, Math.round((k * (n - 1)) / (CLUSTER_SAMPLE - 1))));
  const idx = [...at].sort((a, b) => a - b);
  const pos = new Map<number, number>(idx.map((v, k) => [v, k]));
  const subForbid: [number, number][] = [];
  for (const [a, b] of opts.forbid ?? []) {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (pa !== undefined && pb !== undefined && pa !== pb) subForbid.push([pa, pb]);
  }
  const subOf = clusterCore(idx.map((i) => prints[i]), {
    ...opts,
    ...(opts.sides ? { sides: idx.map((i) => opts.sides![i]) } : {}),
    forbid: subForbid,
  });
  const dim = prints[0].length;
  const members = new Map<number, number[]>();
  subOf.forEach((c, k) => {
    const list = members.get(c) ?? [];
    list.push(idx[k]);
    members.set(c, list);
  });
  const centroid = (mm: readonly number[]): Float64Array => {
    const out = new Float64Array(dim);
    for (const i of mm) {
      const p = prints[i];
      for (let d = 0; d < dim; d++) out[d] += p[d];
    }
    return out;
  };
  const cents = new Map<number, Float64Array>();
  for (const [c, mm] of members) cents.set(c, centroid(mm));
  const barredBy = new Map<number, Set<number>>();
  for (const [a, b] of opts.forbid ?? []) {
    if (!barredBy.get(a)) barredBy.set(a, new Set());
    if (!barredBy.get(b)) barredBy.set(b, new Set());
    barredBy.get(a)!.add(b);
    barredBy.get(b)!.add(a);
  }
  const out = new Array<number>(n);
  subOf.forEach((c, k) => {
    out[idx[k]] = c;
  });
  let nextVoice = subOf.length ? Math.max(...subOf) + 1 : 0;
  for (let i = 0; i < n; i++) {
    if (pos.has(i)) continue;
    let best = -1;
    let bestLike = -2;
    for (const [c, mm] of members) {
      if (opts.sides) {
        const mine = opts.sides[i];
        let clash = false;
        for (const m of mm) {
          const theirs = opts.sides[m];
          if ((mine === 'mic' && theirs === 'pc') || (mine === 'pc' && theirs === 'mic')) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
      }
      const barred = barredBy.get(i);
      if (barred && mm.some((m) => barred.has(m))) continue;
      const l = cosine(prints[i], cents.get(c)!);
      if (l > bestLike + 1e-9) {
        bestLike = l;
        best = c;
      }
    }
    if (best < 0) {
      best = nextVoice++;
      members.set(best, []);
      cents.set(best, centroid([i]));
    }
    out[i] = best;
    members.get(best)!.push(i);
  }
  const first = new Map<number, number>();
  out.forEach((c, i) => {
    if (!first.has(c) || i < first.get(c)!) first.set(c, i);
  });
  const ranked = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
  return out.map((c) => ranked.indexOf(c));
}

/**
 * The live pass's voices: each new voiceprint joins the likest voice it may (same side, alike enough), else starts
 * the next voice. Rough on purpose (the final pass settles it); the certain facts hold from the first line: sides
 * never join, and past the cap the likest joins anyway rather than crowding the card.
 */
export class LiveVoices {
  private readonly voices: { sum: number[]; count: number; side: SpeakerSide }[] = [];
  constructor(
    private readonly threshold = CLUSTER_THRESHOLD,
    private readonly cap = MAX_SPEAKERS,
  ) {}

  /** How many voices so far. */
  get size(): number {
    return this.voices.length;
  }

  /** A voiceprint's voice (0, 1, …), starting a new voice when it sounds like nobody so far. A voice heard
   *  only once is provisional (one short stretch's print can sit well off its person's usual sound), so the
   *  next print may join it a little below the settled line rather than found a second voice for the same
   *  person and leave the first dead (6 Nov 2026, e1-speaker-turns: half a second of "Right," did exactly that,
   *  and the meeting showed 3 voices for 2 people until the final pass). Past the cap (a 1-2-1's 1) the likest
   *  voice takes it: the meeting's count says an extra group is a split, not another person. */
  note(print: ArrayLike<number>, side: SpeakerSide): number {
    let best = -1;
    let bestLike = -2;
    let likest = -1;
    let likestLike = -2;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.side === 'mic' && side === 'pc') continue;
      if (v.side === 'pc' && side === 'mic') continue;
      const like = cosine(print, v.sum);
      if (like > likestLike + 1e-9) {
        likestLike = like;
        likest = i;
      }
      const line = v.count >= 2 ? this.threshold : this.threshold - 0.12;
      if (like >= line && like > bestLike + 1e-9) {
        bestLike = like;
        best = i;
      }
    }
    if (best < 0 && likest >= 0 && this.voices.length >= this.cap) best = likest;
    if (best >= 0) {
      const v = this.voices[best];
      for (let i = 0; i < print.length; i++) v.sum[i] = (v.sum[i] ?? 0) + print[i];
      v.count++;
      if (v.side === 'mix') v.side = side;
      return best;
    }
    this.voices.push({ sum: Array.from(print), count: 1, side });
    return this.voices.length - 1;
  }
}

// ── Who is talking, from what the meeting already knows ────────────────────────────────────────────────────────────
// (12 Nov 2026, the live 1-2-1 with Darcy: one far-side voice split into Speaker 2, 3 and 4, numbered, never named —
// "it should be intelligent in the way it discovers whos talking"). The grouping is told how many others to expect —
// the invite's attendees, else a "1-2-1 with X" title — so one person is never split into numbered voices; past that
// count the likest groups join (the cap both passes already carry, likest first). Names come from the meeting too: in
// a 1-2-1 the one other voice is the one other attendee, and with more people from what is said ("thanks Darcy",
// "Bettina here", someone answering to their name) matched against the invite. Each candidate name carries a
// confidence, and a voice is named only when it is clear; anyone unclear stays numbered, with the invited names
// offered for one-click naming. There is no voice memory: nothing about a voice leaves the meeting (6 Nov 2026).

/** Whether a title is a 1-2-1 ("1-2-1 with Darcy", "1:1", "one-to-one", "one on one"). */
export function isOneToOneTitle(title: string): boolean {
  return /\b1\s*[-–:]\s*2\s*[-–:]\s*1\b|\b1\s*:\s*1\b|\bone[-\s]?to[-\s]?one\b|\bone\s+on\s+one\b/i.test(String(title ?? ''));
}

/** A 1-2-1 title's one other person ("1-2-1 with Darcy Lin" → "Darcy Lin"; null when none is named). The name must
 *  run to the title's end (a trailing bracketed note allowed), so "1-2-1 with the team about hiring" names nobody. */
export function otherNameFromTitle(title: string): string | null {
  if (!isOneToOneTitle(title)) return null;
  const t = String(title).replace(/\s+/g, ' ').trim();
  const word = "[A-Z][\\p{L}'’-]+";
  const after = new RegExp(`(?:\\bwith\\b\\s*|[–—:\\-]\\s*)(${word}(?:\\s+${word}){0,2})\\s*(?:\\(.*\\))?\\s*$`, 'u').exec(t)?.[1];
  if (after) return after;
  return new RegExp(`(${word}(?:\\s+${word}){0,2})\\s+(?:1\\s*[-–:]\\s*2\\s*[-–:]\\s*1|1\\s*:\\s*1|one[-\\s]?to[-\\s]?one|one\\s+on\\s+one)\\b`, 'iu').exec(t)?.[1] ?? null;
}

/** The invite's others: attendees without the recorder themselves (link marks, case and full/first name ignored). */
export function othersFromAttendees(attendees: readonly string[], me?: string): string[] {
  const mine = String(me ?? '')
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .trim()
    .toLowerCase();
  const out: string[] = [];
  for (const a of attendees ?? []) {
    const t = String(a ?? '')
      .replace(/^\[\[|\]\]$/g, '')
      .split('|')[0]
      .split('#')[0]
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!t || t.length < 2) continue;
    const low = t.toLowerCase();
    if (mine && (low === mine || low.startsWith(mine + ' ') || mine.startsWith(low + ' '))) continue;
    if (out.some((o) => o.toLowerCase() === low)) continue;
    out.push(t);
  }
  return out;
}

/** How many others the meeting expects on the call: the invite's attendees without the recorder, else 1 for a
 *  1-2-1 title, else unknown (null — the grouping runs unbounded, as today). */
export function expectedOthers({ title = '', attendees = [], me = '' }: { title?: string; attendees?: readonly string[]; me?: string }): number | null {
  const others = othersFromAttendees(attendees, me);
  if (others.length) return others.length;
  if (isOneToOneTitle(title)) return 1;
  return null;
}

/** How sure one cue is that a voice is a name (0 … 1): a self-introduction ("Bettina here", "I'm Darcy") says it
 *  outright; an answer to being addressed ("thanks Darcy", and Darcy speaks next) is one observation of two — two
 *  answers combine past the clear line (1 − 0.4² = 0.84), one alone never does. */
export const VOICE_CUE_SELF = 0.9;
export const VOICE_CUE_ANSWER = 0.6;
/** A self-introduction of someone outside the invite: trusted only when it repeats (a misheard word rarely does). */
export const VOICE_CUE_STRANGER = 0.7;
/** How sure the 1-2-1 rule is (one other voice on the call, one other attendee: whoever speaks there is them). */
export const VOICE_CUE_ONE_TO_ONE = 0.9;
/** A voice is named only past this combined confidence (independent cues combine as 1 − Π(1 − c)): one
 *  self-introduction, two answers, or the 1-2-1 rule. Below it the voice stays numbered for one-click naming — a
 *  wrong automatic name is worse than "Speaker 2", which the person names in one step once they hear the clip. */
export const VOICE_NAME_CLEAR = 0.8;

/**
 * Voices named from what the meeting already knows: the invite's attendees (and a 1-2-1 title's other person when
 * the invite names nobody), matched against what is said. A voice naming themselves ("Bettina here", "I'm Darcy",
 * "my name is …") names their own voice; a name addressed ("thanks Darcy", "Darcy, …", "…, Darcy", "this is
 * Darcy", "it's Darcy") names the next voice that answers, when it is a different numbered voice; in a 1-2-1 call
 * the one other voice is the one other attendee. Gives the clear names with their confidences; anything unclear,
 * tied, or claimed by two voices stays unnamed. "You" is never named (on a call the recorder is You, never a
 * numbered voice); in a room every voice, recorder included, may be named from what is said.
 */
export function autoVoiceNames(
  lines: readonly TranscriptLine[],
  opts: { attendees?: readonly string[]; title?: string; me?: string; sources?: 'mic' | 'mic+pc' | 'pc' | undefined } = {},
): { names: SpeakerNames; confidence: Record<string, number> } {
  const empty: { names: SpeakerNames; confidence: Record<string, number> } = { names: {}, confidence: {} };
  if (!lines.length) return empty;
  const others = othersFromAttendees(opts.attendees ?? [], opts.me);
  const titled = others.length ? '' : (otherNameFromTitle(opts.title ?? '') ?? '');
  const pool = titled && !others.some((o) => o.toLowerCase() === titled.toLowerCase()) ? [...others, titled] : others;
  const fold = (n: string) => String(n ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const first = (n: string) => fold(n).replace(/\s+/g, ' ').trim().split(' ')[0] ?? '';
  // On a call the recorder is You, never a numbered voice: their own name can never name one.
  const barred = new Set<string>();
  if (opts.sources === 'mic+pc' && opts.me) {
    barred.add(fold(opts.me).replace(/\s+/g, ' ').trim());
    barred.add(first(opts.me));
  }
  /** An invite name a spoken phrase means (full or first-name match, in the invite's own spelling). */
  const meant = (phrase: string): string | null => {
    const p = fold(phrase).replace(/\s+/g, ' ').trim();
    if (!p) return null;
    for (const o of pool) {
      const f = fold(o).replace(/\s+/g, ' ').trim();
      if (p === f || p.split(' ')[0] === f.split(' ')[0]) return o;
    }
    return null;
  };
  const cues = new Map<string, Map<string, number[]>>();
  const cue = (voice: string, name: string, c: number) => {
    if (!isSpeakerId(voice)) return;
    const clean = cleanSpeakerName(name);
    if (!clean || speakerNameRefused(clean)) return;
    if (barred.has(fold(clean).replace(/\s+/g, ' ').trim()) || barred.has(first(clean))) return;
    let m = cues.get(voice);
    if (!m) {
      m = new Map();
      cues.set(voice, m);
    }
    m.set(clean, [...(m.get(clean) ?? []), c]);
  };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The full name or the first name alone ("Darcy Lin" or "Darcy"), as actually spelt in the invite.
  const forms = (name: string): string => {
    const words = String(name).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).map(esc);
    return words.length > 1 ? `(?:${words.join('\\s+')}|${words[0]})` : (words[0] ?? '');
  };
  const nameAlt = pool.map(forms).filter(Boolean).join('|');
  const selfHere = (text: string): string | null => {
    const m = /\b([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})\s+here\b/u.exec(text);
    if (m) return m[1];
    const iam = /\bI'?m\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u.exec(text);
    if (iam) return iam[1];
    return /\bmy\s+name\s+is\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/iu.exec(text)?.[1] ?? null;
  };
  const addressed = (text: string): string | null => {
    if (!pool.length) return null;
    // "thanks Darcy", "thank you Darcy" (a name within the same breath).
    if (new RegExp(`\\bthank(?:s|\\s+you)?\\b[^.?!]{0,40}?\\b(?:${nameAlt})\\b`, 'iu').test(text)) {
      const m = new RegExp(`\\bthank(?:s|\\s+you)?\\b[^.?!]{0,40}?\\b(${nameAlt})\\b`, 'iu').exec(text);
      if (m) return meant(m[1]);
    }
    // A name called out ("Darcy, what do you think?", "What do you think, Darcy?").
    const called = new RegExp(`\\b(${nameAlt})\\s*,|\\bwith\\b[^.?!]{0,20}?\\b(${nameAlt})\\b|,\\s*(${nameAlt})\\b`, 'iu').exec(text);
    if (called) return meant(called[1] ?? called[2] ?? called[3] ?? '');
    // An introduction ("this is Darcy", "it's Darcy"): ambiguous with self-introduction on a call, so it only ever
    // addresses — the answer still names the right voice when they speak next, and never the wrong one.
    const intro = new RegExp(`\\bthis\\s+is\\s+(${nameAlt})\\b(?!\\s*['’]s\\b)|\\bit(?:'s|\\s+is)\\s+(${nameAlt})\\b(?!\\s*['’]s\\b)`, 'iu').exec(text);
    if (intro) return meant(intro[1] ?? intro[2] ?? '');
    return null;
  };
  lines.forEach((l, i) => {
    const id = l.who ? parseSpeakerDisplay(l.who) : null;
    if (id) {
      const self = selfHere(l.text);
      if (self) {
        const invite = meant(self);
        cue(id, invite ?? self, invite ? VOICE_CUE_SELF : VOICE_CUE_STRANGER);
      }
    }
    const to = addressed(l.text);
    if (to) {
      // The next voice that answers, when it is a different numbered voice: two lines ahead at most (an answer
      // comes at once; anything later is another turn). Lines with no speaker say nothing either way.
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        const who = lines[j].who;
        if (!who) continue;
        if (who === l.who) continue;
        const answer = parseSpeakerDisplay(who);
        if (answer) cue(answer, to, VOICE_CUE_ANSWER);
        break;
      }
    }
  });
  // In a 1-2-1 call the one other voice is the one other attendee.
  if (opts.sources === 'mic+pc' && pool.length === 1) {
    const voiced = [...new Set(lines.map((l) => (l.who ? parseSpeakerDisplay(l.who) : null)).filter((v): v is string => !!v))];
    if (voiced.length === 1) cue(voiced[0], pool[0], VOICE_CUE_ONE_TO_ONE);
  }
  // Each voice takes its surest name past the clear line; a name two voices claim stays on neither.
  const best = new Map<string, { name: string; confidence: number }>();
  for (const [voice, m] of cues) {
    let top: { name: string; confidence: number } | null = null;
    let tied = false;
    for (const [name, cs] of m) {
      const c = 1 - cs.reduce((p, x) => p * (1 - x), 1);
      if (!top || c > top.confidence + 1e-9) {
        top = { name, confidence: Math.round(c * 1000) / 1000 };
        tied = false;
      } else if (Math.abs(c - top.confidence) <= 1e-9) tied = true;
    }
    if (top && !tied && top.confidence >= VOICE_NAME_CLEAR) best.set(voice, top);
  }
  const claimed = new Map<string, number>();
  for (const { name } of best.values()) claimed.set(name.toLowerCase(), (claimed.get(name.toLowerCase()) ?? 0) + 1);
  const names: SpeakerNames = {};
  const confidence: Record<string, number> = {};
  for (const [voice, { name, confidence: c }] of best) {
    if ((claimed.get(name.toLowerCase()) ?? 0) > 1) continue;
    names[voice] = name;
    confidence[voice] = c;
  }
  return { names, confidence };
}

/** A long summary in short paragraphs (t273): the note's own breaks kept; a long unbroken stretch splits by
 *  sentence, two to a paragraph. The meeting page's summary and the minutes card read it the same way. */
export function summaryParagraphs(s: string): string[] {
  const out: string[] = [];
  for (const chunk of s.split(/\n\s*\n/)) {
    const t = chunk.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t.length <= 320) {
      out.push(t);
      continue;
    }
    const sentences = splitSentences(t);
    if (sentences.length < 2) {
      out.push(t);
      continue;
    }
    for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(' '));
  }
  return out.length ? out : [s];
}
