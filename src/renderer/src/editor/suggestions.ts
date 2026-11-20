// The assistant's suggested changes drawn in the note (19 Oct 2026, 5.0.0: "AI edits you approve"; state/suggestions.ts
// keeps them). A change inside a line shows its words: the ones going struck through in a soft red, the ones coming in a
// soft green beside them. A change of whole lines shows the lines going struck through and the lines coming in as a block
// below them. Each has Keep and Discard at its end; one the person has typed over says "Out of date" and can only be
// discarded. Properties hidden above the note (Live Preview) show their change as a block where the note's words start.

import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { frontMatterRange, propsReadable } from '../../../shared/frontmatter';
import { hunkLook, rebaseHunks, wordParts, type Hunk } from '../../../shared/note-diff';
import { discardSuggestion, keepSuggestion, onSuggestions, suggestionsOf } from '../state/suggestions';

/** Whether the properties are hidden above the note here (Live Preview with them in their panel). */
export const propertiesHidden = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

const redraw = StateEffect.define<null>();

function button(label: string, cls: string, title: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.title = title;
  // The cursor stays where it is in the note.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  return b;
}

/** Keep and Discard (or "Out of date" and Discard) for one change. */
function actions(path: string, h: Hunk, current: boolean): HTMLElement {
  const box = document.createElement('span');
  box.className = `cm-nv-sg-actions${current ? ' is-current' : ''}${h.stale ? ' is-stale' : ''}`;
  box.setAttribute('contenteditable', 'false');
  if (h.stale) {
    const said = document.createElement('span');
    said.className = 'cm-nv-sg-stale';
    said.textContent = 'Out of date';
    said.title = 'You changed this part of the note since it was suggested, so it can only be discarded.';
    box.append(said);
  } else box.append(button('Keep', 'cm-nv-sg-keep', 'Keep this change (Alt+Enter)', () => keepSuggestion(path, h.id)));
  box.append(button('Discard', 'cm-nv-sg-discard', 'Discard this change (Alt+Backspace)', () => discardSuggestion(path, h.id)));
  return box;
}

/** Words coming in, inside a line. */
class AddedWords extends WidgetType {
  constructor(
    readonly text: string,
    readonly stale: boolean,
  ) {
    super();
  }
  eq(other: AddedWords) {
    return other.text === this.text && other.stale === this.stale;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-nv-sg-add${this.stale ? ' is-stale' : ''}`;
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

/** Keep and Discard at the end of a change inside a line. */
class Actions extends WidgetType {
  constructor(
    readonly path: string,
    readonly hunk: Hunk,
    readonly current: boolean,
  ) {
    super();
  }
  eq(other: Actions) {
    return other.path === this.path && other.hunk.id === this.hunk.id && !!other.hunk.stale === !!this.hunk.stale && other.current === this.current;
  }
  toDOM() {
    return actions(this.path, this.hunk, this.current);
  }
  ignoreEvent() {
    return true;
  }
}

/** Lines coming in, as a block below the lines going (or the properties' change, when they are hidden). */
class Block extends WidgetType {
  constructor(
    readonly path: string,
    readonly hunk: Hunk,
    readonly current: boolean,
    readonly shown: string,
    readonly gone: string | null,
  ) {
    super();
  }
  eq(other: Block) {
    return other.path === this.path && other.hunk.id === this.hunk.id && !!other.hunk.stale === !!this.hunk.stale && other.current === this.current && other.shown === this.shown && other.gone === this.gone;
  }
  toDOM() {
    const box = document.createElement('div');
    box.className = `cm-nv-sg-block${this.current ? ' is-current' : ''}${this.hunk.stale ? ' is-stale' : ''}`;
    if (this.gone !== null) {
      const head = document.createElement('div');
      head.className = 'cm-nv-sg-block-head';
      head.textContent = 'Properties';
      box.append(head);
      for (const line of this.gone.split('\n')) {
        const row = document.createElement('div');
        row.className = 'cm-nv-sg-line-gone';
        row.textContent = line || ' ';
        box.append(row);
      }
    }
    if (this.shown) {
      for (const line of this.shown.split('\n')) {
        const row = document.createElement('div');
        row.className = 'cm-nv-sg-line-add';
        row.textContent = line || ' ';
        box.append(row);
      }
    }
    const bar = document.createElement('div');
    bar.className = 'cm-nv-sg-block-bar';
    if (!this.shown && this.gone === null) {
      const said = document.createElement('span');
      said.className = 'cm-nv-sg-block-said';
      said.textContent = this.hunk.old.split('\n').filter((l) => l.trim()).length > 1 ? 'Take out these lines' : 'Take out this line';
      bar.append(said);
    }
    bar.append(actions(this.path, this.hunk, this.current));
    box.append(bar);
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/** A change's lines without the line break that only joins them to what is around. */
const trimBreaks = (s: string) => s.replace(/^\n/, '').replace(/\n$/, '');

function build(path: string, state: EditorState): DecorationSet {
  const entry = suggestionsOf(path);
  if (!entry?.hunks.length) return Decoration.none;
  const doc = state.doc.toString();
  // The editor a step ahead of the shared text (a change on its way): placed by their lines until it catches up.
  const list = entry.anchor === doc ? entry.hunks : rebaseHunks(entry.hunks, entry.anchor, doc);
  const fm = state.facet(propertiesHidden) ? frontMatterRange(doc.slice(0, 50000)) : null;
  const hiddenTo = fm && fm.to > 0 && propsReadable(doc.slice(0, 50000)) ? fm.to : 0;
  const out: Range<Decoration>[] = [];
  list.forEach((h, i) => {
    if (h.to > doc.length) return;
    const current = i === entry.current;
    const cls = `${h.stale ? ' is-stale' : ''}${current ? ' is-current' : ''}`;
    // Out of date: what it would have put in, greyed, with Discard where it was.
    if (h.stale) {
      const at = Math.min(h.from, doc.length);
      if (hunkLook(h) === 'lines') out.push(Decoration.widget({ widget: new Block(path, h, current, trimBreaks(h.insert), null), block: true, side: 1 }).range(state.doc.lineAt(at).to));
      else {
        if (h.insert) out.push(Decoration.widget({ widget: new AddedWords(h.insert, true), side: 1 }).range(at));
        out.push(Decoration.widget({ widget: new Actions(path, h, current), side: 2 }).range(at));
      }
      return;
    }
    if (h.from < hiddenTo) {
      out.push(Decoration.widget({ widget: new Block(path, h, current, trimBreaks(h.insert), trimBreaks(h.old)), block: true, side: -1 }).range(Math.min(hiddenTo, doc.length)));
      return;
    }
    if (hunkLook(h) === 'inline') {
      let at = h.from;
      for (const part of wordParts(h.old, h.insert)) {
        if (part.kind === 'same') at += part.text.length;
        else if (part.kind === 'del') {
          out.push(Decoration.mark({ class: `cm-nv-sg-del${cls}` }).range(at, at + part.text.length));
          at += part.text.length;
        } else out.push(Decoration.widget({ widget: new AddedWords(part.text, !!h.stale), side: 1 }).range(at));
      }
      out.push(Decoration.widget({ widget: new Actions(path, h, current), side: 2 }).range(h.to));
      return;
    }
    if (h.to > h.from) {
      out.push(Decoration.mark({ class: `cm-nv-sg-del${cls}` }).range(h.from, h.to));
      const first = state.doc.lineAt(h.from);
      const last = state.doc.lineAt(Math.max(h.from, h.to - 1));
      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n);
        if (line.from >= h.from && line.to <= h.to) out.push(Decoration.line({ class: `cm-nv-sg-line-del${cls}` }).range(line.from));
      }
    }
    // The new lines go below the lines going (before the line the change ends at, or after the line it ends in).
    const atLineStart = h.to === 0 || doc[h.to - 1] === '\n';
    const pos = atLineStart ? h.to : state.doc.lineAt(h.to).to;
    out.push(Decoration.widget({ widget: new Block(path, h, current, trimBreaks(h.insert), null), block: true, side: atLineStart ? -1 : 1 }).range(pos));
  });
  return Decoration.set(out, true);
}

/** The suggested changes in this note's editor, drawn again whenever they change. */
export function suggestionsExtension(path: string): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(path, state),
    update: (value, tr) => {
      if (tr.effects.some((e) => e.is(redraw)) || tr.startState.facet(propertiesHidden) !== tr.state.facet(propertiesHidden)) return build(path, tr.state);
      return tr.docChanged ? value.map(tr.changes) : value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const follow = ViewPlugin.define((view) => {
    let gone = false;
    let queued = false;
    // Told while the editor may be in the middle of an update (a kept change going in): drawn just after.
    const off = onSuggestions(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!gone) view.dispatch({ effects: redraw.of(null) });
      });
    });
    return {
      destroy() {
        gone = true;
        off();
      },
    };
  });
  return [field, follow];
}
