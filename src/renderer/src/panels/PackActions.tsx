import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { LIFE_MODULES, moduleOn, partOn, resolveModule } from '../../../shared/life-modules';
import '../../../shared/life-tools';
import { MODULE_TOOLS, partForTool } from '../../../shared/module-tools';
import { levelLabel } from '../../../shared/sensitivity';
import type { ChatResult, PackActionDraft } from '../../../shared/types';
import { moduleChanged, setModule, useModules } from '../state/modules';
import type { PackActionsRequest } from '../state/chat';
import { openPath } from '../state/actions';
import { loadNotes, useApp } from '../state/store';

interface Field { type?: string; description?: string; enum?: string[]; items?: { type?: string } }

export default function PackActions({ root, draft, request }: { root: string; draft?: PackActionDraft; request?: PackActionsRequest }) {
  const requested = draft && MODULE_TOOLS.find(t => t.name === draft.name);
  const [submitted, setSubmitted] = useState(false);
  const switches = useModules();
  const canEdit = useApp(s => s.canEdit);
  const [pack, setPack] = useState(() => (requested && resolveModule(requested.module)) ?? request?.pack ?? LIFE_MODULES.find(p => moduleOn(switches, p.id))?.id ?? 'meetings');
  const [action, setAction] = useState(requested?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!requested || !draft) return {};
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft.args)) {
      if (!Object.hasOwn(requested.input, key) || (requested.name === 'finance_csv_import' && key === 'file') || value == null) continue;
      const field = requested.input[key] as Field;
      fields[key] = Array.isArray(value) && field.items?.type === 'string' ? value.join('\n') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    return fields;
  });
  const [history, setHistory] = useState<{ title: string; result: ChatResult }[]>([]);
  const [preview, setPreview] = useState<import('../../../shared/note-passage').NotePage | null>(null);
  async function previewSource(path: string, page = 1) {
    try { setPreview(await window.nv.ai.packPreview(root, path, page)); }
    catch (e) { setPreview(null); setError(errorMessage(e)); }
  }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const actions = MODULE_TOOLS.filter(t => resolveModule(t.module) === pack);
  const tool = actions.find(t => t.name === action) ?? actions[0];
  const info = LIFE_MODULES.find(p => p.id === pack)!;
  const part = tool && partForTool(tool.name);
  const enabled = moduleOn(switches, pack);
  const partEnabled = !part || partOn(switches, pack, part);
  const packPicker = useRef<HTMLSelectElement>(null);
  const handled = useRef<PackActionsRequest | undefined>(undefined);
  useEffect(() => {
    if (draft || busy || !request || handled.current === request) return;
    handled.current = request;
    if (request.pack !== pack) {
      setPack(request.pack);
      setAction('');
      setValues({});
      setError('');
      setPreview(null);
    }
    packPicker.current?.focus({ preventScroll: true });
  }, [busy, draft, pack, request]);
  function reset(name: string) {
    setAction(name); setValues({}); setError(''); setPreview(null);
  }
  async function execute() {
    if (!tool || lock.current || submitted) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const args: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        if (!value.trim()) continue;
        const field = tool.input[key] as Field;
        if (field.type === 'array') args[key] = field.items?.type === 'string' ? value.split(/\r?\n/).map(v => v.trim()).filter(Boolean) : JSON.parse(value);
        else if (field.type === 'object') args[key] = JSON.parse(value);
        else if (field.type === 'boolean') args[key] = value === 'true';
        else if (field.type === 'integer' || field.type === 'number') args[key] = Number(value);
        else args[key] = value;
      }
      const result = await window.nv.ai.packAction(root, tool.name, args);
      if (draft) setSubmitted(true);
      setHistory(prev => [{ title: tool.title, result }, ...prev].slice(0, 8));
      moduleChanged(); void loadNotes();
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function undo(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const text = await window.nv.ai.undoPackAction(id);
      setHistory(prev => prev.map(row => row.result.changes?.turnId === id ? { ...row, result: { text, sources: [] } } : row));
      moduleChanged(); void loadNotes();
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="chat-pack-actions">
    <form aria-label="Pack actions" onSubmit={e => { e.preventDefault(); void execute(); }}>
      <fieldset disabled={busy || submitted}>
        <label>Pack<select ref={packPicker} disabled={!!draft} value={pack} onChange={e => { setPack(e.target.value); reset(''); }}>{LIFE_MODULES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Action<select disabled={!!draft} value={tool?.name ?? ''} onChange={e => reset(e.target.value)}>{actions.map(t => <option key={t.name} value={t.name}>{t.title}</option>)}</select></label>
        {tool && <p className="hint">{tool.description}</p>}
        {tool && Object.entries(tool.input).map(([key, schema]) => {
          const field = schema as Field;
          const required = !!tool.required?.includes(key);
          const label = key.replace(/_/g, ' ');
          const text = values[key] ?? '';
          const change = (v: string) => { setPreview(null); setValues(before => ({ ...before, [key]: v })); };
          return <label key={key}>{label}{required ? ' (required)' : ''}
            {field.enum || field.type === 'boolean' ? <select required={required} value={text} onChange={e => change(e.target.value)}><option value="">Choose…</option>{(field.enum ?? ['true','false']).map(v => <option key={v} value={v}>{v}</option>)}</select>
            : key === 'file' && tool.name === 'finance_csv_import' ? <input type="file" required={required} accept=".csv,.txt" onChange={e => change(e.target.files?.[0] ? window.nv.files.pathOf(e.target.files[0]) : '')} />
            : field.type === 'array' || field.type === 'object' ? <textarea required={required} value={text} placeholder={field.items?.type === 'string' ? 'One entry per line' : 'JSON'} onChange={e => change(e.target.value)} />
            : <input type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === 'integer' ? 1 : 'any'} required={required} value={text} onChange={e => change(e.target.value)} />}
            {field.description && <small>{field.description}</small>}
          </label>;
        })}
        {[...new Set(Object.values(values).filter(v => /^[^\r\n]+\.md$/i.test(v)))].map(path => <button key={path} type="button" className="text-button" onClick={() => void previewSource(path)}>Preview {path}</button>)}
        {preview && <div className="chat-pack-result"><strong>{preview.path} · line {preview.line}</strong><p>{preview.text}</p>
          {preview.page > 1 && <button type="button" className="text-button" onClick={() => void previewSource(preview.path, preview.page - 1)}>Previous passage</button>}
          {preview.nextPage && <button type="button" className="text-button" onClick={() => void previewSource(preview.path, preview.nextPage!)}>Next passage</button>}
        </div>}
        <small>Runs directly in Ironleaf with the side chat’s access to {levelLabel(info.level)} records.</small>
        {enabled && partEnabled ? <button className="button small" type="submit" disabled={!tool || !canEdit}>{tool?.title || 'Run action'}</button>
        : <button className="button small" type="button" disabled={!canEdit} onClick={() => void setModule(pack, true, enabled ? part : undefined).catch(e => setError(errorMessage(e)))}>Enable {enabled ? info.parts.find(p => p.id === part)?.name ?? info.name : info.name}</button>}
      </fieldset>
    </form>
    {error && <p role="alert">{error}</p>}
    <div aria-live="polite">{history.map(({ title, result }, i) => <div className="chat-pack-result" key={result.changes?.turnId ?? i}>
      <strong>{title}</strong><p>{result.text}</p>
      {[...new Set([...(result.changes?.paths ?? []), ...result.sources.map(s => s.path)])].map(path => <button key={path} className="text-button" onClick={() => openPath(path)}>{path}</button>)}
      {result.changes && <button type="button" className="button small" disabled={busy} onClick={() => void undo(result.changes!.turnId)}>Undo change</button>}
    </div>)}</div>
  </div>;
}
