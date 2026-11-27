import { meetingTaskLine } from '../../../../shared/tasks';
import { useRef, useState } from 'react';
import { workCall } from '../../state/workModules';
import { moduleChanged } from '../../state/modules';
import { showError } from '../../state/store';

export function MeetingCapture({ path }: { path: string }) {
  const [kind, setKind] = useState('decision');
  const [words, setWords] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function save() {
    if (!words.trim() || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const line = kind === 'action' ? meetingTaskLine({ what: words, who: owner, due }).replace(/^- \[ \] /, '') : words;
      await workCall('meetings', 'add-item', path, kind, line);
      setWords(''); setOwner(''); setDue('');
      setSaved(kind === 'question' ? 'Question saved.' : kind === 'decision' ? 'Decision saved.' : 'Task saved.');
      moduleChanged();
    } catch (e) { showError(e); } finally { lock.current = false; setBusy(false); }
  }
  return <form className="meeting-capture" aria-label="Capture a meeting item" onSubmit={e => { e.preventDefault(); void save(); }}>
    <fieldset disabled={busy} className="meeting-review-fields">
      <label>Capture<select value={kind} onChange={e => { setKind(e.target.value); setSaved(''); }}>
        <option value="decision">Decision</option><option value="question">Question</option><option value="action">Task</option>
      </select></label>
      <label>What was agreed or asked<input required value={words} onChange={e => setWords(e.target.value)} /></label>
      {kind === 'action' && <><label>Owner<input value={owner} onChange={e => setOwner(e.target.value)} /></label><label>Due<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label></>}
      <button type="submit" className="button small" disabled={!words.trim()}>Save item</button>
    </fieldset>
    <span role="status">{saved}</span>
  </form>;
}
