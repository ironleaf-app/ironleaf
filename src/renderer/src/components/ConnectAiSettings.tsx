// Settings › Connect an AI (20 Nov 2026, standalone): any AI app that speaks MCP uses the notes through Ironleaf
// itself. One switch (off until turned on), Read only or Read and write, the local URL with its token for apps that
// connect by URL, and the exact set-up to paste into Claude Desktop, Claude Code, Cursor, VS Code, ChatGPT desktop
// and any other MCP app. The server is src/main/mcp-local.ts (stdio: "ironleaf mcp") and src/main/mcp-http.ts
// (Streamable HTTP on 127.0.0.1); every call goes through src/main/agent-access.ts asLocalMcp. docs/MCP.md has the
// tools and the set-up in full.

import { useEffect, useState, type ReactNode } from 'react';
import type { AgentsState, LocalMcpLevel } from '../../../shared/agent-access';
import { MCP_HTTP_PORT, MCP_SETUP_APPS, mcpClaudeCodeCommand, mcpSetupJson } from '../../../shared/mcp-local';
import { setAgentsState } from '../state/agents';
import { showError } from '../state/store';
import { confirm } from './Dialogs';
import { Icon } from './Icon';
import { Row, Segmented, Toggle } from './Settings';
import { usePolicyAllows } from './ManagedNotice';

/** Copies text, saying so on the button for a moment. */
export function CopyButton({ text, label = 'Copy', primary }: { text: string; label?: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`button${primary ? ' primary' : ''} ag-copy`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          },
          (err) => showError(err),
        );
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} /> {done ? 'Copied' : label}
    </button>
  );
}

export function CodeBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="ag-code">
      <pre aria-label={label}>{text}</pre>
      <CopyButton text={text} />
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ag-section${className ? ` ${className}` : ''}`}>
      <div className="ag-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The Connect an AI section: the switch, what AI apps may do, the local URL, and each app’s set-up. */
export function ConnectAiSettings({ state, children }: { state: AgentsState; children?: ReactNode }) {
  const [cli, setCli] = useState<{ cli: string | null; windows: boolean } | undefined>(undefined);
  const mcp = state.localMcp;
  // Where the command is, read when the page opens and again when switched on (the command may be written after the
  // page first opened, which then still showed "not set up").
  useEffect(() => {
    void window.nv.external
      .state()
      .then((s) => setCli({ cli: s.cli ?? null, windows: s.windows }))
      .catch(() => setCli({ cli: null, windows: true }));
  }, []);
  useEffect(() => {
    if (!mcp.on) return;
    void window.nv.external
      .state()
      .then((s) => setCli({ cli: s.cli ?? null, windows: s.windows }))
      .catch(() => {});
  }, [mcp.on]);
  const save = async (patch: { on?: boolean; level?: LocalMcpLevel; http?: boolean; port?: number }) => {
    try {
      setAgentsState(await window.nv.agents.localMcp(patch));
    } catch (err) {
      showError(err);
    }
  };
  const newToken = async () => {
    if (!(await confirm('Make a new token?', { message: 'Every AI app given the old token stops reaching your notes until you paste the new one.', ok: 'Make a new token' }))) return;
    try {
      setAgentsState(await window.nv.agents.localMcpToken());
    } catch (err) {
      showError(err);
    }
  };
  const http = state.localMcpHttp;
  const httpSetup = mcp.http && http?.on ? { url: http.url, token: http.token } : null;
  // The program the apps run with the word mcp: the Windows ironleaf command, else this app's own program.
  const command = cli?.cli ?? state.localMcpCommand ?? null;
  const [portText, setPortText] = useState(String(mcp.port ?? MCP_HTTP_PORT));
  // A policy that allows reading only never offers Read and write (src/main/policy.ts › localMcpUnderPolicy).
  const allows = usePolicyAllows();
  const cliWords = !cli?.windows
    ? 'The set-up lines appear here when Ironleaf runs from its installed program (the AppImage on Linux).'
    : 'The ironleaf command is not set up on this PC yet (it is set up when Ironleaf is installed). The set-up lines appear here once it is.';
  return (
    <Section title="Connect an AI">
      {/* Two columns where the card has the room (2.0.1): the switches at the left, each app's set-up beside them. */}
      <div className={`ai-settings${mcp.on ? ' ai-two' : ''}`}>
      <div className="ai-col-main">
      <p className="ag-lead">Any AI app that speaks MCP (Claude Desktop, Claude Code, ChatGPT, Cursor, VS Code and others) can use your notes through Ironleaf: search, read, follow links, and (when you allow it) write notes, tasks, projects, canvases and more. Nothing leaves this PC except what those apps send to their own services. Private notes and Secrets are never reachable.</p>
      <Row title="Connect an AI" hint={mcp.on ? 'On: AI apps you set up can use your notes as far as you allow. Every change shows in What agents did, with Undo.' : 'Off: no AI app can use your notes this way. Switch on, then paste the set-up into each app.'}>
        <Toggle label="Connect an AI" value={mcp.on} onChange={(on) => void save({ on })} />
      </Row>
      {mcp.on && (
        <Row title="What they may do" hint={mcp.level === 'edit' ? 'Read and write: everything Read only does, plus make, change, move and rename notes (deleting goes to the Bin), tasks, projects, templates, canvases, properties and records. Every change can be undone.' : 'Read only: search, read and list. Nothing changes.'}>
          <Segmented<LocalMcpLevel> value={mcp.level} options={allows.mcpWrite ? [{ id: 'read', label: 'Read only' }, { id: 'edit', label: 'Read and write' }] : [{ id: 'read', label: 'Read only' }]} onChange={(level) => void save({ level })} />
        </Row>
      )}
      {mcp.on && (
        <Row title="Local URL" hint={mcp.http ? (http?.problem ?? (http?.on ? `Listening at ${http.url} on this PC only, with the token below.` : 'Starting…')) : 'For apps that connect by URL (Streamable HTTP) instead of running a command. Only this PC can reach it, and only with the token.'}>
          <Toggle label="Local URL" value={!!mcp.http} onChange={(on) => void save({ http: on })} />
        </Row>
      )}
      {mcp.on && mcp.http && (
        <Row title="Port" hint="47731 unless another program needs it.">
          <input
            className="ag-port"
            inputMode="numeric"
            value={portText}
            aria-label="Port"
            onChange={(e) => setPortText(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            onBlur={() => {
              const port = Number(portText);
              if (port >= 1024 && port <= 65535 && port !== (mcp.port ?? MCP_HTTP_PORT)) void save({ port });
              else setPortText(String(mcp.port ?? MCP_HTTP_PORT));
            }}
          />
        </Row>
      )}
      {mcp.on && mcp.http && http && (
        <div className="ag-setup-body">
          <p className="ag-step">
            <strong>Address</strong>: {http.url}
          </p>
          <CodeBlock text={`Authorization: Bearer ${http.token}`} label="Token header" />
          <button type="button" className="btn" onClick={() => void newToken()}>
            Make a new token
          </button>
        </div>
      )}
      {children}
      </div>
      <div className="ai-col-side">
      {mcp.on &&
        (cli === undefined ? (
          <p className="hint">Reading where the ironleaf command is…</p>
        ) : command === null && !httpSetup ? (
          <p className="notice">{cliWords}</p>
        ) : (
          MCP_SETUP_APPS.map((app) => {
            const viaUrl = app.id === 'claude-desktop' ? null : httpSetup;
            if (!command && !viaUrl) return null;
            return (
              <div key={app.id} className="ag-setup-body">
                <p className="ag-step">
                  <strong>{app.name}</strong>: {app.words}
                </p>
                {app.id === 'claude-code' && <CodeBlock text={mcpClaudeCodeCommand(command ?? '', viaUrl)} label="Claude Code command" />}
                <CodeBlock text={mcpSetupJson(app.id, command ?? '', viaUrl)} label={`${app.name} set-up`} />
              </div>
            );
          })
        ))}
      </div>
      </div>
    </Section>
  );
}
