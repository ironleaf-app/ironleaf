// The suggested home of an Inbox capture (8.0 Job C, 29 Oct 2026; SPEC section C: "each capture shows a suggested
// home (project or module, from its words)"). Pure: no files, no DOM. The main side (src/main/life.ts) suggests with
// the vault's own structure through src/shared/inbox.ts; this module is the same suggestion worked out wherever the
// vault's projects, people and modules are already in hand (the Inbox page, from the index in memory), with a
// module's records added: a capture that names a module or one of its records is offered that module first, in the
// module's own words when it gives them. A suggestion is only ever an offer: filing still goes through the one
// filing path, and nothing here gates anything on the capture's words.

import { matchText, type CaptureProject } from './capture';
import { suggestFiling, type FilingTarget, type InboxItem, type InboxSuggestion, type SuggestContext } from './inbox';

export type { FilingTarget, InboxSuggestion };

/** A module a capture can be filed into, as the suggestion needs it: its name and the names of its records. */
export interface SuggestModule {
  id: string;
  name: string;
  /** Its records' names ("Wagon", "Telstra bill"): a capture naming one is offered the module. */
  records?: { name: string; path?: string; label?: string }[];
}

export interface InboxSuggestContext extends SuggestContext {
  modules?: SuggestModule[];
}

/**
 * Where a capture probably goes, the likeliest first (at most three): a module it names or whose record it names,
 * then what the vault's own structure says (src/shared/inbox.ts suggestFiling: a note or project it links to, a
 * project or person it names, that thing's area). Nothing when nothing in it points anywhere.
 */
export function suggestInboxHome(item: Pick<InboxItem, 'words' | 'text' | 'links' | 'task'>, ctx: InboxSuggestContext): InboxSuggestion[] {
  const out: InboxSuggestion[] = [];
  const add = (s: InboxSuggestion) => {
    const key = `${s.target.kind}:${s.target.path ?? s.target.area ?? s.target.module ?? ''}`;
    if (!out.some((x) => `${x.target.kind}:${x.target.path ?? x.target.area ?? x.target.module ?? ''}` === key)) out.push(s);
  };
  // A module, or one of its records, named in the capture's own words.
  const hay = matchText(item.words || item.text);
  for (const m of ctx.modules ?? []) {
    const record = (m.records ?? []).find((r) => {
      const name = matchText(r.name).trim();
      return name.length >= 3 && hay.includes(` ${name} `);
    });
    if (record) {
      add({ target: { kind: 'module', module: m.id, ...(record.path ? { path: record.path } : {}), name: record.name, ...(record.label ? { label: record.label } : {}) }, why: `Names ${record.name} in ${m.name}` });
      continue;
    }
    const name = matchText(m.name).trim();
    if (name.length >= 3 && hay.includes(` ${name} `)) add({ target: { kind: 'module', module: m.id, name: m.name }, why: `Names ${m.name}` });
  }
  for (const s of suggestFiling(item, ctx)) add(s);
  return out.slice(0, 3);
}

/** The one suggestion the Inbox page leads with: the first, when there is one. Its words for the one-click button:
 *  "File to <project>" for a project, "File in <place>" for anything else. */
export function leadSuggestion(suggestions: readonly InboxSuggestion[]): InboxSuggestion | null {
  return suggestions[0] ?? null;
}

/** A reminder home in words, the same on its chip and its one-click button: "Remind Friday at 3pm" (the moment
 *  the model read, in the capture's own words), else "Remind me". */
export function remindTargetWords(t: Pick<FilingTarget, 'when'>): string {
  const when = String(t.when ?? '').replace(/\s+/g, ' ').trim();
  return when ? `Remind ${when}` : 'Remind me';
}

export function fileToWords(s: InboxSuggestion): string {
  if (s.target.kind === 'reminder') return remindTargetWords(s.target);
  return s.target.kind === 'project' ? `File to ${s.target.name}` : `File in ${s.target.name}`;
}

/** Filing the ticked items where suggested: each item with a lead suggestion and its target, in order. Items with
 *  no suggestion are left out for the person, never guessed at. */
export function planBulkFile(items: readonly Pick<InboxItem, 'id'>[], suggestionsFor: (id: string) => readonly InboxSuggestion[]): { id: string; target: FilingTarget }[] {
  const out: { id: string; target: FilingTarget }[] = [];
  for (const it of items) {
    const lead = leadSuggestion(suggestionsFor(it.id));
    if (lead) out.push({ id: it.id, target: lead.target });
  }
  return out;
}

/** Re-exported so the page builds its project list the capture box's way (src/shared/capture.ts CaptureProject). */
export type { CaptureProject };
