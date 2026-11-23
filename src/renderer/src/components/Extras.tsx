// Earlier versions (file recovery, with who made each change and what it changed), and Present as slides.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Snapshot, SnapshotFile } from '../../../shared/types';
import { changeCounts, changeRows, wordParts } from '../../../shared/note-diff';
import { authorWords } from '../../../shared/versions';
import { hydrate } from '../lib/hydrate';
import { renderMarkdown } from '../lib/markdownRender';
import { useEscape } from '../lib/useEscape';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { setWorkspace, useWorkspace } from '../state/layout';
import { openTypePage } from '../state/noteTypes';
import * as W from '../state/workspace';
import { getState, loadFiles, loadNotes, showError, toast, useApp, usePrefs } from '../state/store';
import { Crumbs, ViewHeader } from '../views/ViewHeader';
import { confirm } from './Dialogs';
import { Icon } from './Icon';
import { EmptyState, LoadingRows } from './EmptyState';

const when = (t: number) => new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
/** Who made a version, or for one from the Git backup (Settings › Backup and sync; 21 Oct 2026) "Git backup". */
const byWords = (v: Snapshot) => (v.from === 'git' ? 'Git backup' : authorWords(v.by));

/** What changed from the version before, line by line: lines taken out struck through, lines put in tinted, long runs
 *  that stayed the same folded. */
export function ChangeRows({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => changeRows(before, after), [before, after]);
  if (!rows.some((r) => r.kind === 'add' || r.kind === 'del')) return <p className="hint recovery-same">The words are the same as the version before.</p>;
  return (
    <div className="recovery-diff" role="list">
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          <div key={i} className="recovery-diff-gap" role="listitem">
            {r.count === 1 ? '1 line the same' : `${r.count} lines the same`}
          </div>
        ) : (
          <div key={i} className={`recovery-diff-line is-${r.kind}`} role="listitem" aria-label={r.kind === 'add' ? 'Added' : r.kind === 'del' ? 'Taken out' : undefined}>
            <span className="recovery-diff-sign" aria-hidden="true">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span>
            <span className="recovery-diff-text">{r.text || '\u00a0'}</span>
          </div>
        ),
      )}
    </div>
  );
}

/** Words in a version, and how many differ from the current copy. */
function wordsOf(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Earlier versions as a page (8.7 w4a round 2): the copies of one note down the left (when, how many words changed,
 * Preview, Put back), the one picked against the current copy on the right — words taken out struck through, words
 * put in tinted — and Put this one back (itself kept as a new version, so bringing one back can be undone the same
 * way). Who made each change (you, an app, a sync; 19 Oct 2026, 5.0.0) shows above the preview.
 * Opened for a note (Notes / the note / Earlier versions), or bare with a note picked at the top.
 */
export function VersionsPage({ tab }: { tab: W.TabState }) {
  const fromNote = tab.path || undefined;
  const prefs = usePrefs();
  const [files, setFiles] = useState<SnapshotFile[] | null>(null);
  const [chosen, setChosen] = useState<string | undefined>(fromNote);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  // Which note's copies `versions` holds (none read yet shows the loading rows, never "no copies" for a moment).
  const [versionsOf, setVersionsOf] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [current, setCurrent] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [show, setShow] = useState<'changes' | 'page'>('changes');
  const canEdit = useApp((s) => s.canEdit);
  const body = useRef<HTMLDivElement>(null);
  const ws = useWorkspace();

  useEffect(() => {
    void window.nv.recovery.list().then(setFiles).catch(() => setFiles([]));
  }, []);
  useEffect(() => {
    if (!chosen) return;
    setVersion(null);
    setText('');
    setCurrent('');
    setTexts({});
    void window.nv.recovery.versions(chosen).then((v) => {
      setVersions(v);
      setVersionsOf(chosen);
      if (v[0]) setVersion(v[0].id);
    }, () => (setVersions([]), setVersionsOf(chosen)));
  }, [chosen]);
  // The version shown, against the current copy (the newest one).
  const shownVersion = useMemo(() => versions.find((v) => v.id === version), [versions, version]);
  const isCurrent = versions.length > 0 && version === versions[0]?.id;
  useEffect(() => {
    if (!chosen || !version) return;
    let alive = true;
    void window.nv.recovery.read(chosen, version).then((t) => alive && (setText(t), setTexts((m) => ({ ...m, [version]: t }))), () => alive && setText(''));
    const newest = versions[0];
    if (newest && newest.id !== version) void window.nv.recovery.read(chosen, newest.id).then((t) => alive && (setCurrent(t), setTexts((m) => ({ ...m, [newest.id]: t }))), () => alive && setCurrent(''));
    else setCurrent('');
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, version]);
  // Every copy's words, in the background, for the list's word counts.
  useEffect(() => {
    if (!chosen || !versions.length) return;
    let alive = true;
    void Promise.all(
      versions.filter((v) => texts[v.id] === undefined).map((v) => window.nv.recovery.read(chosen, v.id).then((t) => alive && setTexts((m) => (m[v.id] === undefined ? { ...m, [v.id]: t } : m)), () => undefined)),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, versions]);
  const changesShown = show === 'changes' && !isCurrent && !!current;
  // The preview's name sits above it, so a first heading that only repeats the note's name is not shown twice.
  const html = useMemo(() => {
    const h = /^\s*#\s+(.+?)\s*(?:\r?\n|$)/.exec(text);
    const same = !!h && !!chosen && h[1].trim().toLowerCase() === A.titleOf(chosen).trim().toLowerCase();
    return renderMarkdown(same ? text.slice(h![0].length) : text, { from: chosen });
  }, [text, chosen]);
  useEffect(() => {
    if (body.current && !changesShown) void hydrate(body.current, 1);
  }, [html, changesShown]);
  const counts = useMemo(() => (current && text ? changeCounts(current, text) : null), [current, text]);

  const restore = async (id: string, words: string) => {
    if (!chosen || !words) return;
    const exists = getState().files.some((f) => f.rel === chosen);
    const at = versions.find((v) => v.id === id)?.time ?? Number(id);
    if (exists && !(await confirm(`Put back this version of “${A.titleOf(chosen)}”?`, { message: 'The note as it is now is kept here as a version first, so you can come back to it.', ok: 'Put it back' }))) return;
    try {
      if (exists) {
        await docs.settle();
        const text = words;
        await window.nv.notes.write(chosen, text, 'restored');
        await docs.changedOnDisk([chosen]);
      } else await window.nv.notes.create(chosen, words);
      await Promise.all([loadNotes(), loadFiles()]);
      // The copies list read again (9.2 uplift F133): the put-back made a new current, so the list and its tag
      // follow the fresh list, never the pre-restore one.
      const fresh = await window.nv.recovery.versions(chosen).catch(() => null);
      if (fresh) {
        setVersions(fresh);
        setTexts({});
        setVersion(fresh[0]?.id ?? null);
      } else setVersion(versions[0]?.id ?? null);
      toast(`“${A.titleOf(chosen)}” is back as it was ${when(at)}.`, { label: 'Open', run: () => A.openPath(chosen, { reuse: true }) });
    } catch (err) {
      showError(err);
    }
  };
  const putBackRow = (id: string) => {
    const words = texts[id];
    if (words !== undefined) return void restore(id, words);
    if (!chosen) return;
    void window.nv.recovery.read(chosen, id).then((t) => restore(id, t), showError);
  };

  const gone = (p: string) => !getState().files.some((x) => x.rel === p);
  useEscape(() => {
    const live = W.groups(ws.root).flatMap((g) => g.tabs).find((t) => t.id === tab.id) ?? tab;
    if (live.back.length) setWorkspace((w) => W.navigate(w, tab.id, -1));
  });
  const newestText = versions.length ? (texts[versions[0].id] ?? (isCurrent ? text : current)) : '';
  return (
    <>
      <ViewHeader
        tab={tab}
        crumb={
          <Crumbs
            trail={
              chosen
                ? [
                    { key: 'notes', label: 'Notes', onClick: () => openTypePage('note') },
                    { key: 'note', label: A.titleOf(chosen), onClick: () => A.openPath(chosen) },
                  ]
                : [{ key: 'settings', label: 'Settings', onClick: () => A.openSettings('backups') }]
            }
            here={<b>Earlier versions</b>}
          />
        }
      />
      <div className="nv-page-scroll">
        {/* versions-dialog kept as an alias: the smoke check finds the note picker through it. */}
        <div className="nv-page full versions-page versions-dialog">
          <h1 className="w4a-title">Earlier versions</h1>
          <p className="vsub versions-lead">
            {prefs.recoveryMinutes ? `A copy is kept every ${prefs.recoveryMinutes} minutes, for ${prefs.recoveryDays} days, on this PC.` : `Copies are kept for ${prefs.recoveryDays} days, on this PC.`} Pick one to read it. Put it back only if you say so.
          </p>
          {!fromNote && (
            <div className="field versions-pick">
              <label htmlFor="versions-note">Note</label>
              <select id="versions-note" className="setting-input" value={chosen ?? ''} onChange={(e) => setChosen(e.target.value || undefined)}>
                {!chosen && <option value="">Pick a note…</option>}
                {(files ?? []).map((f) => (
                  <option key={f.path} value={f.path}>
                    {A.titleOf(f.path)}{gone(f.path) ? ' (deleted)' : ''} · {f.count} {f.count === 1 ? 'copy' : 'copies'}
                  </option>
                ))}
              </select>
            </div>
          )}
          {files === null ? (
            <LoadingRows rows={5} label="Looking for copies" />
          ) : !files.length ? (
            <EmptyState icon="history" title="No copies yet" line="Ironleaf keeps one as notes change (Settings › Backups and sync › Recovery)." />
          ) : !chosen ? (
            <EmptyState icon="history" title="Pick a note" line="Choose it above: its copies show here, newest first." />
          ) : versionsOf !== chosen ? (
            <LoadingRows rows={5} label="Looking for copies" />
          ) : !versions.length ? (
            // Opened from a note that has no copy yet (wide-window pass: it said "Pick a note" with nothing to pick).
            <EmptyState
              icon="history"
              title="No earlier copies of this note yet"
              line={prefs.recoveryMinutes ? `A copy is kept every ${prefs.recoveryMinutes} minutes while it changes.` : 'A copy is kept as it changes.'}
              action={{ label: 'Back to the note', run: () => A.openPath(chosen) }}
              also={{ label: 'Recovery settings', icon: 'settings', run: () => A.openSettings('backups') }}
            />
          ) : (
            <div className="vwrap">
              <div className="vlist">
                <h2 className="glabel vlist-head">{versions.length} {versions.length === 1 ? 'copy' : 'copies'}</h2>
                <ul className="vlist-rows" role="list">
                  {versions.map((v) => (
                    <VersionRow key={v.id} v={v} words={texts[v.id]} newest={newestText} active={version === v.id} isCurrent={versions[0]?.id === v.id} onPick={() => setVersion(v.id)} onPutBack={() => putBackRow(v.id)} />
                  ))}
                </ul>
              </div>
              <div className="vprev">
                <div className="vprev-head">
                  <h2 className="vprev-title">{chosen ? A.titleOf(chosen) : ''}</h2>
                  {/* When and who, then where it stands, as separate words rather than one dotted string. */}
                  <p className="vprev-meta">
                    {shownVersion && <span>{new Date(shownVersion.time).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
                    {shownVersion && <span>{byWords(shownVersion)}</span>}
                    {!isCurrent && current ? <span className="tag">Against current</span> : isCurrent ? <span className="tag">Current</span> : null}
                  </p>
                </div>
                {!isCurrent && (
                  <div className="seg small vprev-seg">
                    <button className={show === 'changes' ? 'on' : ''} aria-pressed={show === 'changes'} onClick={() => setShow('changes')}>What changed</button>
                    <button className={show === 'page' ? 'on' : ''} aria-pressed={show === 'page'} onClick={() => setShow('page')}>As it reads</button>
                  </div>
                )}
                {changesShown ? (
                  <VersionCompare before={current} after={text} />
                ) : (
                  // Rendered with raw HTML switched off (markdownRender.ts).
                  <div ref={body} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
                )}
                {counts && !isCurrent && (counts.added || counts.removed) ? (
                  <p className="sx-faint">
                    {wordsOf(text)} words · {counts.added + counts.removed} {counts.added + counts.removed === 1 ? 'word' : 'words'} differ from current
                  </p>
                ) : null}
                <div className="vprev-actions">
                  {!isCurrent && (
                    <>
                      <button className="btn pri" disabled={!text || !canEdit} onClick={() => void restore(version ?? '', text)}>Put this one back</button>
                      <button className="btn" onClick={() => setVersion(versions[0].id)}>Back to current</button>
                    </>
                  )}
                  <button className="btn quiet" disabled={!text} onClick={() => void navigator.clipboard.writeText(text).then(() => toast('Copied.'))}>
                    <Icon name="copy" size={13} /> Copy
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** One copy in the list: when, how many words (and how many changed against current), Preview and Put back. */
function VersionRow({ v, words, newest, active, isCurrent, onPick, onPutBack }: { v: Snapshot; words: string | undefined; newest: string; active: boolean; isCurrent: boolean; onPick(): void; onPutBack(): void }) {
  const diff = !isCurrent && words !== undefined && newest ? changeCounts(newest, words) : null;
  const changed = diff ? diff.added + diff.removed : null;
  return (
    <li className={`vrow${active ? ' sel' : ''}`}>
      <button className="vrow-pick" onClick={onPick} aria-current={active ? true : undefined} aria-label={`Read the copy from ${when(v.time)}`}>
        <span className="w">{when(v.time)}</span>
        <span className="m">
          {words === undefined ? `${byWords(v)}` : `${wordsOf(words)} words${isCurrent ? ', current' : changed === null ? '' : changed === 0 ? ', same as current' : `, ${changed} ${changed === 1 ? 'word' : 'words'} changed`}`}
        </span>
      </button>
      {!isCurrent && (
        <span className="ctl">
          <button className="mini" onClick={onPick}>Preview</button>
          <button className="mini" onClick={onPutBack}>Put back</button>
        </span>
      )}
    </li>
  );
}

/** A version against the current copy, paragraph by paragraph: words taken out struck through, words put in tinted. */
function VersionCompare({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => changeRows(before, after), [before, after]);
  if (!rows.some((r) => r.kind === 'add' || r.kind === 'del')) return <p className="sx-faint">The words are the same as the current copy.</p>;
  const out: ReactNode[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'gap') {
      out.push(<p key={i} className="vw-gap">{r.count === 1 ? '1 line the same' : `${r.count} lines the same`}</p>);
    } else if (r.kind === 'same') {
      out.push(<p key={i}>{r.text || ' '}</p>);
    } else if (r.kind === 'del' && rows[i + 1]?.kind === 'add') {
      const parts = wordParts(r.text, (rows[i + 1] as { text: string }).text);
      i++;
      out.push(
        <p key={i}>
          {parts.map((p, n) => (p.kind === 'del' ? <del key={n}>{p.text}</del> : p.kind === 'add' ? <ins key={n}>{p.text}</ins> : <span key={n}>{p.text}</span>))}
        </p>,
      );
    } else if (r.kind === 'del') {
      out.push(<p key={i}><del>{r.text}</del></p>);
    } else {
      out.push(<p key={i}><ins>{r.text}</ins></p>);
    }
  }
  return <div className="vw-compare">{out}</div>;
}

/** Present as slides: the note split at each --- line (or each top heading), one slide at a time, full screen. */
export function SlidesModal({ path, onClose }: { path: string; onClose(): void }) {
  const [slides, setSlides] = useState<string[]>([]);
  const [at, setAt] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void (async () => {
      const text = (docs.text(path) ?? (await window.nv.notes.read(path))).replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*\r?\n/, '');
      let parts = text.split(/\r?\n-{3,}\s*\r?\n/);
      if (parts.length < 2) parts = text.split(/\r?\n(?=#{1,2}\s)/);
      setSlides(parts.map((p) => p.trim()).filter(Boolean));
    })();
  }, [path]);
  const html = useMemo(() => renderMarkdown(slides[at] ?? '', { from: path }), [slides, at, path]);
  useEffect(() => {
    if (body.current) void hydrate(body.current, 1);
  }, [html]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) setAt((i) => Math.min(slides.length - 1, i + 1));
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) setAt((i) => Math.max(0, i - 1));
      else if (e.key === 'Home') setAt(0);
      else if (e.key === 'End') setAt(slides.length - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [slides.length, onClose]);
  return (
    <div className="slides" onClick={(e) => (e.clientX > window.innerWidth / 3 ? setAt((i) => Math.min(slides.length - 1, i + 1)) : setAt((i) => Math.max(0, i - 1)))}>
      {/* Rendered with raw HTML switched off (markdownRender.ts). */}
      <div ref={body} className="slide markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="slides-bar" onClick={(e) => e.stopPropagation()}>
        <button className="icon-button" onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at === 0}>
          <Icon name="back" size={16} />
        </button>
        <span>
          {slides.length ? at + 1 : 0} / {slides.length}
        </span>
        <button className="icon-button" onClick={() => setAt((i) => Math.min(slides.length - 1, i + 1))} disabled={at >= slides.length - 1}>
          <Icon name="forward" size={16} />
        </button>
        <button className="icon-button" title="End (Esc)" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
