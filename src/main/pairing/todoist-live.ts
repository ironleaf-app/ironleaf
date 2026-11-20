// Todoist kept in step both ways (V11, 29 Oct 2026): the person's own API token reads their projects and tasks;
// each task becomes a note in its project's folder, so the Tasks view and the AI see it like any other note, and a
// change made here (its words, its due day, its priority, ticking it done) is sent back. The token is only ever
// held by the caller (the app's secret store, src/main/pairing/service.ts) and sent as a request header: never
// written to the vault, a note or a log. A stand-in server in the tests answers the same shapes.

import type { PropValue } from '../../shared/frontmatter';
import { fileSafe, type SourceItem, type SourceRead } from './source';
import type { FetchFn } from './notion-live';

export interface TodoistClient { fetchFn: FetchFn; token: string; base?: string }

const BASE = 'https://api.todoist.com/rest/v2';

async function call(c: TodoistClient, method: string, path: string, body?: unknown): Promise<any> {
  const res = await c.fetchFn(`${(c.base ?? BASE).replace(/\/+$/, '')}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Todoist did not accept that token. Check you copied the whole token, then try again.');
    throw new Error(`Todoist could not be reached just now (it answered ${res.status}). Try again in a moment.`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const PRIORITY: Record<number, string> = { 4: 'Highest', 3: 'High', 2: 'Medium', 1: 'Lowest' };
const PRIORITY_BACK: Record<string, number> = { highest: 4, urgent: 4, high: 3, medium: 2, normal: 2, lowest: 1, low: 1 };

/** Every project's open tasks, one item each (its project is its folder). Done tasks stay in Todoist's history. */
export async function readTodoistLive(c: TodoistClient): Promise<SourceRead> {
  const projects = await call(c, 'GET', '/projects');
  const byId = new Map<string, string>((projects ?? []).map((p: any) => [String(p.id), fileSafe(String(p.name ?? 'Inbox'))]));
  const tasks = await call(c, 'GET', '/tasks');
  const items: SourceItem[] = [];
  for (const t of tasks ?? []) {
    const props: Record<string, PropValue> = {};
    const project = byId.get(String(t.project_id ?? '')) ?? 'Inbox';
    props.Project = project;
    if (t.due?.date) props.Due = String(t.due.date).slice(0, 10);
    if (typeof t.priority === 'number' && PRIORITY[t.priority]) props.Priority = PRIORITY[t.priority];
    if (Array.isArray(t.labels) && t.labels.length) props.tags = t.labels.map((l: unknown) => String(l).replace(/\s+/g, '-'));
    const desc = String(t.description ?? '').trim();
    items.push({ id: String(t.id), title: fileSafe(String(t.content ?? 'Task').slice(0, 120), 'Task'), folder: project, props, body: desc ? `${desc}\n` : '', files: [] });
  }
  return { kind: 'todoist', name: '', items, views: [], skipped: [] };
}

/** A vault link as plain words for Todoist (`[[Gate House|the gate]]` reads `the gate`). */
const unlinkTodoist = (s: string) => s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => (alias ?? target.split('/').pop() ?? target).trim() || target);

/** Send one task's changes back: its name, words, labels, due day and priority; ticking Done here closes it.
/// A project move here (the note's folder) stays here: Todoist keeps its project, the note keeps its folder. */
export async function pushTodoist(c: TodoistClient, change: { id: string; props: Record<string, PropValue>; body: string; title?: string; itemTitle?: string }): Promise<boolean> {
  const p = change.props;
  const done = p.Done === true || /^true$/i.test(String(p.Done ?? ''));
  const body: Record<string, unknown> = {};
  // The name (F22): the file's name now, when it differs from what Todoist holds.
  if (change.title && change.itemTitle && change.title !== change.itemTitle) body.content = change.title.slice(0, 500);
  const desc = unlinkTodoist(change.body.replace(/^---[\s\S]*?---\s*/, '').trim());
  body.description = desc.slice(0, 16383);
  if (Array.isArray(p.tags)) body.labels = p.tags.map((t) => String(t).slice(0, 60));
  if (typeof p.Due === 'string' && p.Due) body.due_date = p.Due.slice(0, 10);
  if (typeof p.Priority === 'string' && PRIORITY_BACK[p.Priority.toLowerCase()]) body.priority = PRIORITY_BACK[p.Priority.toLowerCase()];
  // One call carries every change (an unchanged description resends harmlessly; an emptied one clears).
  await call(c, 'POST', `/tasks/${change.id}`, body);
  if (done) await call(c, 'POST', `/tasks/${change.id}/close`);
  return true;
}

/** A task ticked done here is closed at Todoist; one unticked is reopened (called when only Done changed). */
export async function setTodoistDone(c: TodoistClient, id: string, done: boolean): Promise<void> {
  await call(c, 'POST', `/tasks/${id}/${done ? 'close' : 'reopen'}`);
}
