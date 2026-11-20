// Panels about the open note: its outline, the links going out of it, the tags across all notes, and a small graph of
// what it connects to.

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { OutgoingLink, TagCount } from '../../../shared/types';
import { readProps } from '../../../shared/frontmatter';
import { livingLocal, livingScope } from '../../../shared/living-graph';
import { tagList } from '../../../shared/tags';
import { noteTags } from '../lib/noteTags';
import { readDate, shortDate } from '../lib/projectLook';
import { BrainGraphView } from '../components/BrainGraphView';
import { GraphView } from '../components/GraphView';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { useGraphData } from '../state/graphData';
import { editorFor, useEditorsVersion } from '../state/layout';
import { requestSearch } from '../state/modals';
import { useApp } from '../state/store';
import type { TabState } from '../state/workspace';

/** The open note's text, kept current as it is typed. */
export function useNoteText(path: string | undefined): string {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!path || !/\.md$/i.test(path)) {
      setText('');
      return;
    }
    let alive = true;
    let off = () => {};
    void docs.acquire(path).then((t) => {
      if (!alive) return docs.release(path);
      setText(t);
      // Coalesced (t102, 9 Nov 2026, like NoteView's fnv3 F25): the side panels re-read at most once a
      // frame instead of on every keystroke, so typing never re-renders them mid-stroke.
      let pending: string | null = null;
      let frame = 0;
      off = docs.subscribe(path, (next) => {
        pending = next;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (pending !== null) {
            setText(pending);
            pending = null;
          }
        });
      });
      const keepOff = off;
      off = () => {
        if (frame) cancelAnimationFrame(frame);
        keepOff();
      };
    }).catch(() => {});
    return () => {
      alive = false;
      off();
      docs.release(path);
    };
  }, [path]);
  return text;
}

/** An outline row, drawn once per words (t102, 9 Nov 2026): every heading re-rendered on every
 *  keystroke, each with a fresh click. Steady words stand; only the cursor's mark moves. */
const OutlineRow = memo(function OutlineRow({ line, text, level, min, current, onJump }: { line: number; text: string; level: number; min: number; current: boolean; onJump(line: number): void }) {
  return (
    <button className={`outline-row${current ? ' current' : ''}`} style={{ paddingLeft: 10 + (level - min) * 14 }} onClick={() => onJump(line)}>
      <span className="outline-text">{text || '(untitled)'}</span>
    </button>
  );
});

export function OutlinePanel({ tab }: { tab: TabState }) {
  const text = useNoteText(tab.type === 'note' ? tab.path : undefined);
  useEditorsVersion();
  const [cursorLine, setCursorLine] = useState(-1);
  const headings = useMemo(() => {
    const out: { level: number; text: string; line: number }[] = [];
    let fence = false;
    text.split('\n').forEach((l, i) => {
      if (/^(```|~~~)/.test(l)) fence = !fence;
      if (fence) return;
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*_`=]/g, ''), line: i });
    });
    return out;
  }, [text]);
  const jump = useCallback(
    (line: number) => {
      const ed = editorFor(tab.id);
      if (ed) ed.scrollToLine(line);
      else {
        const el = document.querySelector(`.reading-body [data-line="${line}"]`);
        el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    },
    [tab.id],
  );

  // The heading the cursor is under is marked.
  useEffect(() => {
    const view = editorFor(tab.id)?.view();
    if (!view) return;
    const update = () => setCursorLine(view.state.doc.lineAt(view.state.selection.main.head).number - 1);
    update();
    const id = setInterval(update, 400);
    return () => clearInterval(id);
  }, [tab.id, text]);

  if (tab.type !== 'note') return <EmptyState size="panel" icon="outline" title="No note open" line="Open a note to see its outline." />;
  const min = Math.min(...headings.map((h) => h.level), 6);
  const current = [...headings].reverse().find((h) => h.line <= cursorLine)?.line;
  return (
    <div className="panel-body outline">
      {headings.map((h) => (
        <OutlineRow key={h.line} line={h.line} text={h.text} level={h.level} min={min} current={h.line === current} onJump={jump} />
      ))}
      {!headings.length && <EmptyState size="panel" icon="heading" title="No headings yet" line="Start a line with # and a heading shows here, to jump to." />}
    </div>
  );
}

export function OutgoingPanel({ tab }: { tab: TabState }) {
  const revision = useApp((s) => s.revision);
  const [links, setLinks] = useState<OutgoingLink[]>([]);
  const [mentions, setMentions] = useState<{ target: string; targetTitle: string; phrase: string; line: number }[]>([]);
  const path = tab.type === 'note' ? tab.path : undefined;
  const text = useNoteText(path);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void window.nv.index.outgoing(path).then((l) => alive && setLinks(l));
    return () => {
      alive = false;
    };
  }, [path, revision]);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const t = setTimeout(() => void window.nv.index.mentions(path, text).then((m) => alive && setMentions(m)), 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [path, text, revision]);
  if (!path) return <p className="empty padded">Open a note to see its links.</p>;
  const found = links.filter((l) => l.resolved);
  const missing = links.filter((l) => !l.resolved);
  return (
    <div className="panel-body">
      <div className="section">
        <div className="section-title">
          Links <span className="panel-count">{found.length}</span>
        </div>
        {found.map((l) => (
          <button key={`${l.resolved}#${l.heading ?? ''}`} className="link-row" onClick={(e) => A.openPath(l.resolved!, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current', heading: l.heading })}>
            <Icon name={l.embed ? 'image' : 'link'} size={13} />
            <span>{l.title}{l.heading ? ` › ${l.heading}` : ''}</span>
          </button>
        ))}
        {!found.length && <p className="empty">No links yet.</p>}
      </div>
      {missing.length > 0 && (
        <div className="section">
          <div className="section-title">
            Not written yet <span className="panel-count">{missing.length}</span>
          </div>
          {missing.map((l) => (
            <button key={l.target} className="link-row is-missing" title="Make this note" onClick={() => void A.openLink(l.target, path)}>
              <Icon name="filePlus" size={13} />
              <span>{l.target}</span>
            </button>
          ))}
        </div>
      )}
      <div className="section">
        <div className="section-title">
          Mentions of other notes <span className="panel-count">{mentions.length}</span>
        </div>
        <p className="hint">Words in this note that name another note but aren’t a link yet.</p>
        {mentions.map((m) => (
          <div key={m.target} className="result-row">
            <button className="result-snippet" onClick={() => A.openPath(m.target)}>
              <strong>{m.phrase}</strong> → {m.targetTitle}
            </button>
            <button className="small-button" onClick={() => editorFor(tab.id)?.linkPhrase(m.phrase, m.targetTitle, m.line)}>
              Link
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TagsPanel() {
  const revision = useApp((s) => s.revision);
  const notes = useApp((s) => s.notes);
  // Every property any note has, with how many notes have it (click to find them).
  const props = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const key of Object.keys(n.props ?? {})) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [byCount, setByCount] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    void window.nv.index.tags().then(setTags);
  }, [revision]);
  // Nested tags (area/work) as a tree; a parent counts its children's notes too.
  const tree = useMemo(() => {
    interface Node {
      name: string;
      full: string;
      count: number;
      children: Map<string, Node>;
    }
    const root: Node = { name: '', full: '', count: 0, children: new Map() };
    for (const t of tags) {
      let node = root;
      const parts = t.tag.split('/');
      parts.forEach((part, i) => {
        const full = parts.slice(0, i + 1).join('/');
        let next = node.children.get(part);
        if (!next) {
          next = { name: part, full, count: 0, children: new Map() };
          node.children.set(part, next);
        }
        next.count += t.count;
        node = next;
      });
    }
    return root;
  }, [tags]);
  type TagNode = typeof tree;
  const search = (tag: string) => {
    requestSearch(`tag:#${tag}`);
  };
  const render = (node: TagNode, depth: number): React.ReactNode =>
    [...node.children.values()]
      .sort((a, b) => (byCount ? b.count - a.count : 0) || a.name.localeCompare(b.name))
      .map((n) => (
        <div key={n.full}>
          <div className="tree-row tag-row" style={{ paddingLeft: 8 + depth * 16 }} onClick={() => search(n.full)}>
            {n.children.size > 0 ? (
              <button
                className="tag-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(n.full)) next.delete(n.full);
                    else next.add(n.full);
                    return next;
                  });
                }}
              >
                <Icon name="chevron" size={11} className={`tree-chevron${open.has(n.full) ? ' open' : ''}`} />
              </button>
            ) : (
              <span className="tag-toggle" />
            )}
            <span className="tree-name">#{n.name}</span>
            <span className="tag-count">{n.count}</span>
          </div>
          {open.has(n.full) && render(n, depth + 1)}
        </div>
      ));
  return (
    <div className="panel tags">
      <div className="panel-toolbar">
        <span className="panel-toolbar-label">{tags.length} tags</span>
        <span className="panel-toolbar-space" />
        <button className="icon-button" title={byCount ? 'By name' : 'Most used first'} onClick={() => setByCount((b) => !b)}>
          <Icon name="sort" size={15} />
        </button>
      </div>
      <div className="panel-body tree">
        {tags.length ? render(tree, 0) : <EmptyState size="panel" icon="tag" title="No tags yet" line="Type #something in a note to tag it." />}
        <div className="backlinks-heading toggleable">
          <span>Properties</span>
          <span className="panel-count">{props.length}</span>
        </div>
        {props.map(([key, count]) => (
          <div
            key={key}
            className="tree-row tag-row"
            onClick={() => {
              requestSearch(`[${key}]`);
            }}
          >
            <Icon name="properties" size={13} className="tree-file-icon" />
            <span className="tree-name">{key}</span>
            <span className="tag-count">{count}</span>
          </div>
        ))}
        {!props.length && <p className="empty">No properties yet.</p>}
      </div>
    </div>
  );
}

/** This note's tags and dates, closing the side's links stack (t7-note-window, 8 Nov 2026): its tags as
 *  written (each one click from searching them, as the context rail's strip), and its date-valued properties
 *  as quiet rows (read here, changed in the properties above the note — one way of changing them). Each group
 *  shows only with something in it, so a note with neither says nothing. */
export function TagsDates({ path }: { path: string }) {
  const meta = useApp((s) => s.byPath.get(path));
  const text = useNoteText(path);
  const tags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const props = meta?.props ?? readProps(text);
    for (const t of [...tagList(props.tags), ...noteTags(text)]) {
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.push(t);
      }
    }
    return out;
  }, [meta, text]);
  const dates = useMemo(() => {
    const rows: { key: string; words: string; iso: string }[] = [];
    for (const [key, value] of Object.entries(meta?.props ?? {})) {
      if (typeof value !== 'string') continue;
      const ms = readDate(value);
      if (ms === null) continue;
      rows.push({ key, words: shortDate(ms), iso: value });
    }
    return rows;
  }, [meta]);
  if (!tags.length && !dates.length) return null;
  return (
    <>
      {tags.length > 0 && (
        <div className="section">
          <div className="section-title">
            Tags <span className="panel-count">{tags.length}</span>
          </div>
          <div className="side-tags">
            {tags.map((t) => (
              <button key={t} className="side-tag" onClick={() => requestSearch(`tag:#${t}`)} title={`Search for #${t}`}>
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}
      {dates.length > 0 && (
        <div className="section">
          <div className="section-title">
            Dates <span className="panel-count">{dates.length}</span>
          </div>
          {dates.map((d) => (
            <div key={d.key} className="side-date-row" title={d.iso}>
              <span className="side-date-key">{d.key}</span>
              <span className="side-date-when">{d.words}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Whether the note's own small graph has anything to draw (t151): its links within two steps, already
 *  scoped as the graph draws them. False while loading and when alone, so the stack shows nothing (no empty
 *  box). One hook for the stack and its panel, so the head and the graph leave together. */
export function useNoteHasGraphLinks(path: string | undefined): boolean {
  const revision = useApp((s) => s.revision);
  const settings = useApp((s) => s.settings);
  const { data } = useGraphData(revision);
  return useMemo(() => {
    if (!path || !data) return false;
    const store = {
      templatesFolder: settings?.prefs.templatesFolder,
      assetsFolder: settings?.prefs.assetsFolder,
      attachmentsFolder: settings?.prefs.attachmentsFolder,
      dailyFolder: settings?.dailyFolder ?? 'Daily',
    };
    const scoped = livingScope(data.nodes, data.links, { showRest: false, store, forceIds: [path] });
    const sub = livingLocal(scoped.nodes, scoped.links, path, 2, []);
    return sub.nodes.length > 1 && sub.links.length > 0;
  }, [path, data, settings]);
}

/** The note's own small graph (t151, 9 Nov 2026): the dark neighbourhood in its Connections stack, with a way
 *  to the big graph. A note with no links shows nothing (the stack hides with it, so no head is left
 *  behind). */
export function LocalGraphPanel({ tab }: { tab: TabState }) {
  const revision = useApp((s) => s.revision);
  const [living] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('graph') === 'living';
    } catch {
      return false;
    }
  });
  const path = tab.type === 'note' ? tab.path : undefined;
  const hasLinks = useNoteHasGraphLinks(path);
  if (!path || !hasLinks) return null;
  return (
    <>
      <div className="local-graph">
        {living ? (
          <GraphView compact current={path} revision={revision} local onOpen={(p, newTab) => A.openPath(p, { where: newTab ? 'tab' : 'current' })} />
        ) : (
          <BrainGraphView compact local centre={path} revision={revision} onOpen={(p, newTab) => A.openPath(p, { where: newTab ? 'tab' : 'current' })} />
        )}
      </div>
      <button type="button" className="side-suggest" onClick={() => void A.openGraph()} title="Open the big graph on this note">
        Open in the graph
      </button>
    </>
  );
}
