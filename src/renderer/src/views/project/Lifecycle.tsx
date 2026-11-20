// A project's life on its hub (23 Oct 2026, workstream 1: "full project lifecycle"): Idea → Planning → Active → Closing
// → Done as a stepper, each stage's short checklist under it (the project's own, kept in its file under
// ## Stage checklist; the defaults until it's changed), the move to the next stage when it's ready, and at Done the
// close-out report written from the project's own data (src/shared/project-hub.ts closeOutReport), with the assistant to
// polish its words if the person wants.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../../../shared/project-file';
import type { ProjectView } from '../../../../shared/types';
import { plural } from '../../../../shared/words';
import { checklistEdit, closeOutName, closeOutReport, stageChecklists, stageKey, stageOf, STAGE_LINES, STAGE_WORDS, STAGES, type HubFileIn, type Stage } from '../../../../shared/project-hub';
import { todayDay } from '../../../../shared/timeline';
import { Icon } from '../../components/Icon';
import * as A from '../../state/actions';
import { askInChat } from '../../state/chat';
import { docs } from '../../state/docs';
import { loadNotes, showError, toast } from '../../state/store';
import { useEditor } from './Inline';

export function Lifecycle({ view, files, open, onOpen }: { view: ProjectView; files: HubFileIn[]; open: boolean; onOpen(open: boolean): void }) {
  const { canEdit, edit, path } = useEditor();
  const p = view.project;
  const current = stageOf(view.props, p);
  const [shown, setShown] = useState<Stage>(current);
  useEffect(() => setShown(current), [current]);
  const lists = useMemo(() => stageChecklists(p), [p]);
  const list = lists.find((l) => l.stage === shown)!;
  const at = STAGES.indexOf(current);
  const done = list.items.filter((i) => i.done).length;
  const report = view.notes.find((n) => /close-out report$/i.test(n.title));
  const move = (stage: Stage) => void edit({ kind: 'stage', stage, key: stageKey(view.props) });
  const write = async () => {
    try {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const text = closeOutReport({ project: p, props: view.props, today: todayDay(), files });
      // Found first (W5-7): writing it again updates the report there, never a numbered copy.
      // The open tab's words land first (Nov 2026, nv-save F12), so the close-out never strands them.
      if (report) await docs.flush(report.path);
      const made = report ? (await window.nv.notes.write(report.path, text), report.path) : await window.nv.files.create(dir, closeOutName(p.name), '.md', text);
      await loadNotes();
      A.openPath(made, { where: 'tab' });
      toast(report ? 'Updated the close-out report from the project: check it, and add the lessons.' : 'Wrote the close-out report from the project: check it, and add the lessons.');
    } catch (err) {
      showError(err);
    }
  };
  const polish = () => report && askInChat(`Read the close-out report [[${report.title}]] for the project [[${p.name}]] and improve its wording so it reads well for a manager: keep every fact, date and name exactly as written, add nothing that isn't in the project, and fill "What went well" and "What we would do differently" only from what the project's own notes say. Show me the changes before making them.`, report.path);
  const next = at < STAGES.length - 1 ? STAGES[at + 1] : null;

  // One calm header (polish 29 Oct 2026, item 2): the five-step bar shows only while a project is being shaped or
  // wrapped up (Idea, Planning, Closing), as one thin line. An Active project's "Active" pill in the page header
  // says it on its own, so no bar sits before the work; a Done project keeps only its close-out row here.
  if (current === 'active') return null;
  if (current === 'done')
    return (
      <section className="ph-life is-thin is-done" aria-label="Where the project is in its life">
        <div className="ph-closeout">
          <Icon name="doc" size={16} />
          <div className="ph-closeout-words">
            <strong>Close-out report</strong>
            <span>{report ? `Written · ${report.title}` : 'What was delivered, the decisions, lessons and files: written from the project.'}</span>
          </div>
          {report && (
            <button className="button" onClick={() => A.openPath(report.path, { where: 'tab' })}>
              Open it
            </button>
          )}
          {report && <button className="button" onClick={polish}>Polish the words…</button>}
          {canEdit && (
            <button className={`button${report ? '' : ' primary'}`} onClick={() => void write()}>
              {report ? 'Write it again' : 'Write the close-out report'}
            </button>
          )}
        </div>
      </section>
    );

  return (
    <section className={`ph-life is-thin${open ? ' is-open' : ''}`} aria-label="Where the project is in its life">
      <div className="ph-life-row">
        <ol className="ph-steps">
          {STAGES.map((s, i) => (
            <li key={s} className={`ph-step${i < at ? ' is-past' : ''}${i === at ? ' is-now' : ''}${s === shown && open ? ' is-shown' : ''}`}>
              <button
                className="ph-step-button"
                aria-current={i === at ? 'step' : undefined}
                title={`${STAGE_WORDS[s]}: ${STAGE_LINES[s]}${i === at ? ' (where it is now)' : ''}`}
                onClick={() => {
                  setShown(s);
                  onOpen(!(open && s === shown));
                }}
              >
                <span className="ph-step-dot">{i < at ? <Icon name="check" size={10} /> : null}</span>
                <span className="ph-step-name">{STAGE_WORDS[s]}</span>
              </button>
            </li>
          ))}
        </ol>
        <button className="ph-life-toggle" aria-expanded={open} onClick={() => onOpen(!open)}>
          {(() => {
            const done = lists[at].items.filter((i) => i.done).length;
            const total = lists[at].items.length;
            return done ? `${done} of ${total} ${STAGE_WORDS[current]} checks` : `${plural(total, `${STAGE_WORDS[current]} check`)} to do`;
          })()}
          <Icon name="chevronDown" size={12} />
        </button>
      </div>
      {open && (
        <div className="ph-life-panel">
          <div className="ph-life-head">
            <div>
              <h4>
                {STAGE_WORDS[shown]}
                {shown === current ? <span className="ph-now">Now</span> : null}
              </h4>
              <p>{STAGE_LINES[shown]}</p>
            </div>
            <div className="ph-life-actions">
              {canEdit && shown !== current && (
                <button className="button" onClick={() => move(shown)}>
                  Move the project to {STAGE_WORDS[shown]}
                </button>
              )}
              {canEdit && shown === current && next && (
                <button className={`button${done === list.items.length && list.items.length ? ' primary' : ''}`} onClick={() => move(next)}>
                  Move to {STAGE_WORDS[next]} <Icon name="forward" size={12} />
                </button>
              )}
            </div>
          </div>
          <Checklist key={shown} p={p} stage={shown} items={list.items} />
          {shown === 'done' || current === 'closing' ? (
            <div className="ph-closeout">
              <Icon name="doc" size={16} />
              <div className="ph-closeout-words">
                <strong>Close-out report</strong>
                <span>{report ? `Written · ${report.title}` : 'What was delivered, the decisions, lessons and files: written from the project.'}</span>
              </div>
              {report && (
                <button className="button" onClick={() => A.openPath(report.path, { where: 'tab' })}>
                  Open it
                </button>
              )}
              {report && <button className="button" onClick={polish}>Polish the words…</button>}
              {canEdit && (
                <button className={`button${report ? '' : ' primary'}`} onClick={() => void write()}>
                  {report ? 'Write it again' : 'Write the close-out report'}
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Checklist({ p, stage, items }: { p: Project; stage: Stage; items: { what: string; done: boolean }[] }) {
  const { canEdit, edit } = useEditor();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const run = (change: Parameters<typeof checklistEdit>[1]) => {
    const e = checklistEdit(p, change);
    if (e) void edit(e);
  };
  return (
    <ul className="ph-check">
      {items.map((it, i) => (
        <li key={`${i}:${it.what}`} className={`ph-check-row${it.done ? ' is-done' : ''}`}>
          <button className="ph-box" role="checkbox" aria-checked={it.done} disabled={!canEdit} title={it.done ? 'Untick' : 'Tick it off'} onClick={() => run({ kind: 'toggle', stage, index: i })}>
            {it.done && <Icon name="check" size={11} />}
          </button>
          {renaming === i ? (
            <LineInput
              value={it.what}
              onDone={(v) => {
                setRenaming(null);
                if (v !== null && v.trim() && v.trim() !== it.what) run({ kind: 'rename', stage, index: i, what: v });
              }}
            />
          ) : (
            <span className="ph-check-words" onDoubleClick={() => canEdit && setRenaming(i)} title={canEdit ? 'Double-click to change the words' : undefined}>
              {it.what}
            </span>
          )}
          {canEdit && renaming !== i && (
            <span className="ph-row-tools">
              <button className="ph-tool" title="Change the words" aria-label="Change the words" onClick={() => setRenaming(i)}>
                <Icon name="pencil" size={12} />
              </button>
              <button className="ph-tool" title="Take it off the checklist" aria-label="Take it off the checklist" onClick={() => run({ kind: 'remove', stage, index: i })}>
                <Icon name="trash" size={12} />
              </button>
            </span>
          )}
        </li>
      ))}
      {canEdit &&
        (adding ? (
          <li className="ph-check-row">
            <span className="ph-box is-ghost" />
            <LineInput
              value=""
              placeholder={`Something to check before leaving ${STAGE_WORDS[stage]}…`}
              onDone={(v) => {
                setAdding(false);
                if (v?.trim()) run({ kind: 'add', stage, what: v });
              }}
            />
          </li>
        ) : (
          <li>
            <button className="ph-add" onClick={() => setAdding(true)}>
              <Icon name="plus" size={11} /> Add a check
            </button>
          </li>
        ))}
    </ul>
  );
}

/** One line of words typed where it is: Enter keeps it, Esc leaves it. */
function LineInput({ value, placeholder, onDone }: { value: string; placeholder?: string; onDone(v: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (out: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(out);
  };
  return (
    <input
      ref={ref}
      className="ph-line-input"
      value={v}
      placeholder={placeholder}
      maxLength={200}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(v);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(v)}
    />
  );
}
