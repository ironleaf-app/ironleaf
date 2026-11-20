// The meeting note's Questions (t248, 12 Nov 2026): asked where they happen, beside the meeting's
// Tasks and Decisions, open until answered and never lost. The same backend as the Meetings room
// (add-item, answer-question, question-task, question-decision), the same rows it reads.
import { useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { prompt } from '../components/Dialogs';
import { workCall, workDid } from '../state/workModules';
import { useMeetingModel } from './meeting/useMeetingModel';
import type { MeetingQuestionRec } from '../../../shared/work-meetings';

export function MeetingQuestions({ path, text, canEdit }: { path: string; text: string; canEdit: boolean }) {
  const { ctx, model } = useMeetingModel(path, text);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;
  if (!ctx.meeting) return null;
  if (!model) return null;
  const questions = model.questions;
  const open = questions.filter((q) => !q.answered);
  const add = async () => {
    const t = adding.trim();
    if (!t) return;
    setAdding('');
    await workDid(workCall('meetings', 'add-item', path, 'question', t));
  };
  const answer = async (q: MeetingQuestionRec) => {
    const said = await prompt('Answer it', { message: q.what, placeholder: 'The answer, in plain words', ok: 'Answer' });
    if (!said?.trim()) return;
    await workDid(workCall<string>('meetings', 'answer-question', path, q.line, q.raw, said.trim()));
  };
  const convert = async (q: MeetingQuestionRec, kind: 'task' | 'decision') => {
    if (busy) return;
    setBusy(true);
    try {
      await workDid(workCall<string>('meetings', kind === 'task' ? 'question-task' : 'question-decision', path, q.line, q.raw));
    } finally {
      setBusy(false);
    }
  };
  const sub = (q: MeetingQuestionRec): ReactNode => {
    const bits = [q.askedBy ? `asked by ${q.askedBy}` : '', q.owner ? `for ${q.owner}` : '', q.answer ? `answer: ${q.answer}` : ''].filter(Boolean);
    if (!bits.length) return null;
    return <span className="meta"> · {bits.join(' · ')}</span>;
  };
  return (
    <section className="mt-panel open" aria-label="Questions in this note">
      <div className="mt-head" aria-hidden="true">
        <span className="mt-head-icon">
          <Icon name="help" size={14} />
        </span>
        <span className="mt-head-words">
          <strong>Questions · {questions.length}{open.length > 0 && open.length < questions.length ? `, ${open.length} still open` : open.length === 0 && questions.length > 0 ? ', all answered' : ''}</strong>
        </span>
      </div>
      <div className="mt-body">
        {questions.length ? (
          <ul className="mt-list tklist">
            {questions.map((q) => (
              <li key={`${q.line}:${q.what}`} className="mt-row tkrow">
                <span className={`gtile xs ${q.answered ? 'green' : 'slate'}`} aria-hidden="true" style={{ justifySelf: 'center' }}>
                  <Icon name={q.answered ? 'check' : 'help'} size={12} />
                </span>
                <span className="tkrow-title">
                  <span className="mt-words" title={q.what}>
                    <span className="clip-2">
                      {q.what}
                      {sub(q)}
                    </span>
                  </span>
                </span>
                {canEdit && !q.answered && (
                  <span className="tkrow-line2">
                    <button type="button" className="text-button" onClick={() => void answer(q)}>
                      Answer it
                    </button>
                  </span>
                )}
                {canEdit && q.answered && (
                  <span className="tkrow-line2">
                    <button type="button" className="text-button" title="Make it a task in this meeting (its answer stays on the question)" disabled={busy} onClick={() => void convert(q, 'task')}>
                      Make a task
                    </button>
                    <button type="button" className="text-button" title="Make it a decision in this meeting (its answer stays on the question)" disabled={busy} onClick={() => void convert(q, 'decision')}>
                      Make a decision
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="vsub" style={{ margin: '6px 14px 6px 42px' }}>No questions yet. Ask one here and it stays open until it is answered.</p>
        )}
        {canEdit && (
          <div className="mt-foot">
            <div className="w2b-add" style={{ marginTop: 0, flex: '1 1 100%' }}>
              <Icon name="plus" size={12} />
              <input value={adding} placeholder="Ask a question (“Who signs off the till logs?”)" aria-label="Ask a question" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} onBlur={() => void add()} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
