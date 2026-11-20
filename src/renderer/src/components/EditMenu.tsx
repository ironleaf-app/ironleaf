// Right-click in a note, a field or a page: spelling suggestions, cut, copy and paste, and in a note the formatting,
// paragraph kinds and things to insert. Places that have their own menu (the file list, tabs, canvas) keep theirs.

import { useEffect } from 'react';
import { runCommand } from '../state/commands';
import type { EditContext } from '../../../preload';
import { openMenu, type MenuItem } from './Menu';

export function EditMenuHost() {
  useEffect(() => {
    let last: { target: HTMLElement | null; x: number; y: number } = { target: null, x: 0, y: 0 };
    const remember = (e: MouseEvent) => {
      last = { target: e.target as HTMLElement | null, x: e.clientX, y: e.clientY };
    };
    window.addEventListener('contextmenu', remember, true);
    const off = window.nv.on.editContext((info: EditContext) => {
      const inNote = !!last.target?.closest('.note-editor .cm-content');
      const at = { clientX: last.x, clientY: last.y };
      const items: MenuItem[] = [];
      if (info.misspelled) {
        if (info.suggestions.length) for (const word of info.suggestions) items.push({ label: word, run: () => void window.nv.window.edit('replace-misspelling', word) });
        else items.push({ label: 'No suggestions', disabled: true });
        items.push({ label: `Add “${info.misspelled}” to the dictionary`, icon: 'book', run: () => void window.nv.window.edit('add-word', info.misspelled) });
        items.push({ separator: true });
      }
      if (info.editable) {
        items.push(
          { label: 'Cut', icon: 'scissors', hotkey: 'Mod+X', disabled: !info.canCut, run: () => void window.nv.window.edit('cut') },
          { label: 'Copy', icon: 'copy', hotkey: 'Mod+C', disabled: !info.canCopy, run: () => void window.nv.window.edit('copy') },
          { label: 'Paste', hotkey: 'Mod+V', disabled: !info.canPaste, run: () => void window.nv.window.edit('paste') },
          { label: 'Paste as plain text', hotkey: 'Mod+Shift+V', disabled: !info.canPaste, run: () => void window.nv.window.edit('paste-plain') },
          { label: 'Select all', hotkey: 'Mod+A', run: () => void window.nv.window.edit('select-all') },
        );
      } else if (info.selection) {
        items.push({ label: 'Copy', icon: 'copy', hotkey: 'Mod+C', run: () => void window.nv.window.edit('copy') });
      }
      if (inNote) {
        items.push(
          { separator: true },
          {
            label: 'Format',
            icon: 'bold',
            submenu: [
              { label: 'Bold', icon: 'bold', hotkey: 'Mod+B', run: () => runCommand('bold') },
              { label: 'Italic', icon: 'italic', hotkey: 'Mod+I', run: () => runCommand('italic') },
              { label: 'Strikethrough', icon: 'strike', run: () => runCommand('strike') },
              { label: 'Highlight', icon: 'highlight', run: () => runCommand('highlight') },
              { label: 'Code', icon: 'code', run: () => runCommand('inline-code') },
              { label: 'Hide as a comment', icon: 'eye', hotkey: 'Mod+/', run: () => runCommand('comment') },
            ],
          },
          {
            label: 'Paragraph',
            icon: 'heading',
            submenu: [
              { label: 'Heading 1', run: () => runCommand('heading-1') },
              { label: 'Heading 2', run: () => runCommand('heading-2') },
              { label: 'Heading 3', run: () => runCommand('heading-3') },
              { label: 'Plain text', run: () => runCommand('paragraph') },
              { separator: true },
              { label: 'Bulleted list', icon: 'list', run: () => runCommand('bullets') },
              { label: 'Numbered list', icon: 'numbered', run: () => runCommand('numbers') },
              { label: 'Tick-box', icon: 'task', hotkey: 'Mod+L', run: () => runCommand('task') },
              { label: 'Quote', icon: 'quote', run: () => runCommand('quote') },
            ],
          },
          {
            label: 'Insert',
            icon: 'plus',
            submenu: [
              { label: 'Link', icon: 'link', hotkey: 'Mod+U', run: () => runCommand('link') },
              { label: 'Table', icon: 'table', run: () => runCommand('table') },
              { label: 'Callout', icon: 'callout', run: () => runCommand('callout') },
              { label: 'Code block', icon: 'code', run: () => runCommand('code-block') },
              { label: 'Maths block', icon: 'math', run: () => runCommand('math-block') },
              { label: 'Divider', icon: 'divider', run: () => runCommand('divider') },
              { label: 'Footnote', run: () => runCommand('footnote') },
              { label: 'Template', icon: 'template', run: () => runCommand('insert-template') },
              { label: 'Synced block', icon: 'copy', run: () => runCommand('synced-block') },
              { label: "Today's date", icon: 'calendar', run: () => runCommand('date') },
            ],
          },
        );
        if (last.target?.closest('.cm-line')?.textContent?.trim().startsWith('|')) {
          items.push({
            label: 'Table',
            icon: 'table',
            submenu: [
              { label: 'Add a row below', run: () => runCommand('table-row-below') },
              { label: 'Add a row above', run: () => runCommand('table-row-above') },
              { label: 'Add a column to the right', run: () => runCommand('table-col-right') },
              { label: 'Add a column to the left', run: () => runCommand('table-col-left') },
              { separator: true },
              { label: 'Delete this row', run: () => runCommand('table-delete-row') },
              { label: 'Delete this column', run: () => runCommand('table-delete-col') },
              { separator: true },
              { label: 'Line up the columns', run: () => runCommand('table-format') },
            ],
          });
        }
        if (info.selection)
          items.push(
            { separator: true },
            { label: 'Move the selection to a new note', icon: 'scissors', run: () => runCommand('extract') },
            { label: 'Make the selection a synced block', icon: 'copy', run: () => runCommand('make-synced-block') },
            { label: 'Lay out in columns', icon: 'splitRight', submenu: [{ label: '2 columns', run: () => runCommand('columns-2') }, { label: '3 columns', run: () => runCommand('columns-3') }, { label: '4 columns', run: () => runCommand('columns-4') }] },
          );
      }
      if (info.link && /^https?:/i.test(info.link)) items.push({ separator: true }, { label: 'Open the link', icon: 'external', run: () => window.open(info.link, '_blank') }, { label: 'Copy the link', icon: 'copy', run: () => void navigator.clipboard.writeText(info.link) });
      if (items.length) openMenu(at, items);
    });
    return () => {
      window.removeEventListener('contextmenu', remember, true);
      off();
    };
  }, []);
  return null;
}
