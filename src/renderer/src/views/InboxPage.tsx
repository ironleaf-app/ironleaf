// The Inbox (Wave 4, 24 Oct 2026; module 20 of the catalogue: "Quick capture from Telegram, voice, photos, email.
// Triage into the right module."; 8.7 wave 2a, 30 Oct 2026). Every capture without a place, one card each
// (src/shared/inbox.ts): the lines of the Inbox note (the capture box, the former host app and a chat bot when no
// project is named, dictation, a photo) and what sits in the Inbox folder. Each is filed, kept or deleted in one
// step — onto a suggestion read from the vault's own structure (the project or person it names, a link it carries,
// their area), or anywhere with File… (a project, a person's card, or a note of a type in an area) — kept as done,
// or deleted (a line under Deleted in the Inbox note, a note or file to Recently deleted, both recoverable). Nothing
// is lost: a filed line goes where it was filed, word for word.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListDetail, RecordDetail } from '../components/ListDetail';
import type { FilingTarget, InboxItem, InboxSuggestion } from '../../../shared/inbox';
import { fileToWords, leadSuggestion, planBulkFile, remindTargetWords, suggestInboxHome } from '../../../shared/inbox-suggest';
import { isFinished } from '../../../shared/finished';
import { INBOX_TOUR_ID, INBOX_TOUR_STEPS } from '../../../shared/inbox-tour';
import { setTourSeen, tourSeen } from '../state/moduleFills';
import { isProjectProps } from '../../../shared/project-file';
import { toggleSelected } from '../../../shared/notes-list';
import { plural } from '../../../shared/words';
import { modulesOn } from '../../../shared/life-modules';
import { moduleInfo } from '../../../shared/life-modules';
import { INBOX_SORTS, sortInbox, type InboxSort } from '../../../shared/projects-87';
import { EmptyState } from '../components/EmptyState';
import { Icon, type IconName } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { ListFind, useFindMemory } from '../components/PageTabs';
import { ViewHeader } from './ViewHeader';
import { prompt } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { fileUrl, resolveAny } from '../lib/resolve';
import { landFiles } from '../state/intake';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { areaOfPath, getAreas, useAreas } from '../state/areas';
import { lifeChanged, useLifeTick } from '../state/life';
import { getNoteTypes, typeChip } from '../state/noteTypes';
import { getState, savePrefs, showError, toast, useApp, usePrefs } from '../state/store';
import type * as W from '../state/workspace';

const PICTURE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
const TARGET_ICON: Record<FilingTarget['kind'], IconName> = { project: 'layers', person: 'person', note: 'notes', area: 'home', module: 'receipt', reminder: 'bell' };
const SORT_MEMORY = 'nv-inbox-sort';

function readSort(): InboxSort {
  try {
    const v = localStorage.getItem(SORT_MEMORY);
    return (INBOX_SORTS.some((s) => s.id === v) ? v : 'newest') as InboxSort;
  } catch {
    return 'newest';
  }
}

/** Where to file something, chosen from every project, card and area (an area then asks what it becomes there),
 *  or — for a capture line, when the person asks — a reminder at a moment they say. */
const REMIND_ROW = 'r:remind';
/** A person or organisation card, one test for File… and the fallback suggestions alike (9.2 uplift F39). */
const isPersonCard = (type: unknown): boolean => /^(person|people|contact|organisation|organization|company|org)$/i.test(String(type ?? ''));

async function chooseTarget(allowReminder: boolean): Promise<FilingTarget | null> {
  const { notes } = getState();
  const areas = (await import('../state/areas')).getAreas()?.areas.filter((a) => !a.hidden) ?? [];
  type Row = { id: string; label: string; detail: string; icon: IconName; target: FilingTarget };
  const rows: Row[] = [
    // A capture becomes a reminder only when the person says so (9 Nov 2026, t119 one-tap filing): the moment
    // asked in their own words, never read off the line.
    ...(allowReminder ? [{ id: REMIND_ROW, label: 'Remind me…', detail: 'Reminder · at a moment you say', icon: 'bell' as IconName, target: { kind: 'reminder' as const, name: 'Reminders' } }] : []),
    ...notes.filter((n) => isProjectProps(n.props) && !isFinished(n.props?.status)).map((n): Row => ({ id: `p:${n.path}`, label: n.label || n.title, detail: 'Project · a tick-box becomes a task, a line goes in its log', icon: 'layers', target: { kind: 'project', path: n.path, name: n.label || n.title } })),
    ...areas.map((a): Row => ({ id: `a:${a.id}`, label: a.name, detail: 'Area · a note of its own there', icon: a.icon as IconName, target: { kind: 'area', area: a.id, name: a.name } })),
    ...notes.filter((n) => isPersonCard(n.props?.type)).map((n): Row => ({ id: `c:${n.path}`, label: n.title, detail: 'Card · added to their notes', icon: 'person', target: { kind: 'person', path: n.path, name: n.title } })),
  ];
  const id = await pick({
    placeholder: allowReminder ? 'File it where? A project, an area, someone’s card, or a reminder' : 'File it where? A project, an area or someone’s card',
    items: (q) => fuzzyFilter(rows, q, (r) => `${r.label} ${r.detail}`, 60).map((r) => ({ id: r.id, label: r.label, detail: r.detail, icon: r.icon })),
    footer: '↑↓ to move · Enter to file it there · Esc to cancel',
  });
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  if (row.id === REMIND_ROW) {
    const when = await prompt('Remind me when?', { message: 'Say the moment in your own words.', placeholder: 'Friday at 3pm', ok: 'Remind me' });
    return when?.trim() ? { kind: 'reminder', name: 'Reminders', when: when.trim() } : null;
  }
  if (row.target.kind !== 'area') return row.target;
  const type = await chooseKind(row.target.name);
  return type ? { ...row.target, type } : null;
}

/** What a filed line becomes in an area: a note of one of the types (Note first). */
async function chooseKind(areaName: string): Promise<string | null> {
  const types = getNoteTypes().filter((t) => !t.hidden && t.id !== 'project' && t.id !== 'doc');
  return pick({
    placeholder: `In ${areaName}, as what? Enter makes a plain note`,
    items: (q) => fuzzyFilter(types, q, (t) => `${t.name} ${t.hint}`).map((t) => ({ id: t.id, label: t.name, detail: `in ${areaName} › ${t.folder || 'Notes'}`, sub: t.hint, lead: typeChip(t) })),
    footer: '↑↓ to move · Enter to make it · Esc to cancel',
  });
}

function suggWords(s: InboxSuggestion): string {
  if (s.target.kind === 'reminder') return remindTargetWords(s.target);
  if (s.target.kind !== 'module') return s.target.name;
  // An emailed bill (Finance): what filing it does, with its amount and day (Wave 5).
  if (s.target.label) return `${s.target.label}${/:/.test(s.why) ? ` · ${s.why.replace(/^[^:]*:\s*/, '')}` : ''}`;
  return `${s.target.path ? 'Update the bill' : 'Add as a bill'}: ${s.target.name} · ${s.why.replace(/^[^:]*:\s*/, '')}`;
}

function suggIcon(s: InboxSuggestion): IconName {
  if (s.target.kind === 'area') return (getAreas()?.areas.find((a) => a.id === s.target.area)?.icon as IconName) ?? 'home';
  if (s.target.kind === 'module' && s.target.module && s.target.module !== 'finance') return (moduleInfo(s.target.module)?.icon as IconName) ?? 'layers';
  return TARGET_ICON[s.target.kind];
}

function ItemCard({ item, suggestions, busy, active, ticked, onTick, onFile, onDone, onRemove, onMakeTask, onHover }: { item: InboxItem; suggestions: InboxSuggestion[]; busy: boolean; active: boolean; ticked: boolean; onTick(): void; onFile(t: FilingTarget): void; onDone(): void; onRemove(): void; onMakeTask(t?: FilingTarget): void; onHover(): void }) {
  const lead = leadSuggestion(suggestions);
  const canEdit = useApp((s) => s.canEdit);
  const pictures = item.embeds.filter((e) => PICTURE.test(e));
  const files = item.embeds.filter((e) => !PICTURE.test(e));
  const icon: IconName = item.kind === 'note' ? 'notes' : item.kind === 'file' ? (PICTURE.test(item.path) ? 'image' : 'file') : item.task ? 'task' : pictures.length ? 'image' : 'inbox';
  const tint = item.kind === 'file' || pictures.length ? 'amber' : item.task ? 'blue' : item.kind === 'note' ? 'blue' : 'slate';
  const sub = [item.kind === 'file' ? 'File' : item.kind === 'note' ? 'Note' : item.task ? 'Task' : 'Captured', item.stamp, item.kind !== 'line' ? 'In the Inbox folder' : '', files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="card" style={{ padding: '14px 20px', marginTop: 12, ...(active ? { borderColor: 'var(--border-strong)' } : {}) }} onMouseEnter={onHover} aria-current={active || undefined}>
      <div className="w2a-ib">
        <input type="checkbox" className="w2a-tick" checked={ticked} onChange={onTick} aria-label={`Tick “${item.words || 'a picture'}” to act on it with others`} title="Tick to act on it with others" />
        <span className={`gtile sm ${tint}`} aria-hidden="true">
          <Icon name={icon} size={15} />
        </span>
        <div className="w2a-ib-words">
          <div className="w2a-ib-title">{item.words || <span style={{ color: 'var(--text-faint)' }}>A picture</span>}</div>
          {sub && <div className="w2a-ib-sub">{sub}</div>}
          {(pictures.length > 0 || (item.kind === 'file' && PICTURE.test(item.path))) && (
            <div className="w2a-ib-pics">
              {(item.kind === 'file' ? [item.path] : pictures).slice(0, 4).map((p) => {
                const rel = item.kind === 'file' ? p : (resolveAny(p, item.path) ?? p);
                return <img key={p} src={fileUrl(rel)} alt="" loading="lazy" draggable={false} onClick={(e) => A.openPath(rel, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} />;
              })}
            </div>
          )}
          {files.length > 0 && item.kind === 'line' && (
            <div className="w2a-ib-sub" style={{ marginTop: 6 }}>
              {files.map((f) => (
                <span key={f} style={{ marginRight: 10 }}>
                  <Icon name="paperclip" size={11} /> {f.split('/').pop()}
                </span>
              ))}
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="w2a-ib-filein">
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)' }}>File in</span>
              {suggestions.map((s, i) => (
                <button key={`${s.target.kind}:${s.target.path ?? s.target.area}`} type="button" className={`chip${i === 0 ? ' on' : ''}`} disabled={!canEdit || busy} title={`${s.why}\nFile it here in one click`} onClick={() => onFile(s.target)}>
                  <Icon name={suggIcon(s)} size={12} />
                  {suggWords(s)}
                </button>
              ))}
            </div>
          )}
          {/* The best home's reason, shown (9 Nov 2026, t119 one-tap filing: "mentions Harbour fit-out",
              not hover-only); the other chips keep theirs in their tooltips. */}
          {lead && <div className="w2a-ib-sub">{lead.why}</div>}
        </div>
        {/* No key chips on the rows (5 Nov 2026, rest-quieten I1: F/T/D repeated on every row); the foot
            says the keys once, each button's tooltip says its own, and the keys work as before. */}
        <div className="w2a-ib-actions">
          {lead && (
            <button type="button" className="btn pri" disabled={!canEdit || busy} title={`${fileToWords(lead)}\n${lead.why}\nFile it where suggested, in one click (F)`} onClick={() => onFile(lead.target)}>
              <span className="w2a-ib-leadwords">{fileToWords(lead)}</span>
            </button>
          )}
          {item.kind === 'line' && (
            // A card already labelled Task moves to a project (5 Nov 2026: "Make it a task" on one meant the same
            // word twice); a plain capture line still becomes a task first, then moves.
            <button type="button" className="btn" disabled={!canEdit || busy} title={item.task ? "Move it to a project: it becomes one of that project's tasks (T)" : "Make it a task in a project (T)"} onClick={() => onMakeTask(lead?.target.kind === 'project' ? lead.target : undefined)}>
              {item.task ? 'Move to a project' : 'Make it a task'}
            </button>
          )}
          {item.kind !== 'line' && (
            <button type="button" className="btn" title="Open it (Enter)" aria-label="Open it" onClick={(e) => A.openPath(item.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })}>
              Open
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={!canEdit || busy}
            onClick={async () => {
              const t = await chooseTarget(item.kind === 'line');
              if (t) onFile(t);
            }}
          >
            File…
          </button>
          {item.kind !== 'file' && (
            <button type="button" className="btn" title={item.kind === 'line' ? 'Done: kept under Done in the Inbox note (D)' : 'Done: kept under Done in the Inbox folder (D)'} disabled={!canEdit || busy} onClick={onDone}>
              Done
            </button>
          )}
          <button type="button" className="btn danger-text" title={item.kind === 'line' ? 'Delete it (kept under Deleted in the Inbox note) (Delete)' : 'Delete it to Recently deleted (Delete)'} aria-label="Delete it" disabled={!canEdit || busy} onClick={onRemove}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function InboxPage({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  const filesRevision = useApp((s) => s.filesRevision);
  const tick = useLifeTick();
  const prefs = usePrefs();
  const areasTick = useAreas();
  const [data, setData] = useState<{ items: InboxItem[]; suggestions: Record<string, InboxSuggestion[]> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<InboxSort>(() => readSort());
  // A failed read is not an empty inbox (W5-6).
  const [failed, setFailed] = useState(false);
  // One tap files, nothing files itself (9 Nov 2026, t119 one-tap filing: the self-filing is gone).
  // Suggestions come from the vault's own links, names and meaning index.
  const [tourDone, setTourDone] = useState(() => tourSeen(INBOX_TOUR_ID));
  const load = useCallback(() => void window.nv.life.inbox.list().then((d) => (setData(d), setFailed(false)), () => setFailed(true)), []);
  useEffect(() => {
    const t = setTimeout(load, data ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, filesRevision, tick]);
  const file = async (item: InboxItem, target: FilingTarget) => {
    setBusy(item.id);
    // A task filed to an area stays a task; a suggestion's type otherwise stands.
    const t = target.kind === 'area' && !target.type ? { ...target, type: item.task ? 'task' : 'note' } : target;
    try {
      const r = await window.nv.life.inbox.file(item.id, t);
      const first = r.paths.find((p) => p !== 'Inbox.md');
      // One tap carries Undo (a filed receipt's through Money, anything else through the Inbox's own);
      // what carries none opens what changed instead.
      const undo = !r.undo
        ? undefined
        : t.kind === 'module'
          ? { label: 'Undo', run: () => void window.nv.recmod.undoReceipt(r.undo!).then((words) => (toast(words), lifeChanged(), load()), showError) }
          : { label: 'Undo', run: () => void window.nv.life.inbox.undoAuto(r.undo!).then((u) => (toast(u.words), lifeChanged(), load()), showError) };
      toast(r.words, undo ?? (first ? { label: 'Open', run: () => A.openPath(target.kind === 'project' && item.task && target.path ? target.path : first) } : target.kind === 'project' && target.path ? { label: 'Open', run: () => A.openPath(target.path!) } : undefined));
      lifeChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      load();
    }
  };
  const done = async (item: InboxItem) => {
    setBusy(item.id);
    try {
      toast((await window.nv.life.inbox.done(item.id)).words);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      load();
    }
  };
  const remove = async (item: InboxItem) => {
    setBusy(item.id);
    try {
      if (item.kind === 'line') toast((await window.nv.life.inbox.remove(item.id)).words);
      else await A.trashPath(item.path);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      load();
    }
  };
  const notesInMemory = useApp((s) => s.notes);
  // A suggested home worked out here when the main side offered none (src/shared/inbox-suggest.ts, from the index
  // already in memory: the vault's projects, people, notes and areas, the same shape the main side suggests with).
  const fallback = useMemo(() => {
    const out: Record<string, InboxSuggestion[]> = {};
    if (!data) return out;
    const areasNow = getAreas()?.areas.filter((a) => !a.hidden) ?? [];
    const areaOf = (p: string) => areaOfPath(p)?.id;
    const projects = notesInMemory.filter((n) => isProjectProps(n.props)).map((n) => ({ path: n.path, name: n.label || n.title, people: [] as string[], tags: n.tags, modified: n.mtime, area: areaOf(n.path) }));
    const people = notesInMemory.filter((n) => isPersonCard(n.props?.type)).map((n) => ({ name: n.title, path: n.path, names: n.aliases, area: areaOf(n.path) }));
    const known = new Set([...projects.map((p) => p.path), ...people.map((p) => p.path)]);
    const templatesPrefix = prefs.templatesFolder ? `${prefs.templatesFolder.toLowerCase()}/` : '';
    const notes = notesInMemory
      .filter((n) => !known.has(n.path) && !/^inbox(\/|\.md$)/i.test(n.path) && !/^private notes\//i.test(n.path) && !(templatesPrefix && n.path.toLowerCase().startsWith(templatesPrefix)) && !/^daily\//i.test(n.path))
      .map((n) => ({ title: n.title, path: n.path, area: areaOf(n.path) }));
    const modules = modulesOn(prefs.modules).map((m) => ({ id: m.id, name: m.name }));
    const ctx = { projects, people, notes, areas: areasNow.map((a) => ({ id: a.id, name: a.name })), modules, resolve: (t: string) => resolveAny(t, 'Inbox.md') };
    for (const it of data.items) {
      if ((data.suggestions[it.id] ?? []).length) continue;
      out[it.id] = suggestInboxHome(it, ctx);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- areasTick re-reads the areas when they land
  }, [data, notesInMemory, prefs.modules, prefs.templatesFolder, areasTick]);
  const suggestionsFor = (it: InboxItem) => (data?.suggestions[it.id]?.length ? data.suggestions[it.id] : (fallback[it.id] ?? []));
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  // The Inbox's Find (t262): the one list Find over the waiting list, filtering in state; every key and
  // the ticked bar below act on the rows on show, never rows the Find hid. The words stand as left (t266).
  const [find, setFind] = useFindMemory('inbox');
  const listRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const needle = find.trim().toLowerCase();
  const items = useMemo(() => sortInbox(data?.items ?? [], sort, (id) => (data?.suggestions[id]?.length ?? 0) > 0 || (fallback[id]?.length ?? 0) > 0), [data, sort, fallback]);
  const shownItems = useMemo(() => (needle ? items.filter((it) => `${it.words} ${it.stamp ?? ''} ${it.kind} ${it.embeds.join(' ')}`.toLowerCase().includes(needle)) : items), [items, needle]);
  const match = !needle ? null : { n: shownItems.length, m: items.length };
  // Ticked items that filtered or cleared away untick themselves, so the bar never acts on what isn't shown.
  useEffect(() => {
    setSelected((s) => {
      const here = new Set(shownItems.map((it) => it.id));
      const kept = s.filter((id) => here.has(id));
      return kept.length === s.length ? s : kept;
    });
  }, [shownItems]);
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, shownItems.length - 1)));
  }, [shownItems.length]);
  const ticked = useMemo(() => shownItems.filter((it) => selected.includes(it.id)), [shownItems, selected]);
  const canEdit = useApp((s) => s.canEdit);
  const fileTicked = async () => {
    const plan = planBulkFile(ticked, (id) => suggestionsFor(items.find((it) => it.id === id)!));
    setBusy('__bulk__');
    let done = 0;
    try {
      for (const { id, target } of plan) {
        const it = items.find((x) => x.id === id)!;
        const t = target.kind === 'area' && !target.type ? { ...target, type: it.task ? 'task' : 'note' } : target;
        await window.nv.life.inbox.file(id, t);
        done++;
      }
      lifeChanged();
      const skipped = ticked.length - done;
      toast(done === 1 ? 'Filed where suggested.' : `${done} filed where suggested.${skipped ? ` ${skipped} had no suggestion and ${skipped === 1 ? 'was' : 'were'} left.` : ''}`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      setSelected([]);
      load();
    }
  };
  const doneTicked = async () => {
    const doable = ticked.filter((it) => it.kind !== 'file');
    setBusy('__bulk__');
    try {
      for (const it of doable) await window.nv.life.inbox.done(it.id);
      toast(doable.length === 1 ? 'Kept as done.' : `${doable.length} kept as done.`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      setSelected([]);
      load();
    }
  };
  const removeTicked = async () => {
    setBusy('__bulk__');
    try {
      for (const it of ticked) {
        if (it.kind === 'line') await window.nv.life.inbox.remove(it.id);
        else await A.trashPath(it.path);
      }
      toast(ticked.length === 1 ? 'Deleted.' : `${ticked.length} deleted.`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      setSelected([]);
      load();
    }
  };
  const changeSort = (s: InboxSort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_MEMORY, s);
    } catch {
      // Remembering is a convenience.
    }
  };

  /** "Make it a task": a plain capture line becomes a tick-box line in the Inbox note, then it is filed to the
   *  project, where a tick-box becomes its next step (src/main/life.ts inbox:file). */
  const makeTask = async (item: InboxItem, chosen?: FilingTarget) => {
    const target = chosen ?? (await chooseTarget(false));
    if (!target || target.kind !== 'project') { if (target) void file(item, target); return; }
    if (item.task || item.kind !== 'line') return void file(item, target);
    setBusy(item.id);
    try {
      const text = await docs.readThrough('Inbox.md');
      const lines = text.split(/\r?\n/);
      // The item's own line (9.2 uplift F35): its place when still true, else its exact line — two identical
      // captures convert the one tapped, never the first match.
      const first = item.text.split('\n')[0];
      const at = item.from !== undefined && lines[item.from]?.includes(first) ? item.from : lines.findIndex((l) => l.trim() === first.trim());
      if (at < 0) throw new Error('That item is not in the Inbox note any more.');
      lines[at] = lines[at].replace(/^(\s*[-*+]\s+|\s*\d+[.)]\s+|\s*)/, '$1[ ] ');
      await docs.writeThrough('Inbox.md', lines.join('\n'), 'inbox');
      const fresh = await window.nv.life.inbox.list();
      setData(fresh);
      const again = fresh.items.find((x) => x.from === at && x.kind === 'line') ?? fresh.items.find((x) => x.words === item.words && x.kind === 'line');
      if (!again) throw new Error('That item is not in the Inbox any more.');
      setBusy(null);
      await file(again, target);
    } catch (err) {
      showError(err);
      setBusy(null);
      load();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    // The room's / key jumps to the Find (fnv3 F29: a key is the list's only outside a field).
    if (e.key === '/' && (e.target as Element)?.closest?.('input, textarea, select') === null && document.activeElement !== findRef.current) { e.preventDefault(); findRef.current?.focus(); return; }
    const it = shownItems[active];
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setActive((a) => Math.min(shownItems.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (!it) return;
    else if (e.key === 'f' && suggestionsFor(it)[0]) void file(it, suggestionsFor(it)[0].target);
    else if (e.key === 't' && it.kind === 'line') void makeTask(it, suggestionsFor(it).find((s) => s.target.kind === 'project')?.target);
    else if ((e.key === 'd' || e.key === 'x') && it.kind !== 'file') void done(it);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && (e.target as Element)?.closest?.('input, textarea') === null) void remove(it);
    else if (e.key === 'Enter' && it.kind !== 'line') A.openPath(it.path);
  };

  return (
    <>
      <ViewHeader tab={tab}>
        {/* The header names which note it opens (3 Nov 2026, fifth-round H2): "Inbox note", never "The note". The
            header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search): both
            buttons yield one by one from the least used when measured within 12px of the bar, into the ⋯ beside
            them, which only shows while it carries something. */}
        <button type="button" className="btn" data-overflow="inbox-note" data-overflow-order={1} onClick={(e) => A.openPath('Inbox.md', { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} disabled={!getState().byPath.has('Inbox.md')} title="The Inbox note, as written">
          Inbox note
        </button>
        <button type="button" className="btn pri" data-overflow="capture" data-overflow-order={2} onClick={() => void window.nv.capture.show().catch(showError)}>+ Capture</button>
        <button type="button" className="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the inbox" title="More" onClick={(e) => openMenu(e.currentTarget, overflowMenuItems(headerOverflowHidden(tab.id), {
          'inbox-note': () => ({ label: 'Inbox note', icon: 'notes', run: () => A.openPath('Inbox.md') }),
          'capture': () => ({ label: 'Capture', icon: 'plus', run: () => void window.nv.capture.show().catch(showError) }),
        }))}>
          <Icon name="more" size={16} />
        </button>
      </ViewHeader>
      <div
        className="vscroll"
        ref={rootRef}
        data-tab={tab.id}
        onKeyDown={onKey}
        tabIndex={-1}
        style={{ outline: 'none' }}
        onDragOver={(e) => {
          if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          // The front door (t243): an email or PDF dropped on the Inbox lands with its one question.
          const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.(eml|msg|pdf)$/i.test(f.name));
          if (!files.length) return;
          e.preventDefault();
          e.stopPropagation();
          if (!canEdit) return;
          void landFiles(files);
        }}
      >
      {/* The frame sets the column (p25 one column; was: 960 here, its own left edge). */}
      <div className="vpage wide has-split">
        <div className="w2a-head">
          <h1 className="w2a-title">Inbox</h1>
          {items.length > 0 && <span className="nv-page-count">{items.length} waiting</span>}
          <span className="w2a-views" style={{ alignItems: 'center' }}>
            <button
              className="chip"
              aria-haspopup="menu"
              aria-label="How the inbox is ordered"
              title="How the inbox is ordered"
              onClick={(e) =>
                openMenu(
                  e.currentTarget,
                  INBOX_SORTS.map((s) => ({ label: s.label, checked: sort === s.id, run: () => changeSort(s.id) })),
                )
              }
            >
              {INBOX_SORTS.find((s) => s.id === sort)?.label} <Icon name="chevronDown" size={12} />
            </button>
          </span>
        </div>
        {failed ? (
          <EmptyState icon="inbox" title="Couldn't check the inbox" line="What is waiting is still waiting. Try again in a moment." action={{ label: 'Try again', run: load }} />
        ) : !data ? (
          <div className="view-loading" style={{ marginTop: 24 }} />
        ) : !items.length ? (
          <EmptyState icon="inbox" title="Nothing waiting" line="Things you capture with nowhere to go land here. Capture from anywhere with Ctrl+Alt+N, send a voice note or a photo, or share from your other apps." action={{ label: 'Capture', icon: 'plus', run: () => void window.nv.capture.show().catch(showError) }} />
        ) : (
          <>
            {shownItems.length > 0 && (
              <div className="w2a-ib-select">
                <button type="button" className="btn quiet" onClick={() => setSelected((s) => (s.length === shownItems.length ? [] : shownItems.map((it) => it.id)))}>{selected.length === shownItems.length ? 'Untick all' : 'Tick all'}</button>
              </div>
            )}
            {selected.length > 0 && (
              <div className="w2a-ib-bulk" role="toolbar" aria-label={`${plural(selected.length, 'capture', 'captures')} ticked`}>
                {/* The ticked count reads right aloud too (3 Nov 2026, fourth-round G7): "1 capture ticked", never "1 captures ticked". */}
                <span className="w2a-ib-bulk-count">{selected.length} ticked</span>
                <button type="button" className="btn pri" disabled={!canEdit || busy !== null} onClick={() => void fileTicked()}>File where suggested</button>
                <button type="button" className="btn" disabled={!canEdit || busy !== null} onClick={() => void doneTicked()}>Done</button>
                <button type="button" className="btn danger-text" disabled={!canEdit || busy !== null} onClick={() => void removeTicked()}>Delete</button>
                <button type="button" className="btn quiet" onClick={() => setSelected([])}>Clear</button>
              </div>
            )}
            <ListFind id="inbox" open value={find} onChange={setFind} match={match} scope={listRef} inputRef={findRef} hint="Press / to jump to the find" />
            {/* List and detail (round 3, at 3440x1400): the captures in a pane that scrolls inside itself, the one the pointer or
                the keys are on read whole beside it, so the Inbox fills the window. */}
            <ListDetail
              label="The capture chosen"
              context={false}
              list={
                <>
                <div aria-label="Waiting to be filed" ref={listRef}>
                  {shownItems.map((it, i) => (
                    <ItemCard key={it.id} item={it} suggestions={suggestionsFor(it)} busy={busy === it.id || busy === '__bulk__'} active={i === active} ticked={selected.includes(it.id)} onTick={() => setSelected((s) => toggleSelected(s, it.id))} onHover={() => setActive(i)} onFile={(t) => void file(it, t)} onDone={() => void done(it)} onRemove={() => void remove(it)} onMakeTask={(t) => void makeTask(it, t)} />
                  ))}
                </div>
                <div className="w2a-ib-foot">
                  <span>Captures with no project go to</span>
                  <span className="seg">
                    <button type="button" className={prefs.captureNoProject === 'inbox' ? 'on' : ''} aria-pressed={prefs.captureNoProject === 'inbox'} onClick={() => void savePrefs({ captureNoProject: 'inbox', captureNoProjectChosen: true }).catch(showError)}>The Inbox</button>
                    <button type="button" className={prefs.captureNoProject === 'daily' ? 'on' : ''} aria-pressed={prefs.captureNoProject === 'daily'} onClick={() => void savePrefs({ captureNoProject: 'daily', captureNoProjectChosen: true }).catch(showError)}>Today's note</button>
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-faint)' }}>j/k move · f files · t task · d done · ⌫ deletes</span>
                </div>
                {/* The lesson after the items (t243: the Inbox leads with what is waiting, not "Where things go"). */}
                {!tourDone && (
                  <div className="card" data-tour="inbox-tour" style={{ padding: '12px 16px', marginTop: 12 }} role="note" aria-label="Where things go">
                    <div style={{ fontWeight: 650, marginBottom: 4 }}>Where things go</div>
                    {INBOX_TOUR_STEPS.map((s) => (
                      <div key={s.title} style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>
                        <b>{s.title}.</b> {s.body}
                      </div>
                    ))}
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="btn small" onClick={() => (setTourSeen(INBOX_TOUR_ID, true), setTourDone(true))}>
                        Got it
                      </button>
                    </div>
                  </div>
                )}
                </>
              }
              detail={shownItems[active] ?? shownItems[0] ? <RecordDetail refTo={{ path: (shownItems[active] ?? shownItems[0]).path }} /> : null}
            />
          </>
        )}
      </div>
      </div>
    </>
  );
}
