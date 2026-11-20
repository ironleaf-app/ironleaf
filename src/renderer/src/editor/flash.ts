// A passage shown for a moment (21 Oct 2026, notebook mode): a cited answer's chip opens its note and the lines it quotes
// glow briefly, so the eye lands on the exact paragraph. Only a look: nothing in the note changes.

import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** Lines to light (counted from 0), or null to put them out. */
export const flashLines = StateEffect.define<{ from: number; to: number } | null>();

const lit = Decoration.line({ class: 'cm-nv-flash' });

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(flashLines)) continue;
      if (!e.value) {
        deco = Decoration.none;
        continue;
      }
      const doc = tr.state.doc;
      const first = Math.min(Math.max(e.value.from + 1, 1), doc.lines);
      const last = Math.min(Math.max(e.value.to + 1, first), doc.lines, first + 80);
      const ranges: Range<Decoration>[] = [];
      for (let n = first; n <= last; n++) ranges.push(lit.range(doc.line(n).from));
      deco = Decoration.set(ranges);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Lines a reveal points at (counted from 0), or null to forget them. Live Preview unwraps what they touch, so the
 *  lit line is real source even inside a table, diagram or embed (p14, 4 Nov 2026: the flash used to land on lines a
 *  widget hid, so "Edit" on a table row lit nothing at all). */
export const revealShow = StateEffect.define<{ from: number; to: number } | null>();

export const revealField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(revealShow)) return e.value;
    return value;
  },
});

/** Lights lines `from`–`to` (from 0) for about two seconds. */
export function flash(view: EditorView, from: number, to: number): void {
  view.dispatch({ effects: [flashLines.of({ from, to }), revealShow.of({ from, to })] });
  setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: [flashLines.of(null), revealShow.of(null)] });
  }, 2400);
}
