// Publish as a website (9.0 w122publish): the dialog. What goes in (one page, a project, a folder, a tag or chosen
// pages), the preview (what is left out and why, and the site itself before the first publish), and where it goes
// (a folder the person chooses, and, inside the former host app, its Publish destinations). Plain words
// throughout, no em dashes, and every publish says what it did.

import { useEffect, useMemo, useState } from 'react';
import type { SiteDef, SiteSource } from '../../../shared/site-publish';
import { plural } from '../../../shared/words';
import { isProjectProps } from '../../../shared/project-file';
import { fuzzyFilter } from '../lib/fuzzy';
import { useEscape } from '../lib/useEscape';
import { docs } from '../state/docs';
import { getState, showError, toast, useApp } from '../state/store';
import { pick, pickFile } from './Pickers';

type Step = 'what' | 'preview' | 'where';

const KINDS: { id: SiteSource['kind']; label: string }[] = [
  { id: 'page', label: 'One page' },
  { id: 'project', label: 'A project' },
  { id: 'folder', label: 'A folder' },
  { id: 'tag', label: 'A tag' },
  { id: 'list', label: 'Chosen pages' },
];

const titleOf = (rel: string): string => getState().byPath.get(rel)?.label ?? getState().byPath.get(rel)?.title ?? rel.split('/').pop()!.replace(/\.md$/i, '');
const projectPaths = (): string[] => getState().notes.filter((n) => isProjectProps(n.props)).map((n) => n.path);
const notePaths = (): string[] => getState().notes.filter((n) => n.path.endsWith('.md')).map((n) => n.path);
const tagList = (): string[] => [...new Set(getState().notes.flatMap((n) => n.tags ?? []))].sort((a, b) => a.localeCompare(b));

function defaultName(source: SiteSource): string {
  if (source.kind === 'page' || source.kind === 'project') return titleOf(source.path);
  if (source.kind === 'folder') return source.folder ? (source.folder.split('/').pop() ?? source.folder) : 'My notes';
  if (source.kind === 'tag') return `#${source.tag}`;
  return source.paths.length === 1 ? titleOf(source.paths[0]) : 'Chosen pages';
}

function sourceReady(source: SiteSource): boolean {
  if (source.kind === 'list') return source.paths.length > 0;
  if (source.kind === 'tag') return !!source.tag.trim();
  if (source.kind === 'page' || source.kind === 'project') return !!source.path;
  return true;
}

interface Resolved {
  included: { path: string; title: string }[];
  excluded: { path: string; title: string; reason: string }[];
  words: string;
}

export function PublishDialog({ siteId, source: initialSource, onClose }: { siteId?: string; source?: SiteSource; onClose(): void }) {
  const [step, setStep] = useState<Step>('what');
  const [site, setSite] = useState<SiteDef | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState<SiteSource>(initialSource ?? { kind: 'page', path: '' });
  const [named, setNamed] = useState(false);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [preview, setPreview] = useState<{ url: string; warnings: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [folder, setFolder] = useState('');
  const [hosts, setHosts] = useState<{ available: boolean; hosts: { id: string; name: string; free: string; help: string; keys: { id: string; label: string; secret: boolean }[]; connected: boolean | null; account: string }[]; last: string } | null>(null);
  const [hostSel, setHostSel] = useState('');
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [options, setOptions] = useState<{ accounts: { id: string; label: string; needsSignIn: boolean }[]; accountId: string; repositories: { fullName: string; private: boolean }[]; computers: { id: string; label: string; address: string }[]; starting: boolean } | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ words: string; url: string } | null>(null);
  const [ask, setAsk] = useState<{ title: string; text: string; confirm: string; cancel: string } | null>(null);
  useEscape(onClose);
  // The pickers read the notes, folders and tags as they are now.
  void useApp((s) => s.revision);
  void useApp((s) => s.filesRevision);

  // A kept site opens as itself; a new one starts from what asked (a page, a project, the palette).
  useEffect(() => {
    if (!siteId) {
      if (initialSource && sourceReady(initialSource)) {
        setName(defaultName(initialSource));
        setNamed(false);
      }
      return;
    }
    window.nv.site
      .list()
      .then((sites) => {
        const found = sites.find((s) => s.id === siteId);
        if (!found) {
          toast('That site isn’t kept any more.');
          onClose();
          return;
        }
        setSite(found);
        setName(found.name);
        setNamed(true);
        setDescription(found.description);
        setSource(found.source);
        setFolder(found.folder);
        setHostSel(found.host?.id ?? '');
        setSettings(found.host?.settings ?? {});
      }, showError)
      .catch(showError);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);
  useEffect(() => {
    window.nv.site.hosts().then(setHosts, () => setHosts({ available: false, hosts: [], last: '' }));
  }, []);

  // The name follows the choice until the person writes their own.
  useEffect(() => {
    if (!named && sourceReady(source)) setName(defaultName(source));
  }, [source, named]);

  const draft = useMemo(() => ({ name: name.trim() || 'Published notes', description: description.trim(), source }), [name, description, source]);

  const sameAsSite = (): boolean => !!site && site.name === (name.trim() || 'Published notes') && site.description === description.trim() && JSON.stringify(site.source) === JSON.stringify(source);

  const resolveNow = async (): Promise<Resolved | null> => {
    setResolving(true);
    try {
      await docs.settle();
      const r = await window.nv.site.resolve(site?.id && sameAsSite() ? site.id : draft);
      setResolved(r);
      return r;
    } catch (err) {
      showError(err);
      return null;
    } finally {
      setResolving(false);
    }
  };

  const toPreview = async () => {
    if (!sourceReady(source)) {
      toast('Choose what goes in first.');
      return;
    }
    const r = await resolveNow();
    if (!r) return;
    if (!r.included.length) {
      toast(r.excluded.length ? `Nothing can be published: ${r.excluded[0].reason}` : 'Nothing is chosen.');
      return;
    }
    setStep('preview');
    setPreview(null);
    setPreviewing(true);
    try {
      const p = await window.nv.site.preview(site?.id && sameAsSite() ? site.id : draft);
      setPreview({ url: p.url, warnings: p.warnings });
    } catch (err) {
      showError(err);
      setStep('what');
    } finally {
      setPreviewing(false);
    }
  };

  const chooseFolder = async () => {
    try {
      const picked = await window.nv.site.pickFolder();
      if (picked) setFolder(picked);
    } catch (err) {
      showError(err);
    }
  };

  const saveFirst = async (): Promise<SiteDef | null> => {
    try {
      await docs.settle();
      const saved = await window.nv.site.save({ ...(site ? { id: site.id } : {}), name: name.trim() || 'Published notes', description: description.trim(), source, folder, accent: site?.accent ?? '', host: hostSel ? { id: hostSel, settings } : null });
      setSite(saved);
      return saved;
    } catch (err) {
      showError(err);
      return null;
    }
  };

  const publishNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await saveFirst();
      if (!saved) return;
      const r = await window.nv.site.publish(saved.id);
      if (!r) return;
      setDone({ words: r.words, url: r.host?.url ?? '' });
      setSite(r.site);
      toast(r.words);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const unpublishNow = async (confirm: boolean) => {
    const id = site?.id;
    if (!id || busy) return;
    setBusy(true);
    try {
      const r = await window.nv.site.unpublish(id, confirm);
      if ('ask' in r) {
        setAsk(r.ask);
        return;
      }
      setAsk(null);
      toast(r.words);
      const sites = await window.nv.site.list();
      setSite(sites.find((s) => s.id === id) ?? null);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const pickers: Record<SiteSource['kind'], () => void> = {
    page: () => void pickFile('Publish which page?', notePaths(), titleOf).then((p) => p && setSource({ kind: 'page', path: p })),
    project: () => {
      const projects = projectPaths();
      if (!projects.length) {
        toast('No projects yet.');
        return;
      }
      void pickFile('Publish which project?', projects, titleOf).then((p) => p && setSource({ kind: 'project', path: p }));
    },
    folder: () =>
      void pick({
        placeholder: 'Publish which folder?',
        items: (q) =>
          fuzzyFilter(['', ...getState().folders], q, (f) => f || 'every note').map((f) => ({ id: `folder:${f}`, label: f || 'Every note in the vault', detail: f || undefined })),
        footer: <span>↑↓ to move · Enter to choose · Esc to cancel</span>,
      }).then((id) => id !== null && setSource({ kind: 'folder', folder: id.slice('folder:'.length) })),
    tag: () => {
      const tags = tagList();
      if (!tags.length) {
        toast('No tags yet. Tag some notes first.');
        return;
      }
      void pick({
        placeholder: 'Publish which tag?',
        items: (q) => fuzzyFilter(tags, q, (t) => t).map((t) => ({ id: t, label: `#${t}` })),
        footer: <span>↑↓ to move · Enter to choose · Esc to cancel</span>,
      }).then((id) => id !== null && setSource({ kind: 'tag', tag: id }));
    },
    list: () => void pickFile('Add which page?', notePaths().filter((p) => !(source.kind === 'list' && source.paths.includes(p))), titleOf).then((p) => p && setSource({ kind: 'list', paths: [...(source.kind === 'list' ? source.paths : []), p] })),
  };

  const sourceWords = (): string => {
    if (source.kind === 'page' || source.kind === 'project') return source.path ? titleOf(source.path) : 'Not chosen';
    if (source.kind === 'folder') return source.folder || 'Every note in the vault';
    if (source.kind === 'tag') return source.tag ? `#${source.tag}` : 'Not chosen';
    return source.paths.length ? `${plural(source.paths.length, 'page')}` : 'None yet';
  };

  const host = hosts?.hosts.find((h) => h.id === hostSel) ?? null;
  const loadOptions = (accountId?: string) => {
    if (!hostSel) return;
    window.nv.site.options(hostSel, accountId ?? (typeof settings.accountId === 'string' ? settings.accountId : undefined)).then(setOptions, showError);
  };
  useEffect(() => {
    if (hostSel === 'github' || hostSel === 'ssh') loadOptions();
    else setOptions(null);
    // When the destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostSel]);

  const connect = async () => {
    if (!host) return;
    setBusy(true);
    try {
      const keys: Record<string, string> = {};
      for (const k of host.keys) keys[k.id] = keyDrafts[k.id]?.trim() ?? '';
      const r = await window.nv.site.connect(host.id, keys);
      if (r.connected) {
        setHosts(await window.nv.site.hosts());
        setKeyDrafts({});
        toast(`Connected to ${host.name}${r.account ? ` as ${r.account}` : ''}.`);
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string, v: unknown) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog publish-dialog" role="dialog" aria-modal="true" aria-label="Publish as a website" onMouseDown={(e) => e.stopPropagation()}>
        <div className="publish-head">
          <h2>{site?.publishedAt ? `Publish “${site.name}”` : 'Publish as a website'}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="publish-steps" role="tablist" aria-label="Steps">
          {(['what', 'preview', 'where'] as Step[]).map((s, i) => (
            <button key={s} role="tab" type="button" aria-selected={step === s} className={`publish-step${step === s ? ' is-on' : ''}`} onClick={() => (s === 'what' || (s === 'preview' && resolved) || (s === 'where' && preview) ? setStep(s) : undefined)}>
              {i + 1}. {s === 'what' ? 'What goes in' : s === 'preview' ? 'Preview' : 'Where it goes'}
            </button>
          ))}
        </div>

        {step === 'what' && (
          <div className="publish-body">
            <label className="publish-field">
              <span className="publish-label">Site name</span>
              <input value={name} spellCheck={false} maxLength={80} placeholder="My baking" onChange={(e) => (setName(e.target.value), setNamed(true))} />
            </label>
            <label className="publish-field">
              <span className="publish-label">Description (for the home page)</span>
              <input value={description} spellCheck={true} maxLength={300} placeholder="Cakes worth making." onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="publish-field">
              <span className="publish-label">What goes in</span>
              <div className="segmented">
                {KINDS.map((k) => (
                  <button key={k.id} type="button" className={source.kind === k.id ? 'active' : ''} onClick={() => setSource(k.id === 'page' ? { kind: 'page', path: '' } : k.id === 'project' ? { kind: 'project', path: '' } : k.id === 'folder' ? { kind: 'folder', folder: '' } : k.id === 'tag' ? { kind: 'tag', tag: '' } : { kind: 'list', paths: [] })}>
                    {k.label}
                  </button>
                ))}
              </div>
              <div className="publish-choice">
                <button type="button" className="button" onClick={() => pickers[source.kind]()}>
                  {source.kind === 'list' ? 'Add a page…' : 'Choose…'}
                </button>
                <span className="publish-choice-words">{sourceWords()}</span>
              </div>
              {source.kind === 'list' && !!source.paths.length && (
                <ul className="publish-list">
                  {source.paths.map((p) => (
                    <li key={p}>
                      <span>{titleOf(p)}</span>
                      <button type="button" className="text-button subtle" aria-label={`Take ${titleOf(p)} out`} onClick={() => setSource({ kind: 'list', paths: source.paths.filter((x) => x !== p) })}>
                        Take out
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="hint">Private notes, secrets, health and marked pages never publish. The preview names what stays out.</p>
            <div className="publish-foot">
              <span>{resolving ? 'Reading the choice…' : resolved ? `${plural(resolved.included.length, 'page')}${resolved.excluded.length ? `, ${resolved.excluded.length} left out` : ''}` : ''}</span>
              <button type="button" className="button primary" disabled={!sourceReady(source) || resolving} onClick={() => void toPreview()}>
                Preview…
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="publish-body is-preview">
            {resolved && (
              <div className="publish-leftout">
                <div className="publish-label">Left out ({resolved.excluded.length})</div>
                {resolved.excluded.length ? (
                  <ul>
                    {resolved.excluded.slice(0, 8).map((e) => (
                      <li key={e.path}>
                        {e.title}: {e.reason}
                      </li>
                    ))}
                    {resolved.excluded.length > 8 && <li>And {resolved.excluded.length - 8} more…</li>}
                  </ul>
                ) : (
                  <p className="hint">Nothing left out.</p>
                )}
              </div>
            )}
            {preview?.warnings.map((w) => (
              <p key={w} className="publish-warn">
                {w}
              </p>
            ))}
            <div className="publish-frame-wrap">{previewing || !preview ? <p className="hint">Building the preview…</p> : <iframe title="The site’s preview" src={preview.url} className="publish-frame" />}</div>
            <div className="publish-foot">
              <button type="button" className="button" onClick={() => setStep('what')}>
                Back
              </button>
              <button type="button" className="button primary" disabled={!preview} onClick={() => setStep('where')}>
                Where it goes…
              </button>
            </div>
          </div>
        )}

        {step === 'where' && (
          <div className="publish-body">
            <div className="publish-field">
              <span className="publish-label">Folder (always: the finished site, opened straight from here)</span>
              <div className="publish-choice">
                <button type="button" className="button" onClick={() => void chooseFolder()}>
                  {folder ? 'Change…' : 'Choose…'}
                </button>
                <span className="publish-choice-words">{folder || 'Asked when you publish'}</span>
              </div>
            </div>
            <div className="publish-field">
              <span className="publish-label">Also on the web</span>
              {!hosts ? (
                <p className="hint">Reading destinations…</p>
              ) : !hosts.available ? (
                <p className="hint">No web destination is set up on this PC.</p>
              ) : (
                <>
                  <div className="publish-hosts" role="radiogroup" aria-label="Where on the web">
                    <label className={`publish-host${!hostSel ? ' is-on' : ''}`}>
                      <input type="radio" name="publish-host" checked={!hostSel} onChange={() => (setHostSel(''), setSettings({}))} />
                      <span>
                        <b>Folder only</b>
                        <i>The site stays in its folder.</i>
                      </span>
                    </label>
                    {hosts.hosts.map((h) => (
                      <label key={h.id} className={`publish-host${hostSel === h.id ? ' is-on' : ''}`}>
                        <input type="radio" name="publish-host" checked={hostSel === h.id} onChange={() => (setHostSel(h.id), setSettings({ name: name.trim() }))} />
                        <span>
                          <b>{h.name}</b>
                          <i>
                            {h.free} {h.connected ? (h.account ? `Connected as ${h.account}.` : 'Connected.') : h.connected === false ? 'Not connected.' : ''}
                          </i>
                        </span>
                      </label>
                    ))}
                  </div>
                  {host && host.connected === false && !!host.keys.length && (
                    <div className="publish-connect">
                      <p className="hint">{host.help}</p>
                      {host.keys.map((k) => (
                        <label key={k.id} className="publish-field">
                          <span className="publish-label">{k.label}</span>
                          <input type={k.secret ? 'password' : 'text'} value={keyDrafts[k.id] ?? ''} spellCheck={false} autoComplete="off" onChange={(e) => setKeyDrafts((d) => ({ ...d, [k.id]: e.target.value }))} />
                        </label>
                      ))}
                      <button type="button" className="button" disabled={busy} onClick={() => void connect()}>
                        {busy ? 'Checking…' : `Connect ${host.name}`}
                      </button>
                    </div>
                  )}
                  {host && host.connected !== false && (
                    <div className="publish-settings">
                      <label className="publish-field">
                        <span className="publish-label">Site name there</span>
                        <input value={typeof settings.name === 'string' ? settings.name : ''} spellCheck={false} maxLength={60} onChange={(e) => set('name', e.target.value)} />
                      </label>
                      {hostSel === 'netlify' && (
                        <label className="publish-field">
                          <span className="publish-label">Password (paid Netlify plans only, else left open)</span>
                          <input type="password" value={typeof settings.password === 'string' ? settings.password : ''} autoComplete="off" onChange={(e) => set('password', e.target.value)} />
                        </label>
                      )}
                      {hostSel === 'github' && (
                        <>
                          <label className="publish-field">
                            <span className="publish-label">Account</span>
                            <select value={typeof settings.accountId === 'string' ? settings.accountId : (options?.accountId ?? '')} onChange={(e) => (set('accountId', e.target.value), set('repository', ''), loadOptions(e.target.value))}>
                              <option value="">Choose…</option>
                              {(options?.accounts ?? []).map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.label}
                                  {a.needsSignIn ? ' (sign in again)' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="publish-field">
                            <span className="publish-label">Repository</span>
                            <select value={typeof settings.repository === 'string' ? settings.repository : ''} onChange={(e) => set('repository', e.target.value)}>
                              <option value="">Choose…</option>
                              {(options?.repositories ?? []).map((r) => (
                                <option key={r.fullName} value={r.fullName}>
                                  {r.fullName}
                                  {r.private ? ' (private)' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="publish-field">
                            <span className="publish-label">Or a new repository</span>
                            <input value={typeof settings.newRepository === 'string' ? settings.newRepository : ''} spellCheck={false} maxLength={90} placeholder="my-site" onChange={(e) => set('newRepository', e.target.value)} />
                          </label>
                        </>
                      )}
                      {hostSel === 'ssh' && (
                        <>
                          <label className="publish-field">
                            <span className="publish-label">Computer</span>
                            <select value={typeof settings.computer === 'string' ? settings.computer : ''} onChange={(e) => set('computer', e.target.value)}>
                              <option value="">Choose…</option>
                              {(options?.computers ?? []).map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="publish-field">
                            <span className="publish-label">Folder on that computer</span>
                            <input value={typeof settings.folder === 'string' ? settings.folder : ''} spellCheck={false} placeholder="/var/www/my-site" onChange={(e) => set('folder', e.target.value)} />
                          </label>
                          <label className="publish-field">
                            <span className="publish-label">Web server</span>
                            <select value={typeof settings.server === 'string' ? settings.server : ''} onChange={(e) => set('server', e.target.value)}>
                              <option value="">None yet</option>
                              <option value="nginx">Nginx</option>
                              <option value="apache">Apache</option>
                              <option value="caddy">Caddy</option>
                            </select>
                          </label>
                          <label className="publish-field">
                            <span className="publish-label">Web address (when it has one)</span>
                            <input value={typeof settings.address === 'string' ? settings.address : ''} spellCheck={false} placeholder="https://…" onChange={(e) => set('address', e.target.value)} />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            {ask ? (
              <div className="publish-ask">
                <div className="publish-label">{ask.title}</div>
                <p>{ask.text}</p>
                <div className="publish-foot">
                  <button type="button" className="button" onClick={() => setAsk(null)}>
                    {ask.cancel}
                  </button>
                  <button type="button" className="button danger" disabled={busy} onClick={() => void unpublishNow(true)}>
                    {busy ? 'Unpublishing…' : ask.confirm}
                  </button>
                </div>
              </div>
            ) : done ? (
              <div className="publish-done">
                <p>{done.words}</p>
                {done.url && (
                  <p>
                    <button type="button" className="text-button" onClick={() => window.open(done.url, '_blank', 'noopener')}>
                      {done.url}
                    </button>
                  </p>
                )}
                <div className="publish-foot">
                  {site?.publishedAt && (
                    <button type="button" className="button" onClick={() => window.nv.site.open(site.id).catch(showError)}>
                      Open the folder’s site
                    </button>
                  )}
                  <button type="button" className="button primary" onClick={onClose}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="publish-foot">
                <button type="button" className="button" onClick={() => setStep('preview')}>
                  Back
                </button>
                <span className="publish-foot-actions">
                  {site?.publishedAt && (
                    <button type="button" className="button danger" disabled={busy} onClick={() => void unpublishNow(false)}>
                      Unpublish…
                    </button>
                  )}
                  <button type="button" className="button primary" disabled={busy || !sourceReady(source) || (!!hostSel && host?.connected === false)} onClick={() => void publishNow()}>
                    {busy ? 'Publishing…' : site?.publishedAt ? 'Republish' : 'Publish'}
                  </button>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
