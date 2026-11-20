// Settings › Quick capture › Capture to… (21 Oct 2026, gap G27; src/shared/capture-flows.ts): the flows Ctrl+Shift+J
// offers, each a place a line goes with the time — a project's log, the Inbox, today's note or a note — with its own
// keys if wanted.

import { useEffect, useState } from 'react';
import { DEFAULT_HEADING, MAX_FLOWS, TARGET_WORDS, type CaptureFlow, type FlowTarget } from '../../../shared/capture-flows';
import type { Prefs } from '../../../shared/prefs';
import { comboFromEvent, formatHotkey } from '../lib/hotkeys';
import { uniqueId } from '../lib/ids';
import * as A from '../state/actions';
import { CAPTURE_COMMANDS } from '../state/captureFlows';
import { typeOfPath } from '../state/noteTypes';
import { useApp } from '../state/store';
import { Icon } from './Icon';
import { pickFile } from './Pickers';
import { Row } from './Settings';

/** A field kept as it is typed and saved when left (Enter too), so Settings isn't written on every key. */
function Draft({ value, label, className, onSave }: { value: string; label: string; className: string; onSave(v: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className={`setting-input ${className}`} aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

function FlowKeys({ index, prefs, set }: { index: number; prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const id = `capture-flow-${index + 1}`;
  const [recording, setRecording] = useState(false);
  const keys = prefs.hotkeys[id];
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(false);
      const combo = comboFromEvent(e);
      if (!combo) return;
      setRecording(false);
      set({ hotkeys: { ...prefs.hotkeys, [id]: combo } });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, prefs.hotkeys, id, set]);
  return (
    <span className="cf-keys">
      {recording ? (
        <span className="keys-recording">Press the keys… (Esc to stop)</span>
      ) : (
        <button className="keys-combo" title={keys ? 'Change its keys' : 'Give it keys'} onClick={() => setRecording(true)}>
          {keys ? <kbd>{formatHotkey(keys)}</kbd> : <span className="cf-nokeys">Add keys</span>}
        </button>
      )}
      {keys && !recording && (
        <button
          className="icon-button small"
          title="No keys"
          aria-label="Take its keys off"
          onClick={() => {
            const next = { ...prefs.hotkeys };
            delete next[id];
            set({ hotkeys: next });
          }}
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

export function CaptureFlowsSettings({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const notes = useApp((s) => s.notes);
  const flows = prefs.captureFlows;
  // Every project, however typed (9.2 uplift F130): the shared reading counts a project by its folder too.
  const projects = notes.filter((n) => typeOfPath(n.path)?.id === 'project').sort((a, b) => (a.label || a.title).localeCompare(b.label || b.title));
  const save = (next: CaptureFlow[]) => set({ captureFlows: next });
  const change = (i: number, patch: Partial<CaptureFlow>) => save(flows.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  const chooseNote = async (i: number) => {
    const path = await pickFile('Capture into which note?', notes.map((n) => n.path), A.titleOf);
    if (path) change(i, { target: 'note', note: path, heading: flows[i].target === 'note' ? flows[i].heading : DEFAULT_HEADING.note });
  };
  const capture = CAPTURE_COMMANDS[0];
  return (
    <>
      <h3>Capture to…</h3>
      <Row
        title="Capture flows"
        hint={
          <>
            Press <kbd>{formatHotkey(prefs.hotkeys[capture.id] || capture.hotkey || '')}</kbd> inside Ironleaf to add a line to one of these with the time, without opening the note. Give a flow its own keys to go straight to it.
          </>
        }
        stacked
      >
        <div className="cf-wrap">
          <ul className="cf-list">
            {flows.map((f, i) => (
              <li key={f.id} className="cf-flow">
                <div className="cf-line">
                  <Draft className="cf-name" label="Its name" value={f.name} onSave={(name) => change(i, { name: name.trim() || TARGET_WORDS[f.target] })} />
                  <select
                    aria-label="Where it goes"
                    value={f.target}
                    onChange={(e) => {
                      const target = e.target.value as FlowTarget;
                      if (target === 'note') return void chooseNote(i);
                      change(i, { target, heading: DEFAULT_HEADING[target], ...(target === 'project-log' ? { project: '' } : {}) });
                    }}
                  >
                    {(Object.keys(TARGET_WORDS) as FlowTarget[]).map((t) => (
                      <option key={t} value={t}>
                        {TARGET_WORDS[t]}
                      </option>
                    ))}
                  </select>
                  {f.target === 'project-log' && (
                    <select aria-label="Which project" value={f.project ?? ''} onChange={(e) => change(i, { project: e.target.value })}>
                      <option value="">Ask each time</option>
                      {projects.map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.label || p.title}
                        </option>
                      ))}
                    </select>
                  )}
                  {f.target === 'note' && (
                    <button className="button cf-note" title={f.note} onClick={() => void chooseNote(i)}>
                      <Icon name="notes" size={13} />
                      {A.titleOf(f.note ?? '')}
                    </button>
                  )}
                  <button className="icon-button small cf-remove" title="Remove this flow" aria-label={`Remove ${f.name}`} onClick={() => save(flows.filter((_, n) => n !== i))}>
                    <Icon name="trash" size={13} />
                  </button>
                </div>
                <div className="cf-line cf-more">
                  <label>
                    Under the heading
                    <Draft className="cf-heading" label="The heading its lines go under" value={f.heading} onSave={(heading) => change(i, { heading: heading.trim() || DEFAULT_HEADING[f.target] })} />
                  </label>
                  <select aria-label="With the" value={f.stamp} onChange={(e) => change(i, { stamp: e.target.value as CaptureFlow['stamp'] })}>
                    <option value="date-time">With the date and time</option>
                    <option value="time">With the time</option>
                  </select>
                  <select aria-label="As" value={f.kind} onChange={(e) => change(i, { kind: e.target.value as CaptureFlow['kind'] })}>
                    <option value="line">As a line</option>
                    <option value="task">As a task</option>
                  </select>
                  <FlowKeys index={i} prefs={prefs} set={set} />
                </div>
              </li>
            ))}
          </ul>
          <button
            className="button cf-add"
            disabled={flows.length >= MAX_FLOWS}
            title={flows.length >= MAX_FLOWS ? `Up to ${MAX_FLOWS} flows` : undefined}
            onClick={() => save([...flows, { id: uniqueId('flow'), name: 'Inbox', target: 'inbox', heading: DEFAULT_HEADING.inbox, stamp: 'date-time', kind: 'line' }])}
          >
            <Icon name="plus" size={13} /> Add a flow
          </button>
        </div>
      </Row>
    </>
  );
}
