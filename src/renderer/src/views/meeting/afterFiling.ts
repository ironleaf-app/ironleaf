// One-tap filing both meeting doors share (10.0 item 19): the note's own panel and the Meetings place file actions
// into Tasks and reminders through these two functions, so both doors behave the same, say the same words, and ask
// the same day. The filing itself is pure (src/shared/meeting-after.ts); this is the asking, writing and telling.

import { useRef } from 'react';
import { prompt } from '../../components/Dialogs';
import { docs } from '../../state/docs';
import { moduleChanged } from '../../state/modules';
import { showError, toast } from '../../state/store';
import { actionReminderAt, fileActionsToTasks, mayFileReminders, reminderLinesForActions, remindersSetWords, tasksFiledWords } from '../../../../shared/meeting-after';
import { REMINDER_HOMES, appendReminderLine, parseWhen } from '../../../../shared/reminders';

export interface AfterRow {
  line: number;
  raw: string;
  what: string;
  who?: string;
  /** Its day (YYYY-MM-DD), when one is known. */
  due?: string;
}

export function useMeetingAfterFiling(path: string, opts: { writeNoteText?: (next: string) => void } = {}): {
  fileToTasks(rows: AfterRow[]): void;
  remindRows(rows: AfterRow[]): void;
} {
  // One filing at a time per panel (a double tap files once; the second run would only say already anyway).
  const live = useRef(false);

  /** Each row becomes a tick box in the meeting note. Through the note's own writer when given (the editor, so Ctrl+Z
   *  there takes them back); else through the docs when they hold the note, else written straight with Undo here. */
  const fileToTasks = (rows: AfterRow[]) => {
    if (!rows.length || live.current) return;
    live.current = true;
    void (async () => {
      try {
        const before = docs.text(path) ?? (await window.nv.notes.read(path).catch(() => null));
        if (before === null) {
          showError(new Error('That meeting note is not there any more.'));
          return;
        }
        const r = fileActionsToTasks(
          before,
          rows.map((x) => ({ line: x.line, raw: x.raw, what: x.what.trim(), ...(x.who?.trim() ? { who: x.who.trim() } : {}), ...(x.due ? { due: x.due } : {}) })),
        );
        if (r.text === before) {
          toast(tasksFiledWords(r));
          return;
        }
        if (opts.writeNoteText) {
          opts.writeNoteText(r.text);
          moduleChanged();
          toast(tasksFiledWords(r));
          return;
        }
        const viaBuffer = docs.text(path) !== undefined;
        if (viaBuffer) docs.update(path, r.text, `meeting-tasks:${path}`);
        else await window.nv.notes.write(path, r.text);
        moduleChanged();
        toast(
          tasksFiledWords(r),
          viaBuffer
            ? undefined
            : {
                label: 'Undo',
                run: () => {
                  if (docs.text(path) !== undefined) docs.update(path, before, `meeting-tasks-undo:${path}`);
                  else void window.nv.notes.write(path, before).catch(showError);
                  moduleChanged();
                },
              },
        );
      } catch (err) {
        showError(err);
      } finally {
        live.current = false;
      }
    })();
  };

  /** Each row gains a ⏰ line in Reminders.md, the one home, written the assistant's own way. Never from a private
   *  note (its words would leave the locked place). Rows with no day share one asked day for the tap; a cancelled ask
   *  leaves those rows out and says so. Past days set nothing, like the side chat. */
  const remindRows = (rows: AfterRow[]) => {
    if (!rows.length || live.current || !mayFileReminders(path)) return;
    live.current = true;
    void (async () => {
      try {
        const at = new Date();
        const withAt: { what: string; who?: string; at: number }[] = [];
        const dayless: AfterRow[] = [];
        let past = 0;
        for (const x of rows) {
          const moment = x.due ? actionReminderAt(x.due) : null;
          if (moment === null) {
            dayless.push(x);
            continue;
          }
          if (moment <= at.getTime()) {
            past++;
            continue;
          }
          withAt.push({ what: x.what.trim(), ...(x.who?.trim() ? { who: x.who.trim() } : {}), at: moment });
        }
        let leftOut = 0;
        if (dayless.length) {
          const said = await prompt('Remind me on which day?', {
            message: `${dayless.length === 1 ? 'It has' : `${dayless.length} have`} no day. One day for ${dayless.length === 1 ? 'it' : 'them'} (a time too, if there is one).`,
            placeholder: 'Friday, 6 Nov, tomorrow at 3pm',
            ok: dayless.length === 1 ? 'Set it' : 'Set them',
          });
          if (said?.trim()) {
            const when = parseWhen(said.trim(), at);
            if (!when) toast(`Could not tell when “${said.trim().slice(0, 60)}” is. Give a day like Friday or 6 Nov.`);
            else if (when.at.getTime() <= at.getTime()) past += dayless.length;
            else for (const x of dayless) withAt.push({ what: x.what.trim(), ...(x.who?.trim() ? { who: x.who.trim() } : {}), at: when.at.getTime() });
          } else leftOut = dayless.length;
        }
        if (!withAt.length) {
          toast(leftOut ? 'No day given. Nothing was set.' : remindersSetWords({ set: 0, already: 0, past }));
          return;
        }
        const [reminders, inbox] = await Promise.all([window.nv.notes.read(REMINDER_HOMES[0]).catch(() => null), window.nv.notes.read(REMINDER_HOMES[1]).catch(() => null)]);
        const plan = reminderLinesForActions(withAt, { reminders, inbox });
        if (!plan.lines.length) {
          toast(remindersSetWords({ set: 0, already: plan.already, past }));
          return;
        }
        let next: string | null = reminders;
        for (const line of plan.lines) next = appendReminderLine(next, line);
        if (next === null) return; // A line was always appended above; nothing to write.
        const rel = REMINDER_HOMES[0];
        const before = reminders;
        if (docs.text(rel) !== undefined) docs.update(rel, next, `meeting-remind:${path}`);
        else await window.nv.notes.write(rel, next);
        toast(
          remindersSetWords({ set: plan.lines.length, already: plan.already, past }) + (leftOut ? ` ${leftOut === 1 ? '1 had' : `${leftOut} had`} no day and ${leftOut === 1 ? 'was' : 'were'} left out.` : ''),
          // Undo restores Reminders.md exactly (a home just made has nothing to restore: no Undo then).
          before === null
            ? undefined
            : {
                label: 'Undo',
                run: () => {
                  if (docs.text(rel) !== undefined) docs.update(rel, before, `meeting-remind-undo:${path}`);
                  else void window.nv.notes.write(rel, before).catch(showError);
                },
              },
        );
      } catch (err) {
        showError(err);
      } finally {
        live.current = false;
      }
    })();
  };

  return { fileToTasks, remindRows };
}
