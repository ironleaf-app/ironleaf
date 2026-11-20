// The meeting note's Decisions (t248, 12 Nov 2026): beside its Tasks and Questions, the same rows
// the Meetings room reads, logged in one wording ("Log decision", as the project page says it).
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { workCall, workDid } from '../state/workModules';
import { useMeetingModel } from './meeting/useMeetingModel';

export function MeetingDecisions({ path, text, canEdit }: { path: string; text: string; canEdit: boolean }) {
  const { ctx, model } = useMeetingModel(path, text);
  const [adding, setAdding] = useState('');
  if (!ctx) return null;
  if (!ctx.meeting) return null;
  if (!model) return null;
  const decisions = model.decisions;
  const add = async () => {
    const t = adding.trim();
    if (!t) return;
    setAdding('');
    await workDid(workCall('meetings', 'add-item', path, 'decision', t));
  };
  return (
    <section className="mt-panel open" aria-label="Decisions in this note">
      <div className="mt-head" aria-hidden="true">
        <span className="mt-head-icon">
          <Icon name="check" size={14} />
        </span>
        <span className="mt-head-words">
          <strong>Decisions · {decisions.length}</strong>
        </span>
      </div>
      <div className="mt-body">
        {decisions.length ? (
          <div style={{ padding: '6px 14px 6px 12px' }}>
            {decisions.map((x) => (
              <div key={`${x.line}:${x.text}`} className="drow">
                <span className="check done" aria-hidden="true">✓</span>
                <span style={{ minWidth: 0, overflowWrap: 'break-word' }}>{x.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="vsub" style={{ margin: '6px 14px 6px 42px' }}>No decisions yet. They land here as you make them.</p>
        )}
        {canEdit && (
          <div className="mt-foot">
            <div className="w2b-add" style={{ marginTop: 0, flex: '1 1 100%' }}>
              <Icon name="plus" size={12} />
              <input value={adding} placeholder="Log decision" aria-label="Log decision" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} onBlur={() => void add()} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
