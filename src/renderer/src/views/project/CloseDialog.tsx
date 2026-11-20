// Closing a project with open tasks (p12-close-and-noise A, 4 Nov 2026: their Wexley St and Penhallow St were marked
// done with 12 open tasks nobody could answer for). The shared dialog: the project page's status control and the side
// panel open it instead of marking done silently, and the quiet "N loose ends" line on a finished project opens it too.
// Every open task with Done, Drop, Move to another project; "All done" and "Keep it open" at the foot. A dropped task
// keeps its line under Decisions with the date (src/shared/project-close.ts); every action goes through the project's
// own edits, so Undo takes it back.

import { closeAskLead, type LooseTask } from '../../../../shared/project-close';
import { openMenu } from '../../components/Menu';
import { useEscape } from '../../lib/useEscape';

/** A project a task can move to (the host leaves the project itself out). */
export interface CloseTarget {
  path: string;
  name: string;
}

export function CloseDialog({ name, tasks, targets, mode, busy, onDone, onDrop, onMove, onAllDone, onClose }: {
  /** The project being closed. */
  name: string;
  /** The open tasks still to answer for (the host keeps them fresh from the file). */
  tasks: LooseTask[];
  /** Where a task can move (besides here). */
  targets: CloseTarget[];
  /** Closing it now, or answering the loose ends of one already done. */
  mode: 'closing' | 'loose';
  /** An action is running. */
  busy: boolean;
  onDone(index: number): void;
  onDrop(index: number): void;
  onMove(index: number, target: string): void;
  onAllDone(): void;
  onClose(): void;
}) {
  useEscape(onClose);
  const move = (t: LooseTask, anchor: HTMLElement) => {
    if (!targets.length) return;
    openMenu(
      anchor,
      targets.map((p) => ({ label: p.name, run: () => onMove(t.index, p.path) })),
    );
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog close-dialog" role="dialog" aria-modal="true" aria-label={mode === 'closing' ? `Mark ${name} done` : `${name}: loose ends`} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{mode === 'closing' ? `Mark “${name}” done?` : `“${name}”: loose ends`}</h2>
        <p className="hint">{tasks.length ? closeAskLead(tasks) : 'Nothing is open any more.'}</p>
        {!!tasks.length && (
          <ul className="close-tasks">
            {tasks.map((t) => (
              <li key={t.index} className="close-task">
                <span className="close-task-words">
                  <span>{t.what}</span>
                  {(t.who || t.when) && <span className="close-task-meta">{[t.who, t.when ? `by ${t.when}` : ''].filter(Boolean).join(' · ')}</span>}
                </span>
                <span className="close-task-acts">
                  <button type="button" className="button" disabled={busy} onClick={() => onDone(t.index)}>
                    Done
                  </button>
                  <button type="button" className="button" disabled={busy} title="Kept under Decisions with the date" onClick={() => onDrop(t.index)}>
                    Drop
                  </button>
                  <button type="button" className="button" disabled={busy || !targets.length} title={targets.length ? 'Move to another project' : 'There is no other project to move to'} aria-label="Move to another project" onClick={(e) => move(t, e.currentTarget)}>
                    Move
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Dropped tasks are kept under Decisions with the date. Everything here can be undone.</p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            {mode === 'closing' ? 'Keep it open' : 'Close'}
          </button>
          <button type="button" className="button primary" disabled={busy || !tasks.length} onClick={onAllDone}>
            All done
          </button>
        </div>
      </div>
    </div>
  );
}
