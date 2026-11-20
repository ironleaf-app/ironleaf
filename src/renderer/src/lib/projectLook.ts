// How projects look (the Projects home and project pages, docs/PROJECTS-DESIGN.md): health as a tone, dates people read,
// file kinds as small labels, sizes.

import { formatDue, weekdayDate } from '../../../shared/due-words';
import { isFinished } from '../../../shared/finished';
import { effectiveHealthOf, healthTone as sharedHealthTone, projectStanding, statusReading as sharedReading } from '../../../shared/project-standing';
import type { ProjectCard } from '../../../shared/types';

export type Tone = 'ok' | 'warn' | 'bad' | 'none';

// ── One reading of a status or health word ─────────────────────────────────────────────────────────────
// The reading lives in src/shared/project-standing.ts (one fact, one value, 8 Nov 2026: the Projects page,
// the Graph, the project page and Today all read it, so a word means the same on every screen). These stay
// as delegating wrappers so every existing caller keeps its words; finished-ness itself stays with isFinished
// (src/shared/finished.ts).

/** A status or health in one canonical state: over, held for someone, off track, at risk, on track, or none. */
export type StatusState = 'done' | 'waiting' | 'off-track' | 'at-risk' | 'on-track' | 'none';

/** A status or health word in its canonical state ("Held over" is open, never done; "High" alone is none —
 *  a risk level's High is levelTone). Whole words only, so "Coffee catch-up" is not at risk. */
export function statusReading(words?: string): { state: StatusState; tone: Tone } {
  return sharedReading(words);
}

/** A risk or priority level as a tone: Critical red, High amber, the rest calm. Levels are not statuses:
 *  "High" here warns, while a status of "High" reads none (statusReading). */
export function levelTone(level?: string): Tone {
  const w = String(level ?? '');
  if (/\bcritical\b/i.test(w)) return 'bad';
  if (/\bhigh\b/i.test(w)) return 'warn';
  return 'none';
}

export function healthTone(health?: string): Tone {
  return sharedHealthTone(health);
}

/** The health a card may claim (sweep 023/024: "on track" with the person's own steps late is not on track,
 *  whatever the stored word says; past its due day and not finished, never "on track" either — it left Due
 *  soon, so it shows under Needs attention). The stored word is untouched; what the home shows and filters by
 *  weighs lateMine and the due day with it, through the one standing. */
export function effectiveHealth(c: Pick<ProjectCard, 'health' | 'lateMine'> & Partial<Pick<ProjectCard, 'due' | 'status'>>): string | undefined {
  return effectiveHealthOf({ health: c.health, lateMine: c.lateMine, overdue: dueWords(c.due, c.status)?.tone === 'bad' });
}

/** Health words for a pill: the project's standing, or Active. Finished projects carry no pill at all (their
 *  rows and cards say Finished instead). A health no list reads shows as written; everything else reads the
 *  one standing's words. Always a quiet neutral chip; Off track and Overdue carry a small coral dot instead
 *  of a solid block (3 Nov 2026 sweep D: the solid coral blocks and coral tiles were very loud; audit f F18
 *  and DECISIONS 3: never amber, red or green chips). */
export function healthPill(c: Pick<ProjectCard, 'health' | 'lateMine'> & Partial<Pick<ProjectCard, 'due' | 'status'>>): { words: string; tint: string; attention: boolean } {
  const h = effectiveHealth(c);
  const s = projectStanding({ status: c.status, health: h });
  if (!s.open) return { words: s.words, tint: 'slate', attention: false };
  if (!h) return { words: 'Active', tint: 'slate', attention: false };
  if (s.words === 'Active') return { words: h.charAt(0).toUpperCase() + h.slice(1), tint: 'slate', attention: false };
  return { words: s.words, tint: 'slate', attention: s.tone === 'bad' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date as written in a project (2026-10-31, 31 Oct 2026…) as a time, when it can be read. */
export function readDate(text?: string): number | null {
  if (!text) return null;
  const t = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const dm = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s*(\d{4})?/.exec(t);
  if (dm) {
    const m = MONTHS.findIndex((x) => x.toLowerCase() === dm[2].toLowerCase());
    if (m >= 0) return new Date(dm[3] ? Number(dm[3]) : new Date().getFullYear(), m, Number(dm[1])).getTime();
  }
  // Australian day-first numerics (9.2 uplift F25): 03/04/2026 is 3 Apr, never the US 4 Mar. Date.parse
  // reads them month-first, so numerics never reach it: a numeric that is not a real day-first date reads
  // as nothing rather than as the wrong day.
  const ymd = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})/.exec(t);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])).getTime();
  const num = /^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(t);
  if (num) {
    const day = Number(num[1]);
    const month = Number(num[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const year = num[3] === undefined ? new Date().getFullYear() : num[3].length === 2 ? (Number(num[3]) < 70 ? 2000 + Number(num[3]) : 1900 + Number(num[3])) : Number(num[3]);
      const at = new Date(year, month - 1, day, Number(num[4] ?? 0), Number(num[5] ?? 0), Number(num[6] ?? 0));
      if (at.getDate() === day && at.getMonth() === month - 1) return at.getTime();
    }
    return null;
  }
  if (/^[\d\s.:/\-+T]+$/.test(t)) return null;
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "16 Oct", "16 Oct 2025" (another year). Nothing for a moment that cannot be read (8.7 urgent, 30 Oct 2026):
 *  never a crash on MONTHS[NaN], never "Invalid Date". */
export function shortDate(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** "today", "yesterday", "3 days ago", else the date. Nothing for a moment that cannot be read. */
export function whenAgo(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const day = 86400000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.floor((start.getTime() - new Date(ms).setHours(0, 0, 0, 0)) / day);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff} days ago`;
  return shortDate(ms);
}

/** Whether a project is due soon: still to come within a week (today through the next 7 days), never
 *  overdue and never finished (5 Nov 2026, the plan: display tones no longer separate soon from later —
 *  both read muted — so the "Due soon" filter reads the days, not the tone). */
export function isDueSoon(due?: string, status?: string): boolean {
  if (isFinished(status)) return false;
  const ms = readDate(due);
  if (ms === null) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.round((ms - start.getTime()) / 86400000);
  return days >= 0 && days <= 7;
}

/** A due date in plain words, and whether it needs attention (5 Nov 2026, the plan: the one reader —
 *  "2 days late"/"Yesterday" attention, "Today"/"Tomorrow"/weekday with date muted, one word for late, never
 *  "overdue"). A finished project's (status done) is just its date; what cannot be read shows as written. */
export function dueWords(due?: string, status?: string): { words: string; tone: Tone } | null {
  const ms = readDate(due);
  if (ms === null) return due?.trim() ? { words: due.trim(), tone: 'none' } : null;
  const day = 86400000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const days = Math.round((ms - today) / day);
  const target = new Date(ms);
  if (isFinished(status)) return { words: weekdayDate(target, start), tone: 'none' };
  const read = formatDue(days, target, start);
  return { words: read.words, tone: read.tone === 'attention' ? 'bad' : 'none' };
}

export interface FileKind {
  label: string;
  kind: 'sheet' | 'doc' | 'slides' | 'pdf' | 'image' | 'text' | 'mail' | 'zip' | 'file';
}

export function fileKind(ext: string): FileKind {
  const e = ext.toLowerCase();
  if (['xlsx', 'xlsm', 'xls', 'csv', 'ods'].includes(e)) return { label: e === 'csv' ? 'CSV' : 'XLS', kind: 'sheet' };
  if (['docx', 'doc', 'odt', 'rtf'].includes(e)) return { label: 'DOC', kind: 'doc' };
  if (['pptx', 'ppt', 'odp'].includes(e)) return { label: 'PPT', kind: 'slides' };
  if (e === 'pdf') return { label: 'PDF', kind: 'pdf' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(e)) return { label: 'IMG', kind: 'image' };
  // Every kind its own badge (13 Nov 2026, the picture: a .json file wore TXT).
  if (['md', 'txt', 'json', 'yaml', 'yml'].includes(e)) return { label: e === 'md' ? 'MD' : e === 'json' ? 'JSON' : e === 'txt' ? 'TXT' : 'YAML', kind: 'text' };
  if (['msg', 'eml'].includes(e)) return { label: 'MAIL', kind: 'mail' };
  if (['zip', '7z', 'rar'].includes(e)) return { label: 'ZIP', kind: 'zip' };
  return { label: (e || 'file').slice(0, 4).toUpperCase(), kind: 'file' };
}

/** A project card's one line without the health its pill already says (polish 29 Oct 2026, item 1): "98% · at risk"
 *  becomes "98%", "at risk · Design and pricing" becomes "Design and pricing"; other lines ("Day 4 alcohol-free",
 *  "71 days to the pop-up") are kept as they are. Null when the line was the health alone. */
export function cardLineWords(line: { words: string; tone: string } | undefined, health?: string): { words: string; tone: string } | null {
  if (!line) return null;
  const h = (health ?? '').trim().toLowerCase();
  if (!h) return line;
  const parts = line.words.split(' · ').map((x) => x.trim()).filter(Boolean);
  const kept = parts.filter((x) => x.toLowerCase() !== h);
  if (kept.length === parts.length) return line;
  return kept.length ? { words: kept.join(' · '), tone: 'none' } : null;
}

export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Two letters for a person ("Wesley Stavely" → "WS"), and a steady colour from their name. */
export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))).toUpperCase() || '?';
}

/** A face's hue, steady per name, from the cool green-to-blue range only (9.5 polished, 1 Nov 2026: cool, never
 *  cream or warm tints): every hue-driven avatar reads this, so no face ever tints warm. */
export function personHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return 150 + (h % 100);
}

/** A decorative tile's tint, steady per key, from the cool kit tints only (9.5 polished): avatars, pack tiles,
 *  bookmark tiles and automation tiles share this instead of eight local warm pools. Status tints (ok/warn/bad)
 *  keep their own mapping; this is only for decoration. */
export function hashTint(key: string): 'blue' | 'green' | 'slate' {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (['blue', 'green', 'slate'] as const)[h % 3];
}

/** Words as they read, links shown by their names ("([[2026-10-23 Cross-Team Alignment]])" → "(2026-10-23 Cross-Team Alignment)"). */
export function shownWords(s: string | undefined): string {
  return String(s ?? '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop()!.replace(/\.md$/i, ''))
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

/** The person a "who" names first ("Alex Morgan · Fri 23 Oct, 11:00 AM" → "Alex Morgan"), for the peek. */
export function whoPerson(who: string | undefined): string {
  return shownWords(who)
    .split(/\s+·\s+|\s*\(/)[0]
    .split(/\s+(?:with|and|&)\s+|\s*[/;,]\s*/)[0]
    .trim();
}
