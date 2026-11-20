// The sensitivity picker (Wave 4, 24 Oct 2026): a note's, file's, asset's or folder's level — Open, Work-confidential,
// Personal, Family-private, Health — chosen from its chip on the note's page, the asset's details, its ⋯ menu or the file
// list. The picker says, for each level, what it is for and who may read it now, so the choice is made knowing. A note
// keeps its level as its `sensitivity:` property; a file's and a folder's go in the vault's sensitivity file
// (src/main/sensitive.ts). Who reads each level is set in Settings › Privacy and secrets.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { accessOf, AGENT_GROUPS, LEVELS, levelLabel, levelInfo, levelOf, type Level, type LevelOf } from '../../../shared/sensitivity';
import { isPrivatePath } from '../../../shared/private';
import { folderHere, levelHere, privacyStore, setFolderLevel, setLevel, usePrivacy } from '../state/privacy';
import { openModal } from '../state/modals';
import { getState, useApp } from '../state/store';
import { Icon, type IconName } from './Icon';
import { type MenuItem } from './Menu';

export const LEVEL_ICON: Record<Level, IconName> = { open: 'eye', work: 'briefcase', personal: 'person', family: 'people', health: 'heart' };

/** Who may read a level now (the four groups), in words. */
export function readersOf(level: Level): string {
  const store = privacyStore();
  const who = AGENT_GROUPS.filter((g) => accessOf(store, g.id).includes(level)).map((g) => g.label.replace(/^The /, 'the ').replace(/^Outside/, 'outside'));
  return who.length ? `Read by ${who.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : 'No assistant or agent reads it';
}

/** A note open in the editor: its level read from the words as they are now, and set in them (the editor saves it). */
export interface LiveNote {
  props: Record<string, unknown>;
  set(level: Level | null): void;
}

const liveLevel = (path: string, live?: LiveNote) => (live ? levelOf(privacyStore(), path, live.props.sensitivity, live.props.type, live.props.area) : levelHere(path));

/** The level a path would have without its own (9.2 uplift F140): the same levelOf reading the chip shows,
 *  with no own level, so type and area defaults count and the promise names where it comes from. */
function levelBelow(path: string, type?: unknown, area?: unknown): { level: Level; folder?: string; from: LevelOf['from'] } {
  const { level, folder, from } = levelOf(privacyStore(), path, undefined, type, area);
  return { level, ...(folder ? { folder } : {}), from };
}

// ── The picker ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface PickerAsk {
  anchor: HTMLElement;
  title: string;
  sub: string;
  /** The level chosen now (its own), else null. */
  own: Level | null;
  /** What it is without its own. */
  below: { level: Level; folder?: string };
  pick(level: Level | null): void;
  /** Words for "no level of its own" ("As its folder says (Health)"). */
  noneWords: string;
}

function Picker({ ask, onClose }: { ask: PickerAsk; onClose(): void }) {
  usePrivacy();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => {
    const r = ask.anchor.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 6 };
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const a = ask.anchor.getBoundingClientRect();
    const x = Math.max(8, Math.min(pos.x, window.innerWidth - r.width - 8));
    const y = pos.y + r.height > window.innerHeight - 8 ? Math.max(8, a.top - r.height - 6) : pos.y;
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
  }, [pos, ask.anchor]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.lp-option.is-on, .lp-option')?.focus();
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !ask.anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.lp-option') ?? [])];
        const at = all.indexOf(document.activeElement as HTMLButtonElement);
        all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
      }
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [ask.anchor, onClose]);
  const shown = ask.own ?? ask.below.level;
  const choose = (level: Level | null) => {
    onClose();
    ask.pick(level);
  };
  return (
    <div ref={ref} className="lp" role="dialog" aria-label={ask.title} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="lp-head">
        <strong>{ask.title}</strong>
        <span>{ask.sub}</span>
      </div>
      <div className="lp-options" role="listbox" aria-label="Levels">
        {LEVELS.map((l) => (
          <button key={l.id} role="option" aria-selected={shown === l.id} className={`lp-option lv-${l.id}${shown === l.id ? ' is-on' : ''}`} onClick={() => choose(l.id)}>
            <span className="lp-icon" aria-hidden="true">
              <Icon name={LEVEL_ICON[l.id]} size={14} />
            </span>
            <span className="lp-words">
              <span className="lp-name">
                {l.label}
                {shown === l.id && !ask.own && ask.below.folder ? <em>from {ask.below.folder}</em> : null}
              </span>
              <span className="lp-what">{l.words}</span>
              <span className="lp-who">{readersOf(l.id)}</span>
            </span>
            {shown === l.id && <Icon name="check" size={15} className="lp-check" />}
          </button>
        ))}
      </div>
      <div className="lp-foot">
        {ask.own ? (
          <button className="lp-link" onClick={() => choose(null)}>
            <Icon name="folder" size={12} /> {ask.noneWords}
          </button>
        ) : (
          <span />
        )}
        <button
          className="lp-link"
          onClick={() => {
            onClose();
            openModal({ kind: 'settings', section: 'privacy' });
          }}
        >
          <Icon name="settings" size={12} /> Who reads each level
        </button>
      </div>
    </div>
  );
}

let host: { el: HTMLDivElement; root: Root } | null = null;
function openPicker(ask: PickerAsk): void {
  if (!host) {
    const el = document.createElement('div');
    el.className = 'lp-host';
    document.body.appendChild(el);
    host = { el, root: createRoot(el) };
  }
  const close = () => host?.root.render(null);
  host.root.render(<Picker key={Date.now()} ask={ask} onClose={close} />);
}

/** The picker for a note's, file's or asset's level (a note open in the editor: set in its words). */
export function pickLevel(anchor: HTMLElement, path: string, live?: LiveNote): void {
  if (isPrivatePath(path)) return;
  const now = liveLevel(path, live);
  const own = now.from === 'note' || now.from === 'file' ? now.level : null;
  const meta = live ? live.props : getState().byPath.get(path)?.props;
  const below = own ? levelBelow(path, meta?.type, meta?.area) : { level: now.level, ...(now.folder ? { folder: now.folder } : {}), from: now.from as LevelOf['from'] };
  const isNote = /\.md$/i.test(path);
  openPicker({
    anchor,
    title: 'Sensitivity',
    sub: `Who may read this ${isNote ? 'note' : 'file'}`,
    own,
    below,
    noneWords: below.from === 'type' ? `As its type says (${levelLabel(below.level)})` : below.folder ? `As ${below.folder} says (${levelLabel(below.level)})` : `No level of its own (${levelLabel(below.level)})`,
    pick: (level) => {
      if (live) {
        live.set(level);
        void window.nv.privacy.noted(path, level);
      } else void setLevel(path, level);
    },
  });
}

/** The picker for a folder's own default level. */
export function pickFolderLevel(anchor: HTMLElement, folder: string): void {
  const { own, inherited } = folderHere(folder);
  openPicker({
    anchor,
    title: `${folder.split('/').pop()}: its level`,
    sub: 'For everything in it without a level of its own',
    own,
    below: inherited ?? { level: 'open' },
    noneWords: inherited ? `As ${inherited.folder} says (${levelLabel(inherited.level)})` : 'No level of its own (Open)',
    pick: (level) => void setFolderLevel(folder, level),
  });
}

/** The menu entry for the ⋯ and right-click menus of a note, file or folder: short choices, the full picker a click away. */
export function levelMenuEntry(path: string, isFolder = false): MenuItem {
  const settings: MenuItem = { label: 'Who reads each level…', icon: 'settings', run: () => openModal({ kind: 'settings', section: 'privacy' }) };
  if (isFolder) {
    const { own } = folderHere(path);
    return {
      label: 'Sensitivity',
      icon: 'lock',
      hint: own ? levelInfo(own).short : undefined,
      submenu: [
        ...LEVELS.map((l): MenuItem => ({ label: l.label, icon: LEVEL_ICON[l.id], checked: own === l.id, run: () => void setFolderLevel(path, l.id) })),
        ...(own ? [{ separator: true } as MenuItem, { label: 'No level of its own', icon: 'close', run: () => void setFolderLevel(path, null) } as MenuItem] : []),
        { separator: true },
        settings,
      ],
    };
  }
  const now = levelHere(path);
  const own = now.from === 'note' || now.from === 'file' ? now.level : null;
  return {
    label: 'Sensitivity',
    icon: 'lock',
    hint: levelInfo(now.level).short,
    submenu: [
      ...LEVELS.map((l): MenuItem => ({ label: l.label, icon: LEVEL_ICON[l.id], checked: now.level === l.id, run: () => void setLevel(path, l.id) })),
      ...(own ? [{ separator: true } as MenuItem, { label: 'No level of its own', icon: 'folder', run: () => void setLevel(path, null) } as MenuItem] : []),
      { separator: true },
      settings,
    ],
  };
}

/** The level on a note's page, above its title: shown when it isn't Open (or always); a click changes it. */
export function LevelChip({ path, live, always = false }: { path: string; live?: LiveNote; always?: boolean }) {
  usePrivacy();
  useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  if (isPrivatePath(path)) return null;
  const now = liveLevel(path, live);
  if (now.level === 'open' && !always) return null;
  const info = levelInfo(now.level);
  const from = now.from === 'folder' && now.folder ? `from ${now.folder}` : now.from === 'type' ? 'from its type' : '';
  const title = `${info.words} ${readersOf(now.level)}.`;
  const body = (
    <>
      <Icon name={LEVEL_ICON[now.level]} size={13} />
      <span>{info.label}</span>
      {from && <span className="lv-from">{from}</span>}
    </>
  );
  return canEdit ? (
    <button className={`lv-chip lv-${now.level}`} title={title} onClick={(e) => pickLevel(e.currentTarget, path, live)}>
      {body}
    </button>
  ) : (
    <span className={`lv-chip lv-${now.level}`} title={title}>
      {body}
    </span>
  );
}

/** Whether a note open in the editor shows as Open with no level of its own (its page then offers "Set sensitivity"). */
export const plainlyOpen = (path: string, live: LiveNote) => liveLevel(path, live).level === 'open';

/** A small level mark for lists (the asset store, the scanner, the audit trail). */
export function LevelMark({ level, quiet = false }: { level: Level; quiet?: boolean }) {
  if (quiet && level === 'open') return null;
  return (
    <span className={`lv-mark lv-${level}`} title={levelInfo(level).words}>
      <Icon name={LEVEL_ICON[level]} size={11} />
      {levelInfo(level).short}
    </span>
  );
}
