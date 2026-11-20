// A file's details in the peek (Wave 4 part c, 24 Oct 2026; src/main/vault-files.ts): what it is (its kind, pages, title
// and one line on what it says, read from the file itself, or summarised by the assistant when the file's level lets the
// side chat read it), what it is for, what it belongs to, where it came from (who sent it, how, when), its sensitivity,
// and its versions: the latest (what links reach) and the older ones kept, each opened, compared with the latest or
// brought back (nothing is lost). A file linked where it is on the PC says where, and opens from there.

import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PURPOSES, dayWords, sizeWords, sourceWords, type VersionRow } from '../../../shared/file-records';
import type { CompareResult, FileInfo } from '../../../shared/vault-files-api';
import { errorMessage } from '../lib/errors';
import { showError, toast, useApp } from '../state/store';
import { peek } from '../state/peek';
import { Icon } from './Icon';
import { LevelChip } from './LevelPicker';
import { choose } from './Dialogs';
import { folderFileUrl } from '../views/project/fileModel';

const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.(md|canvas)$/i, '');
const BY_WORDS: Record<NonNullable<FileInfo['summaryBy']>, string> = { file: 'Read from the file', assistant: 'Written by the assistant', agent: 'From the agent that sent it', you: 'Written by you' };

export function FileCard({ path }: { path: string }) {
  const revision = useApp((s) => s.filesRevision);
  const canEdit = useApp((s) => s.canEdit);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    let live = true;
    window.nv.vfiles.info(path).then(
      (i) => {
        if (!live) return;
        setInfo(i);
        setProblem('');
      },
      (e) => live && setProblem(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [path, revision]);
  if (problem) return <p className="fc-problem">{problem}</p>;
  if (!info) return <div className="fc-loading" aria-busy="true" />;

  const run = async (what: string, fn: () => Promise<FileInfo | null | void>) => {
    setBusy(what);
    try {
      const next = await fn();
      if (next) setInfo(next);
    } catch (err) {
      showError(err);
    } finally {
      setBusy('');
    }
  };
  const latest = info.versions.find((v) => v.latest);
  const older = info.versions.filter((v) => !v.latest);
  const folder = info.folder;

  return (
    <div className="fc">
      {/* What it is */}
      <section className="fc-what" aria-label="What it is">
        <div className="fc-kind">
          <Icon name={info.ext === 'pdf' ? 'pdf' : /^(png|jpe?g|gif|webp|svg|heic)$/.test(info.ext) ? 'image' : /^(mp4|mov|m4v|webm)$/.test(info.ext) ? 'video' : /^(mp3|wav|m4a|ogg|weba)$/.test(info.ext) ? 'audio' : 'doc'} size={14} />
          <span>{info.what}</span>
        </div>
        {info.title && info.title !== info.name && <h3 className="fc-title">{info.title}</h3>}
        {editing ? (
          <div className="fc-edit">
            <textarea className="fc-edit-box" value={draft} rows={3} maxLength={400} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run('line', () => window.nv.vfiles.set(path, { summary: draft })).then(() => setEditing(false));
            }} placeholder="One line on what it is and what it says" />
            <div className="fc-edit-actions">
              <button type="button" className="peek-button primary" onClick={() => void run('line', () => window.nv.vfiles.set(path, { summary: draft })).then(() => setEditing(false))}>
                Save
              </button>
              <button type="button" className="peek-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : info.summary ? (
          <p className="fc-line">
            {info.summary}
            <span className="fc-line-by">{info.summaryBy ? BY_WORDS[info.summaryBy] : ''}</span>
          </p>
        ) : (
          <p className="fc-line is-empty">{info.ref ? 'It stays where it is on this PC. Write a line to say what it is.' : 'No words to read in it here (a picture, a recording or a scan). Write a line to say what it is.'}</p>
        )}
        {canEdit && !editing && (
          <div className="fc-what-actions">
            <button type="button" className="fc-link" onClick={() => {
              setDraft(info.summary ?? '');
              setEditing(true);
            }}>
              <Icon name="pencil" size={12} />
              {info.summary ? 'Edit the line' : 'Write a line'}
            </button>
            {!info.ref && (
              info.assistant.ok ? (
                <button type="button" className="fc-link" disabled={busy === 'summary'} onClick={() => void run('summary', () => window.nv.vfiles.summarise(path))}>
                  <Icon name="sparkle" size={12} />
                  {busy === 'summary' ? 'Summarising…' : 'Summarise with the assistant'}
                </button>
              ) : (
                <span className="fc-note" title={info.assistant.why}>
                  <Icon name="lock" size={12} />
                  The assistant can’t read this one
                </span>
              )
            )}
          </div>
        )}
      </section>

      {/* Its facts */}
      <dl className="peek-facts fc-facts">
        <div className="peek-fact">
          <dt>For</dt>
          <dd>
            {canEdit ? (
              <select className="fc-select" value={info.purpose} onChange={(e) => void run('purpose', () => window.nv.vfiles.set(path, { purpose: e.target.value }))} aria-label="What it is for">
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            ) : (
              info.purpose
            )}
            {!info.purposeChosen && <span className="peek-soft"> · from its name</span>}
          </dd>
        </div>
        {info.record && (
          <div className="peek-fact">
            <dt>Belongs to</dt>
            <dd>
              <button type="button" className="peek-fact-link" onClick={() => peek({ path: info.record! }, { title: titleOf(info.record!) })}>
                {titleOf(info.record)}
              </button>
            </dd>
          </div>
        )}
        <div className="peek-fact">
          <dt>Came from</dt>
          <dd>{info.sourceWords || <span className="peek-soft">Not recorded (it was here before Ironleaf kept sources)</span>}</dd>
        </div>
        {info.source?.from && info.source.how === 'url' && (
          <div className="peek-fact">
            <dt>Address</dt>
            <dd className="fc-mono">{info.source.from}</dd>
          </div>
        )}
        <div className="peek-fact">
          <dt>Sensitivity</dt>
          <dd>
            {info.ref ? <span className="peek-soft">As its note’s folder says</span> : <LevelChip path={path} always />}
          </dd>
        </div>
        <div className="peek-fact">
          <dt>{info.ref ? 'On this PC' : 'In'}</dt>
          <dd>
            {info.ref ? (
              <>
                <span className="fc-mono">{info.ref.path}</span>
                {info.ref.missing && (
                  <span className="fc-warn">
                    <Icon name="warning" size={12} />
                    It isn’t there any more (moved, renamed or deleted on this PC).
                  </span>
                )}
              </>
            ) : (
              <button type="button" className="peek-fact-link" title="Show it in File Explorer" onClick={() => void window.nv.files.reveal(path).catch(showError)}>
                {folder || 'The top of the vault'}
              </button>
            )}
          </dd>
        </div>
      </dl>
      {info.ref && (
        <div className="fc-ref-actions">
          <button type="button" className="peek-button" disabled={info.ref.missing} onClick={() => void window.nv.vfiles.openRef(folder, info.name).catch(showError)}>
            <Icon name="external" size={13} />
            Open from this PC
          </button>
          <button type="button" className="peek-button" disabled={info.ref.missing} onClick={() => void window.nv.vfiles.showRef(folder, info.name).catch(showError)}>
            <Icon name="reveal" size={13} />
            Show in folder
          </button>
          {canEdit && (
            <button type="button" className="peek-button" onClick={() => void (async () => {
              const ok = await choose(`Unlink ${info.name}?`, [{ id: 'yes', label: 'Unlink', danger: true }], 'The file stays where it is on this PC; only the link from Ironleaf goes.');
              if (ok === 'yes') await run('unlink', () => window.nv.vfiles.forgetRef(folder, info.name));
            })()}>
              Unlink
            </button>
          )}
        </div>
      )}

      {/* Versions */}
      {!info.ref && (
        <section className="fc-versions" aria-label="Versions">
          <div className="fc-head">
            <h3 className="peek-section-head">Versions</h3>
            {canEdit && (
              <button type="button" className="fc-link" disabled={!!busy} onClick={() => void run('version', async () => {
                const r = await window.nv.vfiles.addVersion(path);
                if (r && 'info' in r) {
                  toast(`${info.name} is version ${r.info.version} now. The one before is kept.`);
                  return r.info;
                }
                if (r && 'importing' in r) toast(`${r.importing.name} is coming in as the new version (it carries on after a break).`);
                return null;
              })}>
                <Icon name="history" size={12} />
                Add a newer version…
              </button>
            )}
          </div>
          {!older.length && <p className="fc-soft-line">Only this one. A newer version keeps this one as v{latest?.n ?? 1}, so you can compare or bring it back.</p>}
          <ol className="fc-version-list">
            {info.versions.map((v) => (
              <VersionLine key={`${v.n}:${v.path}`} v={v} path={path} latest={latest} canEdit={canEdit} busy={busy} onRestore={() => void run('restore', async () => {
                const ok = await choose(`Bring back v${v.n}?`, [{ id: 'yes', label: `Bring back v${v.n}`, primary: true }], `It becomes the latest (v${(latest?.n ?? 1) + 1}), and the one there now is kept as v${latest?.n ?? 1}. Nothing is lost.`);
                if (ok !== 'yes') return null;
                const next = await window.nv.vfiles.restore(path, v.n);
                toast(`v${v.n} is back as v${next.version}. The one before is kept.`);
                return next;
              })} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function VersionLine({ v, path, latest, canEdit, busy, onRestore }: { v: VersionRow; path: string; latest?: VersionRow; canEdit: boolean; busy: string; onRestore(): void }) {
  const who = v.source ? sourceWords(v.source) : v.added ? `Added ${dayWords(v.added)}` : '';
  return (
    <li className={`fc-version${v.latest ? ' is-latest' : ''}`}>
      <span className="fc-version-n">v{v.n || '?'}</span>
      <span className="fc-version-main">
        <span className="fc-version-top">
          {v.latest ? <span className="fc-badge">Latest</span> : <span className="fc-badge is-old">{v.named ? 'Older file' : 'Superseded'}</span>}
          {v.named && <span className="fc-version-name">{v.name}</span>}
          {v.size !== undefined && <span className="peek-soft">{sizeWords(v.size)}</span>}
        </span>
        {who && <span className="fc-version-who">{who}</span>}
      </span>
      {!v.latest && (
        <span className="fc-version-actions">
          <button type="button" className="fc-mini" title="Open this version" onClick={() => void (v.named ? window.nv.files.openDefault(v.path) : window.nv.vfiles.openVersion(path, v.n)).catch(showError)}>
            Open
          </button>
          {latest && (
            <button type="button" className="fc-mini" title="What changed between this one and the latest" onClick={() => openCompare(path, v, latest)}>
              Compare
            </button>
          )}
          {canEdit && !v.named && (
            <button type="button" className="fc-mini" disabled={!!busy} onClick={onRestore}>
              Bring back
            </button>
          )}
        </span>
      )}
    </li>
  );
}

// ── Compare two versions ──

let host: { el: HTMLDivElement; root: Root } | null = null;

export function openCompare(path: string, a: VersionRow, b: VersionRow): void {
  if (!host) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    host = { el, root: createRoot(el) };
  }
  const close = () => host?.root.render(null);
  host.root.render(<Compare key={`${path}:${a.n}:${b.n}:${Date.now()}`} path={path} a={a} b={b} onClose={close} />);
}

function Compare({ path, a, b, onClose }: { path: string; a: VersionRow; b: VersionRow; onClose(): void }) {
  const [r, setR] = useState<CompareResult | null>(null);
  const [problem, setProblem] = useState('');
  const [urls, setUrls] = useState<{ a: string; b: string } | null>(null);
  useEffect(() => {
    // Named versions are files of their own: compared by their own paths through the latest's record.
    window.nv.vfiles.compare(path, a.n, b.n).then(setR, (e) => setProblem(errorMessage(e)));
    // Esc closes the comparison only (the peek under it stays open).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (!r?.pictures) return;
    const url = (abs: string) => {
      const p = abs.replace(/\\/g, '/');
      const at = p.lastIndexOf('/');
      return folderFileUrl(p.slice(0, at), p.slice(at + 1));
    };
    setUrls({ a: url(r.pictures.a), b: url(r.pictures.b) });
  }, [r]);
  const name = path.split('/').pop() ?? path;
  return (
    <div className="fc-compare-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fc-compare" role="dialog" aria-label={`Compare versions of ${name}`}>
        <header className="fc-compare-head">
          <div>
            <h2>
              {name}: v{a.n} and v{b.n}
            </h2>
            <p className="fc-compare-sub">
              {r ? (r.rows ? (r.same ? 'The words are the same in both.' : `${r.added ?? 0} ${r.added === 1 ? 'line' : 'lines'} added and ${r.removed ?? 0} taken out in v${b.n}.`) : r.pictures ? 'Side by side.' : r.note) : problem || 'Reading both…'}
            </p>
          </div>
          <button type="button" className="peek-icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        {r && (
          <div className="fc-compare-meta">
            {[r.a, r.b].map((x) => (
              <div key={x.n} className="fc-compare-side">
                <span className="fc-badge is-old">v{x.n}</span>
                <span>
                  {sizeWords(x.size)}
                  {x.pages ? ` · ${x.pages} pages` : ''}
                </span>
                {x.summary && <span className="fc-compare-sum">{x.summary}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="fc-compare-body">
          {r?.rows && !r.same && (
            <ol className="fc-diff">
              {r.rows.map((row, i) =>
                row.kind === 'gap' ? (
                  <li key={i} className="fc-diff-gap">
                    {row.count} {row.count === 1 ? 'line' : 'lines'} the same
                  </li>
                ) : (
                  <li key={i} className={`fc-diff-${row.kind}`}>
                    <span className="fc-diff-mark" aria-hidden="true">
                      {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
                    </span>
                    <span className="fc-diff-text">{row.text.replace(/\n$/, '') || ' '}</span>
                  </li>
                ),
              )}
            </ol>
          )}
          {r?.pictures && urls && (
            <div className="fc-pictures">
              <figure>
                <img src={urls.a} alt={`v${a.n}`} />
                <figcaption>v{a.n}</figcaption>
              </figure>
              <figure>
                <img src={urls.b} alt={`v${b.n}`} />
                <figcaption>v{b.n}</figcaption>
              </figure>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
