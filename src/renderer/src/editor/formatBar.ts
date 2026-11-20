// The formatting bar: select words in a note (with the mouse or the keys) and a small bar appears just above them, for
// bold, italic, strike-through, a highlight in one of six colours, code, a link, a heading, a list (bulleted or numbered),
// a tick-box, a quote and, where
// the note may go to the assistant, Ask about this (19 Oct 2026, 5.0.0). It waits until the mouse is let go, sits above
// the words (below them when there is no room above, never over them), and goes on Escape, when the selection goes, and
// while typing. Alt+F10 (Settings › Keys: "Formatting bar") puts the keys on it: ←/→ move, Enter presses, ↓ opens a
// button's choices, Esc or Tab goes back to the words. Every button runs the same command as its keys and menus.

import { syntaxTree } from '@codemirror/language';
import { Facet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, showTooltip, ViewPlugin, type Tooltip, type TooltipView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { iconMarkup, type IconName } from '../components/Icon';
import { HIGHLIGHT_COLOURS, type HighlightColour } from '../lib/highlights';
import { cycleTask, insertLink, setHeading, setHighlight, toggleBullet, toggleMark, toggleNumbered, toggleQuote } from './commands';
import { keysFor } from './keysFor';
import { changeProps, readProps } from '../../../shared/frontmatter';
import { SELECTION_ACTIONS, taskLineFor } from '../../../shared/note-task';
import { NOTE_FONTS, NOTE_SIZES } from '../lib/noteFont';
import { minPopupTop } from '../lib/windowButtons';

export interface FormatBarHost {
  /** [[links]] or [text](address) for Link (Settings › Editor). */
  wikilinks(): boolean;
  /** Puts the selected words in the chat's message box, about this note (left out for a private note). */
  askAbout?(words: string): void;
  /** The other things selecting words offers (8.0 section E): add to a project, or an Ask choice by its id. */
  selectionAction?(action: string, words: string): void;
}

interface BarFlags {
  /** Escape put it away (until the next selection). */
  dismissed: boolean;
  /** The mouse is still selecting. */
  dragging: boolean;
  /** The editor (or the bar itself) has the keys. */
  focused: boolean;
  /** Alt+F10 asked for it, with or without a selection. */
  forced: boolean;
}

const setBar = StateEffect.define<Partial<BarFlags>>();

const barFlags = StateField.define<BarFlags>({
  create: () => ({ dismissed: false, dragging: false, focused: false, forced: false }),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) if (e.is(setBar)) next = { ...next, ...e.value };
    if (tr.effects.some((e) => e.is(setBar))) return next;
    // Typing puts it away; a fresh selection brings it back after Escape.
    if (tr.docChanged && (tr.isUserEvent('input.type') || tr.isUserEvent('delete')) && (next.forced || next.dismissed)) next = { ...next, forced: false, dismissed: false };
    else if (tr.selection && next.dismissed && !tr.selection.main.eq(tr.startState.selection.main)) next = { ...next, dismissed: false };
    return next;
  },
});

function barTooltip(state: EditorState): Tooltip | null {
  const flags = state.field(barFlags);
  if (state.readOnly || flags.dismissed || flags.dragging || !flags.focused) return null;
  const sel = state.selection.main;
  if (sel.empty && !flags.forced) return null;
  return { pos: sel.from, end: sel.to, above: true, arrow: false, create: createBar };
}

/** What the selection is already in, so its buttons show pressed (bold inside bold…). */
function activeMarks(state: EditorState): Set<string> {
  const out = new Set<string>();
  const sel = state.selection.main;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(sel.from, 1); node; node = node.parent) {
    if (node.to < sel.to) continue;
    switch (node.name) {
      case 'StrongEmphasis':
        out.add('bold');
        break;
      case 'Emphasis':
        out.add('italic');
        break;
      case 'Strikethrough':
        out.add('strike');
        break;
      case 'Highlight':
      case 'ColourHighlight':
        out.add('highlight');
        break;
      case 'InlineCode':
        out.add('code');
        break;
      case 'Link':
      case 'Wikilink':
        out.add('link');
        break;
      case 'Blockquote':
        out.add('quote');
        break;
      case 'BulletList':
        out.add('bullets');
        break;
    }
  }
  const heading = /^\s{0,3}(#{1,6})\s/.exec(state.doc.lineAt(sel.from).text)?.[1].length ?? 0;
  if (heading) out.add(`heading-${heading}`);
  if (heading) out.add('heading');
  return out;
}

/** The colour of the highlight the selection is in (null: none). */
function highlightColour(state: EditorState): HighlightColour | null {
  const sel = state.selection.main;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(sel.from, 1); node; node = node.parent) {
    if (node.name === 'Highlight') return 'yellow';
    if (node.name === 'ColourHighlight') {
      const open = node.firstChild;
      const m = open ? /nv-(\w+)/.exec(state.sliceDoc(open.from, open.to)) : null;
      return (m?.[1] as HighlightColour) ?? 'yellow';
    }
  }
  return null;
}

interface Button {
  id: string;
  icon: IconName;
  label: string;
  /** The command with the same job (state/commands.ts), for its keys in the tip. */
  command?: string;
  /** A small arrow beside it opens these choices. */
  menu?: 'highlight' | 'heading' | 'font' | 'ask';
  /** Words beside its icon (the selection offers are named, not icons alone). */
  text?: string;
  run?(view: EditorView, host: FormatBarHost): void;
}

const BUTTONS: (Button | 'sep')[] = [
  { id: 'bold', icon: 'bold', label: 'Bold', command: 'bold', run: (v) => toggleMark(v, '**') },
  { id: 'italic', icon: 'italic', label: 'Italic', command: 'italic', run: (v) => toggleMark(v, '*') },
  { id: 'strike', icon: 'strike', label: 'Strikethrough', command: 'strike', run: (v) => toggleMark(v, '~~') },
  { id: 'highlight', icon: 'highlight', label: 'Highlight', command: 'highlight', menu: 'highlight', run: (v) => setHighlight(v, highlightColour(v.state) ? null : 'yellow') },
  { id: 'code', icon: 'code', label: 'Code', command: 'inline-code', run: (v) => toggleMark(v, '`') },
  { id: 'link', icon: 'link', label: 'Link', command: 'link', run: (v, h) => insertLink(v, h.wikilinks()) },
  'sep',
  { id: 'heading', icon: 'heading', label: 'Heading', menu: 'heading' },
  // 5.2.0: this note's font and text size, kept in its properties.
  { id: 'font', icon: 'text', label: 'Font and size for this note', menu: 'font' },
  { id: 'bullets', icon: 'list', label: 'Bulleted list', command: 'bullets', run: toggleBullet },
  // 5.2.0 ("every tool they should ever need"): a numbered list and a tick-box beside the bulleted list.
  { id: 'numbers', icon: 'numbered', label: 'Numbered list', command: 'numbers', run: toggleNumbered },
  { id: 'task', icon: 'task', label: 'Tick-box', command: 'task', run: cycleTask },
  { id: 'quote', icon: 'quote', label: 'Quote', command: 'quote', run: toggleQuote },
];

const ASK: Button = {
  id: 'ask',
  icon: 'sparkle',
  label: 'Ask about this',
  text: 'Ask about this',
  menu: 'ask',
  run: (v, h) => {
    const sel = v.state.selection.main;
    const words = v.state.sliceDoc(sel.from, sel.to).trim() || v.state.doc.lineAt(sel.head).text.trim();
    if (words) h.askAbout?.(words);
  },
};

/** Selecting words offers this too (8.0 section E): a task here (in a meeting or note of a project, that is the project's task). */
const MAKE_TASK: Button = {
  id: 'make-task',
  icon: 'task',
  label: 'Make a task',
  text: 'Make a task',
  run: (v) => {
    const sel = v.state.selection.main;
    const words = v.state.sliceDoc(sel.from, sel.to);
    if (!words.trim()) return;
    const line = taskLineFor(words);
    v.dispatch({ changes: { from: sel.from, to: sel.to, insert: line }, selection: { anchor: sel.from + line.length }, userEvent: 'input.task' });
    v.focus();
  },
};
const HEADINGS = [
  { level: 1, label: 'Heading 1' },
  { level: 2, label: 'Heading 2' },
  { level: 3, label: 'Heading 3' },
  { level: 0, label: 'Plain text' },
];

const tip = (b: Button) => {
  const keys = b.command ? keysFor(b.command) : undefined;
  return keys ? `${b.label} (${keys})` : b.label;
};

/** The note's own part (its link style, whether it may go to the assistant). */
const barHost = Facet.define<FormatBarHost, FormatBarHost>({ combine: (values) => values[0] ?? { wikilinks: () => true } });

/** The bar itself (one per editor; CodeMirror keeps it while the selection moves, and calls update). */
function createBar(view: EditorView): TooltipView {
  const host = view.state.facet(barHost);
  const dom = document.createElement('div');
  dom.className = 'nv-format-bar';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-label', 'Formatting');
  const row = document.createElement('div');
  row.className = 'nv-fb-row';
  dom.appendChild(row);
  let menu: HTMLElement | null = null;
  let menuFor: HTMLButtonElement | null = null;

  const buttons = [...BUTTONS, 'sep' as const, MAKE_TASK, ...(host.askAbout ? [ASK] : [])];
  const tops: HTMLButtonElement[] = [];
  for (const b of buttons) {
    if (b === 'sep') {
      const sep = document.createElement('span');
      sep.className = 'nv-fb-sep';
      sep.setAttribute('aria-hidden', 'true');
      row.appendChild(sep);
      continue;
    }
    const group = document.createElement('span');
    group.className = `nv-fb-group${b.menu ? ' has-menu' : ''}${b.id === 'ask' ? ' is-ask' : ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nv-fb-btn';
    button.dataset.id = b.id;
    button.title = tip(b);
    button.setAttribute('aria-label', tip(b));
    button.innerHTML = iconMarkup(b.icon, 16) + (b.text ? `<span class="nv-fb-text">${b.text}</span>` : '');
    if (b.run) {
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        b.run!(view, host);
        closeMenu(false);
      });
    } else if (b.menu) {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => (menuFor === button ? closeMenu(true) : openMenu(b.menu!, button, false)));
    }
    group.appendChild(button);
    tops.push(button);
    if (b.menu && b.run) {
      // The highlight's colours: a small arrow of its own beside it.
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'nv-fb-more';
      more.title = b.menu === 'ask' ? 'More ways to ask' : 'Highlight colour';
      more.setAttribute('aria-label', more.title);
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      more.innerHTML = iconMarkup('chevronDown', 12);
      more.addEventListener('click', () => (menuFor === more ? closeMenu(true) : openMenu(b.menu!, more, false)));
      group.appendChild(more);
      tops.push(more);
    }
    row.appendChild(group);
  }
  tops.forEach((t, i) => (t.tabIndex = i === 0 ? 0 : -1));

  function closeMenu(refocus: boolean): void {
    if (!menu) return;
    menu.remove();
    menu = null;
    menuFor?.setAttribute('aria-expanded', 'false');
    if (refocus) menuFor?.focus();
    menuFor = null;
  }

  function openMenu(kind: 'highlight' | 'heading' | 'font' | 'ask', anchor: HTMLButtonElement, focusFirst: boolean): void {
    closeMenu(false);
    menu = document.createElement('div');
    menu.className = `nv-fb-menu nv-fb-menu-${kind}`;
    menu.setAttribute('role', 'menu');
    const items: HTMLButtonElement[] = [];
    const add = (label: string, checked: boolean, run: () => void, swatch?: string) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `nv-fb-item${checked ? ' is-checked' : ''}`;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(checked));
      item.tabIndex = -1;
      item.innerHTML = `${swatch ? `<span class="nv-fb-swatch" style="--swatch: var(--hl-${swatch})"></span>` : ''}<span class="nv-fb-item-label"></span>${checked ? iconMarkup('check', 14) : ''}`;
      (item.querySelector('.nv-fb-item-label') as HTMLElement).textContent = label;
      item.addEventListener('click', () => {
        run();
        closeMenu(true);
      });
      menu!.appendChild(item);
      items.push(item);
    };
    if (kind === 'ask') {
      const sel = view.state.selection.main;
      const words = view.state.sliceDoc(sel.from, sel.to).trim() || view.state.doc.lineAt(sel.head).text.trim();
      add('Ask about this', false, () => words && host.askAbout?.(words));
      for (const choice of SELECTION_ACTIONS) if ('ask' in choice) add(choice.label, false, () => words && host.selectionAction?.(choice.id, words));
    } else if (kind === 'highlight') {
      const now = highlightColour(view.state);
      for (const c of HIGHLIGHT_COLOURS) add(c.label, now === c.id, () => setHighlight(view, c.id), c.id);
      if (now) add('No highlight', false, () => setHighlight(view, null), 'none');
    } else if (kind === 'font') {
      // A designed panel, not a list: each font a tile showing itself, the size as a stepper with quick sizes.
      const props = readProps(view.state.doc.toString());
      const font = typeof props.font === 'string' ? props.font : '';
      const size = typeof props['text size'] === 'number' ? (props['text size'] as number) : 0;
      const section = (title: string, cls: string) => {
        const h = document.createElement('div');
        h.className = 'nv-ff-title';
        h.textContent = title;
        menu!.appendChild(h);
        const box = document.createElement('div');
        box.className = cls;
        menu!.appendChild(box);
        return box;
      };
      const button = (box: HTMLElement, cls: string, label: string, checked: boolean, run: () => void, html?: string) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `${cls}${checked ? ' is-checked' : ''}`;
        el.setAttribute('role', 'menuitemradio');
        el.setAttribute('aria-checked', String(checked));
        el.setAttribute('aria-label', label);
        el.tabIndex = -1;
        if (html) el.innerHTML = html;
        else el.textContent = label;
        el.addEventListener('click', () => {
          run();
          closeMenu(true);
        });
        box.appendChild(el);
        items.push(el);
        return el;
      };
      const tiles = section('Font for this note', 'nv-ff-tiles');
      for (const f of NOTE_FONTS) {
        const t = button(tiles, 'nv-ff-tile', f.label, f.value === font, () => setNoteProp(view, 'font', f.value || null), '<span class="nv-ff-sample">Ag</span><span class="nv-ff-name"></span>');
        (t.querySelector('.nv-ff-sample') as HTMLElement).style.fontFamily = f.css;
        (t.querySelector('.nv-ff-name') as HTMLElement).textContent = f.label;
      }
      const sizes = section('Text size', 'nv-ff-size');
      const now = size || 0;
      const step = (by: number) => {
        const list = NOTE_SIZES.filter((n) => n > 0);
        const base = now || 16;
        const at = list.reduce((best, n) => (Math.abs(n - base) < Math.abs(best - base) ? n : best), list[0]);
        const next = list[Math.max(0, Math.min(list.length - 1, list.indexOf(at) + by))];
        setNoteProp(view, 'text size', next);
      };
      button(sizes, 'nv-ff-step', 'Smaller', false, () => step(-1), '<span aria-hidden="true">A</span>');
      const shown = document.createElement('span');
      shown.className = 'nv-ff-now';
      shown.textContent = now ? `${now} px` : 'Default';
      sizes.appendChild(shown);
      button(sizes, 'nv-ff-step is-big', 'Larger', false, () => step(1), '<span aria-hidden="true">A</span>');
      const quick = section('', 'nv-ff-quick');
      quick.previousElementSibling?.remove();
      for (const [label, n] of [['Default', 0], ['S', 14], ['M', 16], ['L', 18], ['XL', 22]] as [string, number][]) button(quick, 'nv-ff-chip', label === 'Default' ? 'Default size' : `${label}, ${n} px`, n === now, () => setNoteProp(view, 'text size', n || null)).textContent = label;
      const foot = document.createElement('div');
      foot.className = 'nv-ff-foot';
      foot.textContent = 'For every note: Settings › Look';
      menu!.appendChild(foot);
    } else {
      const line = view.state.doc.lineAt(view.state.selection.main.from).text;
      const level = /^\s{0,3}(#{1,6})\s/.exec(line)?.[1].length ?? 0;
      for (const h of HEADINGS) add(h.label, level === h.level, () => setHeading(view, h.level));
      // Each heading's size, at a glance.
      items.forEach((item, i) => item.classList.add(`is-h${HEADINGS[i].level}`));
    }
    anchor.setAttribute('aria-expanded', 'true');
    menuFor = anchor;
    const group = anchor.closest('.nv-fb-group') as HTMLElement;
    menu.style.left = `${group.offsetLeft}px`;
    dom.appendChild(menu);
    // Away from the words when there is room (above a bar that sits above them), else the other way.
    const bar = dom.getBoundingClientRect();
    const room = menu.offsetHeight + 12;
    const up = dom.classList.contains('cm-tooltip-above') ? bar.top > room : window.innerHeight - bar.bottom < room;
    menu.classList.add(up ? 'is-up' : 'is-down');
    // Always wholly in the window and below the window buttons' band (8.6.1): the other way if it runs off, else as
    // tall as the room there is (it scrolls).
    const fit = () => {
      const r = menu!.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 8 && menu!.classList.contains('is-down') && bar.top - 12 > window.innerHeight - bar.bottom) {
        menu!.classList.replace('is-down', 'is-up');
      } else if (r.top < minPopupTop() && menu!.classList.contains('is-up') && window.innerHeight - bar.bottom - 12 > bar.top) {
        menu!.classList.replace('is-up', 'is-down');
      }
      const r2 = menu!.getBoundingClientRect();
      const roomNow = menu!.classList.contains('is-up') ? bar.top - 14 : window.innerHeight - bar.bottom - 14;
      if (r2.height > roomNow) menu!.style.maxHeight = `${Math.max(160, roomNow)}px`;
    };
    fit();
    if (focusFirst) (items.find((i) => i.classList.contains('is-checked')) ?? items[0])?.focus();
  }

  const refresh = () => {
    const on = activeMarks(view.state);
    for (const t of tops) {
      const id = t.dataset.id;
      if (id && t.hasAttribute('aria-pressed')) t.setAttribute('aria-pressed', String(on.has(id)));
      if (id === 'heading') t.classList.toggle('is-on', on.has('heading'));
    }
  };
  refresh();

  // The mouse never takes the keys from the words (so the selection stays and stays drawn).
  dom.addEventListener('mousedown', (e) => e.preventDefault());
  dom.addEventListener('keydown', (e) => {
    const inMenu = !!menu && menu.contains(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (menu) closeMenu(true);
      else backToWords(view);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      closeMenu(false);
      backToWords(view, false);
      return;
    }
    if (inMenu) {
      const items = [...menu!.querySelectorAll<HTMLButtonElement>('.nv-fb-item')];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const go = (i: number) => items[(i + items.length) % items.length]?.focus();
      if (e.key === 'ArrowDown') go(at + 1);
      else if (e.key === 'ArrowUp') go(at - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(items.length - 1);
      else return;
      e.preventDefault();
      return;
    }
    const at = tops.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const go = (i: number) => {
      const next = tops[(i + tops.length) % tops.length];
      tops.forEach((t) => (t.tabIndex = t === next ? 0 : -1));
      next.focus();
    };
    if (e.key === 'ArrowRight') go(at + 1);
    else if (e.key === 'ArrowLeft') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(tops.length - 1);
    else if (e.key === 'ArrowDown' && tops[at].getAttribute('aria-haspopup')) {
      const id = tops[at].closest('.nv-fb-group')?.querySelector<HTMLButtonElement>('.nv-fb-btn')?.dataset.id;
      openMenu(id === 'heading' ? 'heading' : id === 'ask' ? 'ask' : 'highlight', tops[at], true);
    } else return;
    e.preventDefault();
  });

  return {
    dom,
    offset: { x: 0, y: 8 },
    // The selection's whole height (so the bar sits above its first line, or below its last, never over it), centred
    // over the words when they are on one line.
    getCoords: () => {
      const sel = view.state.selection.main;
      const a = view.coordsAtPos(sel.from, 1);
      const b = view.coordsAtPos(sel.to, -1) ?? a;
      if (!a || !b) return { top: -1e4, bottom: -1e4, left: 0, right: 0 };
      const oneLine = Math.abs(a.top - b.top) < 4;
      const width = dom.offsetWidth || 0;
      // Kept inside the note's own pane (19 Oct 2026, the real app: words near the note's left edge put half the bar over
      // the side bar).
      const pane = view.scrollDOM.getBoundingClientRect();
      const centred = oneLine ? (a.left + b.right) / 2 - width / 2 : a.left;
      const left = Math.max(pane.left + 8, Math.min(centred, pane.right - width - 8));
      // Its right edge stays the words' own (CodeMirror hides a tooltip whose place is off the side of the note).
      return { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left, right: Math.max(a.right, b.right) };
    },
    update(update) {
      if (update.docChanged || update.selectionSet) {
        closeMenu(false);
        refresh();
      }
    },
  };
}

/** The keys go back to the words; the bar goes until the next selection (or stays for Tab, as the selection does). */
function backToWords(view: EditorView, dismiss = true): void {
  view.dispatch({ effects: setBar.of({ forced: false, ...(dismiss ? { dismissed: true } : {}) }) });
  view.focus();
}

/** Alt+F10: the bar appears (for the word at the cursor when nothing is selected) and its first button has the keys. */
export function focusFormatBar(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  view.dispatch({ effects: setBar.of({ forced: true, dismissed: false, focused: true, dragging: false }) });
  requestAnimationFrame(() => view.dom.querySelector<HTMLButtonElement>('.nv-format-bar .nv-fb-btn')?.focus());
  return true;
}

/** Tracks the mouse (the bar waits until it is let go) and where the keys are (the bar goes when they leave the note). */
const watcher = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      view.dom.addEventListener('focusin', this.focusIn);
      view.dom.addEventListener('focusout', this.focusOut);
      view.contentDOM.addEventListener('mousedown', this.down);
      // A note's editor is kept while its tab is away (editor/NoteEditor.tsx): coming back, the bar follows where the
      // keys are now, not where they were.
      queueMicrotask(() => this.set({ focused: view.hasFocus, dragging: false, forced: false }));
    }
    set(flags: Partial<BarFlags>) {
      const now = this.view.state.field(barFlags, false);
      if (!now || Object.entries(flags).every(([k, v]) => now[k as keyof BarFlags] === v)) return;
      this.view.dispatch({ effects: setBar.of(flags) });
    }
    focusIn = () => this.set({ focused: true });
    focusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && this.view.dom.contains(e.relatedTarget)) return;
      // Leaving the note (another pane, the chat, another window): the bar goes, and comes back with the keys.
      setTimeout(() => {
        if (!this.view.dom.contains(document.activeElement)) this.set({ focused: false, forced: false });
      }, 0);
    };
    down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.set({ dragging: true, forced: false });
      window.addEventListener('mouseup', this.up, { once: true });
    };
    up = () => this.set({ dragging: false });
    destroy() {
      this.view.dom.removeEventListener('focusin', this.focusIn);
      this.view.dom.removeEventListener('focusout', this.focusOut);
      this.view.contentDOM.removeEventListener('mousedown', this.down);
      window.removeEventListener('mouseup', this.up);
    }
  },
);

/** Escape puts the bar away while it shows (else Escape does what it always did). */
const escape = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.key !== 'Escape' || !view.dom.querySelector('.nv-format-bar')) return false;
    if (view.dom.querySelector('.cm-tooltip-autocomplete')) return false;
    view.dispatch({ effects: setBar.of({ dismissed: true, forced: false }) });
    return true;
  },
});

/** A property of the open note set (or taken away), through the editor so Ctrl+Z undoes it. */
function setNoteProp(view: EditorView, key: string, value: string | number | null): void {
  const current = view.state.doc.toString();
  const next = changeProps(current, (doc) => (value === null ? doc.delete(key) : doc.set(key, value)));
  if (next === current) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start++;
  let endA = current.length;
  let endB = next.length;
  while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) {
    endA--;
    endB--;
  }
  view.dispatch({ changes: { from: start, to: endA, insert: next.slice(start, endB) }, userEvent: 'input.properties' });
}

export function formatBar(host: FormatBarHost): Extension {
  return [
    barFlags,
    showTooltip.compute([barFlags, 'selection'], barTooltip),
    watcher,
    escape,
    barHost.of(host),
  ];
}
