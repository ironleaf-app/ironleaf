// Starting a publication (Publications, Wave 6 part a): its name, masthead, motto and schedule, with four sections to
// begin with (each changed in Settings afterwards).

import { useContext, useState } from 'react';
import { ModuleFills } from '../../../state/moduleFills';
import { readSchedule, scheduleWords, TEMPLATES } from '../../../../../shared/publications';
import { Icon } from '../../../components/Icon';
import { useApp } from '../../../state/store';
import { act } from './usePub';

export function StartPublication({ first, onDone, onCancel }: { first?: boolean; onDone(rel: string): void; onCancel?(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const fills = useContext(ModuleFills)?.fills ?? '';
  const [title, setTitle] = useState('');
  const [masthead, setMasthead] = useState('');
  const [motto, setMotto] = useState('');
  const [schedule, setSchedule] = useState('Sat 08:00');
  const [template, setTemplate] = useState('broadsheet');
  const [busy, setBusy] = useState(false);
  const s = readSchedule(schedule);
  const submit = async () => {
    setBusy(true);
    const rel = await act(() => window.nv.pub.create({ title, masthead: masthead || title, motto, schedule, template }), `Started ${title}.`);
    setBusy(false);
    if (rel) onDone(rel);
  };
  return (
    <form
      className={`pb-start${first ? ' is-first' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && !busy) void submit();
      }}
    >
      <header className="pb-start-head">
        <span className="pb-mark is-big" aria-hidden="true">
          <Icon name="newspaper" size={22} />
        </span>
        <div>
          <h2>{first ? 'Start your first publication' : 'Start a publication'}</h2>
          <p>A newsletter or paper for the household: you choose its sections and where their pieces may come from, and each edition is laid out on real pages before it is printed or sent.</p>
          {first && fills && (
            <p>
              <b>Fills itself.</b> {fills}
            </p>
          )}
        </div>
      </header>
      <div className="pb-grid2">
        <label className="pb-field">
          <span>Name</span>
          {/* No autoFocus (6 Nov 2026, the rest-of-Vault audit): a fresh open starts at the top with focus steady —
              the old autofocus jumped into this field and rang it red before a word was typed. */}
          <input className="pb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Harbour Gazette" required />
        </label>
        <label className="pb-field">
          <span>Masthead (as printed)</span>
          <input className="pb-input" value={masthead} onChange={(e) => setMasthead(e.target.value)} placeholder={title || 'The Harbour Gazette'} />
        </label>
        <label className="pb-field is-wide">
          <span>Motto</span>
          <input className="pb-input" value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="News from our house to yours" />
        </label>
        <label className="pb-field">
          <span>When it comes out</span>
          <input className="pb-input" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="Mon, Fri 07:00" />
          <em className={s || !schedule ? 'pb-hint' : 'pb-hint is-bad'}>{schedule ? (s ? scheduleWords(s) : 'Write days and a time, like “Mon, Fri 07:00”.') : 'No schedule: you send it when you choose.'}</em>
        </label>
        <label className="pb-field">
          <span>Layout</span>
          <select className="pb-input" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <em className="pb-hint">{TEMPLATES.find((t) => t.id === template)?.words}</em>
        </label>
      </div>
      <p className="pb-faint">It starts with Front, News, Sport and Puzzles; change them, their page budgets, sources and rules in Settings.</p>
      <div className="pb-actions">
        {onCancel && (
          <button type="button" className="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="button primary" disabled={!canEdit || busy || !title.trim()}>
          Start it
        </button>
      </div>
    </form>
  );
}
