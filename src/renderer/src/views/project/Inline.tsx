// Editing a project's page in place: double-click a value, click its pencil, or Tab to it and press E (or F2), and it
// becomes a field in the same type, where it was, with the caret where the click was. A single click no longer edits (WS1
// part B, 24 Oct 2026): a value that belongs to a record (an action, a milestone, a person… components/RecordScope.tsx)
// opens that record in the peek, as Space and Enter do; an empty value's "+ …" still adds with one click. Every field of
// words wraps and grows inside its own box (never a one-line field running off the card): Enter saves, Shift+Enter makes
// a new line in words of several lines, Esc puts it back, clicking away saves. Values the person can change show it
// softly when the pointer is over them, with a small pencil that takes no room. Suggestions (people, tags) drop down
// under the field. Rows are added with a quiet "Add…" line at the end of a list.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectEdit } from '../../../../shared/project-file';
import type { ProjectView } from '../../../../shared/types';
import { GrowField } from '../../components/GrowField';
import { Icon, type IconName } from '../../components/Icon';
import { wikilinkFromClick } from '../../lib/markdownRender';
import { readDate, shortDate } from '../../lib/projectLook';
import { useRecord } from '../../components/RecordScope';
import * as A from '../../state/actions';
import { cancelPeekSoon, peek, peekSoon, unpeek } from '../../state/peek';
import { isEnterKey } from '../../lib/enterKey';

export interface Editor {
  path: string;
  canEdit: boolean;
  known: ProjectView['known'];
  /** One change, through the one way changes go (main side, project-file.ts); resolves whether it was made. */
  edit(change: ProjectEdit): Promise<boolean>;
}

export const EditorContext = createContext<Editor | null>(null);
export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('The project page’s editor is missing.');
  return editor;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
/** A date as the project's lines write it: "17 Oct 2026". */
export const lineDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
/** A date as the properties write it: "2026-10-17". */
export const isoDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Whether words are a date the page can read (and so edit with a calendar). */
export const readable = (text?: string) => !!text && /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\s+[A-Za-z]{3}/.test(text.trim()) && readDate(text) !== null;
/** A date as people read it ("12 Oct", "3 Mar 2025"), when it can be read; else as written. */
export const niceDate = (text: string) => (readable(text) ? shortDate(readDate(text)!) : text);

export interface Suggestion {
  value: string;
  hint?: string;
}

/** Whether a click was on a link (or text being selected), which isn't a wish to edit. */
const notForEditing = (e: React.MouseEvent) => !!(e.target as Element).closest('a, button, input, .pj-ed-input') || !!window.getSelection()?.toString();

interface InlineProps {
  value: string;
  /** Saves the new words ('' when emptied); resolves whether it was saved. */
  onSave(value: string): Promise<boolean> | void;
  /** What shows when it isn't being edited (else the words themselves). */
  children?: ReactNode;
  placeholder?: string;
  /** The placeholder shows only when the pointer is over its row (for the optional parts of a line). */
  quiet?: boolean;
  multiline?: boolean;
  /** It can't be emptied: emptied, it goes back as it was. */
  required?: boolean;
  suggest?: Suggestion[];
  onPick?(s: Suggestion): void;
  className?: string;
  label: string;
  /** Starts in editing (Edit description… from a menu). */
  autoEdit?: boolean;
  onDone?(): void;
  maxLength?: number;
  /** A small value (a chip, the owner, a tag): the field is as wide as its words, up to its column. Otherwise the field
   *  takes the whole width the words had. */
  compact?: boolean;
}

/** Where in the words a click landed (when the words show as written, without Markdown), so the caret goes there. */
function caretAt(e: React.MouseEvent, el: HTMLElement, value: string): number | null {
  if (el.textContent !== value) return null;
  const doc = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
  const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
  if (!pos || !el.contains(pos.offsetNode)) return null;
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(pos.offsetNode, pos.offset);
  return r.toString().length;
}

/** A value edited in place: one line, or several (Markdown shown when not editing). */
export function Inline({ value, onSave, children, placeholder = '', quiet, multiline, required, suggest, onPick, className = '', label, autoEdit, onDone, maxLength = multiline ? 20000 : 400, compact }: InlineProps) {
  const { canEdit, path } = useEditor();
  const rec = useRecord();
  const [editing, setEditing] = useState(!!autoEdit && canEdit);
  const caret = useRef<number | null>(null);
  const shown = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    // Finished with the keys (Enter or Esc): the keys stay on the value, so Tab goes on from it.
    if (!editing && refocus.current) {
      refocus.current = false;
      shown.current?.focus();
    }
  }, [editing]);
  const empty = !value.trim();
  const Tag = multiline ? 'div' : 'span';
  if (!canEdit) return empty ? null : <Tag className={className}>{children ?? value}</Tag>;
  if (editing)
    return (
      <Field
        initial={value}
        multiline={multiline}
        required={required}
        suggest={suggest}
        onPick={onPick}
        className={className}
        label={label}
        placeholder={placeholder}
        maxLength={maxLength}
        compact={compact}
        caret={caret.current}
        onKeyClose={() => (refocus.current = true)}
        onClose={async (next) => {
          setEditing(false);
          onDone?.();
          if (next === null || next.trim() === value.trim() || (required && !next.trim())) return;
          await onSave(multiline ? next.replace(/\s+$/, '') : next.trim());
        }}
      />
    );
  const startEdit = (e?: React.MouseEvent) => {
    caret.current = e && !empty ? caretAt(e, e.currentTarget as HTMLElement, value) : null;
    setEditing(true);
  };
  return (
    <Tag
      ref={shown as never}
      className={`pj-ed ${className}${empty ? ` pj-ed-empty${quiet ? ' quiet' : ''}` : ' has-pencil'}${multiline ? ' block' : ''}${rec && !empty ? ' rec-peekable' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={empty ? placeholder || label : `${label}: ${value.slice(0, 80)}`}
      aria-keyshortcuts={empty ? undefined : 'E F2'}
      title={empty ? undefined : rec ? `Open it · double-click or E to change the ${label.toLowerCase()}` : `Double-click or E to change the ${label.toLowerCase()}`}
      onClick={(e: React.MouseEvent) => {
        if ((e.target as Element).closest('.rec-pencil')) {
          e.stopPropagation();
          return startEdit();
        }
        // A link in shown Markdown opens (p11, 4 Nov 2026: the summary's wikilinks were dead — kept from editing
        // but opened by nothing; every other renderInline consumer opens them, so Inline does too).
        const target = wikilinkFromClick(e);
        if (target !== null) {
          e.preventDefault();
          e.stopPropagation();
          void A.openLink(target, path, e.ctrlKey || e.metaKey ? 'tab' : 'current');
          return;
        }
        if (notForEditing(e)) return;
        // An empty value's "+ Owner" adds in one click; a record's value opens the record; any other waits for a
        // double-click, its pencil or E.
        if (empty) {
          e.stopPropagation();
          return startEdit();
        }
        if (rec) {
          e.stopPropagation();
          peekSoon(rec);
        }
      }}
      onDoubleClick={(e: React.MouseEvent) => {
        // (A double-click selects a word: that isn't someone selecting text to copy.)
        if (empty || (e.target as Element).closest('a, button, input, .pj-ed-input')) return;
        e.stopPropagation();
        window.getSelection()?.removeAllRanges();
        cancelPeekSoon();
        if (rec) unpeek(rec);
        startEdit(e);
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'F2' || ((e.key === 'e' || e.key === 'E') && !e.shiftKey)) {
          e.preventDefault();
          return startEdit();
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (rec && !empty) peek(rec);
          else startEdit();
        }
      }}
    >
      {empty ? placeholder : (children ?? value)}
      {!empty && (
        <span className="rec-pencil" aria-hidden="true" title={`Change the ${label.toLowerCase()}`}>
          <Icon name="pencil" size={11} />
        </span>
      )}
    </Tag>
  );
}

/** The field itself, sized to its words, with suggestions under it. */
function Field({ initial, multiline, required, suggest, onPick, className, label, placeholder, maxLength, compact, caret, onClose, onKeyClose }: { initial: string; multiline?: boolean; required?: boolean; suggest?: Suggestion[]; onPick?(s: Suggestion): void; className: string; label: string; placeholder: string; maxLength: number; compact?: boolean; caret: number | null; onClose(value: string | null): void; onKeyClose(): void }) {
  const [text, setText] = useState(initial);
  const [pick, setPick] = useState(-1);
  const ref = useRef<HTMLTextAreaElement>(null);
  const closed = useRef(false);
  const close = (value: string | null) => {
    if (closed.current) return;
    closed.current = true;
    onClose(value);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // The caret where the click was; from the keys, at the end.
    const at = caret ?? el.value.length;
    el.setSelectionRange(at, at);
  }, []);
  const matches = suggestFor(suggest, text, initial);
  const choose = (s: Suggestion) => {
    if (onPick) {
      closed.current = true;
      onPick(s);
      onClose(null);
    } else close(s.value);
  };
  return (
    <span className={`pj-ed-wrap${multiline ? ' block' : compact ? ' compact' : ' wide'}`}>
      <GrowField
        ref={ref}
        className={`pj-ed-input ${className}`}
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        multiline={multiline}
        onChange={(v) => {
          setText(v);
          setPick(-1);
        }}
        onBlur={() => close(required && !text.trim() ? null : text)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onKeyClose();
            close(null);
          } else if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setPick((i) => (e.key === 'ArrowDown' ? (i + 1) % matches.length : (i <= 0 ? matches.length : i) - 1));
          }
        }}
        onEnter={() => {
          onKeyClose();
          if (pick >= 0 && matches[pick]) choose(matches[pick]);
          else close(text);
        }}
      />
      {multiline && <span className="pj-ed-hint">Enter to save · Shift+Enter for a new line · Esc to leave it as it was</span>}
      {matches.length > 0 && (
        <span className="pj-suggest" role="listbox">
          {matches.map((s, i) => (
            <span
              key={s.value}
              role="option"
              aria-selected={i === pick}
              className={`pj-suggest-item${i === pick ? ' is-picked' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setPick(i)}
            >
              <span>{s.value}</span>
              {s.hint && <span className="pj-suggest-hint">{s.hint}</span>}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function suggestFor(list: Suggestion[] | undefined, text: string, initial: string): Suggestion[] {
  if (!list?.length) return [];
  const t = text.trim().toLowerCase();
  if (t && t === initial.trim().toLowerCase() && text === initial) return [];
  const starts = list.filter((s) => s.value.toLowerCase().startsWith(t) && s.value.toLowerCase() !== t);
  const inside = t ? list.filter((s) => !s.value.toLowerCase().startsWith(t) && s.value.toLowerCase().includes(t)) : [];
  return [...starts, ...inside].slice(0, 6);
}

/** A date edited with the calendar: shown as people read it; written as the file writes dates ("17 Oct 2026", or ISO). */
export function InlineDate({ value, onSave, children, placeholder = '', quiet, iso, label, className = '', clearable = true }: { value?: string; onSave(value: string): Promise<boolean> | void; children?: ReactNode; placeholder?: string; quiet?: boolean; iso?: boolean; label: string; className?: string; clearable?: boolean }) {
  const { canEdit } = useEditor();
  const rec = useRecord();
  const [editing, setEditing] = useState(false);
  const text = value ?? '';
  // A date written as words the page can't read ("Q4", "after Easter") is edited as words.
  if (text && !readable(text))
    return (
      <Inline value={text} onSave={onSave} placeholder={placeholder} quiet={quiet} label={label} className={className} required={!clearable} compact>
        {children}
      </Inline>
    );
  if (!canEdit) return text ? <span className={className}>{children ?? niceDate(text)}</span> : null;
  if (editing) {
    const ms = readDate(text);
    return (
      <DateField
        initial={ms === null ? '' : isoDate(ms)}
        className={className}
        label={label}
        clearable={clearable}
        onClose={(next) => {
          setEditing(false);
          if (next === null) return;
          const out = next ? (iso ? next : lineDate(readDate(next)!)) : '';
          if (out === text || (!out && !text)) return;
          void onSave(out);
        }}
      />
    );
  }
  return (
    <span
      className={`pj-ed pj-ed-date ${className}${!text ? ` pj-ed-empty${quiet ? ' quiet' : ''}` : ' has-pencil'}${rec && text ? ' rec-peekable' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={text ? `${label}: ${niceDate(text)}` : placeholder || label}
      aria-keyshortcuts={text ? 'E F2' : undefined}
      title={text ? (rec ? `Open in the peek · double-click or E to change the ${label.toLowerCase()}` : `Double-click or E to change the ${label.toLowerCase()}`) : undefined}
      onClick={(e) => {
        if ((e.target as Element).closest('.rec-pencil')) {
          e.stopPropagation();
          return setEditing(true);
        }
        if (notForEditing(e)) return;
        if (!text) {
          e.stopPropagation();
          return setEditing(true);
        }
        if (rec) {
          e.stopPropagation();
          peekSoon(rec);
        }
      }}
      onDoubleClick={(e) => {
        if (!text || (e.target as Element).closest('a, button, input, .pj-ed-input')) return;
        e.stopPropagation();
        cancelPeekSoon();
        if (rec) unpeek(rec);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'F2' || ((e.key === 'e' || e.key === 'E') && !e.shiftKey)) {
          e.preventDefault();
          return setEditing(true);
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (rec && text) peek(rec);
          else setEditing(true);
        }
      }}
    >
      {text ? (children ?? niceDate(text)) : placeholder}
      {text && (
        <span className="rec-pencil" aria-hidden="true" title={`Change the ${label.toLowerCase()}`}>
          <Icon name="pencil" size={11} />
        </span>
      )}
    </span>
  );
}

function DateField({ initial, className, label, clearable, onClose }: { initial: string; className: string; label: string; clearable: boolean; onClose(value: string | null): void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const closed = useRef(false);
  const close = (v: string | null) => {
    if (closed.current) return;
    closed.current = true;
    onClose(v);
  };
  useLayoutEffect(() => {
    ref.current?.focus();
    try {
      ref.current?.showPicker();
    } catch {
      // The calendar opens with a click on the field instead.
    }
  }, []);
  return (
    <span
      ref={wrap}
      className="pj-ed-wrap pj-date-wrap"
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) close(text || (clearable ? '' : null));
      }}
    >
      <input
        ref={ref}
        type="date"
        className={`pj-ed-input pj-date-input ${className}`}
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            close(null);
          } else if (isEnterKey(e)) {
            e.preventDefault();
            close(text || (clearable ? '' : null));
          }
        }}
      />
      {clearable && initial && (
        <button
          className="pj-date-clear"
          title="No date"
          onMouseDown={(e) => {
            e.preventDefault();
            close('');
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

/** The quiet actions at the end of a row (shown when the pointer is over it, or it has the keys). */
export function RowActions({ children }: { children: ReactNode }) {
  const { canEdit } = useEditor();
  if (!canEdit) return null;
  return <span className="pj-row-actions">{children}</span>;
}

export function RowAction({ icon, title, onClick, danger }: { icon: IconName; title: string; onClick(): void; danger?: boolean }) {
  return (
    <button
      className={`pj-row-action${danger ? ' danger' : ''}`}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

export interface AddField {
  key: string;
  placeholder: string;
  kind?: 'text' | 'date' | 'level';
  required?: boolean;
  suggest?: Suggestion[];
  /** Picking a suggestion fills other parts too (a known person's role). */
  fill?(s: Suggestion): Record<string, string>;
  grow?: boolean;
}

/** "Add a key date…": a quiet line at the end of a list that opens into the parts of a new line. */
export function AddRow({ label, fields, onAdd, initial = {} }: { label: string; fields: AddField[]; onAdd(values: Record<string, string>): Promise<boolean>; initial?: Record<string, string> }) {
  const { canEdit } = useEditor();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [pick, setPick] = useState<{ key: string; index: number } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  if (!canEdit) return null;
  if (!open)
    return (
      <button className="pj-addrow" onClick={() => setOpen(true)}>
        <Icon name="plus" size={13} />
        <span>{label}</span>
      </button>
    );
  const ready = fields.every((f) => !f.required || values[f.key]?.trim());
  const submit = async () => {
    if (!ready) return;
    const out: Record<string, string> = {};
    for (const f of fields) if (values[f.key]?.trim()) out[f.key] = f.kind === 'date' ? lineDate(readDate(values[f.key])!) : values[f.key].trim();
    if (await onAdd(out)) {
      setValues(initial);
      first.current?.focus();
    }
  };
  const shut = () => {
    setOpen(false);
    setValues(initial);
  };
  return (
    <div
      ref={box}
      className="pj-addform"
      onBlur={(e) => {
        if (box.current?.contains(e.relatedTarget as Node)) return;
        // Clicked away: what was typed is added when it can be, else the line closes.
        if (ready && fields.some((f) => values[f.key]?.trim() && f.kind !== 'level')) void submit().then(shut);
        else shut();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          shut();
        }
      }}
    >
      {fields.map((f, i) => {
        if (f.kind === 'level')
          return (
            <span key={f.key} className="pj-levels" role="radiogroup" aria-label="How much it matters">
              {['low', 'medium', 'high'].map((l) => (
                <button key={l} role="radio" aria-checked={values[f.key] === l} className={`pj-level level-${l}${values[f.key] === l ? ' is-on' : ''}`} onClick={() => setValues((v) => ({ ...v, [f.key]: l }))}>
                  {l.charAt(0).toUpperCase() + l.slice(1)}
                </button>
              ))}
            </span>
          );
        const matches = f.suggest && focusKey === f.key ? suggestFor(f.suggest, values[f.key] ?? '', '') : [];
        const choose = (s: Suggestion) => {
          setValues((v) => ({ ...v, [f.key]: s.value, ...(f.fill ? Object.fromEntries(Object.entries(f.fill(s)).filter(([k]) => !v[k]?.trim())) : {}) }));
          setPick(null);
        };
        return (
          <span key={f.key} className={`pj-addfield${f.grow ? ' grow' : ''}`}>
            {f.kind === 'date' ? (
              <input
                ref={i === 0 ? first : undefined}
                type="date"
                className="pj-addinput"
                aria-label={f.placeholder}
                value={values[f.key] ?? ''}
                onFocus={() => setFocusKey(f.key)}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            ) : (
              <GrowField
                ref={i === 0 ? first : undefined}
                className="pj-addinput"
                placeholder={f.placeholder}
                aria-label={f.placeholder}
                value={values[f.key] ?? ''}
                maxLength={400}
                onFocus={() => setFocusKey(f.key)}
                onChange={(v) => {
                  setValues((x) => ({ ...x, [f.key]: v }));
                  setPick(null);
                }}
                onKeyDown={(e) => {
                  const at = pick?.key === f.key ? pick.index : -1;
                  if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault();
                    setPick({ key: f.key, index: e.key === 'ArrowDown' ? (at + 1) % matches.length : (at <= 0 ? matches.length : at) - 1 });
                  }
                }}
                onEnter={() => {
                  const at = pick?.key === f.key ? pick.index : -1;
                  if (at >= 0 && matches[at]) choose(matches[at]);
                  else void submit();
                }}
              />
            )}
            {matches.length > 0 && (
              <span className="pj-suggest" role="listbox">
                {matches.map((s, j) => (
                  <span
                    key={s.value}
                    role="option"
                    aria-selected={pick?.key === f.key && pick.index === j}
                    className={`pj-suggest-item${pick?.key === f.key && pick.index === j ? ' is-picked' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(s);
                    }}
                  >
                    <span>{s.value}</span>
                    {s.hint && <span className="pj-suggest-hint">{s.hint}</span>}
                  </span>
                ))}
              </span>
            )}
          </span>
        );
      })}
      <button className="pj-add-go" disabled={!ready} onClick={() => void submit()} title="Add (Enter)">
        Add
      </button>
    </div>
  );
}
