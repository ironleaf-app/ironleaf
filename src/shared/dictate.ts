// Dictation heard by the former host app (8.6 voice, second pass, 30 Oct 2026): the pure half both dictation paths
// share. Inside the former host app (the product) a note, the side chat and quick capture hear through the former
// host app's own hearing (the host's transcribeAudio for whole turns, its dictate live sessions for words while
// speaking: the person's provider, then this PC); on its own Ironleaf keeps Windows voice typing. Whatever hears,
// text lands at the cursor as it does now: partial words stream into one tail and the final words replace them. The
// microphone is the one chosen for meetings (Settings shows it on the meeting card), with the pre-roll and tail
// Talk hears with, so one mechanism hears everywhere.

/** Listening → hearing (a voice) → writing (the words being made) → listening, until stopped. */
export type DictatePhase = 'listening' | 'hearing' | 'writing' | 'ended';

export interface DictateState {
  phase: DictatePhase;
  candidateAt: number | null;
  segmentAt: number | null;
  lastVoiceAt: number | null;
  partial: string;
}

export type DictateEvent =
  | { type: 'level'; level: number; at: number }
  | { type: 'partial'; text: string }
  | { type: 'heard'; text: string }
  | { type: 'failed' }
  | { type: 'stop' };

export type DictateEffect =
  | { type: 'startSegment'; from: number }
  | { type: 'endSegment' }
  | { type: 'discardSegment' }
  | { type: 'show'; text: string }
  | { type: 'land'; text: string }
  | { type: 'note'; note: string }
  | { type: 'release' };

/** Talk's own voice levels and tail (half a second of pre-roll, under a second of tail), so dictation hears the same. */
export const DICTATE_TUNING = { startLevel: 0.008, endLevel: 0.005, startMs: 180, endSilenceMs: 850, minSpeechMs: 350, maxSegmentMs: 30000 } as const;

export const dictateInitial = (): DictateState => ({ phase: 'listening', candidateAt: null, segmentAt: null, lastVoiceAt: null, partial: '' });

/** One step of dictation: the next state and what to do (effects) for the session. Pure. */
export function dictateStep(state: DictateState, event: DictateEvent, tuning: typeof DICTATE_TUNING = DICTATE_TUNING): { state: DictateState; effects: DictateEffect[] } {
  const s: DictateState = { ...state };
  const fx: DictateEffect[] = [];
  const t = tuning;
  const at = event.type === 'level' ? event.at : 0;
  switch (event.type) {
    case 'level': {
      if (s.phase === 'ended') break;
      const level = event.level || 0;
      if (s.phase === 'hearing') {
        if (level >= t.endLevel) s.lastVoiceAt = at;
        if (at - (s.segmentAt ?? at) >= t.maxSegmentMs || at - (s.lastVoiceAt ?? at) >= t.endSilenceMs) {
          if ((s.lastVoiceAt ?? 0) - (s.segmentAt ?? 0) >= t.minSpeechMs) {
            s.phase = 'writing';
            fx.push({ type: 'endSegment' });
          } else {
            s.phase = 'listening';
            s.partial = '';
            fx.push({ type: 'discardSegment' });
          }
          s.candidateAt = null;
        }
        break;
      }
      if (s.phase !== 'listening') break;
      if (level < t.startLevel) {
        s.candidateAt = null;
        break;
      }
      if (s.candidateAt === null) s.candidateAt = at;
      if (at - s.candidateAt >= t.startMs) {
        s.phase = 'hearing';
        s.segmentAt = s.candidateAt;
        s.lastVoiceAt = at;
        s.candidateAt = null;
        fx.push({ type: 'startSegment', from: s.segmentAt });
      }
      break;
    }
    case 'partial':
      if (s.phase !== 'hearing' && s.phase !== 'writing') break;
      s.partial = event.text || '';
      fx.push({ type: 'show', text: s.partial });
      break;
    case 'heard': {
      if (s.phase !== 'writing') break;
      const text = (event.text || '').trim();
      s.phase = 'listening';
      s.partial = '';
      if (text) fx.push({ type: 'land', text });
      else fx.push({ type: 'note', note: 'Nothing was heard. Speak, then pause.' });
      break;
    }
    case 'failed':
      if (s.phase === 'ended') break;
      if (s.phase === 'hearing') fx.push({ type: 'discardSegment' });
      s.phase = 'listening';
      s.partial = '';
      s.candidateAt = null;
      break;
    case 'stop':
      if (s.phase === 'ended') break;
      if (s.phase === 'hearing') fx.push({ type: 'discardSegment' });
      s.phase = 'ended';
      s.partial = '';
      fx.push({ type: 'release' });
      break;
  }
  return { state: s, effects: fx };
}

/** Words into what is already there: joined with a space unless the box is empty or already ends with one. */
export function dictateJoin(base: string, addition: string): string {
  const b = base || '';
  const a = addition || '';
  if (!a) return b;
  if (!b || /\s$/.test(b)) return b + a;
  return b + ' ' + a;
}

/** 16-bit mono PCM samples (clipped, never wrapped). */
export function pcm16Of(samples: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

/** Bytes as base64 for a live chunk (the window and the tests alike). */
export function b64Of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

/** Quiet speech lifted before it is heard: gain towards a steady level, capped so nothing clips; near-silence is left
 *  alone, so silence is never lifted into noise a model might hear as words. */
export function boostSamples(samples: Float32Array, target = 0.07, maxGain = 12): Float32Array {
  const out = Float32Array.from(samples);
  let sum = 0;
  let peak = 0;
  for (const x of out) {
    sum += x * x;
    peak = Math.max(peak, Math.abs(x));
  }
  const rms = Math.sqrt(sum / Math.max(1, out.length));
  if (!(rms > 0.002) || !peak) return out;
  const gain = Math.min(maxGain, target / rms, 0.92 / peak);
  if (!(gain > 1)) return out;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * gain));
  return out;
}

// ── Clean writing ────────────────────────────────────────────────────────────────────────────────────────────────────
// Messy speech in, clean writing out, at once: the names kept as written, fillers dropped only where the person chose
// clean text, spoken punctuation and lists written as meant, numbers, dates, times, money and emails formatted, macrons
// right. The same clean the former host app's message box lands.

const NUMBERS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Macrons put right in the common words, whatever way they arrived (hearing models often drop them). */
export function ensureMacrons(text: string): string {
  return String(text || '')
    .replace(/\bwhanau\b/gi, (m) => (m[0] === 'W' ? 'Whānau' : 'whānau'))
    .replace(/\bmaori\b/gi, (m) => (m[0] === 'M' ? 'Māori' : 'māori'))
    .replace(/\bhapu\b/gi, (m) => (m[0] === 'H' ? 'Hapū' : 'hapū'))
    .replace(/\bmorena\b/gi, (m) => (m[0] === 'M' ? 'Mōrena' : 'mōrena'))
    .replace(/\btena koe\b/gi, 'tēnā koe')
    .replace(/\btena koutou\b/gi, 'tēnā koutou');
}

export function cleanDictation(raw: string, { vocabulary = [], clean = true }: { vocabulary?: string[]; clean?: boolean } = {}): string {
  let t = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  // An email said aloud first, so "at" and "dot" are not touched later.
  t = t
    .replace(/\b([a-z][a-z0-9.+-]*)\s+at\s+([a-z0-9-]+)\s+dot\s+(com|org|net|nz|au)\b/gi, '$1@$2.$3')
    .replace(/\b([a-z][a-z0-9.+-]*)\s+at\s+([a-z0-9-]+)\s+dot\s+co\s+dot\s+nz\b/gi, '$1@$2.co.nz');
  // Self-corrections honoured: "meet Tuesday, no, Wednesday" becomes "meet Wednesday".
  t = t.replace(/(\S+),\s*(?:no wait|no|sorry),\s*(\S+)/gi, '$2').replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:no wait|no|sorry),?\s*(\S+)/gi, '$2');
  for (const v of vocabulary || []) {
    const word = String(v || '').trim();
    if (word) t = t.replace(new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), word);
  }
  // Spoken lists: "first … second … third …" written as a list.
  if (/\bfirst\b[\s\S]*\bsecond\b/i.test(t)) {
    t = t
      .replace(/^(?:um\s+|uh\s+)*/i, '')
      .replace(/\bfirst\s+/i, '\n- ')
      .replace(/,?\s*\bsecond\s+/i, '\n- ')
      .replace(/,?\s*\bthird\s+/i, '\n- ')
      .replace(/,?\s*\bfourth\s+/i, '\n- ');
  }
  // Spoken punctuation.
  t = t
    .replace(/\bnew paragraph\b/gi, '\n\n')
    .replace(/\bnew line\b/gi, '\n')
    .replace(/\bfull stop\b/gi, '.')
    .replace(/\bcomma\b/gi, ',')
    .replace(/\bquestion mark\b/gi, '?')
    .replace(/\bexclamation mark\b/gi, '!')
    .replace(/\bcolon\b/gi, ':')
    .replace(/\bsemicolon\b/gi, ';');
  // Fillers and false starts, only where the person chose clean text; otherwise every word stays as said.
  if (clean) t = t.replace(/\b(um+|uh+|ah+|er+)\b[, ]*/gi, '').replace(/,\s*you know,?/gi, '').replace(/\byou know,\s*/gi, '').replace(/(^|[.!?]\s+)like,\s*/gi, '$1');
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
  // Numbers, money, emails, days and months.
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(thirty|fifteen|forty-five|forty five)\b(?=\s*(?:am|pm)\b)/gi, (_m, h: string, mm: string) => String(NUMBERS[h.toLowerCase()]) + '.' + (mm.toLowerCase().startsWith('thirty') ? '30' : mm.toLowerCase().startsWith('fifteen') ? '15' : '45'));
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/gi, (_m, a: string, b: string) => String(NUMBERS[a.toLowerCase()] + NUMBERS[b.toLowerCase()]));
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b(?=\s*(?:am|pm|dollars?|cents?|o'clock|percent|%|people|items|days|weeks|minutes|hours)\b)/gi, (m) => String(NUMBERS[m.toLowerCase()]));
  t = t.replace(/\$?\b(\d+)\s*dollars?(?:\s*(?:and\s*)?(\d+)\s*cents?)?/gi, (_m, d: string, c: string) => '$' + d + (c ? '.' + String(c).padStart(2, '0') : ''));
  t = t.replace(/\$(\d+)\s*cents\b/gi, (_m, c: string) => '$0.' + String(c).padStart(2, '0'));
  t = t.replace(/\b(\d+)\s+cents\b/gi, (_m, c: string) => '$0.' + String(c).padStart(2, '0'));
  t = t.replace(/\b([a-z][a-z0-9.+-]*) at ([a-z0-9-]+) dot (com|co dot nz|org|net|nz|au)\b/gi, (_m, a: string, b: string, c: string) => a + '@' + b + '.' + c.replace(' dot ', '.'));
  t = t.replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, (m) => cap(m.toLowerCase()));
  t = t.replace(/\b(\d+)\s*(am|pm)\b/gi, (_m, n: string, p: string) => n + ' ' + p.toLowerCase());
  t = ensureMacrons(t);
  t = t.replace(/\s+([.,!?;:])/g, '$1');
  // Capitals and a full stop at the end; each line and sentence starts capital.
  t = t
    .split('\n')
    .map((line) => {
      let l = line.trim();
      if (!l) return '';
      const list = l.startsWith('- ');
      if (list) l = '- ' + cap(l.slice(2));
      else l = cap(l);
      l = l.replace(/([.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
      if (!list && l && !/[.!?:]$/.test(l)) l += '.';
      return l;
    })
    .join('\n')
    .trim();
  return t;
}
