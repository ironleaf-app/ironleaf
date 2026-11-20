// Settings › Connect an AI (the section itself is ConnectAiSettings.tsx): Claude Code, Claude Desktop, Cursor and VS Code on this PC use the vault through its own
// local MCP server ("ironleaf mcp"): off until switched on, Read only or Read and write. Every change they make
// shows in What agents did, with Undo. Private notes and Secrets are never reachable.
import { useEffect, useState } from 'react';
import type { ActivityView } from '../../../shared/agent-access';
import * as A from '../state/actions';
import { agoWords, refreshAgents, useAgents, useNow } from '../state/agents';
import { closeModal } from '../state/modals';
import { showError, toast } from '../state/store';
import { ConnectAiSettings, Section } from './ConnectAiSettings';
import { Icon } from './Icon';

function ActivityRow({ entry, now }: { entry: ActivityView; now: number }) {
  const [busy, setBusy] = useState(false);
  const target = entry.project ? { path: entry.project.path, label: entry.project.name } : entry.note ? { path: entry.note, label: A.titleOf(entry.note) } : null;
  return (
    <li className={`ag-act outcome-${entry.outcome}${entry.undone ? ' is-undone' : ''}`}>
      <div className="ag-act-main">
        <div className="ag-act-words">{entry.words}</div>
        <div className="ag-act-meta">
          <span>{entry.agentName}</span>
          {target && (
            <>
              <span className="ag-dot">·</span>
              <button
                className="ag-act-link"
                onClick={() => {
                  closeModal();
                  A.openPath(target.path);
                }}
              >
                {target.label}
              </button>
            </>
          )}
          <span className="ag-dot">·</span>
          <span title={new Date(entry.at).toLocaleString('en-AU')}>{agoWords(entry.at, now)}</span>
        </div>
      </div>
      {entry.undone ? (
        <span className="ag-act-state">Undone</span>
      ) : entry.outcome === 'denied' || entry.outcome === 'expired' ? (
        <span className="ag-act-state refused">Refused</span>
      ) : entry.canUndo ? (
        <button
          className="button ag-undo"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              toast(await window.nv.agents.undo(entry.id));
            } catch (err) {
              showError(err);
            } finally {
              setBusy(false);
              void refreshAgents();
            }
          }}
        >
          <Icon name="undo" size={13} /> Undo
        </button>
      ) : null}
    </li>
  );
}

export function AgentsSettings() {
  const state = useAgents();
  const now = useNow(30000);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    void refreshAgents();
  }, []);
  if (!state) return <p className="hint">Reading your settings…</p>;
  const activity = showAll ? state.activity : state.activity.slice(0, 8);
  return (
    <div className="ag-page">
      <ConnectAiSettings state={state} />
      {(state.localMcp.on || state.activity.length > 0) && (
        <Section title="What agents did">
          {state.activity.length ? (
            <>
              <ul className="ag-activity">
                {activity.map((e) => (
                  <ActivityRow key={e.id} entry={e} now={now} />
                ))}
              </ul>
              {state.activity.length > activity.length && (
                <button className="text-button ag-more" onClick={() => setShowAll(true)}>
                  Show all {state.activity.length}
                </button>
              )}
            </>
          ) : (
            <p className="ag-quiet">Nothing yet. Every change another AI app makes shows here, newest first, with Undo.</p>
          )}
        </Section>
      )}
    </div>
  );
}
