// Settings › AI (20 Nov 2026): the person's own AI connections. A connection is a provider reached with their own key
// (Anthropic, OpenAI, Google Gemini), a model on this PC (Ollama), or any OpenAI-compatible address (LM Studio,
// OpenRouter, Groq, vLLM…). Here they add one, give it its key (kept encrypted on this PC, never shown again), choose
// which of its models to offer (the provider's own list, or typed by hand), test it, choose the model the chat uses,
// and choose what writes recordings and dictation down. Requests go straight from this PC to the provider.

import { useEffect, useMemo, useState } from 'react';
import { usePolicyAllows } from './ManagedNotice';
import type { Prefs } from '../../../shared/prefs';
import type { ModelChoice, ModelConnectionKind, ModelConnectionView, ModelsView, ThinkingLevel } from '../../../shared/types';
import { plural } from '../../../shared/words';
import { errorMessage } from '../lib/errors';
import { setState, showError, useApp } from '../state/store';
import { confirm } from './Dialogs';
import { Icon } from './Icon';
import { Row, Toggle } from './Settings';
import '../styles/ai-settings.css';

export const AI_PRIVACY_LINE = 'Requests go straight from this PC to the provider you choose. Nothing is sent until you add a connection.';

/** The kinds of connection offered under Add connection, in order. */
export const AI_PRESETS: { kind: ModelConnectionKind; name: string; hint: string; baseURL: string; needsKey: boolean; editableURL: boolean; keyHint: string }[] = [
  { kind: 'anthropic', name: 'Anthropic', hint: 'Claude models, with your Anthropic key.', baseURL: 'https://api.anthropic.com', needsKey: true, editableURL: false, keyHint: 'sk-ant-…' },
  { kind: 'openai', name: 'OpenAI', hint: 'OpenAI’s models, with your OpenAI key.', baseURL: 'https://api.openai.com/v1', needsKey: true, editableURL: false, keyHint: 'sk-…' },
  { kind: 'google', name: 'Google Gemini', hint: 'Gemini models, with your Google AI Studio key.', baseURL: 'https://generativelanguage.googleapis.com/v1beta', needsKey: true, editableURL: false, keyHint: 'Your Gemini API key' },
  { kind: 'ollama', name: 'Ollama', hint: 'Models running on this PC. No key needed.', baseURL: 'http://127.0.0.1:11434/v1', needsKey: false, editableURL: true, keyHint: '' },
  { kind: 'custom', name: 'OpenAI-compatible', hint: 'Any OpenAI-compatible address: a local server, OpenRouter, Groq and others.', baseURL: '', needsKey: true, editableURL: true, keyHint: 'The service’s key (leave empty for a local server)' },
];

const LEVEL_NAMES: Record<ThinkingLevel, string> = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const KEY_WORDS: Record<ModelConnectionView['key'], string> = { here: 'Key saved', missing: 'Needs its key', 'not-needed': 'No key needed' };
/** Models that write speech down, offered as you type (any other name can be typed). */
const SPEECH_MODELS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1', 'whisper-large-v3'];

type Said = { ok: boolean; words: string } | null;

function SaidLine({ said }: { said: Said }) {
  if (!said) return null;
  return (
    <p className={`ai-said ${said.ok ? 'is-ok' : 'is-bad'}`} role="status">
      <Icon name={said.ok ? 'check' : 'warning'} size={13} /> {said.words}
    </p>
  );
}

/** One connection: its key, its address where that is the person's to type, its models, and its test. */
function ConnectionCard({ conn, onView }: { conn: ModelConnectionView; onView(v: ModelsView): void }) {
  const [open, setOpen] = useState(conn.key === 'missing' || !conn.models.length);
  const [key, setKey] = useState('');
  const [address, setAddress] = useState(conn.baseURL);
  const [said, setSaid] = useState<Said>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [remote, setRemote] = useState<{ id: string; name: string }[] | null>(null);
  const [filter, setFilter] = useState('');
  const [typed, setTyped] = useState('');
  const [testModel, setTestModel] = useState('');
  const chosen = useMemo(() => new Set(conn.models.map((m) => m.id)), [conn.models]);
  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (err) {
      setSaid({ ok: false, words: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };
  const setModels = (ids: string[]) => act('models', async () => onView(await window.nv.models.updateConnection(conn.id, { models: ids })));
  const fetchModels = () =>
    act('fetch', async () => {
      setSaid(null);
      const list = await window.nv.models.listRemote(conn.id);
      setRemote(list);
      if (!list.length) setSaid({ ok: false, words: `${conn.name} lists no models. Type the model’s name instead.` });
    });
  const test = () =>
    act('test', async () => {
      const model = testModel && chosen.has(testModel) ? testModel : (conn.models[0]?.id ?? '');
      setSaid(null);
      const r = await window.nv.models.test(conn.id, model);
      setSaid({ ok: r.ok, words: r.ok ? `It works. ${r.words}` : r.words });
    });
  // A connection with no models yet asks its provider for the list as it opens (a provider that can't be reached
  // says so, and a model's name can still be typed).
  useEffect(() => {
    if (open && !conn.models.length && conn.key !== 'missing' && remote === null) void fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked once per opening and key state
  }, [open, conn.key]);
  const shown = (remote ?? []).filter((m) => !filter.trim() || `${m.id} ${m.name}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <li className="connection-row ai-conn" data-connection={conn.id}>
      <div className="connection-head">
        <button type="button" className="ai-conn-name" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="chevronDown" size={12} className={open ? 'ai-chev is-open' : 'ai-chev'} /> <strong>{conn.name}</strong>
        </button>
        <span className="hint">{conn.host}</span>
        <span className="hint">{conn.models.length ? plural(conn.models.length, 'model') : 'No models chosen yet'}</span>
        <span className={`key-state key-${conn.key}`}>{KEY_WORDS[conn.key]}</span>
      </div>
      {open && (
        <div className="ai-conn-body">
          {conn.key !== 'not-needed' && (
            <label className="ai-field">
              <span>Key</span>
              <span className="field-row">
                <input type="password" className="setting-input" value={key} autoComplete="off" spellCheck={false} aria-label={`${conn.name} key`} placeholder={conn.key === 'here' ? '•••••••• saved (encrypted on this PC). Paste a new one to replace it.' : `Paste your ${conn.name} key`} onChange={(e) => setKey(e.target.value)} />
                <button className="button primary" disabled={!key.trim() || !!busy} onClick={() => void act('key', async () => { onView(await window.nv.models.setKey(conn.id, key)); setKey(''); setSaid({ ok: true, words: 'Key saved.' }); })}>
                  Save key
                </button>
                {conn.key === 'here' && (
                  <button className="button" disabled={!!busy} onClick={() => void act('key', async () => { onView(await window.nv.models.setKey(conn.id, null)); setSaid({ ok: true, words: 'Key removed.' }); })}>
                    Remove key
                  </button>
                )}
              </span>
            </label>
          )}
          {conn.editableURL && (
            <label className="ai-field">
              <span>Address</span>
              <span className="field-row">
                <input className="setting-input" value={address} spellCheck={false} aria-label={`${conn.name} address`} placeholder="http://127.0.0.1:1234/v1" onChange={(e) => setAddress(e.target.value)} />
                <button className="button" disabled={!address.trim() || address.trim() === conn.baseURL || !!busy} onClick={() => void act('address', async () => { onView(await window.nv.models.updateConnection(conn.id, { baseURL: address })); setRemote(null); setSaid({ ok: true, words: 'Address saved.' }); })}>
                  Save address
                </button>
              </span>
            </label>
          )}
          <div className="ai-field ai-field-models">
            <span>Models</span>
            <div className="ai-models">
              {conn.models.map((m) => (
                <span key={m.id} className="ai-model-chip" title={m.id}>
                  {m.name}
                  <button type="button" aria-label={`Remove ${m.name}`} title="Remove" disabled={!!busy} onClick={() => void setModels(conn.models.filter((x) => x.id !== m.id).map((x) => x.id))}>
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
              {!conn.models.length && <span className="hint">None yet. Fetch {conn.name}’s list, or type a model’s name.</span>}
            </div>
            <span className="field-row">
              <button className="button" disabled={!!busy || conn.key === 'missing'} title={conn.key === 'missing' ? 'Save the key first' : `Ask ${conn.name} which models it has`} onClick={() => void fetchModels()}>
                {busy === 'fetch' ? 'Fetching…' : 'Fetch models'}
              </button>
              <input className="setting-input" value={typed} spellCheck={false} aria-label="A model’s name" placeholder="Or type a model’s name" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && typed.trim() && void setModels([...chosen, typed.trim()]).then(() => setTyped(''))} />
              <button className="button" disabled={!typed.trim() || !!busy} onClick={() => void setModels([...chosen, typed.trim()]).then(() => setTyped(''))}>
                Add
              </button>
            </span>
            {remote && remote.length > 0 && (
              <div className="ai-remote">
                {remote.length > 8 && <input className="setting-input" value={filter} aria-label="Filter the models" placeholder="Filter the models…" onChange={(e) => setFilter(e.target.value)} />}
                <ul className="ai-remote-list" aria-label={`${conn.name}’s models`}>
                  {shown.map((m) => (
                    <li key={m.id}>
                      <label>
                        <input type="checkbox" checked={chosen.has(m.id)} disabled={!!busy} onChange={(e) => void setModels(e.target.checked ? [...chosen, m.id] : [...chosen].filter((id) => id !== m.id))} />
                        <span>{m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}</span>
                      </label>
                    </li>
                  ))}
                  {!shown.length && <li className="hint">Nothing matches.</li>}
                </ul>
              </div>
            )}
          </div>
          <div className="field-row ai-conn-foot">
            {conn.models.length > 1 && (
              <select className="setting-input" value={testModel && chosen.has(testModel) ? testModel : conn.models[0].id} aria-label="Model to test" onChange={(e) => setTestModel(e.target.value)}>
                {conn.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <button className="button" disabled={!!busy || !conn.models.length || conn.key === 'missing'} title={!conn.models.length ? 'Choose a model first' : conn.key === 'missing' ? 'Save the key first' : 'Send one short request'} onClick={() => void test()}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </button>
            <button
              className="button danger-text ai-conn-remove"
              disabled={!!busy}
              onClick={() =>
                void confirm(`Remove ${conn.name}?`, { message: 'Its saved key is removed from this PC too. Your notes are not touched.', ok: 'Remove' }).then((yes) => {
                  if (yes) void act('remove', async () => onView(await window.nv.models.removeConnection(conn.id)));
                })
              }
            >
              Remove connection
            </button>
          </div>
          <SaidLine said={said} />
        </div>
      )}
    </li>
  );
}

/** Add connection: pick the kind, give it its key (or address), and it is added with its models fetched. */
function AddConnection({ onView, first }: { onView(v: ModelsView): void; first: boolean }) {
  const [kind, setKind] = useState<ModelConnectionKind | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>(null);
  // Only the kinds the organisation's or team's policy allows (src/main/policy.ts › assertCanAddConnection).
  const allows = usePolicyAllows();
  const offered = allows.personalKeys ? AI_PRESETS.filter((p) => !allows.providers || allows.providers.includes(p.kind)) : [];
  const preset = AI_PRESETS.find((p) => p.kind === kind) ?? null;
  const pick = (k: ModelConnectionKind) => {
    const p = AI_PRESETS.find((x) => x.kind === k)!;
    setKind(k);
    setName('');
    setAddress(p.baseURL);
    setKey('');
    setSaid(null);
  };
  const add = async () => {
    if (!preset) return;
    setBusy(true);
    setSaid(null);
    try {
      const noAuth = preset.kind === 'ollama' || (preset.kind === 'custom' && !key.trim());
      const { view } = await window.nv.models.addConnection({ kind: preset.kind, ...(name.trim() ? { name: name.trim() } : {}), ...(preset.editableURL ? { baseURL: address.trim() } : {}), ...(preset.kind === 'custom' ? { noAuth } : {}), ...(key.trim() ? { key: key.trim() } : {}) });
      onView(view);
      setKind(null);
    } catch (err) {
      setSaid({ ok: false, words: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-add" data-setting="Add connection">
      {!kind ? (
        <>
          {first && <p className="ai-add-lead">Add an AI connection</p>}
          {!offered.length && <p className="hint">Your organisation’s policy decides the AI connections here, so you can’t add your own.</p>}
          <div className="ai-presets" role="group" aria-label="Add connection">
            {offered.map((p) => (
              <button key={p.kind} type="button" className="ai-preset" onClick={() => pick(p.kind)}>
                <strong>
                  <Icon name="plus" size={12} /> {p.name}
                </strong>
                <span>{p.hint}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        preset && (
          <form
            className="ai-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <p className="ai-add-lead">Add {preset.name}</p>
            <p className="hint">{preset.hint}</p>
            {preset.kind === 'custom' && (
              <label className="ai-field">
                <span>Name</span>
                <input className="setting-input" value={name} placeholder="For example OpenRouter, Groq or My local server" onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            {preset.editableURL && (
              <label className="ai-field">
                <span>Address</span>
                <input className="setting-input" value={address} spellCheck={false} required placeholder="http://127.0.0.1:1234/v1" onChange={(e) => setAddress(e.target.value)} />
              </label>
            )}
            {preset.needsKey && (
              <label className="ai-field">
                <span>Key</span>
                <input type="password" className="setting-input" value={key} autoComplete="off" spellCheck={false} placeholder={preset.keyHint} onChange={(e) => setKey(e.target.value)} />
              </label>
            )}
            {preset.needsKey && <p className="hint">The key is kept encrypted on this PC and is never shown again.</p>}
            <span className="field-row">
              <button type="submit" className="button primary" disabled={busy || (preset.editableURL && !address.trim()) || (preset.needsKey && preset.kind !== 'custom' && !key.trim())}>
                {busy ? 'Adding…' : 'Add connection'}
              </button>
              <button type="button" className="button" disabled={busy} onClick={() => setKind(null)}>
                Cancel
              </button>
            </span>
            <SaidLine said={said} />
          </form>
        )
      )}
    </div>
  );
}

/** Transcription: the connection and model that write recordings and dictation down (OpenAI-compatible speech-to-text). */
function Transcription({ view, onView }: { view: ModelsView; onView(v: ModelsView): void }) {
  // Speech-to-text is the OpenAI-compatible /audio/transcriptions call: OpenAI itself, or any address that speaks it.
  const able = view.connections.filter((c) => c.api === 'openai-completions' || c.api === 'openai-responses');
  const now = view.transcription;
  const [connection, setConnection] = useState(now?.connection ?? '');
  const [model, setModel] = useState(now?.model ?? '');
  const [said, setSaid] = useState<Said>(null);
  useEffect(() => {
    setConnection(now?.connection ?? '');
    setModel(now?.model ?? '');
  }, [now?.connection, now?.model]);
  const save = async (choice: { connection: string; model: string } | null) => {
    try {
      onView(await window.nv.models.setTranscription(choice));
      setSaid({ ok: true, words: choice ? 'Saved. Recordings and dictation are written down through it.' : 'Cleared. Recordings are still saved, just not written down.' });
    } catch (err) {
      setSaid({ ok: false, words: errorMessage(err) });
    }
  };
  const changed = connection !== (now?.connection ?? '') || model.trim() !== (now?.model ?? '');
  return (
    <>
      <h3>Transcription</h3>
      <p className="setting-said">Writes meeting recordings and dictation down. It needs a connection with speech-to-text: OpenAI, or a local Whisper server added as OpenAI-compatible. Without one, recordings are still saved.</p>
      {!able.length ? (
        <p className="hint">Add an OpenAI or OpenAI-compatible connection above to choose it here.</p>
      ) : (
        <Row title="Transcription" hint={now ? undefined : 'None chosen yet.'}>
          <span className="field-row">
            <select className="setting-input" value={connection} aria-label="Transcription connection" onChange={(e) => setConnection(e.target.value)}>
              <option value="">No transcription</option>
              {able.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="setting-input" list="ai-speech-models" value={model} spellCheck={false} aria-label="Transcription model" placeholder="gpt-4o-transcribe" disabled={!connection} onChange={(e) => setModel(e.target.value)} />
            <datalist id="ai-speech-models">
              {SPEECH_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button className="button primary" disabled={!changed || (!!connection && !model.trim())} onClick={() => void save(connection ? { connection, model: model.trim() } : null)}>
              Save
            </button>
          </span>
        </Row>
      )}
      <SaidLine said={said} />
    </>
  );
}

export function AiSettings({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const settings = useApp((s) => s.settings);
  const [view, setView] = useState<ModelsView | null>(null);
  useEffect(() => {
    void window.nv.models.view().then(setView, showError);
    return window.nv.on.modelsChanged(setView);
  }, []);
  if (!settings) return null;
  const choice = settings.model;
  const save = async (model: ModelChoice | null) => {
    try {
      setState({ settings: await window.nv.settings.update({ model }) });
      setView(await window.nv.models.view());
    } catch (err) {
      showError(err);
    }
  };
  // A change here changes whether the assistant is ready: the settings (their ai.ready and its words) are read again.
  const onView = (v: ModelsView) => {
    setView(v);
    void window.nv.settings.get().then((s) => setState({ settings: s }), () => undefined);
  };
  const effective = view?.effective ?? null;
  const conn = view?.connections.find((c) => c.id === effective?.provider);
  const levels = conn?.models.find((m) => m.id === effective?.model)?.levels ?? [];
  const nameOf = (c: ModelChoice | null) => {
    if (!c || !view) return '';
    const cc = view.connections.find((x) => x.id === c.provider);
    return `${cc?.models.find((m) => m.id === c.model)?.name ?? c.model}${cc ? ` (${cc.name})` : ''}`;
  };
  const anyModel = !!view?.connections.some((c) => c.models.length);
  return (
    // Two columns where the card has the room (2.0.1: half the card stood empty at 2560): the connections
    // and adding one at the left, what the model does (chat model, thinking, transcription, the assistant)
    // at the right.
    <div className="ai-settings ai-two">
      <div className="ai-col-main">
      <p className="setting-said ai-privacy">
        <Icon name="lock" size={13} /> {AI_PRIVACY_LINE}
      </p>
      <h3 data-setting="Connections">Connections</h3>
      {!view ? (
        <p className="hint">Reading your connections…</p>
      ) : (
        <>
          {view.connections.length > 0 && (
            <ul className="connection-list">
              {view.connections.map((c) => (
                <ConnectionCard key={c.id} conn={c} onView={onView} />
              ))}
            </ul>
          )}
          <AddConnection onView={onView} first={!view.connections.length} />
        </>
      )}
      </div>
      <div className="ai-col-side">
      {view && (
        <>
          {anyModel && (
            <>
              <h3>Model for chat</h3>
              <Row title="Model for chat" hint={settings.ai.note ?? (settings.ai.modelName ? `Using ${settings.ai.modelName}.` : undefined)}>
                <select
                  className="setting-input"
                  aria-label="Model for chat"
                  value={choice && view.connections.some((c) => c.id === choice.provider && c.models.some((m) => m.id === choice.model)) ? `${choice.provider}\u0000${choice.model}` : ''}
                  onChange={(e) => {
                    const [provider, model] = e.target.value.split('\u0000');
                    void save(e.target.value ? { provider, model } : null);
                  }}
                >
                  <option value="">Recommended{!choice && effective ? `: ${nameOf(effective)}` : ''}</option>
                  {view.connections
                    .filter((c) => c.models.length)
                    .map((c) => (
                      <optgroup key={c.id} label={c.name}>
                        {c.models.map((m) => (
                          <option key={m.id} value={`${c.id}\u0000${m.id}`}>
                            {m.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </Row>
              {choice && levels.length > 0 && (
                <Row title="Thinking">
                  <select className="setting-input" value={choice.reasoning ?? ''} onChange={(e) => void save({ ...choice, ...(e.target.value ? { reasoning: e.target.value as ThinkingLevel } : { reasoning: undefined }) })}>
                    <option value="">The model’s usual</option>
                    {levels.map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_NAMES[l]}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
            </>
          )}
          <Transcription view={view} onView={onView} />
        </>
      )}
      {/* The assistant's edits wait in the note for the person's say (state/suggestions.ts). */}
      <h3>The assistant</h3>
      <Row title="Ask before the assistant changes a note" hint={prefs.askBeforeChanges ? 'Its changes to a note wait in the note, each to keep or discard. New notes it makes are made straight away.' : 'It changes notes straight away; Undo under its answer puts them back.'}>
        <Toggle label="Ask first" value={prefs.askBeforeChanges} onChange={(askBeforeChanges) => set({ askBeforeChanges, askBeforeChangesChosen: true })} />
      </Row>
      </div>
    </div>
  );
}
