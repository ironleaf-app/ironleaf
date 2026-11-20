// A field of words that wraps and grows with them (one line or several), never wider than the box it sits in: the one
// way Ironleaf edits words in place (a project's values, a note's properties, adding a line). Enter does the field's
// onEnter (saves); Shift+Enter makes a new line where several lines make sense and does nothing in one line; pasted line
// breaks become spaces in one line. Its look comes from the caller's class (with CSS field-sizing: content).

import type React from 'react';

export function GrowField({ multiline, onEnter, ...props }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { multiline?: boolean; onEnter?(e: React.KeyboardEvent<HTMLTextAreaElement>): void; onChange(value: string): void; ref?: React.Ref<HTMLTextAreaElement> }) {
  const { onChange, onKeyDown, ...rest } = props;
  return (
    <textarea
      {...rest}
      rows={1}
      spellCheck
      onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        // Shift+Enter: a new line in words of several lines; in one line it does nothing.
        if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
          if (!multiline) e.preventDefault();
          return;
        }
        e.preventDefault();
        onEnter?.(e);
      }}
    />
  );
}

