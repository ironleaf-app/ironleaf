// The quick switcher (Ctrl+O), the command list (Ctrl+K), and the screen shown when no folder of notes is open.

import { useEffect, useMemo, useState } from 'react';
import type { PluginCommandView } from '../../../shared/plugins';
import { fileHitsSection } from './FileHits';
import { Icon, type IconName } from './Icon';
import { openMenu } from './Menu';
import { fuzzyFilter, fuzzyFilterLower } from '../lib/fuzzy';
import { formatHotkey } from '../lib/hotkeys';
import * as A from '../state/actions';
import { draftInChat, sendChat } from '../state/chat';
import { available, COMMANDS, type Command, commandContext, hotkeyOf, listedCommands, noteCommandUsed, recentCommands } from '../state/commands';
import { showSide } from '../state/fit';
import { getWorkspace } from '../state/layout';
import { showError, toast, useApp } from '../state/store';
import { pluginCommands } from '../state/plugins';
import { Picker, type PickerItem } from './Picker';
import { DOCS_FOLDER, isDocNote } from '../../../shared/doc-file';
import { modulesOn } from '../../../shared/life-modules';
import { openTypePage, newNoteOfType, useNoteTypes } from '../state/noteTypes';
import { openModule, useModules } from '../state/modules';
import { packPaletteRows, typePaletteRows } from '../lib/paletteRows';
import { isProjectProps } from '../../../shared/project-file';
import { PROJECT_TABS } from '../views/project/memory';
import { requestSearch } from '../state/modals';
import { quietPath } from '../state/areas';

/** Find a note (or any file) by its name or another name it has; Shift+Enter makes a note with what was typed. */
export function QuickSwitcher({ onClose }: { onClose(): void }) {
  const notes = useApp((s) => s.notes);
  const files = useApp((s) => s.files);
  const canEdit = useApp((s) => s.canEdit);
  const recent = getWorkspace().recent;
  const fileHits = useMemo(() => fileHitsSection(), []);
  // The matching words once per notes change (t102, 9 Nov 2026): each keystroke rebuilt them for
  // every row. The open rows and the quiet ones part here too, never filtered per keystroke.
  const entries = useMemo(() => {
    // Notes opened lately first (newest first), then the rest by when they last changed.
    const rank = (p: string) => {
      const at = recent.indexOf(p);
      return at < 0 ? Infinity : at;
    };
    const byTime = [...notes].sort((a, b) => rank(a.path) - rank(b.path) || b.mtime - a.mtime);
    const list: { id: string; label: string; detail?: string; match: string; icon?: 'doc' | 'bookmark'; quiet?: boolean }[] = [];
    for (const n of byTime) {
      // Templates and the Library's things (Wave 4) wait at the end, found only when their name is typed.
      if (quietPath(n.path)) {
        list.push({ id: n.path, label: n.title, detail: `Library · ${n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''}`, match: n.title.toLowerCase(), icon: 'bookmark', quiet: true });
        continue;
      }
      const folder = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : undefined;
      // A doc says it is one, with its line on what it is (src/shared/doc-file.ts).
      if (isDocNote(n.path, n.props, DOCS_FOLDER)) {
        const about = typeof n.props?.about === 'string' ? n.props.about : '';
        list.push({ id: n.path, label: n.title, detail: about ? `Doc · ${about}` : 'Doc', match: `${n.title} doc ${about ? `Doc · ${about}` : 'Doc'}`.toLowerCase(), icon: 'doc' });
      } else list.push({ id: n.path, label: n.title, detail: folder, match: (folder ? `${n.title} ${folder}` : `${n.title} `).toLowerCase() });
      for (const alias of n.aliases) list.push({ id: `${n.path}\u0000${alias}`, label: alias, detail: `→ ${n.title}`, match: `${alias} → ${n.title}`.toLowerCase() });
    }
    for (const f of files) if (f.kind !== 'note') list.push({ id: f.rel, label: A.nameOf(f.rel), detail: f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : undefined, match: (f.rel.includes('/') ? `${A.nameOf(f.rel)} ${f.rel.slice(0, f.rel.lastIndexOf('/'))}` : `${A.nameOf(f.rel)} `).toLowerCase() });
    return { open: list.filter((e) => !e.quiet), quiet: list.filter((e) => e.quiet) };
  }, [notes, files]);
  return (
    <Picker
      placeholder="Find a note, or type a new name…"
      items={(q) => [...fuzzyFilterLower(entries.open, q, (e) => e.match, 60), ...(q.trim() ? fuzzyFilterLower(entries.quiet, q, (e) => e.match, 8) : [])].map((e) => ({ id: e.id, label: e.label, detail: e.detail, ...(e.icon ? { icon: e.icon } : {}) }))}
      more={fileHits.more}
      onPick={(item, { mod }) => {
        onClose();
        if (fileHits.pick(item.id, mod)) return;
        const path = item.id.split('\u0000')[0];
        A.openPath(path, { where: mod ? 'tab' : 'current' });
      }}
      extraRow={(q) => {
        const name = q.trim();
        if (!name || !canEdit || notes.some((n) => n.title.toLowerCase() === name.toLowerCase())) return null;
        return {
          label: `Make a note called “${name}”`,
          run: () => {
            onClose();
            void newNoteOfType(undefined, { folder: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : undefined, title: name.split('/').pop(), ask: false });
          },
        };
      }}
      footer={
        <span style={{ display: 'flex', gap: 16, width: '100%', alignItems: 'center' }}>
          <span><kbd>↑↓</kbd> move</span> <span><kbd>↵</kbd> open</span> <span><kbd>esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>Ctrl+K lists every command</span>
        </span>
      }
      onClose={onClose}
    />
  );
}

type AskMode = 'ask' | 'find' | 'do';

// A change time's day words, kept (the date words never change for one mtime). One formatter, not one
// per row (t102, 9 Nov 2026): toLocaleDateString builds its formatter on every call, and six rows cost
// each keystroke two thirds of its time.
const dayFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
const dayWords = new Map<number, string>();

export function CommandPalette({ onClose }: { onClose(): void }) {
  const ctx = commandContext();
  // Read once (t102, 9 Nov 2026): the lists below do not follow the typed words, but every keystroke rebuilt
  // them — each command asked whether it shows, each type resolved. The palette closes on any action, so the
  // tab behind it cannot change while it stands.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recent = useMemo(() => recentCommands(), []);
  const notes = useApp((s) => s.notes);
  const canEdit = useApp((s) => s.canEdit);
  // Ask, Find and Do with the scope (4 Nov 2026): the middle Ask box's bar, kept in the header bar's
  // panel in the same words. Find lists as the palette always did; Ask and Do put the typed words
  // first as their own action.
  const [mode, setMode] = useState<AskMode>('find');
  const [source, setSource] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  // Aliases stay out of the browsing lists (8 Nov 2026, the quiet More): each survivor is found once. With
  // words typed they answer by their own names (t21: each New kind answers in Ctrl+K — search finding the door,
  // not a second door), ranked with everything else.
  const usable = useMemo(() => listedCommands().filter((c) => available(c, ctx)), [ctx.tab, ctx.path, ctx.view, notes, canEdit]);
  // The types and packs More used to list (8 Nov 2026, the quiet More): each answers here by its own name,
  // ranked WITH the commands in the one sort, so an exact kind or pack wins over a weak command match.
  // Projects, Meetings, People and Notes are the bar's own rows, so they are not repeated.
  const noteTypes = useNoteTypes();
  const switches = useModules();
  const typeRows = useMemo(() => typePaletteRows(noteTypes.filter((t) => !['project', 'meeting', 'person', 'note'].includes(t.id))), [noteTypes]);
  const packRows = useMemo(() => packPaletteRows(modulesOn(switches).filter((m) => m.id !== 'meetings')), [switches]);
  type MatchRow = { kind: 'command'; cmd: Command } | { kind: 'kind' | 'pack'; id: string; name: string; icon: IconName; detail?: string };
  const matchable: MatchRow[] = useMemo(
    () => [
      ...usable.map((cmd): MatchRow => ({ kind: 'command', cmd })),
      ...typeRows.map((r): MatchRow => ({ kind: 'kind', id: r.id, name: r.label, icon: r.icon, detail: r.detail })),
      ...packRows.map((r): MatchRow => ({ kind: 'pack', id: r.id, name: r.label, icon: r.icon, detail: 'Pack' })),
    ],
    [usable, typeRows, packRows],
  );
  // The aliases by their own names, for typed words only (t21): each New kind answers in Ctrl+K, ranked with
  // everything else. The browsing lists above keep the survivor once.
  const aliasRows: MatchRow[] = useMemo(() => COMMANDS.filter((c) => c.aliasOf && available(c, ctx)).map((cmd): MatchRow => ({ kind: 'command', cmd })), [ctx.tab, ctx.path, ctx.view, notes, canEdit]);
  // Plugins' commands (8.9), read fresh each time the palette opens. A host that knows no plugins answers
  // nothing at all, and the list below reads an array: nothing still means no commands, never a crash.
  const [extra, setExtra] = useState<PluginCommandView[]>([]);
  useEffect(() => {
    void pluginCommands().then((r) => setExtra(r ?? []), () => setExtra([]));
  }, []);
  // With nothing typed, the commands used lately come first, then the rest, then the kinds and packs.
  const matchableOrdered: MatchRow[] = useMemo(
    () => [
      ...usable.filter((c) => recent.includes(c.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)).map((cmd): MatchRow => ({ kind: 'command', cmd })),
      ...usable.filter((c) => !recent.includes(c.id)).map((cmd): MatchRow => ({ kind: 'command', cmd })),
      ...matchable.filter((r) => r.kind !== 'command'),
    ],
    [usable, matchable, recent],
  );
  // Pages under the commands (8.7 wave 1 polish, 30 Oct 2026, command-palette.png's COMMANDS / PAGES): the notes
  // opened lately with nothing typed, else the notes whose name matches. Project files stay in Open a note.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recentPaths = useMemo(() => getWorkspace().recent.filter((p) => !p.includes(':')), []);
  // The open notes once (t102, 9 Nov 2026): each keystroke asked every note whether it hides,
  // then rebuilt and lowered every matching line. The lowered line waits here instead.
  const openNotes = useMemo(() => notes.filter((n) => !quietPath(n.path)).map((n) => ({ n, match: `${n.title} ${n.path}`.toLowerCase() })), [notes]);
  const byPath = useApp((s) => s.byPath);
  // Go to a tab of the open project page (t255, 13 Nov 2026): Ctrl+K still finds each section.
  const goRows = (q: string): PickerItem[] => {
    const onProject = ctx.tab.type === 'note' && ctx.path && ctx.tab.mode === 'page' && isProjectProps(byPath.get(ctx.path)?.props);
    if (!onProject || !ctx.path) return [];
    return fuzzyFilter(PROJECT_TABS, q, (t) => `Go to ${t.title}`, 13).map((t) => ({ id: `pjgoto:${t.id}`, section: 'Go to', label: `Go to ${t.title}`, icon: 'forward' as const, hint: '↵ open' }));
  };
  const pages = (q: string): PickerItem[] => {
    // The day read once per note (t102, 9 Nov 2026): the date words cost each keystroke for the same rows.
    const day = (mtime: number) => {
      const had = dayWords.get(mtime);
      if (had !== undefined) return had;
      const out = dayFmt.format(new Date(mtime));
      if (dayWords.size > 2000) dayWords.clear();
      dayWords.set(mtime, out);
      return out;
    };
    const row = (path: string, title: string, mtime: number): PickerItem => {
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      return { id: `page:${path}`, section: 'Pages', label: title, detail: folder ? `${folder} · ${day(mtime)}` : day(mtime), icon: 'doc', hint: '↵ open' };
    };
    const open = openNotes;
    if (!q.trim()) return recentPaths.map((p) => open.find((e) => e.n.path === p)).filter((e): e is (typeof open)[number] => !!e).slice(0, 4).map((e) => row(e.n.path, e.n.title, e.n.mtime));
    return fuzzyFilterLower(open, q, (e) => e.match, 6).map((e) => row(e.n.path, e.n.title, e.n.mtime));
  };
  // The typed words as the mode's own action, first: Ask puts them to the helper over the scope, Do
  // files them as a task. Find keeps the list as it was, into the full search below. Whole words:
  // palette rows wrap (t207 pass 2).
  const short = (q: string) => q.trim();
  const modeRows = (q: string): PickerItem[] => {
    const words = q.trim();
    if (!words) return [];
    if (mode === 'ask') return [{ id: `ask:${words}`, label: `Ask the assistant about “${short(q)}”`, detail: source ? A.titleOf(source) : 'All notes', icon: 'chat' }];
    if (mode === 'do' && canEdit) return [{ id: `do:${words}`, label: `File “${short(q)}” as a task`, icon: 'task' }];
    return [];
  };
  return (
    <Picker
      placeholder="Ask or find anything…"
      items={(q) => [
        ...modeRows(q),
        ...fuzzyFilter(q.trim() ? [...matchable, ...aliasRows] : matchableOrdered, q, (r) => (r.kind === 'command' ? r.cmd.name : r.name), 80).map((r) => {
          if (r.kind !== 'command') return { id: r.id, section: 'Commands', label: r.name, icon: r.icon, detail: r.detail, hint: '↵ open' };
          const keys = hotkeyOf(r.cmd);
          return { id: r.cmd.id, section: 'Commands', label: r.cmd.name, icon: r.cmd.icon, detail: !q.trim() && recent.includes(r.cmd.id) ? 'used lately' : undefined, hint: keys ? <kbd>{formatHotkey(keys)}</kbd> : undefined };
        }),
        ...fuzzyFilter(extra, q, (c) => `${c.title} ${c.pluginName}`, 20).map((c) => ({ id: `plugin:${c.pluginId}:${c.commandId}`, section: 'Commands', label: c.title, icon: 'command' as const, detail: c.pluginName })),
        ...goRows(q),
        ...pages(q),
      ]}
      extraRow={(q) => {
        // Joined to the search (8.7 w2c): the typed words jump into full search.
        const words = q.trim();
        if (words.length < 2) return null;
        return {
          label: `Search inside notes for “${words}”`,
          run: () => {
            onClose();
            requestSearch(words);
          },
        };
      }}
      onPick={(item, { mod }) => {
        if (item.id.startsWith('ask:')) {
          onClose();
          const q = item.id.slice('ask:'.length);
          // The right chat panel is the one place to ask (4 Nov 2026, p9-one-ask): the words ask there, in the open.
          showSide('right', 'chat');
          void sendChat(q, source ?? undefined).catch(() => draftInChat(q, source ?? undefined));
          return;
        }
        if (item.id.startsWith('do:')) {
          // The panel stays open until the words are filed (as the box kept them): a failure speaks
          // and the words stay for another try, instead of vanishing with the panel.
          if (filing) return;
          const text = item.id.slice('do:'.length);
          setFiling(true);
          void A.fileTaskText(text).then((filed) => {
            setFiling(false);
            if (filed) onClose();
          });
          return;
        }
        onClose();
        if (item.id.startsWith('pjgoto:')) {
          if (ctx.path) window.dispatchEvent(new CustomEvent('pj-goto', { detail: { path: ctx.path, section: item.id.slice('pjgoto:'.length) } }));
          return;
        }
        if (item.id.startsWith('page:')) {
          A.openPath(item.id.slice('page:'.length), { where: mod ? 'tab' : 'current' });
          return;
        }
        if (item.id.startsWith('type:')) {
          openTypePage(item.id.slice('type:'.length), mod ? 'tab' : 'current');
          return;
        }
        if (item.id.startsWith('pack:')) {
          openModule(item.id.slice('pack:'.length));
          return;
        }
        if (item.id.startsWith('plugin:')) {
          const [, pluginId, commandId] = item.id.split(':');
          if (pluginId && commandId) void window.nv.plugins.runCommand(pluginId, commandId).then((r) => (r.ok || !r.words ? undefined : toast(r.words))).catch(showError);
          return;
        }
        const cmd = COMMANDS.find((c) => c.id === item.id);
        if (!cmd) return;
        noteCommandUsed(cmd.id);
        void Promise.resolve(cmd.run(commandContext()));
      }}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <div className="picker-modes">
            <div className="seg" role="tablist" aria-label="What to do with the words">
              {(['ask', 'find', 'do'] as const).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} title={m === 'ask' ? 'Ask the assistant' : m === 'find' ? 'Find it in your notes' : 'File it as a task'} onClick={() => setMode(m)}>
                  {m === 'ask' ? 'Ask' : m === 'find' ? 'Find' : 'Do'}
                </button>
              ))}
            </div>
            <button
              className="src"
              title={mode === 'ask' ? 'Which notes the assistant reads' : 'The assistant reads these when Asking'}
              aria-haspopup="menu"
              onClick={(e) =>
                openMenu(e.currentTarget, [
                  { label: 'All notes', icon: 'notes', checked: !source, run: () => setSource(null) },
                  ...(recentPaths.length ? [{ separator: true } as const] : []),
                  ...recentPaths.slice(0, 6).map((p) => ({ label: A.titleOf(p), icon: 'doc' as const, checked: source === p, run: () => setSource(p) })),
                ])
              }
            >
              {source ? A.titleOf(source) : 'All notes'} <Icon name="chevronDown" size={12} />
            </button>
          </div>
          <span style={{ display: 'flex', gap: 16, width: '100%', alignItems: 'center' }}>
            <span><kbd>↑↓</kbd> move</span> <span><kbd>↵</kbd> open</span> <span><kbd>esc</kbd> close</span>
            <span style={{ marginLeft: 'auto' }}>Ctrl+K or Ctrl+O anywhere</span>
          </span>
        </div>
      }
      onClose={onClose}
    />
  );
}

export function Welcome({ recent, onPick, onOpenRecent, error }: { recent: string[]; onPick(): void; onOpenRecent(path: string): void; error: string | null }) {
  // Choosing, not failing (t156, 9 Nov 2026): with no reason known there is no failure to claim — the person
  // picks their folder, or makes a new one in the window (its picker allows it).
  return (
    <div className="welcome">
      <h1>Ironleaf</h1>
      {error ? (
        <>
          <p>Ironleaf couldn’t open your notes folder.</p>
          <p className="notice">{error}</p>
        </>
      ) : (
        <p>Your notes live in a folder on this PC. Choose it here, or make a new one in the window that opens.</p>
      )}
      <button className="button primary large" onClick={onPick}>
        Choose a folder of notes
      </button>
      {recent.length > 0 && (
        <div className="recent">
          <h3>Opened before</h3>
          {recent.map((v) => (
            <button key={v} className="tree-row" onClick={() => onOpenRecent(v)} title={v}>
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
