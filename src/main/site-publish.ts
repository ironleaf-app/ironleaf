// Publish as a website on the main side (9.0 w122publish, 31 Oct 2026): the person's sites (.neuralvault/sites.json:
// name, what is in it, where it goes, last published), the preview staged for the dialog's frame, the folder written
// (only what changed, pages dropped since moved to the bin, never deleted for good), and, inside the former host app,
// the same files through the former host app's own Publish destinations (the host's publish code, never a second
// one). Standalone there are no host destinations, only the folder.
//
//   site:list                 every site kept
//   site:save                 a site kept (made when it has no id)
//   site:remove               a site forgotten (its published files stay where they are)
//   site:resolve              an id or a draft source → what goes and what stays out, with why
//   site:preview              the site staged in a temporary folder → its file:// address for the frame
//   site:publish              built, the folder written, the host sent to when one is set → plain words
//   site:unpublish            the host asked first when one is set, then everything unpublished in one step
//   site:marks                each published note with its sites (the Published line in a page's head)
//   site:hosts the former host app's destinations (or none, standalone)
//   site:host-connect a destination connected (its token checked, kept protected by the former host app)
//   site:host-disconnect      a destination disconnected
//   site:host-options         a destination's accounts and repositories, or computers
//   site:pick-folder          the folder window (where a site goes)
//   site:open                 the published home opened in the browser
// Every publish and unpublish sends site:changed (the lists and marks read again).

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSite, describeSource, manifestOf, newSiteId, parseSites, planSiteWrite, resolveSitePages, siteMarks, writeSites, type BuiltFile, type NoteMeta, type ResolvedSite, type SiteDef, type SiteManifest, type SiteSource, SITES_FILE, SITE_LIMITS } from '../shared/site-publish';
import type { SensitivityStore } from '../shared/sensitivity';

export type HostPublishRequest =
  | { op: 'hosts' }
  | { op: 'connect'; host: string; keys: Record<string, string> }
  | { op: 'disconnect'; host: string }
  | { op: 'options'; host: string; accountId?: string }
  | { op: 'publish'; dir: string; title: string; host?: string; settings?: Record<string, unknown> }
  | { op: 'status'; dir: string; title: string }
  | { op: 'unpublish'; dir: string; title: string; confirm: boolean };

/** Inside the former host app: the built folder through its Publish destinations (ns/src/neuralvault-host.cjs
sitePublish). */
export type HostPublishFn = (req: HostPublishRequest) => Promise<unknown>;

export interface HostView {
  id: string;
  name: string;
  free: string;
  help: string;
  keys: { id: string; label: string; secret: boolean }[];
  connected: boolean | null;
  account: string;
}

export interface PublishedSiteView {
  id: string;
  host: string;
  hostName: string;
  title: string;
  url: string;
  adminUrl: string;
  publishedAt: string;
  note: string;
}

export interface SitePublishDeps {
  handle(channel: string, fn: (...args: never[]) => unknown): void;
  send(channel: string, payload: unknown): void;
  root(): string | null;
  readText(rel: string): string | Promise<string>;
  notes(): NoteMeta[];
  resolve(target: string, from: string): string | null;
  readFile(rel: string): Uint8Array | null;
  sensitivity(): SensitivityStore;
  accent(): string;
  showProperties(): boolean;
  pickFolder(): Promise<string | null>;
  /** A file to the bin (recoverable), never deleted for good. */
  trash(abs: string): Promise<void>;
  /** A file or folder opened as the person opens it. */
  openPath?(abs: string): Promise<unknown>;
  hostPublish: HostPublishFn | null;
  now?(): Date;
  log?(m: string): void;
}

/** The last publish's receipt, beside the site (hidden, so hosts never upload it). */
const MANIFEST_FILE = '.published.json';
const cleanRel = (p: string): string => p.replace(/\\/g, '/').replace(/^\/+/, '');
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asText = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanHostView(v: unknown): HostView | null {
  const o = asRecord(v);
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  const keys = Array.isArray(o.keys) ? o.keys.map(asRecord).filter((k) => typeof k.id === 'string' && typeof k.label === 'string').map((k) => ({ id: String(k.id).slice(0, 40), label: String(k.label).slice(0, 80), secret: k.secret === true })).slice(0, 6) : [];
  return { id: o.id.slice(0, 20), name: o.name.slice(0, 60), free: asText(o.free, 200), help: asText(o.help, 2000), keys, connected: typeof o.connected === 'boolean' ? o.connected : null, account: asText(o.account, 160) };
}

function cleanPublished(v: unknown): PublishedSiteView | null {
  const o = asRecord(asRecord(v).site ?? v);
  if (!o || typeof o.url !== 'string') return null;
  return { id: asText(o.id, 40), host: asText(o.host, 20), hostName: asText(o.hostName, 60) || asText(o.host, 20), title: asText(o.title, 120), url: asText(o.url, 500), adminUrl: asText(o.adminUrl, 500), publishedAt: asText(o.publishedAt, 30), note: asText(o.note, 500) };
}

export function registerSitePublish(d: SitePublishDeps): { list(): Promise<SiteDef[]> } {
  const now = (): Date => d.now?.() ?? new Date();
  const vaultRoot = (): string => {
    const r = d.root();
    if (!r) throw new Error('Open your notes first.');
    return r;
  };

  async function list(): Promise<SiteDef[]> {
    try {
      return parseSites(await fsp.readFile(path.join(vaultRoot(), ...SITES_FILE.split('/')), 'utf8'));
    } catch {
      return [];
    }
  }

  async function keep(sites: SiteDef[]): Promise<void> {
    const file = path.join(vaultRoot(), ...SITES_FILE.split('/'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, writeSites(sites), 'utf8');
    d.send('site:changed', null);
  }

  async function get(id: unknown): Promise<{ sites: SiteDef[]; site: SiteDef }> {
    const sites = await list();
    const site = sites.find((s) => s.id === id);
    if (!site) throw new Error('That site isn’t kept any more.');
    return { sites, site };
  }

  const cleanSource = (v: unknown): SiteSource => {
    const o = asRecord(v);
    if (o.kind === 'page' && typeof o.path === 'string' && cleanRel(o.path)) return { kind: 'page', path: cleanRel(o.path) };
    if (o.kind === 'project' && typeof o.path === 'string' && cleanRel(o.path)) return { kind: 'project', path: cleanRel(o.path) };
    if (o.kind === 'folder' && typeof o.folder === 'string') return { kind: 'folder', folder: cleanRel(o.folder) };
    if (o.kind === 'tag' && typeof o.tag === 'string' && o.tag.trim()) return { kind: 'tag', tag: o.tag.trim().replace(/^#/, '').slice(0, 80) };
    if (o.kind === 'list' && Array.isArray(o.paths)) return { kind: 'list', paths: [...new Set(o.paths.filter((p): p is string => typeof p === 'string' && !!cleanRel(p)).map(cleanRel))].slice(0, SITE_LIMITS.notes) };
    throw new Error('Choose what to publish: one page, a project, a folder, a tag, or chosen pages.');
  };

  function resolveOf(source: SiteSource): ResolvedSite {
    return resolveSitePages(source, d.notes(), d.sensitivity());
  }

  async function buildOf(site: SiteDef, resolved: ResolvedSite) {
    const byPath = new Map(d.notes().map((n) => [cleanRel(n.path).toLowerCase(), n]));
    const pages = [];
    for (const p of resolved.included) {
      const meta = byPath.get(p.path.toLowerCase());
      pages.push({ path: p.path, title: p.title, props: meta?.props ?? {}, text: await d.readText(p.path), mtime: meta?.mtime });
    }
    return buildSite({ site: { name: site.name, description: site.description, accent: site.accent || d.accent() }, pages, vault: { resolve: d.resolve, read: d.readFile }, showProperties: d.showProperties() });
  }

  function folderOf(site: SiteDef): string {
    if (!site.folder || !path.isAbsolute(site.folder)) throw new Error('Choose the folder this site goes in.');
    const root = vaultRoot();
    const rel = path.relative(root, site.folder);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('Publish outside your notes, so the site doesn’t publish itself.');
    return site.folder;
  }

  async function manifestAt(folder: string): Promise<SiteManifest> {
    try {
      const v = JSON.parse(await fsp.readFile(path.join(folder, MANIFEST_FILE), 'utf8')) as { files?: unknown };
      if (!v || typeof v !== 'object' || !v.files || typeof v.files !== 'object') return {};
      return Object.fromEntries(Object.entries(v.files as Record<string, unknown>).filter(([, h]) => typeof h === 'string').slice(0, SITE_LIMITS.notes + SITE_LIMITS.attachments + 10)) as SiteManifest;
    } catch {
      return {};
    }
  }

  async function writeFolder(folder: string, files: BuiltFile[], prev: SiteManifest): Promise<{ written: number; removed: number }> {
    const plan = planSiteWrite(prev, files);
    await fsp.mkdir(folder, { recursive: true });
    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const p of plan.write) {
      const f = byPath.get(p)!;
      const abs = path.join(folder, ...p.split('/'));
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, f.data);
    }
    for (const p of plan.remove) {
      const abs = path.join(folder, ...p.split('/'));
      try {
        await d.trash(abs);
      } catch (err) {
        d.log?.(`Publish: ${p} couldn’t be moved to the bin: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await fsp.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify({ at: now().toISOString(), files: manifestOf(files) }, null, 1), 'utf8');
    return { written: plan.write.length, removed: plan.remove.length };
  }

  async function removeFolder(folder: string): Promise<number> {
    const prev = await manifestAt(folder);
    let n = 0;
    for (const p of Object.keys(prev)) {
      try {
        await d.trash(path.join(folder, ...p.split('/')));
        n++;
      } catch (err) {
        d.log?.(`Unpublish: ${p} couldn’t be moved to the bin: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await fsp.rm(path.join(folder, MANIFEST_FILE), { force: true }).catch(() => {});
    return n;
  }

  const hostNameOf = (id: string): string => ({ netlify: 'Netlify', cloudflare: 'Cloudflare Pages', github: 'GitHub Pages', ssh: 'your own server' })[id] ?? id;

  d.handle('site:list', () => list());

  d.handle('site:save', async (input: unknown) => {
    const o = asRecord(input);
    const sites = await list();
    const id = typeof o.id === 'string' ? o.id : '';
    const found = sites.find((s) => s.id === id);
    const host = o.host && typeof o.host === 'object' && typeof (o.host as Record<string, unknown>).id === 'string' ? { id: String((o.host as Record<string, unknown>).id).slice(0, 20), settings: asRecord((o.host as Record<string, unknown>).settings) } : null;
    if (host && !/^[a-z]{2,20}$/.test(host.id)) throw new Error('That destination isn’t one Ironleaf knows.');
    const site: SiteDef = {
      id: found ? found.id : newSiteId(),
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'Published notes',
      description: typeof o.description === 'string' ? o.description.trim().slice(0, 300) : '',
      source: cleanSource(o.source),
      folder: typeof o.folder === 'string' ? o.folder.slice(0, 1024) : (found?.folder ?? ''),
      accent: typeof o.accent === 'string' ? o.accent.slice(0, 16) : (found?.accent ?? ''),
      host,
      createdAt: found?.createdAt || now().toISOString(),
      publishedAt: found?.publishedAt ?? '',
      lastWords: found?.lastWords ?? '',
    };
    if (site.folder && !path.isAbsolute(site.folder)) throw new Error('That folder isn’t a full path. Choose it again.');
    await keep(found ? sites.map((s) => (s.id === site.id ? site : s)) : [...sites, site]);
    return site;
  });

  d.handle('site:remove', async (id: unknown) => {
    const { sites, site } = await get(id);
    await keep(sites.filter((s) => s.id !== site.id));
    return { removed: true, words: `“${site.name}” is forgotten. Its published files stay where they are.` };
  });

  d.handle('site:resolve', async (ref: unknown) => {
    if (typeof ref === 'string') {
      const { site } = await get(ref);
      const r = resolveOf(site.source);
      return { ...r, words: describeSource(site.source) };
    }
    const source = cleanSource(asRecord(ref).source ?? ref);
    const r = resolveOf(source);
    return { ...r, words: describeSource(source) };
  });

  d.handle('site:preview', async (ref: unknown) => {
    const source = typeof ref === 'string' ? (await get(ref)).site.source : cleanSource(asRecord(ref).source ?? ref);
    const name = typeof ref === 'string' ? (await get(ref)).site.name : asText(asRecord(ref).name, 80) || 'Published notes';
    const description = typeof ref === 'string' ? (await get(ref)).site.description : asText(asRecord(ref).description, 300);
    const r = resolveOf(source);
    if (!r.included.length) throw new Error(r.excluded.length ? `Nothing can be published: ${r.excluded[0].reason}` : 'Nothing is chosen.');
    const built = await buildOf({ name, description } as SiteDef, r);
    const dir = path.join(os.tmpdir(), `nv-site-preview-${typeof ref === 'string' ? String(ref).replace(/[^A-Za-z0-9_-]/g, '') : 'draft'}`);
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fsp.mkdir(dir, { recursive: true });
    for (const f of built.files) {
      const abs = path.join(dir, ...f.path.split('/'));
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, f.data);
    }
    // The preview opens on the first page (the whole staged site is in the frame: home and search a click away).
    const first = built.pages[0]?.url ?? 'index.html';
    return { url: pathToFileURL(path.join(dir, ...first.split('/'))).href, dir, included: r.included, excluded: r.excluded, warnings: built.warnings, words: describeSource(source) };
  });

  d.handle('site:publish', async (id: unknown) => {
    const { sites, site } = await get(id);
    const r = resolveOf(site.source);
    if (!r.included.length) throw new Error(r.excluded.length ? `Nothing can be published: ${r.excluded.map((e) => `“${e.title}”: ${e.reason}`).slice(0, 3).join(' ')}` : 'Nothing is chosen.');
    let folder = site.folder;
    if (!folder) {
      folder = (await d.pickFolder()) ?? '';
      if (!folder) return null;
      site.folder = folder;
    }
    const dest = folderOf(site);
    const built = await buildOf(site, r);
    const prev = await manifestAt(dest);
    const first = !site.publishedAt;
    const { written, removed } = await writeFolder(dest, built.files, prev);
    let hostView: PublishedSiteView | null = null;
    if (site.host) {
      if (!d.hostPublish) throw new Error('That destination isn’t available. Publish to the folder here instead.');
      const answer = await d.hostPublish({ op: 'publish', dir: dest, title: site.name, host: site.host.id, settings: site.host.settings });
      hostView = cleanPublished(answer);
      if (!hostView) throw new Error('It couldn’t be published. Try again in a moment.');
    }
    site.publishedAt = now().toISOString();
    const changed = `${written ? plural(written, 'file') + ' written' : ''}${written && removed ? ', ' : ''}${removed ? plural(removed, 'file') + ' removed' : ''}`;
    const bits = first
      ? [`“${site.name}” is published: ${plural(r.included.length, 'page')} in ${dest}.`]
      : written || removed
        ? [`“${site.name}” is updated: ${plural(r.included.length, 'page')} (${changed}).`]
        : [`“${site.name}” is already up to date (${plural(r.included.length, 'page')}).`];
    if (r.excluded.length) bits.push(`${plural(r.excluded.length, 'note')} left out (${r.excluded.slice(0, 3).map((e) => `“${e.title}”: ${e.reason}`).join(' ')}${r.excluded.length > 3 ? `, and ${r.excluded.length - 3} more` : ''})`);
    if (built.warnings.length) bits.push(built.warnings.slice(0, 2).join(' '));
    if (hostView) bits.push(`It is also on ${hostView.hostName}: ${hostView.url}${hostView.note ? ` ${hostView.note}` : ''}`);
    site.lastWords = bits.join(' ');
    await keep(sites.map((s) => (s.id === site.id ? site : s)));
    return { words: site.lastWords, site, ...(hostView ? { host: hostView } : {}) };
  });

  d.handle('site:unpublish', async (id: unknown, confirm: unknown) => {
    const { sites, site } = await get(id);
    if (!site.publishedAt) throw new Error('It isn’t published.');
    if (site.host) {
      if (!d.hostPublish) throw new Error('That destination isn’t available here.');
      const answer = await d.hostPublish({ op: 'unpublish', dir: site.folder || '', title: site.name, confirm: confirm === true });
      const asked = asRecord(asRecord(answer).ask);
      if (asked.title) return { ask: { title: asText(asked.title, 120), text: asText(asked.text, 2000), confirm: asText(asked.confirm, 40) || 'Unpublish', cancel: asText(asked.cancel, 40) || 'Keep it' } };
      const note = asText(asRecord(answer).note, 500);
      if (site.folder) await removeFolder(site.folder);
      site.publishedAt = '';
      site.lastWords = `Unpublished from ${hostNameOf(site.host.id)}. ${note}`.trim();
      await keep(sites.map((s) => (s.id === site.id ? site : s)));
      return { words: site.lastWords };
    }
    // The folder alone: unpublished in one step, its files to the bin.
    const n = site.folder ? await removeFolder(site.folder) : 0;
    site.publishedAt = '';
    site.lastWords = n ? `Unpublished: ${plural(n, 'file')} moved to the bin.` : 'Unpublished.';
    await keep(sites.map((s) => (s.id === site.id ? site : s)));
    return { words: site.lastWords };
  });

  d.handle('site:marks', async () => {
    const sites = (await list()).filter((s) => s.publishedAt);
    const resolved = new Map<string, string[]>();
    for (const s of sites) {
      try {
        resolved.set(s.id, resolveOf(s.source).included.map((p) => p.path));
      } catch {
        resolved.set(s.id, []);
      }
    }
    return siteMarks(await list(), resolved);
  });

  d.handle('site:hosts', async () => {
    if (!d.hostPublish) return { available: false, hosts: [], last: '' };
    const answer = await d.hostPublish({ op: 'hosts' });
    const o = asRecord(answer);
    const hosts = Array.isArray(o.hosts) ? o.hosts.map(cleanHostView).filter((h): h is HostView => !!h) : [];
    return { available: true, hosts, last: asText(o.last, 20) };
  });

  d.handle('site:host-connect', async (input: unknown) => {
    if (!d.hostPublish) throw new Error('That destination isn’t available here.');
    const o = asRecord(input);
    if (typeof o.host !== 'string' || !/^[a-z]{2,20}$/.test(o.host)) throw new Error('Choose a destination.');
    const keys = asRecord(o.keys);
    for (const [k, v] of Object.entries(keys)) if (typeof v !== 'string') delete keys[k];
    const answer = await d.hostPublish({ op: 'connect', host: o.host, keys: keys as Record<string, string> });
    const r = asRecord(answer);
    return { connected: r.connected === true, account: asText(r.account, 160) };
  });

  d.handle('site:host-disconnect', async (input: unknown) => {
    if (!d.hostPublish) throw new Error('That destination isn’t available here.');
    const o = asRecord(input);
    if (typeof o.host !== 'string') throw new Error('Choose a destination.');
    await d.hostPublish({ op: 'disconnect', host: o.host });
    return { connected: false };
  });

  d.handle('site:host-options', async (input: unknown) => {
    if (!d.hostPublish) throw new Error('That destination isn’t available here.');
    const o = asRecord(input);
    if (typeof o.host !== 'string') throw new Error('Choose a destination.');
    const answer = await d.hostPublish({ op: 'options', host: o.host, ...(typeof o.accountId === 'string' ? { accountId: o.accountId.slice(0, 80) } : {}) });
    const r = asRecord(answer);
    const accounts = Array.isArray(r.accounts) ? r.accounts.map(asRecord).filter((a) => typeof a.id === 'string').map((a) => ({ id: String(a.id).slice(0, 80), label: asText(a.label, 120), needsSignIn: a.needsSignIn === true })).slice(0, 20) : [];
    const repositories = Array.isArray(r.repositories) ? r.repositories.map(asRecord).filter((x) => typeof x.fullName === 'string').map((x) => ({ fullName: String(x.fullName).slice(0, 200), private: x.private === true })).slice(0, 200) : [];
    const computers = Array.isArray(r.computers) ? r.computers.map(asRecord).filter((c) => typeof c.id === 'string').map((c) => ({ id: String(c.id).slice(0, 80), label: asText(c.label, 120), address: asText(c.address, 200) })).slice(0, 50) : [];
    return { accounts, accountId: asText(r.accountId, 80), repositories, computers, starting: r.starting === true };
  });

  d.handle('site:pick-folder', () => d.pickFolder());

  d.handle('site:open', async (id: unknown) => {
    const { site } = await get(id);
    if (!site.publishedAt || !site.folder) throw new Error('It isn’t published.');
    const home = path.join(site.folder, 'index.html');
    try {
      await fsp.stat(home);
    } catch {
      throw new Error('Its folder isn’t there any more.');
    }
    if (d.openPath) await d.openPath(home);
    return home;
  });

  return { list };
}
