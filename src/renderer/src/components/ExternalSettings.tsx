// Settings › Files and links › Links from other apps and the command line (21 Oct 2026, gap G26): which ironleaf://
// links may change notes without asking first (none, unless the person says so), where the ironleaf command is, and
// Markdown files opened from outside the vault. src/main/external.ts keeps the rules.

import { useEffect, useState } from 'react';
import { URI_WRITES } from '../../../shared/uri';
import { showError } from '../state/store';
import { Row, Toggle } from './Settings';

type State = Awaited<ReturnType<typeof window.nv.external.state>>;

export function ExternalSettings() {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    void window.nv.external.state().then(setState).catch(() => {});
  }, []);
  if (!state) return null;
  const allowed = new Set<string>(state.allow);
  const setAllowed = (kind: string, on: boolean) => {
    const next = URI_WRITES.map((w) => w.kind).filter((k) => (k === kind ? on : allowed.has(k)));
    void window.nv.external.allow(next).then(setState).catch(showError);
  };
  return (
    <>
      <h3>Links from other apps and the command line</h3>
      <Row
        title="Links that change notes"
        hint="A ironleaf:// link can open a note or search without asking. A link that would make a note or add to one always asks first, unless you allow that kind here."
        stacked
      >
        <div className="external-allow">
          {URI_WRITES.map((w) => (
            <label key={w.kind} className="external-allow-row">
              <Toggle label={`${w.label} without asking`} value={allowed.has(w.kind)} onChange={(on) => setAllowed(w.kind, on)} />
              <span>
                <span className="external-allow-label">{w.label} without asking</span>
                <code className="external-allow-code">{w.words}</code>
              </span>
            </label>
          ))}
        </div>
      </Row>
      <Row
        title="The ironleaf command"
        hint={
          state.cli
            ? `Type ironleaf help in a terminal to see what it does.${state.pathAdded ? ' Open a new terminal first: one already open doesn’t know it yet.' : ''}`
            : state.windows
              ? 'It is set up when Ironleaf is installed (not in a development copy).'
              : 'It is set up on Windows.'
        }
      >
        {state.cli ? <code className="external-cli">{state.cli}</code> : <span className="setting-hint">Not set up on this PC</span>}
      </Row>
      <Row title="Markdown files from outside your notes" hint="Open with › Ironleaf in File Explorer, drag a .md file onto the window, or Open a Markdown file from this PC (Ctrl+Shift+O). It is saved where it is.">
        <span className="setting-hint">{state.registered ? 'Ready in File Explorer' : state.windows ? 'Set up when Ironleaf is installed' : 'Drag a file onto the window'}</span>
      </Row>
    </>
  );
}
