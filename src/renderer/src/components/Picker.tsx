import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { EmptyState } from './EmptyState';

export interface PickerItem {
  id: string;
  label: ReactNode;
  detail?: string;
  hint?: ReactNode;
  icon?: IconName;
  /** In place of the icon (a file's kind). */
  lead?: ReactNode;
  /** A second line (where the words were found). */
  sub?: ReactNode;
  /** The group heading drawn above the first item carrying it (the palette's COMMANDS / PAGES). */
  section?: string;
}

/** More rows found a moment after typing (project files): under their own heading, after the list's own. */
export interface PickerMore {
  title: string;
  /** Only once this many characters are typed. */
  min?: number;
  load(query: string): Promise<PickerItem[]>;
  /** Shown under the heading while it reads, or when it says why there is nothing yet. */
  note?: ReactNode;
}

interface PickerProps {
  placeholder: string;
  items(query: string): PickerItem[];
  /** shift: Shift held; mod: Ctrl (Cmd on a Mac) held. */
  onPick(item: PickerItem, event: { shift: boolean; mod: boolean }): void;
  /** Shown as the last row when it returns something, e.g. "Make a note called …". Shift+Enter picks it. */
  extraRow?(query: string): { label: string; run(): void } | null;
  footer?: ReactNode;
  more?: PickerMore;
  onClose(): void;
}

/** The keyboard-first list behind the quick switcher, the command list and the pickers. */
export function Picker({ placeholder, items, onPick, extraRow, footer, more, onClose }: PickerProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [found, setFound] = useState<{ query: string; items: PickerItem[] }>({ query: '', items: [] });
  const list = useRef<HTMLDivElement>(null);
  const own = items(query);
  const moreItems = more && found.query === query.trim() ? found.items : [];
  const results = [...own, ...moreItems];
  const extra = extraRow?.(query) ?? null;
  const count = results.length + (extra ? 1 : 0);

  useEffect(() => setSelected(0), [query]);
  // Rows found a moment after typing stops (the list's own rows stay where they are).
  useEffect(() => {
    const q = query.trim();
    if (!more || q.length < (more.min ?? 2)) {
      setFound({ query: q, items: [] });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      more.load(q).then(
        (r) => live && setFound({ query: q, items: r }),
        () => live && setFound({ query: q, items: [] }),
      );
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    list.current?.querySelector('.picker-row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (index: number, shift: boolean, mod: boolean) => {
    if (index < results.length) onPick(results[index], { shift, mod });
    else extra?.run();
  };

  return (
    <div className="overlay picker-overlay" onMouseDown={onClose}>
      <div className="picker" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-input">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={query}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
                e.preventDefault();
                setSelected((s) => (count ? (s + 1) % count : 0));
              } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
                e.preventDefault();
                setSelected((s) => (count ? (s - 1 + count) % count : 0));
              } else if (e.key === 'Enter' && count) {
                e.preventDefault();
                choose(e.shiftKey && extra ? results.length : selected, e.shiftKey, e.ctrlKey || e.metaKey);
              }
            }}
          />
        </div>
        <div className="picker-list" ref={list}>
          {results.map((item, i) => (
            <Fragment key={item.id}>
              {item.section && (i === 0 || results[i - 1].section !== item.section) && <div className="picker-heading">{item.section}</div>}
              {more && i === own.length && <div className="picker-heading">{more.title}</div>}
              <button className={`picker-row${i === selected ? ' selected' : ''}${item.sub ? ' has-sub' : ''}`} title={typeof item.label === 'string' ? item.label : undefined} onMouseMove={() => setSelected(i)} onClick={(e) => choose(i, e.shiftKey, e.ctrlKey || e.metaKey)}>
                {item.lead ?? (item.icon && <Icon name={item.icon} size={15} className="picker-icon" />)}
                {item.sub ? (
                  <span className="picker-two">
                    <span className="picker-line">
                      <span className="picker-label">{item.label}</span>
                      {item.detail && <span className="picker-detail">{item.detail}</span>}
                    </span>
                    <span className="picker-sub">{item.sub}</span>
                  </span>
                ) : (
                  <>
                    <span className="picker-label">{item.label}</span>
                    {item.detail && <span className="picker-detail">{item.detail}</span>}
                  </>
                )}
                {item.hint && <span className="picker-hint">{item.hint}</span>}
              </button>
            </Fragment>
          ))}
          {more?.note && query.trim().length >= (more.min ?? 2) && <div className="picker-note">{more.note}</div>}
          {extra && (
            <button className={`picker-row extra${selected === results.length ? ' selected' : ''}`} title={typeof extra.label === 'string' ? extra.label : undefined} onMouseMove={() => setSelected(results.length)} onClick={() => extra.run()}>
              <Icon name="filePlus" size={15} className="picker-icon" />
              <span className="picker-label">{extra.label}</span>
            </button>
          )}
          {!count && <EmptyState size="panel" icon="search" title="Nothing matches" line="Try fewer letters, or another word for it." />}
        </div>
        {footer && <div className="picker-footer">{footer}</div>}
      </div>
    </div>
  );
}
