// Small fields of the details panel and the brand kit: words saved when the field is left, and chips (tags,
// collections) typed with suggestions.

import { useEffect, useId, useRef, useState } from 'react';
import { GrowField } from '../../components/GrowField';
import { Icon } from '../../components/Icon';

/** Words saved when the person leaves the field or presses Enter (Shift+Enter: a new line in a field of several lines);
 *  Escape puts them back. The field wraps and grows with its words (never a one-line field hiding the end of them). */
export function SavedText({ value, placeholder, multiline, label, disabled, onSave }: { value: string; placeholder?: string; multiline?: boolean; label: string; disabled?: boolean; onSave(v: string): void }) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <GrowField
      className={`as-field-input${multiline ? ' several' : ''}`}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      multiline={multiline}
      onChange={setDraft}
      onFocus={() => (cancelled.current = false)}
      onBlur={() => {
        // Esc: as it was (the words put back may not have reached this yet).
        if (cancelled.current) return setDraft(value);
        if (draft.trim() !== value.trim()) onSave(draft.trim());
      }}
      onEnter={(e) => e.currentTarget.blur()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Chips: each one removable; type and press Enter (or a comma) to add; suggestions from what is already used. */
export function Chips({ values, suggestions, placeholder, label, prefix, disabled, onChange }: { values: string[]; suggestions: string[]; placeholder: string; label: string; prefix?: string; disabled?: boolean; onChange(next: string[]): void }) {
  const [text, setText] = useState('');
  const list = useId();
  const add = (raw: string) => {
    const v = raw.replace(/^#+/, '').replace(/,+$/, '').replace(/\s+/g, ' ').trim();
    setText('');
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    onChange([...values, v]);
  };
  const left = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className={`as-chips${disabled ? ' is-disabled' : ''}`} onMouseDown={(e) => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        e.currentTarget.querySelector('input')?.focus();
      }
    }}>
      {values.map((v) => (
        <span key={v} className="as-chip">
          {prefix}
          {v}
          {!disabled && (
            <button title={`Remove ${v}`} aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              <Icon name="close" size={10} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <>
          <input
            value={text}
            list={list}
            aria-label={label}
            placeholder={values.length ? '' : placeholder}
            onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
            onBlur={() => text.trim() && add(text)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(text);
              } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
              else if (e.key === 'Escape') {
                e.stopPropagation();
                setText('');
                e.currentTarget.blur();
              }
            }}
          />
          <datalist id={list}>
            {left.slice(0, 40).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}
