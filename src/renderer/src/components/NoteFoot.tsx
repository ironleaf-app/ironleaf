// The foot of every note: what connects to it, where the person finishes reading. The connected vault's join
// first (WS1 part B, 24 Oct 2026: everything joined to the note, src/shared/records.ts, grouped as the peek
// groups it: actions, meetings, people, files, decisions and risks, the timeline, projects, notes; the notes
// that link here keep the lines that do, with the link marked; each opens as itself, Ctrl+click beside it
// (t239, 12 Nov 2026: a click opens the document, never a side panel), then one Linked list
// (t7-note-window, 8 Nov 2026): links in, mentions and related merge through the one shared merge
// (src/shared/linked-list.ts), so a note in two answers is one row saying both, never two
// rows. A mention's lines each offer Link it, written through the note's own save so nothing typed there is
// lost. One list, not three tabs (5 Nov 2026, rest-quieten) and not three sections; a search box narrows the
// whole foot at once, and a long list shows six notes, then one Show-all (5 Nov 2026, v6). The backlinks,
// mentions and related notes arrive through the one shared answer (lib/noteLinks.ts, 5 Nov 2026, v6: the foot's
// read and the context rail's people and meetings share it; t27-unused-panels: the side panels are gone). It
// folds away, and stays folded or open from note to note.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { matchesQuery, snippetOf, type Snippet } from '../../../shared/note-context';
import { mergeLinked, reasonWords, type LinkedRow } from '../../../shared/linked-list';
import type { RelatedItem } from '../../../shared/related';
import { isPrivatePath } from '../../../shared/private';
import { showCount } from '../../../shared/words';
import { linkMentionLine } from '../lib/mentionLink';
import { useNoteLinks } from '../lib/noteLinks';
import { useApp } from '../state/store';
import { Icon } from './Icon';
import { ConnectedGroupList } from './Peek';
import type { ConnectedGroup, VaultRecord } from '../../../shared/records';
import { openRecordPage, peek } from '../state/peek';

const OPEN_KEY = 'nv.noteFoot.open';
const recall = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept for this time only.
  }
};

const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');

/** Jump to the foot's Linked list (t22-note-once, 8 Nov 2026: what links here lives here now, so the status
 *  line's count and the backlinks and related commands land here instead of the side). In every mode the foot
 *  sits after the last line, so going to it is one scroll; on a long note the foot only draws near the
 *  viewport, so the note goes to its end first to wake it, then lands on it. In splits the jump lands in the
 *  focused pane (t28 follow-up, 8 Nov 2026: the jump read the whole document, so it could land on the wrong
 *  pane): the workspace marks the focused pane .is-focused, and the jump stays inside it. Outside the
 *  workspace (a lone foot, no panes) the whole document is the scope, as before. */
export function goToNoteFoot() {
  const scope = document.querySelector('.group.is-focused') ?? document;
  if (!scope.querySelector('.note-foot')) {
    const scroller = scope.querySelector('.note-editor .cm-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
  let tries = 0;
  const land = () => {
    const foot = scope.querySelector('.note-foot');
    if (foot) foot.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else if (tries++ < 10) requestAnimationFrame(land);
  };
  requestAnimationFrame(land);
}

/** A snippet, its marks as <mark>: drawn as text, so nothing in another note can become markup here. */
function Marked({ snippet }: { snippet: Snippet }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  snippet.ranges.forEach(([a, b], i) => {
    if (a < at) return;
    if (a > at) parts.push(snippet.text.slice(at, a));
    parts.push(<mark key={i}>{snippet.text.slice(a, b)}</mark>);
    at = b;
  });
  parts.push(snippet.text.slice(at));
  return (
    <span className="foot-snippet-text">
      {snippet.cutStart && '…'}
      {parts}
      {snippet.cutEnd && '…'}
    </span>
  );
}

/** What a related note shares with this one, as a line with each shared thing marked. */
function sharedLine(r: RelatedItem): Snippet {
  const items = r.reasons.slice(0, 6);
  let text = '';
  const ranges: [number, number][] = [];
  items.forEach((item, i) => {
    if (i) text += ' · ';
    const start = text.length;
    text += item;
    ranges.push([start, text.length]);
  });
  if (r.reasons.length > 6) text += ` · and ${r.reasons.length - 6} more`;
  if (r.kinds.includes('linked')) text = text ? `${text} · linked` : 'Linked';
  return { text, ranges, cutStart: false, cutEnd: false };
}

const MAX_ROWS = 3;
/** A long list shows six notes, then one Show-all: everything stays a click away. */
const MAX_GROUPS = 6;

export function NoteFoot({ path, onOpen }: { path: string; onOpen(path: string, line: number | undefined, newTab: boolean): void }) {
  const revision = useApp((s) => s.revision);
  const meta = useApp((s) => s.byPath.get(path));
  const [open, setOpen] = useState(() => recall(OPEN_KEY, '1') === '1');
  const [query, setQuery] = useState('');
  const [more, setMore] = useState<Set<string>>(new Set());
  const [shownAll, setShownAll] = useState<Record<string, boolean>>({});
  // Unreadable joins say so with a retry (9.2 uplift F126), never the empty words as though true.
  const { links, failed, retry } = useNoteLinks(isPrivatePath(path) ? '' : path, revision);
  const linked = links?.backlinks ?? [];
  const mentioned = links?.unlinked ?? [];
  // One related-notes engine (9.2 uplift F59): the index's, read once in lib/noteLinks.ts — most alike first, and
  // everything but the note itself. A failed read keeps the last list, never blanks it.
  const related = useMemo(() => (links?.related ?? []).filter((x) => x.path !== path), [links, path]);
  /** What the connected vault joins to this note (null: it doesn't hold it). */
  const [connected, setConnected] = useState<ConnectedGroup[] | null>(null);
  const [peekTick, setPeekTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const names = useMemo(() => [meta?.title ?? titleOf(path), ...(meta?.aliases ?? [])], [meta, path]);

  // The foot's links arrive through the one shared answer above; only the connected vault's join reads here.
  useEffect(() => {
    let alive = true;
    void window.nv.records
      .peek({ path })
      .catch(() => null)
      .then((c) => {
        if (alive) setConnected(c ? c.groups : null);
      });
    return () => {
      alive = false;
    };
  }, [path, revision, peekTick]);

  useEffect(() => {
    setQuery('');
    setMore(new Set());
    setShownAll({});
  }, [path]);

  // One Linked list (t7-note-window, 8 Nov 2026): links in, mentions and related merge through the one
  // shared merge, so a note in two answers is one row saying both, never two rows in two sections.
  const rows = useMemo(() => mergeLinked(linked, mentioned, related).filter((r) => r.path !== path), [linked, mentioned, related, path]);
  const connectedCount = connected ? connected.reduce((n, g) => n + g.items.length, 0) : 0;

  /** Link it through the one mention-to-link write (9.2 uplift F127): the same words as the side panel. */
  const linkIt = async (source: string, line: number) => {
    const key = `${source}:${line}`;
    setBusy(key);
    try {
      await linkMentionLine(source, line, path);
    } finally {
      setBusy(null);
    }
  };

  const toggle = () =>
    setOpen((o) => {
      remember(OPEN_KEY, o ? '0' : '1');
      return !o;
    });

  // The one Linked list: six notes at first, then one Show-all (5 Nov 2026, v6: everything stays a click
  // away). Each row says how it is linked; a row's lines open at the line, and a mention's lines each offer
  // Link it; a related row keeps what it shares. Which sections show, and the Filter, are decided below, once
  // for the whole foot (rest-quieten).
  const linkedList = (listed: LinkedRow[]) => {
    const shown = shownAll.linked ? listed : listed.slice(0, MAX_GROUPS);
    return (
      <>
        <ul className="foot-list">
          {shown.map((r) => {
            const all = more.has(r.path);
            const lines = [...r.linkedLines.map((l) => ({ line: l, linkable: false })), ...r.mentionLines.map((l) => ({ line: l, linkable: true }))];
            const snippets = lines.map((l) => ({ line: l.line.line, snippet: snippetOf(l.line.context, names), linkable: l.linkable }));
            const rows = all ? snippets : snippets.slice(0, MAX_ROWS);
            const shared = r.related ? sharedLine(r.related) : null;
            return (
              <li key={r.path} className="foot-item">
                <button className="foot-item-head" title="Open (Ctrl+click: in a new tab)" onClick={(e) => onOpen(r.path, undefined, e.ctrlKey || e.metaKey)}>
                  <span className="foot-item-name">{r.title}</span>
                  {r.folder && <span className="foot-item-folder">{r.folder}</span>}
                  <span className="foot-item-why">{r.reasons.map(reasonWords).join(' · ')}</span>
                </button>
                {rows.map((s) => (
                  <div key={`${s.linkable ? 'u' : 'l'}:${s.line}`} className="foot-row">
                    <button className="foot-snippet" title="Open at this line" onClick={(e) => onOpen(r.path, s.line, e.ctrlKey || e.metaKey)}>
                      <Marked snippet={s.snippet} />
                    </button>
                    {s.linkable && (
                      <button className="foot-link-it" disabled={busy === `${r.path}:${s.line}`} title={`Make “${names[0]}” a link in ${r.title}`} onClick={() => void linkIt(r.path, s.line)}>
                        <Icon name="link" size={12} />
                        <span>Link it</span>
                      </button>
                    )}
                  </div>
                ))}
                {shared && (
                  <div className="foot-row">
                    <button className="foot-snippet is-shared" title="Open (Ctrl+click: in a new tab)" onClick={(e) => onOpen(r.path, undefined, e.ctrlKey || e.metaKey)}>
                      <Marked snippet={shared} />
                    </button>
                  </div>
                )}
                {snippets.length > MAX_ROWS && (
                  <button
                    className="foot-more"
                    onClick={() =>
                      setMore((m) => {
                        const next = new Set(m);
                        if (all) next.delete(r.path);
                        else next.add(r.path);
                        return next;
                      })
                    }
                  >
                    {all ? 'Show fewer' : `${snippets.length - MAX_ROWS} more ${snippets.length - MAX_ROWS === 1 ? 'line' : 'lines'}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {listed.length > MAX_GROUPS && (
          <button className="foot-showall" onClick={() => setShownAll((s) => ({ ...s, linked: !s.linked }))}>
            {shownAll.linked ? 'Show less' : `Show all ${listed.length}`}
          </button>
        )}
      </>
    );
  };

  /** Everything joined to the note, grouped; a note that links here keeps the lines that do. */
  const connectedList = (groups: ConnectedGroup[]) => {
    const byNote = new Map(rows.map((r) => [r.path, r]));
    const open = (r: VaultRecord, page: boolean) => (page ? openRecordPage(r, 'tab') : peek({ id: r.id }, { title: r.title, type: r.type }));
    const lines = (r: VaultRecord) => {
      const g = r.line === 0 ? byNote.get(r.path) : undefined;
      if (!g) return null;
      return (
        <div className="foot-connected-lines">
          {g.linkedLines.slice(0, 2).map((row) => (
            <button key={row.line} className="foot-snippet" title="Open at this line" onClick={(e) => onOpen(g.path, row.line, e.ctrlKey || e.metaKey)}>
              <Marked snippet={snippetOf(row.context, names)} />
            </button>
          ))}
        </div>
      );
    };
    return (
      <div className="foot-connected rec-kinds">
        {groups.map((g) => (
          <ConnectedGroupList key={g.key} g={g} onOpen={open} below={lines} shownAtFirst={6} />
        ))}
      </div>
    );
  };

  // A private note keeps to itself: nothing is worked out about it here (src/main/private-notes.ts).
  if (isPrivatePath(path)) return null;
  const total = connectedCount + rows.length;
  const byNote = new Map(rows.map((r) => [r.path, r]));
  const shownConnected = (connected ?? []).map((g) => ({ ...g, items: g.items.filter((it) => matchesQuery(query, it.record.title, it.whys.join(' '), byNote.get(it.record.path)?.linkedLines.map((l) => l.context).join(' ') ?? '')) })).filter((g) => g.items.length);
  const shownRows = rows.filter((r) => matchesQuery(query, r.title, r.folder, ...r.reasons.map(reasonWords), ...r.linkedLines.map((l) => l.context), ...r.mentionLines.map((l) => l.context), r.related ? sharedLine(r.related).text : ''));
  const filtering = query.trim().length > 0;
  // A section shows when it holds something, or when the whole foot is empty and its empty words teach (Linked:
  // where links land and what Link it does). While filtering, only matching sections show, and one line says
  // when nothing matches anywhere.
  const showConnected = filtering ? shownConnected.length > 0 : connectedCount > 0 || total === 0;
  const showLinked = filtering ? shownRows.length > 0 : rows.length > 0 || total === 0;
  const section = (label: string, count: number, body: () => ReactNode, empty: string) => (
    <section className="foot-section" aria-label={`${label}, ${count}`}>
      <h3 className="foot-section-head">
        <span>{label}</span>
        {/* Sections share the one zero rule (3 Nov 2026, fifth-round H1): a zero stays off, like a badge. */}
        {showCount(count) ? <span className="foot-count">{count}</span> : null}
      </h3>
      {count > 0 ? body() : <p className="foot-empty">{empty}</p>}
    </section>
  );

  return (
    <section className={`note-foot${open ? ' is-open' : ''}`} aria-label="Links and related notes">
      <div className="foot-bar">
        <button className="foot-fold" aria-expanded={open} title={open ? 'Fold away' : 'Show links and related notes'} onClick={toggle}>
          <Icon name="chevron" size={12} className={`tree-chevron${open ? ' open' : ''}`} />
        </button>
        {/* Folded, the bar says what it holds; open, the sections say it, so the Filter keeps the bar. */}
        {!open && (
          <button className="foot-title" aria-expanded={open} onClick={toggle} title="Show links and related notes">
            <span>Linked</span>
            {showCount(total) ? <span className="foot-count">{total}</span> : null}
          </button>
        )}
        {open && total > 0 && (
          <label className="foot-search">
            <Icon name="search" size={13} />
            <input value={query} placeholder="Filter" spellCheck={false} aria-label="Filter these notes" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          </label>
        )}
      </div>
      {open && (
        <div className="foot-body">
          {failed && !linked.length && !mentioned.length && !related.length ? (
            <p className="foot-empty">
              Couldn’t load what’s joined to this note.{' '}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  retry();
                  setPeekTick((n) => n + 1);
                }}
              >
                Try again
              </button>
            </p>
          ) : filtering && !showConnected && !showLinked ? (
            <p className="foot-empty">Nothing here matches “{query}”.</p>
          ) : (
            <>
              {showConnected && section('Connected', connectedCount, () => connectedList(filtering ? shownConnected : (connected ?? [])), 'Nothing is joined to this note yet. Links, the people it names, its actions and its project show here.')}
              {showLinked && section('Linked', rows.length, () => linkedList(filtering ? shownRows : rows), `No notes link here yet. Notes that link here, name “${names[0]}” or share its tags show here.`)}
            </>
          )}
        </div>
      )}
    </section>
  );
}
