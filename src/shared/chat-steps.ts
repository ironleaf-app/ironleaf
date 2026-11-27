// The chat's list of what the assistant did, kept short (18 Oct 2026: the list ran to 40 lines, 32 of them "Looked at
// the cells of Cafe_Opening_Checklist_MASTER.xlsx …" and "…WexleySt.xlsx …" one after the other). A step about the same
// thing as one just before it (the same file looked at again, the same words) is counted on that line instead: "Looked
// at the cells of Cafe_Opening_Checklist_MASTER.xlsx · 12 times". The main side (src/main/ai.ts) and the window
// (src/renderer/src/state/chat.ts) add steps the same way, so the live list and the finished one read alike.

import type { ChatStep } from './types';

/** How far back a step looks for the same thing (steps of other kinds and the model's words in between are passed over). */
const LOOK_BACK = 12;

/** What a step is about: its own key when the tool gave one, else its kind and words. */
export function stepKey(s: ChatStep): string {
  if (s.packAction) return JSON.stringify(s.packAction);
  return s.about ? `${s.kind}|${s.about}` : `${s.kind}|${s.words}`;
}

/**
 * The list with one step added. A step about the same thing as one among the last few of its kind (only the model's
 * words or other things looked at in between: reading two workbooks by turns counts each once) adds to that line's count
 * and moves it to the end (the newest step is last, as the list shows it while it works). The model's own words
 * ("say") are never merged.
 */
export function addStep(list: ChatStep[], step: ChatStep): ChatStep[] {
  if (step.kind === 'say') return step.words ? [...list, step] : list;
  const key = stepKey(step);
  for (let i = list.length - 1, seen = 0; i >= 0 && seen < LOOK_BACK; i--) {
    const s = list[i];
    if (s.kind === 'say') continue;
    seen++;
    if (stepKey(s) === key) {
      const merged: ChatStep = { ...step, times: (s.times ?? 1) + (step.times ?? 1) };
      return [...list.slice(0, i), ...list.slice(i + 1), merged];
    }
    // A write (or a move) is progress: nothing before it merges with what comes after.
    if (s.kind === 'write' || s.kind === 'move') break;
  }
  return [...list, step];
}

/** The words a step shows: with how many times it was done when more than once. */
export function stepWords(s: ChatStep): string {
  return s.times && s.times > 1 ? `${s.words} · ${s.times} times` : s.words;
}

/** How a folded line counts each kind ("2 searches · 2 reads"). Only reads get a verb; the rest count plainly. */
const FOLD_NOUN: Record<string, [string, string]> = { search: ['search', 'searches'], read: ['read', 'reads'], list: ['list', 'lists'], write: ['change', 'changes'], move: ['move', 'moves'], pc: ['folder', 'folders'], error: ['error', 'errors'] };
const FOLD_ORDER = ['search', 'read', 'list', 'write', 'move', 'pc', 'error'];

/**
 * The finished list folded to one line (5 Nov 2026, v8-vault-assistant: it folded to a bare "4 steps", hiding the
 * "knows your notes" evidence one click away). Three or fewer read as one line of their words; more fold to their
 * kinds ("Read 3 notes", "2 searches · 2 reads"); long jobs keep the count beside the kinds. The model's thinking
 * aloud never counts: it shows live only.
 */
export function foldSteps(steps: ChatStep[]): string {
  const shown = steps.filter((s) => s.kind !== 'say');
  if (!shown.length) return '';
  if (shown.length <= 3) return shown.map(stepWords).join(' · ');
  const n = (kind: string) => shown.filter((s) => s.kind === kind).reduce((t, s) => t + (s.times ?? 1), 0);
  const total = shown.reduce((t, s) => t + (s.times ?? 1), 0);
  const kinds = FOLD_ORDER.filter((k) => n(k) > 0);
  if (kinds.length === 1 && kinds[0] === 'read') return `Read ${n('read')} ${n('read') === 1 ? 'note' : 'notes'}`;
  const parts = kinds.map((k) => {
    const c = n(k);
    const [one, many] = FOLD_NOUN[k] ?? ['step', 'steps'];
    return `${c} ${c === 1 ? one : many}`;
  });
  return total > 6 ? `${total} steps · ${parts.join(' · ')}` : parts.join(' · ');
}

/**
 * A move in titles (5 Nov 2026, v8-vault-assistant: steps printed raw full paths, three wrapped lines of them).
 * "Moved Supplier quote harbour to Harbourline Cart Fix · Notes": the note by its title, its new folder by its tail
 * (the top folder is the person's own shelf, never said). Staying in its folder is a rename, not a move.
 */
export function moveWords(from: string, to: string): string {
  const title = (p: string) => String(p).split('/').pop()!.replace(/\.md$/i, '');
  const dir = (p: string) => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '');
  const fromTitle = title(from);
  const toTitle = title(to);
  if (dir(from) === dir(to)) return `Renamed ${fromTitle} to ${toTitle}`;
  const tail = dir(to).split('/').filter(Boolean);
  if (!tail.length) return `Moved ${fromTitle} to the top of your notes`;
  return `Moved ${fromTitle} to ${tail.slice(1).join(' · ') || tail[0]}`;
}
