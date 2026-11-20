// Reminders in the editor (19 Oct 2026, approved reminders): in Live Preview a task's "⏰ 2026-10-23 09:00" reads as a
// small pill ("Fri 23 Oct, 9:00 am"; tinted when it has passed and isn't ticked), and the Markdown shows again where
// the cursor is, as everything else in Live Preview does. Clicking the pill opens a small picker to change the day and
// time (or take the reminder off). Typing a moment as people say it after the ⏰ ("⏰ friday 3pm", "⏰ tomorrow", "⏰
// every Monday") is written the one exact way once the cursor leaves the line, so the note never holds a day that
// slides ("tomorrow" written today means today by tomorrow). The words are src/shared/reminders.ts's.

import { type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { iconMarkup } from '../components/Icon';
import { minPopupTop } from '../lib/windowButtons';
import { toast } from '../state/store';
import { exactMoment, formatMark, parseReminderLine, pillWords, repeatText } from '../../../shared/reminders';

const pad = (n: number) => String(n).padStart(2, '0');

class ReminderPill extends WidgetType {
  constructor(readonly due: number, readonly repeat: string | null, readonly done: boolean, readonly passed: boolean, readonly words: string) {
    super();
  }
  eq(other: ReminderPill) {
    return other.due === this.due && other.repeat === this.repeat && other.done === this.done && other.passed === this.passed && other.words === this.words;
  }
  toDOM() {
    const pill = document.createElement('span');
    pill.className = `cm-nv-remind${this.passed ? ' is-passed' : ''}${this.done ? ' is-done' : ''}`;
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '-1');
    pill.setAttribute('aria-label', `Reminder ${this.words}${this.repeat ? `, ${this.repeat}` : ''}. Change it`);
    pill.title = `${this.passed && !this.done ? 'This reminder’s time has passed' : 'Reminder'}${this.repeat ? ` · ${this.repeat}` : ''} · click to change`;
    pill.innerHTML = iconMarkup('clock', 12);
    const words = document.createElement('span');
    words.textContent = this.words;
    pill.append(words);
    if (this.repeat) {
      const again = document.createElement('span');
      again.className = 'cm-nv-remind-repeat';
      again.innerHTML = iconMarkup('refresh', 11);
      pill.append(again);
    }
    return pill;
  }
  ignoreEvent() {
    return false;
  }
}

/** Whether the cursor is on a range (the editor has the keys): then its Markdown shows. */
function touches(view: EditorView, from: number, to: number): boolean {
  return view.hasFocus && view.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function build(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const now = Date.now();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.text.includes('⏰')) {
        const r = parseReminderLine(line.text);
        if (r && !touches(view, line.from + r.from, line.from + r.to)) {
          out.push(Decoration.replace({ widget: new ReminderPill(r.due, r.repeat ? repeatText(r.repeat) : null, r.done, r.due <= now, pillWords(r.due, now)) }).range(line.from + r.from, line.from + r.to));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

// ── The picker ───────────────────────────────────────────────────────────────────────────────────────────────────────

let openPicker: (() => void) | null = null;

/** The small date and time picker under a pill: Save writes the new moment in place; Remove takes the ⏰ part off. */
function showPicker(view: EditorView, pill: HTMLElement, lineFrom: number): void {
  openPicker?.();
  const line = view.state.doc.lineAt(lineFrom);
  const r = parseReminderLine(line.text);
  if (!r) return;
  const d = new Date(r.due);
  const box = document.createElement('div');
  box.className = 'rm-picker';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Change the reminder');
  box.innerHTML = `
    <div class="rm-picker-head">Remind me</div>
    <div class="rm-picker-fields">
      <label><span>Day</span><input type="date" class="rm-picker-date" value="${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}"></label>
      <label><span>Time</span><input type="time" class="rm-picker-time" value="${pad(d.getHours())}:${pad(d.getMinutes())}"></label>
    </div>
    ${r.repeat ? `<p class="rm-picker-note">Repeats ${repeatText(r.repeat)}: this moves the next one.</p>` : ''}
    <div class="rm-picker-actions">
      <button type="button" class="rm-picker-remove">Remove</button>
      <span></span>
      <button type="button" class="button rm-picker-cancel">Cancel</button>
      <button type="button" class="button primary rm-picker-save">Save</button>
    </div>`;
  document.body.append(box);
  const rect = pill.getBoundingClientRect();
  const width = 280;
  box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  const below = rect.bottom + 6;
  // Never up under the window buttons (8.6.1): below their band.
  box.style.top = `${below + 190 > window.innerHeight ? Math.max(minPopupTop(), rect.top - 196) : Math.max(minPopupTop(), below)}px`;
  const date = box.querySelector<HTMLInputElement>('.rm-picker-date')!;
  const time = box.querySelector<HTMLInputElement>('.rm-picker-time')!;
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

  /** The reminder's line as it is now (the note may have changed while the picker was open). */
  const current = () => {
    const at = Math.min(lineFrom, view.state.doc.length);
    const l = view.state.doc.lineAt(at);
    const now = parseReminderLine(l.text);
    return now && now.text === r.text ? { l, now } : null;
  };
  const save = () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.value);
    const t = /^(\d{2}):(\d{2})$/.exec(time.value || '09:00');
    // Said what's missing, never silently nothing (9.2 uplift F89).
    if (!m || !t) {
      toast('Pick a day for the reminder first.');
      return;
    }
    const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
    const c = current();
    if (c) view.dispatch({ changes: { from: c.l.from + c.now.from, to: c.l.from + c.now.to, insert: formatMark(due, c.now.repeat) } });
    close();
    view.focus();
  };
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      view.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  box.querySelector('.rm-picker-save')!.addEventListener('click', save);
  box.querySelector('.rm-picker-cancel')!.addEventListener('click', () => {
    close();
    view.focus();
  });
  box.querySelector('.rm-picker-remove')!.addEventListener('click', () => {
    const c = current();
    if (c) {
      // The ⏰ part and the space before it: the task stays, as a plain task.
      const start = c.l.from + c.now.from;
      const before = start > c.l.from && /\s/.test(c.l.text[c.now.from - 1] ?? '') ? start - 1 : start;
      view.dispatch({ changes: { from: before, to: c.l.from + c.now.to, insert: '' } });
    }
    close();
    view.focus();
  });
}

// ── Moments typed as people say them ───────────────────────────────────────────────────────────────────────────────

/**
 * Slash's Reminder: the line becomes a task with "⏰" for tomorrow at 9:00 am at its end (the pill, a click away from
 * any other day and time); on an empty line the cursor waits where the task's words go. The ⏰ is hard to type on a
 * keyboard, so this is the way in that doesn't need it.
 */
export function insertReminder(view: EditorView): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const n = new Date();
  const mark = ` ${formatMark(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 9, 0))}`;
  // Already reminding: said, never silent (9.2 uplift F88) — the pill is the way to change it.
  if (parseReminderLine(line.text)) {
    toast('This line already reminds. Choose its pill to change it.');
    return;
  }
  const task = /^(\s*)(?:([-*+]|\d{1,9}[.)])\s+)?(\[[ xX]\]\s+)?(.*?)\s*$/.exec(line.text)!;
  const indent = task[1];
  const words = task[4];
  const head = task[3] ? `${indent}${task[2] ?? '-'} ${task[3]}` : `${indent}${task[2] ?? '-'} [ ] `;
  const text = `${head}${words}${mark}`;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, selection: { anchor: line.from + head.length + words.length } });
  view.focus();
}

/** How long until a visible pill's words change (9.2 uplift F27): each pill redraws on its own next
 *  boundary — "in 5 min" flips the moment it is "in 4 min" — capped at a minute, never longer. */
function msToNextPill(view: EditorView): number {
  const now = Date.now();
  let wait = 60000;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const r = parseReminderLine(line.text);
      if (r && !r.done) {
        const left = r.due - now;
        wait = Math.min(wait, left <= 0 ? 1000 : (left % 60000) + 500, left + 500);
      }
      pos = line.to + 1;
    }
  }
  return Math.max(500, Math.min(wait, 60000));
}

/** Live Preview's reminders: the pills, their picker, and moments made exact. */
export function reminderPills(): Extension {
  const pills = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      timer: ReturnType<typeof setTimeout> | undefined;
      constructor(view: EditorView) {
        this.decorations = build(view);
        const tick = () => {
          this.decorations = build(view);
          view.dispatch({});
          this.timer = setTimeout(tick, msToNextPill(view));
        };
        this.timer = setTimeout(tick, msToNextPill(view));
      }
      destroy() {
        clearTimeout(this.timer);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = build(u.view);
        // Leaving the editor altogether fixes the line too (fnv3 F28): "⏰ tomorrow" must not keep sliding
        // because the person switched tab or to Reading instead of arrowing off the line.
        if (u.focusChanged && !u.view.hasFocus) {
          const line = u.state.doc.lineAt(u.state.selection.main.head);
          const change = line.text.includes('⏰') ? exactMoment(line.text, new Date()) : null;
          if (change) queueMicrotask(() => { if (u.view.state.doc.lineAt(u.view.state.selection.main.head).text === line.text) u.view.dispatch({ changes: { from: line.from + change.from, to: line.from + change.to, insert: change.insert }, userEvent: 'input.reminder' }); });
        }
        // The cursor left a line with a moment as people say it: written the exact way.
        if (u.selectionSet && !u.docChanged && u.view.hasFocus) {
          const was = u.startState.doc.lineAt(u.startState.selection.main.head).number;
          const is = u.state.doc.lineAt(u.state.selection.main.head).number;
          if (was !== is && was <= u.state.doc.lines) {
            const line = u.state.doc.line(was);
            const change = line.text.includes('⏰') ? exactMoment(line.text, new Date()) : null;
            if (change) {
              const view = u.view;
              queueMicrotask(() => {
                if (view.state.doc.line(was).text !== line.text) return;
                view.dispatch({ changes: { from: line.from + change.from, to: line.from + change.to, insert: change.insert }, userEvent: 'input.reminder' });
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
        const pill = (event.target as HTMLElement).closest('.cm-nv-remind') as HTMLElement | null;
        if (!pill) return false;
        event.preventDefault();
        if (!view.state.facet(EditorView.editable)) return true;
        showPicker(view, pill, view.state.doc.lineAt(view.posAtDOM(pill)).from);
        return true;
      },
    }),
  ];
}
