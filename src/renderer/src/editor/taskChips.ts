// A task line's owner and day as chips while writing (8.0 section E, 29 Oct 2026): in Live Preview the line's "—
// Sam Okafor · by 13 Nov" (or its 📅 day, or a day typed in plain words) reads as two small chips at the line's
// end, the day tinted when it is today or past. Every owner chips the same, the note owner included, a done line
// muted (p16). The Markdown shows again on the line the cursor is on, as with everything else in Live Preview.
// Clicking the day chip changes the day; the line is rewritten the one plain way Tasks reads (src/shared/tasks.ts
// setTaskDue). A plain-words day is written canonically once the cursor leaves its line (src/shared/note-task.ts),
// so "fri" written today is still that Friday next week.

import { type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { dueChipTone, plainDateRewrite, taskChips } from '../../../shared/note-task';
import { setTaskDue } from '../../../shared/tasks';
import { minPopupTop } from '../lib/windowButtons';
import { toast } from '../state/store';

class OwnerChip extends WidgetType {
  constructor(
    readonly name: string,
    readonly done: boolean = false,
  ) {
    super();
  }
  eq(other: OwnerChip) {
    return other.name === this.name && other.done === this.done;
  }
  toDOM() {
    const chip = document.createElement('span');
    chip.className = `cm-nv-chip cm-nv-chip-owner${this.done ? ' is-done' : ''}`;
    chip.title = `With ${this.name}`;
    const initial = document.createElement('span');
    initial.className = 'cm-nv-chip-initial';
    initial.textContent = this.name.trim().charAt(0).toUpperCase() || '?';
    const words = document.createElement('span');
    words.textContent = this.name;
    chip.append(initial, words);
    return chip;
  }
}

class DueChip extends WidgetType {
  constructor(
    readonly words: string,
    readonly tone: 'today' | 'overdue' | 'done' | '',
    readonly iso: string,
  ) {
    super();
  }
  eq(other: DueChip) {
    return other.words === this.words && other.tone === this.tone && other.iso === this.iso;
  }
  toDOM() {
    const chip = document.createElement('span');
    chip.className = `cm-nv-chip cm-nv-chip-due${this.tone ? ` is-${this.tone}` : ''}`;
    chip.dataset.due = this.iso;
    chip.setAttribute('role', 'button');
    chip.title = this.tone === 'overdue' ? 'Past its day. Click to change it' : 'Click to change the day';
    chip.textContent = this.words;
    return chip;
  }
  ignoreEvent() {
    return false;
  }
}

const todayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function touchesLine(view: EditorView, lineFrom: number, lineTo: number): boolean {
  return view.hasFocus && view.state.selection.ranges.some((r) => r.from <= lineTo && r.to >= lineFrom);
}

function build(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const now = new Date();
  const today = todayIso(now);
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.text.includes('[ ]') || line.text.includes('[x]') || line.text.includes('[X]')) {
        const chips = taskChips(line.text, now);
        if (chips && !touchesLine(view, line.from, line.to)) {
          // The day, where it is written, becomes its chip (a linked owner stays the mention chip Live Preview draws).
          if (chips.due && chips.dueSpan) {
            const tone = dueChipTone(chips.due, today, chips.done);
            out.push(Decoration.replace({ widget: new DueChip(chips.dueWords!, tone, chips.due) }).range(line.from + chips.dueSpan[0], line.from + chips.dueSpan[1]));
          }
          if (chips.owner && chips.ownerSpan && !chips.ownerRaw?.includes('[[')) {
            out.push(Decoration.replace({ widget: new OwnerChip(chips.owner, chips.done) }).range(line.from + chips.ownerSpan[0], line.from + chips.ownerSpan[1]));
          }
          // The separators the chips replace hide with them (p14): no stray dash or dot beside the chips.
          for (const [a, b] of chips.hideSpans ?? []) {
            if (b > a && a >= 0 && b <= line.text.length) out.push(Decoration.replace({}).range(line.from + a, line.from + b));
          }
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

let openPicker: (() => void) | null = null;

/** The day chip's small picker: Save writes the day the plain way; Clear takes it off the line. */
function showPicker(view: EditorView, chipEl: HTMLElement, iso: string): void {
  openPicker?.();
  const box = document.createElement('div');
  box.className = 'rm-picker nv-due-picker';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Change the day');
  box.innerHTML = `
    <div class="rm-picker-head">Due</div>
    <div class="rm-picker-fields"><label><span>Day</span><input type="date" class="rm-picker-date" value="${iso}"></label></div>
    <div class="rm-picker-actions">
      <button type="button" class="rm-picker-remove">Clear</button>
      <span></span>
      <button type="button" class="button rm-picker-cancel">Cancel</button>
      <button type="button" class="button primary rm-picker-save">Save</button>
    </div>`;
  document.body.append(box);
  const rect = chipEl.getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`;
  // Never up under the window buttons (8.6.1): below their band.
  box.style.top = `${rect.bottom + 160 > window.innerHeight ? Math.max(minPopupTop(), rect.top - 166) : Math.max(minPopupTop(), rect.bottom + 6)}px`;
  const date = box.querySelector<HTMLInputElement>('.rm-picker-date')!;
  date.focus();
  const close = () => {
    box.remove();
    document.removeEventListener('pointerdown', outside, true);
    openPicker = null;
  };
  const outside = (e: Event) => {
    if (!box.contains(e.target as Node)) close();
  };
  document.addEventListener('pointerdown', outside, true);
  openPicker = close;
  const write = (next: string | null) => {
    const line = view.state.doc.lineAt(view.posAtDOM(chipEl));
    const changed = setTaskDue(line.text, next);
    if (changed !== line.text) view.dispatch({ changes: { from: line.from, to: line.to, insert: changed } });
    close();
    view.focus();
  };
  // Save with no day says so (9.2 uplift F89): empty never silently clears — Clear is the way to clear.
  const save = () => {
    if (!date.value) {
      toast('Pick a day first, or Clear to take it off.');
      return;
    }
    write(date.value);
  };
  box.querySelector('.rm-picker-save')!.addEventListener('click', save);
  box.querySelector('.rm-picker-remove')!.addEventListener('click', () => write(null));
  box.querySelector('.rm-picker-cancel')!.addEventListener('click', () => {
    close();
    view.focus();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      view.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
}

/** Live Preview's task chips, their picker, and plain-words days made canonical on leaving the line. */
export function taskChipPills(): Extension {
  const pills = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = build(u.view);
        if (u.selectionSet && !u.docChanged && u.view.hasFocus) {
          const was = u.startState.doc.lineAt(u.startState.selection.main.head).number;
          const is = u.state.doc.lineAt(u.state.selection.main.head).number;
          if (was !== is && was <= u.state.doc.lines) {
            const line = u.state.doc.line(was);
            const change = plainDateRewrite(line.text, new Date());
            if (change) {
              const view = u.view;
              queueMicrotask(() => {
                if (view.state.doc.line(was).text !== line.text) return;
                view.dispatch({ changes: { from: line.from + change.from, to: line.from + change.to, insert: change.insert }, userEvent: 'input.date' });
              });
            }
          }
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [
    pills,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const chip = (event.target as HTMLElement).closest('.cm-nv-chip-due') as HTMLElement | null;
        if (!chip?.dataset.due) return false;
        event.preventDefault();
        if (!view.state.facet(EditorView.editable)) return true;
        showPicker(view, chip, chip.dataset.due);
        return true;
      },
    }),
  ];
}
