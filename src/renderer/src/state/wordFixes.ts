// The word check's memory (5 Nov 2026, minutes: one correction remembered for its project, and the people list
// where it is a person). Next time the transcript is right two ways: the correct spellings ride as hints to the
// speech service (the recorder's hintsFor), and what the service still misspells is fixed as the note is written.
// Kept in the vault's own state ('word-fixes'), never in a note. The window alone touches it; the pure word work is
// src/shared/meeting-words.ts.
import { readTranscript } from '../../../shared/meeting-notes';
import { applyCorrection, findUncertain } from '../../../shared/meeting-words';

export interface WordFixes {
  /** projectKey (a project's path, '' when none) -> wrong spelling (lowercase) -> right spelling. */
  projects: Record<string, Record<string, string>>;
  /** Wrong spelling (lowercase) -> right spelling, for people everywhere. */
  people: Record<string, string>;
}

const EMPTY: WordFixes = { projects: {}, people: {} };
let cache: WordFixes | null = null;
let loading: Promise<WordFixes> | null = null;

const cleanFixes = (raw: unknown): WordFixes => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const cleanMap = (v: unknown): Record<string, string> => {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(o).slice(0, 500)) {
      if (typeof val === 'string' && val.trim() && val.length <= 80 && k.trim()) out[k.trim().toLowerCase()] = val.trim();
    }
    return out;
  };
  const projects: Record<string, Record<string, string>> = {};
  const rp = r?.projects && typeof r.projects === 'object' && !Array.isArray(r.projects) ? (r.projects as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(rp).slice(0, 200)) projects[String(k).slice(0, 500)] = cleanMap(v);
  return { projects, people: cleanMap(r?.people) };
};

/** The remembered fixes, loaded once (empty when never corrected or state won't load). */
export function loadWordFixes(): Promise<WordFixes> {
  if (cache) return Promise.resolve(cache);
  loading ??= (async () => {
    try {
      cache = cleanFixes(await window.nv.state.load('word-fixes'));
    } catch {
      cache = { ...EMPTY, projects: {}, people: {} };
    }
    return cache;
  })();
  return loading;
}

/** Remember one correction: every spelling seen -> the right spelling, for this project (and the people list).
 *  Confirming a spelling (same in and out) is remembered too, so it is known next time. */
export async function rememberFix(projectKey: string | null, from: readonly string[], to: string, isPerson: boolean): Promise<void> {
  const right = to.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!right) return;
  const fixes = await loadWordFixes().catch(() => null);
  if (!fixes) return;
  const key = (projectKey ?? '').slice(0, 500);
  const bucket = fixes.projects[key] ?? {};
  for (const s of from) {
    const wrong = s.trim().toLowerCase();
    if (!wrong) continue;
    bucket[wrong] = right;
    if (isPerson) fixes.people[wrong] = right;
  }
  fixes.projects[key] = bucket;
  try {
    await window.nv.state.save('word-fixes', fixes);
  } catch {
    // Remembering is a convenience; the fix itself already landed in the note.
  }
}

/** One remembered correction taken back (Fix every copy's Undo): the spellings this fix wrote are forgotten,
 *  from the project and, where it went there, the people list. Only entries still holding this fix's spelling go:
 *  a newer correction of the same word is left alone. */
export async function forgetFix(projectKey: string | null, from: readonly string[], to: string, wasPerson: boolean): Promise<void> {
  const right = to.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!right) return;
  const fixes = await loadWordFixes().catch(() => null);
  if (!fixes) return;
  const key = (projectKey ?? '').slice(0, 500);
  const bucket = fixes.projects[key];
  let touched = false;
  for (const s of from) {
    const wrong = s.trim().toLowerCase();
    if (!wrong) continue;
    if (bucket && bucket[wrong] === right) {
      delete bucket[wrong];
      touched = true;
    }
    if (wasPerson && fixes.people[wrong] === right) {
      delete fixes.people[wrong];
      touched = true;
    }
  }
  if (!touched) return;
  try {
    await window.nv.state.save('word-fixes', fixes);
  } catch {
    // Forgetting is a convenience; the note itself is already restored.
  }
}

/** The fixes for a project (its own plus the people list), wrong spelling -> right spelling. Empty until loaded. */
export function fixesFor(projectKey: string | null): Record<string, string> {
  if (!cache) return {};
  const key = projectKey ?? '';
  return { ...cache.people, ...(cache.projects[key] ?? {}) };
}

/** The correct spellings to hint the speech service with (each once). */
export function fixHintWords(projectKey: string | null): string[] {
  return [...new Set(Object.values(fixesFor(projectKey)))].slice(0, 20);
}

/** Remembered fixes applied to words (a transcript line, a note): whole words only, never inside another word. */
export function fixText(text: string, fixes: Record<string, string>): string {
  let out = text;
  for (const [wrong, right] of Object.entries(fixes)) {
    if (wrong && right && out.toLowerCase().includes(wrong.toLowerCase())) out = applyCorrection(out, [wrong], right).text;
  }
  return out;
}

// ── Skipping the list (nothing blocks) ───────────────────────────────────────────────────────────────────────────────

/** A transcript's fingerprint (its shape, not its words): the list stays skipped until this changes. */
export function transcriptFingerprint(parts: readonly { lines: readonly { at: number; text: string }[] }[]): string {
  const words = parts.reduce((s, p) => s + p.lines.reduce((n, l) => n + l.text.trim().split(/\s+/).filter(Boolean).length, 0), 0);
  return `${parts.map((p) => p.lines.length).join(',')}:${words}`;
}

const skipKey = (path: string) => `nv:minutes-skip:${path}`;

/** The list skipped for this transcript (its fingerprint): hidden until the transcript changes. */
export function skipMinutesCheck(path: string, fingerprint: string): void {
  try {
    localStorage.setItem(skipKey(path), fingerprint);
  } catch {
    // Skipping is a convenience only.
  }
}

/** Whether the list stays skipped for this transcript. */
export function minutesCheckSkipped(path: string, fingerprint: string): boolean {
  try {
    return localStorage.getItem(skipKey(path)) === fingerprint;
  } catch {
    return false;
  }
}

/** The skip lifted (the words asked for again). */
export function unskipMinutesCheck(path: string): void {
  try {
    localStorage.removeItem(skipKey(path));
  } catch {
    // Nothing to lift.
  }
}

// ── Before sending or exporting ──────────────────────────────────────────────────────────────────────────────────

/** Words still unsure in a meeting note (0 when none, skipped, or no transcript): Share nudges, never blocks. */
export async function uncertainForShare(path: string, text: string): Promise<number> {
  let parts: ReturnType<typeof readTranscript> = [];
  try {
    parts = text.includes('Transcript') ? readTranscript(text) : [];
  } catch {
    return 0;
  }
  if (!parts.some((p) => p.lines.length)) return 0;
  const ctx = await window.nv.meetings.context(path).catch(() => null);
  if (!ctx?.meeting) return 0;
  if (minutesCheckSkipped(path, transcriptFingerprint(parts))) return 0;
  await loadWordFixes().catch(() => undefined);
  const known = [...(ctx.known?.length ? ctx.known : ctx.people), ...Object.values(fixesFor(ctx.projects[0]?.path ?? null))];
  try {
    return parts.reduce((s, p) => s + findUncertain(p.lines, known).length, 0);
  } catch {
    return 0;
  }
}

// ── The gaps offer, once ─────────────────────────────────────────────────────────────────────────────────────────────

const gapsKey = (path: string) => `nv:minutes-gaps:${path}`;

/** Stretches already offered or heard (their covers joined): offered once. */
export function gapsOffered(path: string): string[] {
  try {
    return (localStorage.getItem(gapsKey(path)) ?? '').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** These stretches offered (or heard): never offered again. */
export function markGapsOffered(path: string, covers: readonly string[]): void {
  try {
    const seen = new Set([...gapsOffered(path), ...covers]);
    localStorage.setItem(gapsKey(path), [...seen].slice(-20).join('\n'));
  } catch {
    // Offering once is a convenience only.
  }
}
