// The note's context rail (8.0 section E, 29 Oct 2026): beside the note while the right side is shut, what it
// belongs to and what hangs off it, each thing one click away. Which project or area it is in (changed here,
// written to its properties), the people in it, its open tasks (tickable here, as everywhere), and its related
// meetings. The links stay out of it (t22-note-once, 8 Nov 2026: what links here lives once, at the foot; what it
// links to lives once, in the right side). What it shows is worked out in src/shared/note-rail.ts. It folds away,
// and stays as it was left.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { changeProps, readProps } from '../../../../shared/frontmatter';
import { headingsWithLines } from '../../../../shared/markdown';
import { firstRepeatLine } from '../../../../shared/notes-list';
import { noteRail } from '../../../../shared/note-rail';
import { tagList } from '../../../../shared/tags';
import { noteTags } from '../../lib/noteTags';
import { resolveNote } from '../../lib/resolve';
import { useNoteLinks } from '../../lib/noteLinks';
import { todayData } from '../../lib/todayData';
import { Icon } from '../../components/Icon';
import { isOwnName } from '../../components/plan/plan';
import { showError, toast, useApp } from '../../state/store';
import '../../styles/note-context.css';

export const OPEN_KEY = 'nv.noteRail.open';
const recall = (fallback: boolean) => {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    return v === null ? fallback : v !== '0';
  } catch {
    return fallback;
  }
};
const remember = (open: boolean) => {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Kept for this time only.
  }
};
/** A strip row, drawn once per words (t102, 9 Nov 2026): two hundred headings re-rendered on every
 *  keystroke, each with a fresh click. The words and the jump are steady, so steady rows stand. */
const StripHeadRow = memo(function StripHeadRow({ line, text, onJump }: { line: number; text: string; onJump(line: number): void }) {
  return (
    <li>
      <button className="nv-strip-row" onClick={() => onJump(line)} title={`Go to ${text}`}>
        <span>{text}</span>
      </button>
    </li>
  );
});
const StripTagRow = memo(function StripTagRow({ tag, onTag }: { tag: string; onTag(tag: string): void }) {
  return (
    <button className="nv-strip-tag" onClick={() => onTag(tag)} title={`Search for #${tag}`}>
      #{tag}
    </button>
  );
});

/** Whether the rail is open on this PC (the top bar menu reads it for its label). */
export const contextOpenNow = (): boolean => {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    return v === null ? false : v !== '0';
  } catch {
    return false;
  }
};
/** Ask the open note's rail to fold or unfold (the top bar menu's way in). */
export const askContextToggle = () => window.dispatchEvent(new CustomEvent('nv-context-toggle'));

interface Props {
  path: string;
  text: string;
  canEdit: boolean;
  onChangeText(next: string): void;
  onOpen(path: string, newTab: boolean): void;
  onJump(line: number): void;
  onToggleTask(line: number): void;
  onTag(tag: string): void;
  /** Shut, the slim strip (round 4, the mock-up's On this page / Tags) instead of the bare toggle. */
  strip?: boolean;
  /** Open on first sight when nothing is remembered (shut everywhere since round 4: Context opens only when asked). */
  defaultOpen?: boolean;
  /** A doc: its own head carries On this page and tags while the rail is shut, so the strip stands aside. */
  isDoc?: boolean;
  /** Told whenever the rail opens or shuts (the doc's head hides its row while open). */
  onOpenChange?(open: boolean): void;
}

export function ContextRail({ path, text, canEdit, onChangeText, onOpen, onJump, onToggleTask, onTag, strip = true, defaultOpen = false, isDoc = false, onOpenChange }: Props) {
  const notes = useApp((s) => s.notes);
  const revision = useApp((s) => s.revision);
  const [open, setOpen] = useState(() => recall(defaultOpen));
  // The rail reads the one answer fetched for the note (lib/noteLinks.ts), never its own copy. Only its
  // people and meetings need who links here now; the link lists themselves live at the foot (t22-note-once).
  const { links } = useNoteLinks(path, revision);
  const backlinkPaths = useMemo(() => [...new Set((links?.backlinks ?? []).map((r) => r.source))], [links]);

  // Who the person is (Today's own reading, as ProjectPage takes it): their own name never shows on their
  // tasks' owner chips here (Polish round 2, ITEMS 3, plan.ts isOwnName).
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { let live = true; void todayData().then((d) => live && setMe(d.me), () => undefined); return () => void (live = false); }, []);
  // Worked out only while open (t102, 9 Nov 2026): the shut rail shows headings and tags alone, but the
  // whole context — every note scanned, every person matched against the text — was recomputed on every
  // keystroke for nothing. Shut, the rail is empty; opening works it out at once.
  const rail = useMemo(
    () =>
      open
        ? noteRail({ path, text, notes, backlinkPaths, resolve: (target, from) => resolveNote(target, from) })
        : { project: null, area: null, people: [], openTasks: [], outgoing: [], backlinks: [], meetings: [], meetingsTotal: 0 },
    [open, path, text, notes, backlinkPaths],
  );
  const projects = useMemo(() => notes.filter((n) => String(n.props?.type ?? '').toLowerCase() === 'project').sort((a, b) => a.title.localeCompare(b.title)), [notes]);
  const areas = useMemo(() => [...new Set(notes.map((n) => String(n.props?.area ?? '').trim()).filter(Boolean))].sort(), [notes]);
  // Belongs to when the note belongs to nothing (5 Nov 2026): one quiet line opening the choice, instead of
  // a heavy box with two big fields. Set means set: the rail's own reading (its property, its folder, the
  // one project it links to) or an explicit choice in its properties, never the folder name the Area field
  // offers as a hint.
  const [placing, setPlacing] = useState(false);
  const belongsSet = useMemo(() => {
    if (rail.project) return true;
    const own = notes.find((n) => n.path === path)?.props;
    return !!String(own?.area ?? '').trim() || !!String(own?.project ?? own?.projects ?? '').trim();
  }, [notes, path, rail.project]);

  const toggle = () => {
    setOpen((was) => {
      remember(!was);
      return !was;
    });
  };
  useEffect(() => {
    const onAsk = () => toggle();
    window.addEventListener('nv-context-toggle', onAsk);
    return () => window.removeEventListener('nv-context-toggle', onAsk);
  }, []);
  // The page keeps the doc's head in step (open rail: the rail carries On this page and tags; shut: the row).
  useEffect(() => {
    onOpenChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const setProp = (key: string, value: string | null) => {
    try {
      onChangeText(changeProps(text, (doc) => (value === null ? doc.delete(key) : doc.set(key, value))));
    } catch (err) {
      showError(err);
    }
  };
  const openPath = (p: string) => (e: React.MouseEvent) => onOpen(p, e.ctrlKey || e.metaKey);

  // The strip reads a beat behind the typing (t102, 9 Nov 2026): its headings and tags scan the whole note,
  // which cost the keystroke's own frame. A new note reads at once; typing catches up when it pauses, the same
  // strip a breath later.
  const [stripText, setStripText] = useState(text);
  const stripPath = useRef(path);
  useEffect(() => {
    if (stripPath.current !== path) {
      stripPath.current = path;
      setStripText(text);
      return;
    }
    const t = setTimeout(() => setStripText(text), 250);
    return () => clearTimeout(t);
  }, [path, text]);
  // The slim strip (round 4, the mock-up's default): the note's own headings (but never the first line the view
  // hides for repeating the title) and its tags, each one click away. The notes that link here left for the foot
  // (t22-note-once, 8 Nov 2026): one Linked list, never two.
  const stripHeads = useMemo(() => {
    const title = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
    const hidden = firstRepeatLine(stripText, title);
    return headingsWithLines(stripText).filter((h) => h.line !== hidden && h.text);
  }, [path, stripText]);
  const stripTags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...tagList(readProps(stripText).tags), ...noteTags(stripText)]) {
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.push(t);
      }
    }
    return out;
  }, [stripText]);

  if (!open && strip)
    return (
      <aside className="nv-rail is-strip" aria-label="On this page and tags">
        {/* A doc's own row carries these while shut (5 Nov 2026): never twice. Past two headings only. */}
        {!isDoc && stripHeads.length >= 3 && (
          <section className="nv-strip-section">
            <h3>On this page</h3>
            <ul className="nv-strip-list">
              {stripHeads.map((h) => (
                <StripHeadRow key={h.line} line={h.line} text={h.text} onJump={onJump} />
              ))}
            </ul>
          </section>
        )}
        {!isDoc && stripTags.length > 0 && (
          <section className="nv-strip-section">
            <h3>Tags</h3>
            <div className="nv-strip-tags">
              {stripTags.map((t) => (
                <StripTagRow key={t} tag={t} onTag={onTag} />
              ))}
            </div>
          </section>
        )}
        <button className="nv-strip-context" onClick={toggle} title="Show this note's context" aria-label="Show context">
          <Icon name="sidebarRight" size={14} />
          <span>Context</span>
        </button>
      </aside>
    );

  if (!open)
    return (
      <aside className="nv-rail is-shut">
        <button className="nv-rail-toggle" onClick={toggle} title="Show this note's context" aria-label="Show context">
          <Icon name="sidebarRight" size={15} />
          <span>Context</span>
        </button>
      </aside>
    );

  return (
    <aside className="nv-rail" aria-label="This note's context">
      <div className="nv-rail-head">
        <span>Context</span>
        <button className="icon-button" onClick={toggle} title="Fold the context away" aria-label="Fold context away">
          <Icon name="close" size={13} />
        </button>
      </div>

      {/* Open, the rail carries On this page and tags (5 Nov 2026): a doc's head stands aside, so they read
          once. Jumping and filtering by tag keep working from here. */}
      {stripHeads.length >= 3 && (
        <section className="nv-strip-section">
          <h3>On this page</h3>
          <ul className="nv-strip-list">
            {stripHeads.map((h) => (
              <StripHeadRow key={h.line} line={h.line} text={h.text} onJump={onJump} />
            ))}
          </ul>
        </section>
      )}

      <section className="nv-rail-section">
        <h3>Belongs to</h3>
        {belongsSet || placing ? (
          <>
            <label className="nv-rail-field">
              <span>Project</span>
              <select value={rail.project?.path ?? ''} disabled={!canEdit} onChange={(e) => {
                const chosen = projects.find((p) => p.path === e.target.value);
                setProp('project', chosen ? `[[${chosen.title}]]` : null);
                if (chosen) toast(`In ${chosen.title} now.`);
              }}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.path} value={p.path}>{p.title}</option>
                ))}
              </select>
            </label>
            <label className="nv-rail-field">
              <span>Area</span>
              <select value={rail.area && areas.includes(rail.area) ? rail.area : ''} disabled={!canEdit} onChange={(e) => setProp('area', e.target.value || null)}>
                <option value="">{rail.area ?? 'No area'}</option>
                {areas.filter((a) => a !== rail.area).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <button className="nv-rail-belonging-none" disabled={!canEdit} onClick={() => setPlacing(true)} title="Set a project or area for this note">
            No project or area
          </button>
        )}
      </section>

      {/* An empty box does not show (5 Nov 2026): each section below appears only with something in it, so a note with
          nothing says nothing rather than instructing.
          @, / and [[ keep working in the note itself, as ever. */}
      {rail.people.length > 0 && (
        <section className="nv-rail-section">
          <h3>People in it <span className="nv-rail-count">{rail.people.length}</span></h3>
          <ul className="nv-rail-list">
            {rail.people.map((p) => (
              <li key={p.path}>
                <button className="nv-rail-row" onClick={openPath(p.path)} title={`Open ${p.title}`}>
                  <span className="nv-rail-avatar" aria-hidden="true">{p.title.charAt(0).toUpperCase()}</span>
                  <span>{p.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rail.openTasks.length > 0 && (
        <section className="nv-rail-section">
          <h3>Open tasks <span className="nv-rail-count">{rail.openTasks.length}</span></h3>
          <ul className="nv-rail-list">
            {rail.openTasks.map((t) => (
              <li key={t.line} className="nv-rail-task">
                <input type="checkbox" checked={false} disabled={!canEdit} aria-label={`Tick off: ${t.words}`} onChange={() => onToggleTask(t.line)} />
                <button className="nv-rail-task-words" onClick={() => onJump(t.line)} title="Go to this task in the note">
                  <span>{t.words}</span>
                  {((t.owner && !isOwnName(t.owner, me)) || t.dueWords) && (
                    <span className="nv-rail-chips">
                      {t.owner && !isOwnName(t.owner, me) && <span className="nv-rail-chip">{t.owner}</span>}
                      {t.dueWords && <span className="nv-rail-chip is-due">{t.dueWords}</span>}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* No link lists here (t22-note-once, 8 Nov 2026): what links here lives once, at the foot (with its
          failed check and retry); what this note links to lives once, in the right side's links stack. */}

      {rail.meetings.length > 0 && (
        <section className="nv-rail-section">
          <h3>Related meetings <span className="nv-rail-count">{rail.meetings.length}</span></h3>
          <ul className="nv-rail-list">
            {rail.meetings.map((p) => (
              <li key={p.path}>
                <button className="nv-rail-row" onClick={openPath(p.path)}>
                  <Icon name="calendar" size={12} />
                  <span>{p.title}</span>
                  {p.date && <span className="nv-rail-date">{p.date}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stripTags.length > 0 && (
        <section className="nv-strip-section">
          <h3>Tags</h3>
          <div className="nv-strip-tags">
            {stripTags.map((t) => (
              <button key={t} className="nv-strip-tag" onClick={() => onTag(t)} title={`Search for #${t}`}>
                #{t}
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
