// Notion kept in step live (V10, 29 Oct 2026): the person's own internal integration token reads the pages and
// databases they shared with that integration, and changes made here to a database page's properties are sent
// back. The token is only ever held by the caller (the app's secret store, src/main/pairing/service.ts) and sent
// as a request header: it is never written to the vault, a note or a log. Only Notion's published API shapes are
// read; a stand-in server in the tests answers the same shapes, so no real network is needed to prove this.

import type { PropValue } from '../../shared/frontmatter';
import { fileSafe, linkToken, type SourceItem, type SourceRead, type SourceView } from './source';
import { defaultView } from '../../shared/views';

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface LiveClient {
  fetchFn: FetchFn;
  token: string;
  /** The API's base (the tests point it at their stand-in). */
  base?: string;
}

const BASE = 'https://api.notion.com';
const VERSION = '2022-06-28';

async function call(c: LiveClient, method: string, path: string, body?: unknown): Promise<any> {
  const res = await c.fetchFn(`${(c.base ?? BASE).replace(/\/+$/, '')}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    // The token itself is never in the words.
    if (res.status === 401) throw new Error('Notion did not accept that token. Check you copied the whole token, then try again.');
    if (res.status === 403 || res.status === 404) throw new Error('Notion would not share that. Open the page or database in Notion and add your integration to it, then try again.');
    throw new Error(`Notion could not be reached just now (it answered ${res.status}). Try again in a moment.`);
  }
  return res.json();
}

const plain = (parts: any[] | undefined): string => (parts ?? []).map((p) => p?.plain_text ?? p?.text?.content ?? '').join('');

type Props = Record<string, any>;

/** A Notion property value as a vault property (a relation becomes a link token to the other page). */
export function notionProp(v: any): PropValue {
  if (!v || typeof v !== 'object') return null;
  switch (v.type) {
    case 'title': return plain(v.title);
    case 'rich_text': return plain(v.rich_text);
    case 'number': return typeof v.number === 'number' ? v.number : null;
    case 'select': return v.select?.name ?? null;
    case 'status': return v.status?.name ?? null;
    case 'multi_select': return (v.multi_select ?? []).map((s: any) => s.name);
    case 'date': return v.date?.start ?? null;
    case 'checkbox': return v.checkbox === true;
    case 'url': return v.url ?? null;
    case 'email': return v.email ?? null;
    case 'phone_number': return v.phone_number ?? null;
    case 'people': return (v.people ?? []).map((p: any) => p.name ?? '').filter(Boolean);
    case 'relation': return (v.relation ?? []).map((r: any) => linkToken('note', String(r.id)));
    case 'formula': return notionProp(v.formula);
    case 'rollup': return Array.isArray(v.rollup?.array) ? v.rollup.array.map((x: any) => String(notionProp(x) ?? '')).filter(Boolean) : null;
    case 'created_time': return typeof v.created_time === 'string' ? v.created_time.slice(0, 10) : null;
    case 'last_edited_time': return typeof v.last_edited_time === 'string' ? v.last_edited_time.slice(0, 10) : null;
    default: return null;
  }
}

/** A vault property back as a Notion property value, by the type Notion holds for it (null: Notion cannot take it). */
export function notionPropBack(type: string, v: PropValue, idOfLink: (s: string) => string | null): any | null {
  const text = Array.isArray(v) ? v.map(String).join(', ') : v === null || v === undefined ? '' : String(v);
  switch (type) {
    case 'title': return { title: [{ text: { content: text.slice(0, 2000) } }] };
    case 'rich_text': return { rich_text: [{ text: { content: text.slice(0, 2000) } }] };
    case 'number': { const n = typeof v === 'number' ? v : Number(text); return Number.isFinite(n) && text !== '' ? { number: n } : { number: null }; }
    case 'select': return text ? { select: { name: text.slice(0, 100) } } : { select: null };
    case 'status': return text ? { status: { name: text.slice(0, 100) } } : { status: null };
    case 'multi_select': return { multi_select: (Array.isArray(v) ? v : text ? [text] : []).map((s) => ({ name: String(s).slice(0, 100) })) };
    case 'date': return text ? { date: { start: text } } : { date: null };
    case 'checkbox': return { checkbox: v === true || /^true$/i.test(text) };
    case 'url': return text ? { url: text } : { url: null };
    case 'email': return text ? { email: text } : { email: null };
    case 'relation': {
      const ids = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? idOfLink(x) ?? (/^[0-9a-f-]{32,36}$/i.test(x.trim()) ? x.trim() : null) : null)).filter(Boolean);
      return { relation: ids.map((id) => ({ id })) };
    }
    default: return null; // People, formulas, rollups and the like are Notion's to work out, not ours to write.
  }
}

function blockText(b: any): string {
  const t = b?.type ? plain(b[b.type]?.rich_text) : '';
  switch (b?.type) {
    case 'heading_1': return `# ${t}`;
    case 'heading_2': return `## ${t}`;
    case 'heading_3': return `### ${t}`;
    case 'bulleted_list_item': return `- ${t}`;
    case 'numbered_list_item': return `1. ${t}`;
    case 'to_do': return `- [${b.to_do?.checked ? 'x' : ' '}] ${t}`;
    case 'quote': return `> ${t}`;
    case 'code': return `\`\`\`${b.code?.language ?? ''}\n${t}\n\`\`\``;
    case 'divider': return '---';
    default: return t;
  }
}

interface BlockLoss { deep: boolean; files: number; other: Set<string> }
const WORD_BLOCKS = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'code', 'divider', 'callout', 'toggle']);

async function blocks(c: LiveClient, id: string, acc: BlockLoss, depth = 0): Promise<string> {
  if (depth > 3) {
    acc.deep = true;
    return '';
  }
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await call(c, 'GET', `/v1/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const b of r.results ?? []) {
      // Pictures and files need downloading (F21): counted here and said per page, never silently lost.
      if (b?.type === 'image' || b?.type === 'file' || b?.type === 'pdf' || b?.type === 'video' || b?.type === 'audio') {
        acc.files++;
      } else {
        const line = blockText(b);
        if (line) out.push(line);
        else if (b?.type && !WORD_BLOCKS.has(b.type)) acc.other.add(String(b.type).replace(/_/g, ' '));
      }
      if (b.has_children) {
        const inner = await blocks(c, b.id, acc, depth + 1);
        if (inner) out.push(inner);
      }
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out.join('\n\n');
}

/** What one page's live read could not bring, in words for skipped. */
function lossSkipped(title: string, acc: BlockLoss): { what: string; why: string }[] {
  const out: { what: string; why: string }[] = [];
  if (acc.files) out.push({ what: title, why: `${acc.files} ${acc.files === 1 ? 'picture or file' : 'pictures and files'} didn’t come in live — bring a Notion export zip for those` });
  if (acc.deep) out.push({ what: title, why: 'blocks nested deeper than 3 levels weren’t brought in' });
  if (acc.other.size) out.push({ what: title, why: `some blocks weren’t brought in (${[...acc.other].slice(0, 4).join(', ')}${acc.other.size > 4 ? `, and ${acc.other.size - 4} more` : ''})` });
  return out;
}

const titleOf = (p: any): string => {
  const props: Props = p?.properties ?? {};
  for (const v of Object.values(props)) if ((v as any)?.type === 'title') return plain((v as any).title) || 'Untitled';
  return plain(p?.child_page?.title ? [{ plain_text: p.child_page.title }] : []) || 'Untitled';
};

/** Everything the integration can see, as the engine's items: pages, and each database's rows as its pages. */
export async function readNotionLive(c: LiveClient): Promise<SourceRead> {
  const items: SourceItem[] = [];
  const views: SourceView[] = [];
  const skipped: { what: string; why: string }[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  const dbs: any[] = [];
  do {
    const r = await call(c, 'POST', '/v1/search', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const x of r.results ?? []) {
      if (x.object === 'database') dbs.push(x);
      else if (x.object === 'page' && !seen.has(x.id)) {
        seen.add(x.id);
        const props: Record<string, PropValue> = {};
        for (const [k, v] of Object.entries(x.properties ?? {})) { const val = notionProp(v); if (val !== null && val !== '') props[k] = val; }
        const title = fileSafe(titleOf(x));
        const acc: BlockLoss = { deep: false, files: 0, other: new Set() };
        const body = await blocks(c, String(x.id), acc);
        skipped.push(...lossSkipped(title, acc));
        items.push({ id: String(x.id), title, folder: '', props, body, files: [] });
      }
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  for (const db of dbs) {
    const name = fileSafe(plain(db.title) || 'Database');
    let q: string | undefined;
    const cols = Object.keys(db.properties ?? {});
    do {
      const r = await call(c, 'POST', `/v1/databases/${db.id}/query`, { page_size: 100, ...(q ? { start_cursor: q } : {}) });
      for (const row of r.results ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const props: Record<string, PropValue> = {};
        for (const [k, v] of Object.entries(row.properties ?? {})) { const val = notionProp(v); if (val !== null && val !== '') props[fileSafe(k)] = val; }
        const title = fileSafe(titleOf(row));
        const acc: BlockLoss = { deep: false, files: 0, other: new Set() };
        const body = await blocks(c, String(row.id), acc);
        skipped.push(...lossSkipped(title, acc));
        items.push({ id: String(row.id), title, folder: name, props, body, files: [] });
      }
      q = r.has_more ? r.next_cursor : undefined;
    } while (q);
    const status = cols.find((k) => /^(status|stage|state)$/i.test(k));
    const def = defaultView({ kind: 'folder', value: name }, status ? 'board' : 'table');
    def.columns = cols.map((k) => fileSafe(k));
    if (status) def.groupBy = fileSafe(status);
    views.push({ name, folder: name, def });
  }
  if (!items.length) skipped.push({ what: 'Nothing', why: 'no page or database is shared with your integration yet' });
  return { kind: 'notion', name: '', items, views, skipped };
}

/** Send one page's changed properties back (the engine calls this only for a note only the person changed). */
export async function pushNotion(c: LiveClient, change: { id: string; props: Record<string, PropValue>; itemProps?: Record<string, string>; idOfLink(s: string): string | null }): Promise<boolean> {
  // Notion's own property types for this page decide what can be written, so a select is never sent as words.
  const page = await call(c, 'GET', `/v1/pages/${change.id}`);
  const types: Record<string, string> = {};
  for (const [k, v] of Object.entries(page?.properties ?? {})) types[k] = (v as any)?.type ?? '';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(change.props)) {
    if (['source', 'source-file', 'source-id', 'imported', 'synced', 'conflict-of'].includes(k)) continue;
    const key = Object.keys(types).find((t) => fileSafe(t) === k || t === k);
    if (!key) continue;
    const back = notionPropBack(types[key], v, change.idOfLink);
    if (back) out[key] = back;
  }
  if (!Object.keys(out).length) return false;
  await call(c, 'PATCH', `/v1/pages/${change.id}`, { properties: out });
  return true;
}
