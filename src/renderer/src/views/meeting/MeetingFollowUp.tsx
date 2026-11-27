import { useMemo, useRef, useState } from 'react';
import { readMinutesExisting } from '../../../../shared/meeting-minutes';
import { useNoteText } from '../MeetingPlayback';
import { followUpDraft, type MeetingRec } from '../../../../shared/work-meetings';
import type { DeliveryRow } from '../../../../main/work/meeting-follow-up';
import { moduleOn } from '../../../../shared/life-modules';
import { useModules, moduleChanged } from '../../state/modules';
import { workCall, useWork } from '../../state/workModules';
import { showError } from '../../state/store';
import * as A from '../../state/actions';

function Review({ meeting }: { meeting: MeetingRec }) {
  const initial = followUpDraft(meeting);
  const note = useNoteText(meeting.path);
  const minutes = useMemo(() => {
    const saved = readMinutesExisting(note ?? '');
    return [saved.summary, ...(saved.topics ?? []).map(t => [t.heading, ...t.words].join('\n'))].filter(Boolean).join('\n\n');
  }, [note]);
  const [words, setWords] = useState(initial.text);
  const [subject, setSubject] = useState(initial.subject);
  const [audience, setAudience] = useState('');
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [weeklyPath, setWeeklyPath] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const weekly = moduleOn(useModules(), 'weekly');
  const { data: mail } = useWork<boolean>('meetings', 'can-send-follow-up');
  const addresses = [...new Set(audience.split(/[,;\s]+/).filter(Boolean).map(a => a.toLowerCase()))];
  async function run(action: 'weekly' | 'draft' | 'send') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (action === 'weekly') {
        const r = await workCall<{ path: string; added: boolean }>('weekly', 'meeting-review', meeting.path, words);
        setWeeklyPath(r.path);
        setMessage(r.added ? 'Added to this week’s draft.' : 'Already added. Your weekly edits are saved.');
      } else {
        const result = await workCall<DeliveryRow[]>('meetings', 'deliver-follow-up', meeting.path, addresses, subject, words, action);
        setRows(result);
      }
      moduleChanged();
    } catch (e) { showError(e); } finally { lock.current = false; setBusy(false); }
  }
  return <fieldset className="meeting-review-fields meeting-review-layout" disabled={busy}>
    <div className="meeting-review-column">
    {minutes && !words.includes(minutes) && <button type="button" className="text-button" onClick={() => { setWords(current => current + '\n\n' + minutes); setRows([]); }}>Include summary and discussion</button>}
    <label>Reviewed contents<textarea rows={7} maxLength={60000} value={words} onChange={e => { setWords(e.target.value); setRows([]); }} /></label>
    {weekly && <div className="w2b-prep-btns">
      <button type="button" className="button small" disabled={!words.trim()} onClick={() => void run('weekly')}>Add to this week’s draft</button>
      {weeklyPath && <button type="button" className="text-button" onClick={() => A.openPath(weeklyPath)}>Open weekly update</button>}
    </div>}
    </div>
    <div className="meeting-review-column">
    <label>Subject<input value={subject} maxLength={200} onChange={e => { setSubject(e.target.value); setRows([]); }} /></label>
    <label>Recipients<input type="text" placeholder="Email addresses, separated by commas" value={audience} onChange={e => { setAudience(e.target.value); setRows([]); }} /></label>
    <div className="w2b-prep-btns">
      <button type="button" className="button small" disabled={!addresses.length || !words.trim() || !subject.trim()} onClick={() => void run('draft')}>Save email drafts{addresses.length ? ' (' + addresses.length + ')' : ''}</button>
      {mail && <button type="button" className="button small" disabled={!addresses.length || !words.trim() || !subject.trim()} onClick={() => void run('send')}>Send individually to {addresses.length}</button>}
    </div>
    </div>
    <div role="status">{message}{rows.length > 0 && <ul>{rows.map(r => <li key={r.address}>{r.address} · {r.status}{r.detail ? ' · ' + r.detail : ''}</li>)}</ul>}</div>
  </fieldset>;
}

export function MeetingFollowUp({ meeting }: { meeting: MeetingRec }) {
  const [opened, setOpened] = useState(false);
  return <details className="card w2b-card meeting-follow-up" onToggle={e => { if (e.currentTarget.open) setOpened(true); }}>
    <summary>Review and share follow-up</summary>
    {opened && <Review meeting={meeting} />}
  </details>;
}
