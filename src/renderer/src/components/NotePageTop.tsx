// The top of a note page, above its title (wave D of Ironleaf Calm, 20 Oct 2026, approved the plan): an optional cover
// (a calm colour band or a picture from the vault), an optional icon (an emoji or one of our line icons), then the type
// chip. Each is a plain line in the note's front matter (src/shared/note-page.ts) written through the same safe property
// writer as the fields, so the rest of the block stays as the person wrote it. Adding them is offered quietly above the
// title, seen only when the pointer rests on the top; the space is kept either way so nothing jumps.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Document } from 'yaml';
import { changeProps, readProps } from '../../../shared/frontmatter';
import { COVER_COLOURS, LINE_ICONS, PAGE_TYPES, pageType, readCover, readIcon, type CoverColour, type PageIcon } from '../../../shared/note-page';
import { pageTypeChoices, pageTypeFor } from '../state/noteTypes';
import { fileUrl, resolveFile } from '../lib/resolve';
import { getState, showError, toast } from '../state/store';
import { Icon, type IconName } from './Icon';
import { openMenu, type MenuItem } from './Menu';
import { pickFile } from './Pickers';
import { LevelChip, pickLevel, plainlyOpen, type LiveNote } from './LevelPicker';
import { isEnterKey } from '../lib/enterKey';

// Checked when the app is built: every icon a note can wear is one the app draws.
const PAGE_ICONS = LINE_ICONS satisfies readonly IconName[];
const TYPE_ICONS = PAGE_TYPES.map((t) => t.icon) satisfies IconName[];
void TYPE_ICONS;

const COLOUR_NAME: Record<CoverColour, string> = { sand: 'Sand', clay: 'Clay', sage: 'Sage', sea: 'Sea', sky: 'Sky', dusk: 'Dusk', stone: 'Stone' };

/** A few emoji to start from; any other can be typed or pasted into the picker. */
const EMOJI = ['📝', '📌', '💡', '📚', '📎', '🗂️', '📅', '🧭', '🎯', '🚀', '✅', '⭐', '🔥', '🌱', '🌊', '☕', '🏠', '💼', '🛠️', '🎨', '🎵', '✈️', '🧪', '💬', '👤', '👥', '📈', '🔑', '🧩', '🌏', '🍀', '⚡'];

const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '');

/** The type's line icon (one the app draws), for the chip and for links to typed notes. */
export function typeIcon(id: string | null): IconName {
  return (pageType(id)?.icon ?? 'file') as IconName;
}

/** The icon a note wears, drawn at a size (an emoji as text, a line icon in its soft square). */
export function PageIconMark({ icon, size }: { icon: PageIcon; size: number }) {
  return icon.kind === 'emoji' ? (
    <span className="page-icon-emoji" style={{ fontSize: size }} aria-hidden="true">
      {icon.text}
    </span>
  ) : (
    <span className="page-icon-line" style={{ width: size * 1.3, height: size * 1.3 }} aria-hidden="true">
      <Icon name={icon.name} size={Math.round(size * 0.72)} />
    </span>
  );
}

/** The icon picker: a few emoji, our line icons, a box to type any emoji, Remove. Closes on a choice, Esc or a click away. */
function IconPicker({ anchor, current, onPick, onClose }: { anchor: HTMLElement; current: PageIcon | null; onPick(value: string | null): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 6 };
  });
  const [typed, setTyped] = useState('');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(pos.x, window.innerWidth - r.width - 8));
    const y = pos.y + r.height > window.innerHeight - 8 ? Math.max(8, anchor.getBoundingClientRect().top - r.height - 6) : pos.y;
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
  }, [pos, anchor]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);
  const typedIcon = readIcon(typed);
  return createPortal(
    <div ref={ref} className="page-icon-picker" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Choose an icon">
      <div className="page-picker-label">Emoji</div>
      <div className="page-picker-grid">
        {EMOJI.map((e) => (
          <button key={e} className={`page-picker-cell${current?.kind === 'emoji' && current.text === e ? ' is-current' : ''}`} title={e} onClick={() => onPick(e)}>
            <span className="page-icon-emoji">{e}</span>
          </button>
        ))}
      </div>
      <div className="page-picker-label">Line icons</div>
      <div className="page-picker-grid">
        {PAGE_ICONS.map((n) => (
          <button key={n} className={`page-picker-cell${current?.kind === 'line' && current.name === n ? ' is-current' : ''}`} title={n} onClick={() => onPick(n)}>
            <Icon name={n} size={17} />
          </button>
        ))}
      </div>
      <div className="page-picker-foot">
        <input
          className="page-picker-input"
          value={typed}
          placeholder="Type or paste an emoji"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (isEnterKey(e) && typedIcon?.kind === 'emoji') onPick(typedIcon.text);
          }}
        />
        {typedIcon?.kind === 'emoji' && (
          <button className="page-picker-use" onClick={() => onPick(typedIcon.text)}>
            Use {typedIcon.text}
          </button>
        )}
        {current && (
          <button className="page-picker-remove" onClick={() => onPick(null)}>
            Remove
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface TopProps {
  path: string;
  text: string;
  canEdit: boolean;
  onChange(next: string): void;
}

export function NotePageTop({ path, text, canEdit, onChange }: TopProps) {
  const props = useMemo(() => readProps(text), [text]);
  const cover = readCover(props.cover);
  const icon = readIcon(props.icon);
  const shownType = pageTypeFor(path, props);
  const typeId = shownType?.id ?? null;
  const type = shownType;
  const [picking, setPicking] = useState<HTMLElement | null>(null);
  // The picture fades in once it has loaded (the band keeps its height meanwhile); kept by its address, so a new
  // picture fades in too.
  const picturePath = cover?.kind === 'picture' ? (resolveFile(cover.path, path) ?? cover.path) : null;
  const pictureUrl = picturePath ? fileUrl(picturePath) : null;
  const [loaded, setLoaded] = useState<string | null>(null);

  const set = (key: string, value: string | null) => {
    try {
      onChange(changeProps(text, (doc: Document) => (value === null ? doc.delete(key) : doc.set(key, value))));
    } catch (err) {
      showError(err);
    }
  };

  const coverMenu = (at: HTMLElement) => {
    const items: MenuItem[] = [
      { heading: 'Cover' },
      ...COVER_COLOURS.map((c) => ({ label: COLOUR_NAME[c], icon: 'palette' as IconName, checked: cover?.kind === 'colour' && cover.colour === c, run: () => set('cover', c) })),
      { separator: true },
      {
        label: 'Picture from the vault…',
        icon: 'image',
        run: async () => {
          const pictures = getState().files.filter((f) => f.kind === 'image').map((f) => f.rel);
          // No empty picker to escape out of (9.2 uplift F132): with no pictures, say so and how to add one.
          if (!pictures.length) {
            toast('No pictures in the vault yet. Once one is among your files, pick it here.');
            return;
          }
          const chosen = await pickFile('Which picture?', pictures, titleOf);
          if (chosen) set('cover', chosen);
        },
      },
      ...(cover ? [{ separator: true } as MenuItem, { label: 'Remove cover', icon: 'trash' as IconName, danger: true, run: () => set('cover', null) }] : []),
    ];
    openMenu(at, items);
  };

  const typeMenu = (at: HTMLElement) =>
    openMenu(at, [
      { heading: 'Change type' },
      ...pageTypeChoices().map((t) => ({ label: t.name, icon: t.icon as IconName, checked: t.id === typeId, run: () => set('type', t.id) })),
      ...(typeId ? [{ separator: true } as MenuItem, { label: 'No type', icon: 'close' as IconName, run: () => set('type', null) }] : []),
    ]);

  // Its sensitivity (Wave 4): read from the words as they are now, and set in them like the cover and the type.
  const live: LiveNote = { props, set: (level) => set('sensitivity', level) };
  const open = plainlyOpen(path, live);
  const tools = canEdit && (!cover || !icon || !type || open);

  return (
    <div className={`page-top${cover ? ' has-cover' : ''}${icon ? ' has-icon' : ''}`}>
      {tools && (
        <div className="page-tools">
          {!cover && (
            <button className="page-tool" onClick={(e) => coverMenu(e.currentTarget)}>
              <Icon name="image" size={13} />
              <span>Add cover</span>
            </button>
          )}
          {!icon && (
            <button className="page-tool" onClick={(e) => setPicking(e.currentTarget)}>
              <Icon name="sparkle" size={13} />
              <span>Add icon</span>
            </button>
          )}
          {!type && (
            <button className="page-tool" onClick={(e) => typeMenu(e.currentTarget)}>
              <Icon name="tag" size={13} />
              <span>Add type</span>
            </button>
          )}
          {open && (
            <button className="page-tool" onClick={(e) => pickLevel(e.currentTarget, path, live)}>
              <Icon name="lock" size={13} />
              <span>Set sensitivity</span>
            </button>
          )}
        </div>
      )}
      {cover && (
        <div className={`page-cover${cover.kind === 'colour' ? ` is-${cover.colour}` : ' is-picture'}`}>
          {pictureUrl && <img className={loaded === pictureUrl ? 'is-loaded' : ''} src={pictureUrl} alt="" draggable={false} onLoad={() => setLoaded(pictureUrl)} />}
          {canEdit && (
            <button className="page-cover-change" onClick={(e) => coverMenu(e.currentTarget)}>
              <Icon name="image" size={13} />
              <span>Change cover</span>
            </button>
          )}
        </div>
      )}
      {icon && (
        <div className="page-icon-row">
          {canEdit ? (
            <button className="page-icon" title="Change icon" onClick={(e) => setPicking(e.currentTarget)}>
              <PageIconMark icon={icon} size={40} />
            </button>
          ) : (
            <span className="page-icon">
              <PageIconMark icon={icon} size={40} />
            </span>
          )}
        </div>
      )}
      {type &&
        (canEdit ? (
          <button className={`page-type${type.color ? ` nt-${type.color}` : ''}`} title="Change type" onClick={(e) => typeMenu(e.currentTarget)}>
            <Icon name={type.icon as IconName} size={13} />
            <span>{type.name}</span>
          </button>
        ) : (
          <span className={`page-type${type.color ? ` nt-${type.color}` : ''}`}>
            <Icon name={type.icon as IconName} size={13} />
            <span>{type.name}</span>
          </span>
        ))}
      <LevelChip path={path} live={live} />
      {picking && (
        <IconPicker
          anchor={picking}
          current={icon}
          onClose={() => setPicking(null)}
          onPick={(value) => {
            setPicking(null);
            set('icon', value);
          }}
        />
      )}
    </div>
  );
}
