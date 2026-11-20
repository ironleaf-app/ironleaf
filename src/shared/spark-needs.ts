// Today's the former host app rows (9 Nov 2026, t53-today-needs-you: one product, Today holds what needs you
// from the former host app too). With the flag on, Today's "things need a look" list gains the former host
// app's needs-you rows, one per kind as the list already does, shaped here from the bell's own notices
// (src/shared/notices.ts) so Today and the bell read the same items and agree: approvals waiting, a finished
// or stopped code task, a bot asking. Only what still needs you rows (unread, and never the vault's own
// kinds); everything else stays the bell's news, as today. Each row opens through the existing notices seam
// (window.nv.notices.open), never a new route.
import type { TaskNotice } from './notices';

/** One the former host app wait inside a row: the bell's own words, opening through notices.open. */
export interface SparkRowItem {
  id: string;
  title: string;
  body: string;
  sessionId: string;
}

/** One row of Today's list from the former host app, in the brief's order (approvals, finished code, stopped code,
asks). */
export interface SparkTodayRow {
  key: 'approvals' | 'code-done' | 'code-stopped' | 'bot-ask';
  title: string;
  items: SparkRowItem[];
}

/** The vault's own kinds (src/shared/notices.ts MIRRORED_KINDS, plus the names ask): never the former host
app rows. */
const OWN_KINDS = new Set(['reminder', 'finance', 'documents', 'tidy', 'names']);

const slim = (i: TaskNotice): SparkRowItem => ({ id: i.id, title: i.title, body: i.body, sessionId: i.sessionId });

/** The former host app's needs-you rows from the bell's list, in row order, each with its items newest first as
listed. */
export function sparkTodayRows(notices: TaskNotice[]): SparkTodayRow[] {
  const live = (Array.isArray(notices) ? notices : []).filter(
    (i) => i && i.read !== true && !OWN_KINDS.has(String(i.kind)) && typeof (i as { reminder?: unknown }).reminder !== 'string',
  );
  const rows: SparkTodayRow[] = [];
  const approvals = live.filter((i) => i.kind === 'approval' || i.kind === 'automation-approval');
  if (approvals.length) rows.push({ key: 'approvals', title: approvals.length === 1 ? '1 approval waiting' : `${approvals.length} approvals waiting`, items: approvals.map(slim) });
  const done = live.filter((i) => i.kind === 'done' && i.surface === 'code');
  if (done.length === 1) rows.push({ key: 'code-done', title: `Code task finished: ${done[0].body || 'Your conversation'}`, items: done.map(slim) });
  else if (done.length > 1) rows.push({ key: 'code-done', title: `${done.length} code tasks finished`, items: done.map(slim) });
  const stopped = live.filter((i) => i.kind === 'failed' && i.surface === 'code');
  if (stopped.length === 1) rows.push({ key: 'code-stopped', title: `Code task stopped: ${stopped[0].body || 'Your conversation'}`, items: stopped.map(slim) });
  else if (stopped.length > 1) rows.push({ key: 'code-stopped', title: `${stopped.length} code tasks stopped`, items: stopped.map(slim) });
  const asks = live.filter((i) => i.kind === 'question' && i.surface === 'bot');
  if (asks.length === 1) {
    const who = typeof asks[0].bot === 'string' && asks[0].bot.trim() ? `${asks[0].bot.trim()} bot asked a question` : 'A bot asked a question';
    rows.push({ key: 'bot-ask', title: who, items: asks.map(slim) });
  } else if (asks.length > 1) rows.push({ key: 'bot-ask', title: `${asks.length} bot questions waiting`, items: asks.map(slim) });
  return rows;
}

/** The Inbox line: how many captures wait to be filed, or no line when none do. */
export function inboxLine(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count === 1 ? '1 captured, waiting to be filed' : `${count} captured, waiting to be filed`;
}
