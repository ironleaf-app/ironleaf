// Project files found by a search (src/main/file-index.ts), wherever search shows: a hit's row (its kind, name,
// project and folder, the lines where the words are, marked, with the page, slide or sheet), the line that says the
// index is reading, and the file shown over the window from a hit — Ironleaf's own viewer for pictures, PDFs and
// recordings; for Word, Excel, PowerPoint and text, the words in it with the words searched for marked, scrolled to the
// first. Open in its program and Show in folder are always a click away.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { FileHit, FileTextState } from '../../../shared/file-index';
import { sizeWords, whenAgo } from '../lib/projectLook';
import { closeFileHit, markRanges, openHitInProgram, progressWords, searchWords, showFileHit, showHitInFolder, stepFileHit, useFileIndexStatus, useShownFileHit } from '../state/fileSearch';
import { folderFileUrl, viewerFor } from '../views/project/fileModel';
import { FileView, RemoteWordsBody } from '../views/project/FilePreview';
import { KindTile, kindWords } from '../views/project/FileArt';
import { plainLine } from '../../../shared/snippet';
import { Icon } from './Icon';
import type { PickerMore } from './Picker';
import { isRemoteHandle } from '../../../shared/project-folder';

/** Text with its marked parts. */
export function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** A snippet without its Markdown marks (src/shared/snippet.ts); the marked words move with the text. */
export function plainSnippet(raw: string, rawRanges: [number, number][]): { text: string; ranges: [number, number][] } {
  return plainLine(raw, rawRanges);
}

const folderOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const placeWords = (where: string) => where.charAt(0).toUpperCase() + where.slice(1);

/** One project file found: a whole row to open, its words marked; open in its program or show in its folder on hover. */
export function FileHitRow({ hit, query, onOpen, compact }: { hit: FileHit; query: string; onOpen(hit: FileHit): void; compact?: boolean }) {
  const words = useMemo(() => searchWords(query), [query]);
  const sub = folderOf(hit.rel);
  const snippets = compact ? hit.snippets.slice(0, 1) : hit.snippets;
  return (
    <div
      className={`fh-row${compact ? ' is-compact' : ''}`}
      role="button"
      tabIndex={0}
      title={`${hit.projectName} · ${hit.rel}`}
      onClick={() => onOpen(hit)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) openHitInProgram(hit);
          else onOpen(hit);
        }
      }}
    >
      <KindTile ext={hit.ext} />
      <span className="fh-words">
        <span className="fh-top">
          <span className="fh-name">
            <Marked text={hit.name} ranges={markRanges(hit.name, words)} />
          </span>
          <span className="fh-when">{whenAgo(hit.modified)}</span>
        </span>
        <span className="fh-where">
          <span className="fh-project">{hit.projectName}</span>
          {sub && <span className="fh-sub">{sub}</span>}
        </span>
        {snippets.map((s, i) => {
          const p = plainSnippet(s.text, s.ranges);
          return (
            <span key={i} className="fh-snippet">
              {s.where && <span className="fh-place">{placeWords(s.where)}</span>}
              <span className="fh-snippet-text">
                <Marked text={p.text} ranges={p.ranges} />
              </span>
            </span>
          );
        })}
        {!snippets.length && <span className="fh-byname">{hit.state === 'text' ? 'Its name matches' : nameOnlyWords(hit.state)}</span>}
      </span>
      <span className="fh-actions">
        <button
          className="icon-button small"
          title="Open in its program (Ctrl+Enter)"
          aria-label="Open in its program"
          onClick={(e) => {
            e.stopPropagation();
            openHitInProgram(hit);
          }}
        >
          <Icon name="external" size={13} />
        </button>
        <button
          className="icon-button small"
          title="Show in folder"
          aria-label="Show in folder"
          onClick={(e) => {
            e.stopPropagation();
            showHitInFolder(hit);
          }}
        >
          <Icon name="reveal" size={13} />
        </button>
      </span>
    </div>
  );
}

function nameOnlyWords(state: FileTextState): string {
  switch (state) {
    case 'name':
      return 'Found by its name';
    case 'empty':
      return 'Its name matches · no words inside (a scan?)';
    case 'big':
      return 'Its name matches · too big to read inside';
    case 'failed':
      return 'Its name matches · couldn’t be read inside';
    case 'full':
      return 'Its name matches';
    default:
      return 'Its name matches';
  }
}

/** "Reading project files… 34 of 79 · Studio Upgrade" while the index reads. */
export function FileIndexLine({ className = '' }: { className?: string }) {
  const s = useFileIndexStatus();
  const words = progressWords(s);
  if (!words) return null;
  const share = s && s.todo ? Math.min(100, Math.round((s.done / s.todo) * 100)) : 0;
  return (
    <div className={`fh-progress ${className}`} role="status" aria-live="polite">
      <span className="fh-progress-words">{words}</span>
      <span className="fh-progress-bar" aria-hidden="true">
        <i style={{ width: `${share}%` }} />
      </span>
    </div>
  );
}

// ── The file shown from a hit ─────────────────────────────────────────────────────────────────────────────────────

/** Shows the file a hit names over the window (mounted once, in App). */
export function FileHitViewerHost() {
  const shown = useShownFileHit();
  if (!shown) return null;
  return createPortal(<FileHitViewer key={`${shown.hit.project}|${shown.hit.rel}`} hit={shown.hit} list={shown.list} query={shown.query} />, document.body);
}

/** Pictures, PDFs, video and recordings show as they are; the rest as their words. */
const showsItself = (ext: string) => ['image', 'pdf', 'video', 'audio'].includes(viewerFor(ext));

function FileHitViewer({ hit, list, query }: { hit: FileHit; list: FileHit[]; query: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeFileHit();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && list.length > 1 && !(e.target as Element)?.closest?.('input, textarea')) {
        e.preventDefault();
        stepFileHit(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    box.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [list.length]);
  const at = list.findIndex((h) => h.project === hit.project && h.rel === hit.rel);
  const sub = folderOf(hit.rel);
  const file = { rel: hit.rel, name: hit.name, ext: hit.ext, size: hit.size, modified: hit.modified };
  const page = /^page (\d+)$/.exec(hit.snippets[0]?.where ?? '')?.[1];
  // A remote computer's file: shown here, read only (its own programs are on that computer).
  const remote = isRemoteHandle(hit.folder);
  const place = hit.remoteName ?? 'the remote computer';
  return (
    <div className="overlay pf-overlay fh-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeFileHit()}>
      <div className="pf-overlay-box" role="dialog" aria-label={hit.name} tabIndex={-1} ref={box}>
        <header className="pf-overlay-head">
          <KindTile ext={hit.ext} />
          <span className="pf-preview-title">
            <span className="pf-preview-name" title={hit.rel}>
              {hit.name}
            </span>
            <span className="pf-preview-meta">{[hit.projectName, remote ? `on ${place}` : '', sub, kindWords(hit.ext), hit.size ? sizeWords(hit.size) : '', hit.modified ? `changed ${whenAgo(hit.modified)}` : ''].filter(Boolean).join(' · ')}</span>
          </span>
          {list.length > 1 && (
            <span className="fh-steps">
              <button className="icon-button" title="The one before (←)" onClick={() => stepFileHit(-1)}>
                <Icon name="back" size={16} />
              </button>
              <span className="fh-step-count">
                {at + 1} of {list.length}
              </span>
              <button className="icon-button" title="The next one (→)" onClick={() => stepFileHit(1)}>
                <Icon name="forward" size={16} />
              </button>
            </span>
          )}
          {remote ? (
            <span className="pf-remote-note" title="Ironleaf reads this computer’s files and never changes them">
              <Icon name="lock" size={12} /> Read only
            </span>
          ) : (
            <>
              <button className="button" onClick={() => showHitInFolder(hit)}>
                <Icon name="reveal" size={14} /> Show in folder
              </button>
              <button className="button primary" onClick={() => openHitInProgram(hit)}>
                <Icon name="external" size={14} /> Open in its program
              </button>
            </>
          )}
          <button className="icon-button" title="Close (Esc)" onClick={closeFileHit}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="pf-overlay-body">
          {showsItself(hit.ext) ? (
            viewerFor(hit.ext) === 'pdf' && page && !remote ? (
              // The PDF opens at the page the words are on.
              <iframe className="pf-view pf-view-pdf" src={`${folderFileUrl(hit.folder, hit.rel)}#page=${page}&toolbar=1&navpanes=0&view=FitH`} title={hit.name} />
            ) : (
              <FileView project={hit.project} folder={hit.folder} file={file} big place={place} />
            )
          ) : (
            <HitWords hit={hit} query={query} remote={remote ? place : ''} />
          )}
        </div>
      </div>
    </div>
  );
}

/** A file's words as the index read them, the words searched for marked, opened at the first of them (also the
 *  viewer tab's words for Word, Excel and PowerPoint files, views/FolderFileView.tsx). */
export function HitWords({ hit, query, remote = '' }: { hit: FileHit; query: string; remote?: string }) {
  const [got, setGot] = useState<{ state: FileTextState; text: string; cut: boolean } | null | undefined>(undefined);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    window.nv.fileIndex.read(hit.project, hit.rel).then(
      (r) => live && setGot(r ?? null),
      () => live && setGot(null),
    );
    return () => {
      live = false;
    };
  }, [hit.project, hit.rel, hit.modified]);
  const words = useMemo(() => searchWords(query), [query]);
  const MAX_LINES = 4000;
  const lines = useMemo(() => (got?.text ? got.text.split('\n') : []), [got]);
  // A long file: the lines around the first match are shown when it is far in.
  const firstHit = useMemo(() => (words.length ? lines.findIndex((l) => !l.startsWith('\f') && markRanges(l, words).length) : -1), [lines, words]);
  const start = firstHit > MAX_LINES - 200 ? firstHit - 200 : 0;
  const shownLines = lines.slice(start, start + MAX_LINES);
  useEffect(() => {
    const first = body.current?.querySelector('mark');
    first?.scrollIntoView({ block: 'center' });
  }, [got]);
  if (got === undefined) return <div className="fh-text pf-loading" />;
  if (got === null || got.state !== 'text')
    return (
      <div className="fh-text-empty">
        <KindTile ext={hit.ext} size="large" />
        <p>{got === null ? 'This file couldn’t be read here.' : got.state === 'empty' ? 'There are no words in this file Ironleaf can read: it may be a scan or pictures.' : got.state === 'big' ? 'This file is too big to read inside: it was found by its name.' : got.state === 'failed' ? 'This file couldn’t be read inside (it may be protected by a password, or in use).' : 'Ironleaf finds this file by its name; it doesn’t read inside this kind of file.'}</p>
        {!remote && (
          <button className="button primary" onClick={() => openHitInProgram(hit)}>
            <Icon name="external" size={14} /> Open in its program
          </button>
        )}
      </div>
    );
  // A remote computer's document: its words as the former host app's readers give them, drawn as a
  // page.
  if (remote && !words.length) return <RemoteWordsBody text={got.text} cut={got.cut} place={remote} big />;
  return (
    <div className="fh-text" ref={body}>
      <p className="fh-text-note">
        <Icon name="text" size={13} /> {remote ? `Its words, read from ${remote}.` : 'Its words, as Ironleaf reads them for search. Open it in its program to see it as it looks.'}
      </p>
      {start > 0 && <p className="fh-text-more">… {start} lines before</p>}
      {shownLines.map((line, i) =>
        line.startsWith('\f') ? (
          <h4 key={i} className="fh-text-place">
            {placeWords(line.slice(1))}
          </h4>
        ) : (
          <p key={i} className="fh-text-line">
            <Marked text={line} ranges={words.length ? markRanges(line, words) : []} />
          </p>
        ),
      )}
      {(got.cut || start + MAX_LINES < lines.length) && <p className="fh-text-more">{remote ? 'The start of the file.' : 'The rest is in the file: open it in its program.'}</p>}
    </div>
  );
}

// ── In Open a note and the command list ───────────────────────────────────────────────────────────────────────────

/**
 * Project files as a section of a picker (Open a note, the command list): "In project files", each with its kind,
 * project and the line where the words are. `pick` shows the file when the row picked is one of these.
 */
export function fileHitsSection(limit = 8): { more: PickerMore; pick(id: string, mod: boolean): boolean } {
  // Each query's own answers (9.2 uplift F125): a row carries its query plus its file's stable identity, never a
  // position into one shared latest list — a later keystroke answering first can no longer steer Enter elsewhere.
  const byQuery = new Map<string, FileHit[]>();
  const keyOf = (h: FileHit): string => `${h.project}\n${h.rel}`;
  return {
    more: {
      title: 'In project files',
      min: 3,
      load: async (q) => {
        const hits = await window.nv.fileIndex.search(q, { limit });
        byQuery.set(q, hits);
        while (byQuery.size > 8) byQuery.delete(byQuery.keys().next().value!);
        const words = searchWords(q);
        return hits.map((h) => {
          const s = h.snippets[0];
          const p = s ? plainSnippet(s.text, s.ranges) : null;
          return {
            id: `pf:${encodeURIComponent(q)}:${encodeURIComponent(keyOf(h))}`,
            label: <Marked text={h.name} ranges={markRanges(h.name, words)} />,
            detail: [h.projectName, folderOf(h.rel)].filter(Boolean).join(' · '),
            lead: <KindTile ext={h.ext} />,
            sub: p ? (
              <>
                {s!.where && <span className="fh-place">{placeWords(s!.where)}</span>}
                <Marked text={p.text} ranges={p.ranges} />
              </>
            ) : undefined,
          };
        });
      },
    },
    pick(id, mod) {
      if (!id.startsWith('pf:')) return false;
      const rest = id.slice(3);
      const sep = rest.indexOf(':');
      const q = decodeURIComponent(rest.slice(0, sep));
      const key = decodeURIComponent(rest.slice(sep + 1));
      const hits = byQuery.get(q) ?? [];
      const hit = hits.find((h) => keyOf(h) === key);
      if (hit) {
        if (mod) openHitInProgram(hit);
        else showFileHit(hit, hits, q);
      }
      return true;
    },
  };
}
