// The person's own AI connections: which provider, where it is, and which of its models to offer. Kept in
// userData/connections.json, in plain words, with no secrets: a connection's key lives in the KeyStore (encrypted by
// the operating system) under the connection's id, never here.

import { promises as fsp } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { ApiFormat, ConnectionKind, ThinkingKey } from './types';
import { KeyedQueue, writeFileAtomic } from '../save-guard';
import { assertCanAddConnection, assertCanChangeConnection, connectionsUnderPolicy, MANAGED_PREFIX, type ManagedConnection } from '../policy';

export type { ApiFormat, ConnectionKind, ThinkingKey };

export interface ModelEntry {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: ('text' | 'image')[];
  reasoningEfforts?: Partial<Record<ThinkingKey, string | null>> | false;
  compat?: Record<string, unknown>;
}

/** One connection as it is saved. */
export interface ConnectionRecord {
  id: string;
  name: string;
  kind: ConnectionKind;
  baseURL: string;
  api: ApiFormat;
  models: ModelEntry[];
  noAuth: boolean;
}

export interface Preset {
  kind: ConnectionKind;
  name: string;
  baseURL: string;
  api: ApiFormat;
  noAuth: boolean;
  /** Whether the address is the person's to type (a local server, or any OpenAI-compatible service). */
  editableURL: boolean;
  /** Models offered before the provider's own list has been fetched. */
  models: string[];
  hint: string;
}

export const PRESETS: Preset[] = [
  { kind: 'anthropic', name: 'Anthropic', baseURL: 'https://api.anthropic.com', api: 'anthropic-messages', noAuth: false, editableURL: false, models: [], hint: 'Claude models, with your Anthropic key.' },
  { kind: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', api: 'openai-responses', noAuth: false, editableURL: false, models: [], hint: 'OpenAI’s models, with your OpenAI key.' },
  { kind: 'google', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai', noAuth: false, editableURL: false, models: [], hint: 'Gemini models, with your Google AI Studio key.' },
  { kind: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', api: 'openai-completions', noAuth: true, editableURL: true, models: [], hint: 'Models running on this PC. No key needed.' },
  { kind: 'custom', name: 'OpenAI-compatible', baseURL: '', api: 'openai-completions', noAuth: false, editableURL: true, models: [], hint: 'Any OpenAI-compatible address: a local server, OpenRouter, Groq and others.' },
];

export const presetOf = (kind: ConnectionKind): Preset => PRESETS.find((p) => p.kind === kind) ?? PRESETS[PRESETS.length - 1];

/** A connection as the model library and the listing calls use it. */
export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  api: ApiFormat;
  /** The address the model library is given (Anthropic without its trailing /v1). */
  engineBase: string;
  /** The address for listing models and for speech-to-text (Anthropic with /v1). */
  restBase: string;
  headers: Record<string, string>;
  noAuth: boolean;
  maxRetries: number;
  defaultContextWindow?: number;
  defaultMaxTokens?: number;
  models: ModelEntry[];
}

/** What each kind of provider is taken to offer when a model says nothing about itself. */
const KIND_DEFAULTS: Record<ConnectionKind, { contextWindow: number; maxTokens: number; images: boolean }> = {
  anthropic: { contextWindow: 200_000, maxTokens: 8192, images: true },
  openai: { contextWindow: 128_000, maxTokens: 8192, images: true },
  google: { contextWindow: 1_000_000, maxTokens: 8192, images: true },
  ollama: { contextWindow: 32_768, maxTokens: 4096, images: false },
  custom: { contextWindow: 32_768, maxTokens: 4096, images: false },
};

export function toConnection(record: ConnectionRecord): Connection {
  const stored = record.baseURL.replace(/\/+$/, '');
  const engineBase = record.api === 'anthropic-messages' ? stored.replace(/\/v1$/, '') : stored;
  const d = KIND_DEFAULTS[record.kind] ?? KIND_DEFAULTS.custom;
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    api: record.api,
    engineBase,
    restBase: record.api === 'anthropic-messages' ? engineBase + '/v1' : engineBase,
    headers: {},
    noAuth: record.noAuth,
    maxRetries: 2,
    defaultContextWindow: d.contextWindow,
    defaultMaxTokens: d.maxTokens,
    models: record.models.map((m) => ({ ...m, input: m.input ?? (d.images ? ['text', 'image'] : ['text']) })),
  };
}

const KINDS: ConnectionKind[] = ['anthropic', 'openai', 'google', 'ollama', 'custom'];
const APIS: ApiFormat[] = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];
const MAX_CONNECTIONS = 40;
const MAX_MODELS = 400;

const cleanURL = (value: unknown): string => {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('That address doesn’t look right. It should start with http:// or https://, for example http://127.0.0.1:1234/v1.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The address should start with http:// or https://.');
  if (url.username || url.password) throw new Error('Leave the key out of the address: it goes in the key box.');
  return text.slice(0, 500);
};

function cleanModels(value: unknown): ModelEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const item of value) {
    const entry = typeof item === 'string' ? { id: item } : item && typeof item === 'object' ? (item as ModelEntry) : null;
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!id || id.length > 200 || /[\u0000-\u001f]/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const name = typeof entry!.name === 'string' && entry!.name.trim() && entry!.name.trim() !== id ? entry!.name.trim().slice(0, 120) : undefined;
    const input = Array.isArray(entry!.input) ? entry!.input.filter((i): i is 'text' | 'image' => i === 'text' || i === 'image') : undefined;
    out.push({
      id,
      ...(name ? { name } : {}),
      ...(Number(entry!.contextWindow) > 0 ? { contextWindow: Number(entry!.contextWindow) } : {}),
      ...(Number(entry!.maxTokens) > 0 ? { maxTokens: Number(entry!.maxTokens) } : {}),
      ...(input?.length ? { input } : {}),
      ...(entry!.reasoningEfforts && typeof entry!.reasoningEfforts === 'object' ? { reasoningEfforts: entry!.reasoningEfforts } : {}),
    });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/** A connection the organisation provides (managed policy, src/main/policy.ts): never saved, never editable here. */
function managedRecord(m: ManagedConnection): ConnectionRecord {
  const preset = presetOf(m.kind);
  return { id: MANAGED_PREFIX + m.id, name: m.name, kind: m.kind, baseURL: m.baseURL ?? preset.baseURL, api: m.api ?? preset.api, models: cleanModels(m.models), noAuth: m.noAuth ?? preset.noAuth };
}

/** One saved record made safe to use: anything that isn't a connection is dropped, and nothing but these fields is kept
 *  (so a key pasted into the file by hand is never carried along). */
function cleanRecord(value: unknown): ConnectionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v.id) ? v.id : '';
  const kind = KINDS.find((k) => k === v.kind);
  if (!id || !kind) return null;
  const preset = presetOf(kind);
  let baseURL: string;
  try {
    baseURL = cleanURL(v.baseURL || preset.baseURL);
  } catch {
    return null;
  }
  return {
    id,
    name: (typeof v.name === 'string' && v.name.trim() ? v.name.trim() : preset.name).slice(0, 80),
    kind,
    baseURL,
    api: APIS.find((a) => a === v.api) ?? preset.api,
    models: cleanModels(v.models),
    noAuth: v.noAuth === true,
  };
}

export interface ConnectionInput {
  kind: ConnectionKind;
  name?: string;
  baseURL?: string;
  api?: ApiFormat;
  models?: (string | ModelEntry)[];
  noAuth?: boolean;
}

/** Speech-to-text: the connection and model that write down what was said. */
export interface TranscriptionChoice {
  connection: string;
  model: string;
}

export class ConnectionStore {
  private records: ConnectionRecord[] = [];
  private speech: TranscriptionChoice | null = null;
  private listeners = new Set<() => void>();

  /** `dir`: Ironleaf's own data folder (userData). */
  constructor(private dir: string) {}

  get file(): string {
    return path.join(this.dir, 'connections.json');
  }

  async load(): Promise<void> {
    try {
      const value = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      const list = Array.isArray(value?.connections) ? value.connections : [];
      const seen = new Set<string>();
      this.records = list.map(cleanRecord).filter((r: ConnectionRecord | null): r is ConnectionRecord => !!r && !seen.has(r.id) && !!seen.add(r.id)).slice(0, MAX_CONNECTIONS);
      this.speech = this.cleanSpeech(value?.transcription);
    } catch {
      this.records = [];
      this.speech = null;
    }
  }

  private cleanSpeech(value: unknown): TranscriptionChoice | null {
    const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    const model = typeof v?.model === 'string' ? v.model.trim().slice(0, 200) : '';
    if (!v || typeof v.connection !== 'string' || !model || !this.list().some((r) => r.id === v.connection)) return null;
    return { connection: v.connection, model };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): ConnectionRecord[] {
    return connectionsUnderPolicy(this.records, managedRecord);
  }

  get(id: string): ConnectionRecord | undefined {
    return this.list().find((r) => r.id === id);
  }

  transcription(): TranscriptionChoice | null {
    return this.speech;
  }

  async add(input: ConnectionInput): Promise<ConnectionRecord> {
    if (this.records.length >= MAX_CONNECTIONS) throw new Error('That is as many connections as Ironleaf keeps. Remove one first.');
    const kind = KINDS.find((k) => k === input?.kind);
    if (!kind) throw new Error('Choose what kind of connection to add.');
    assertCanAddConnection(kind);
    const preset = presetOf(kind);
    const baseURL = cleanURL(preset.editableURL ? (input.baseURL ?? preset.baseURL) : preset.baseURL);
    const record: ConnectionRecord = {
      id: `conn-${randomBytes(6).toString('hex')}`,
      name: (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : preset.name).slice(0, 80),
      kind,
      baseURL,
      api: kind === 'custom' ? (APIS.find((a) => a === input.api) ?? preset.api) : preset.api,
      models: cleanModels(input.models ?? preset.models),
      noAuth: kind === 'custom' ? input.noAuth === true : preset.noAuth,
    };
    this.records = [...this.records, record];
    await this.save();
    return record;
  }

  /** Changes a connection's name, address (where it is the person's to type), key-less switch or its models. */
  async update(id: string, patch: Partial<Pick<ConnectionInput, 'name' | 'baseURL' | 'models' | 'noAuth' | 'api'>>): Promise<ConnectionRecord> {
    assertCanChangeConnection(id);
    const before = this.get(id);
    if (!before) throw new Error('That connection is no longer here.');
    const preset = presetOf(before.kind);
    const next: ConnectionRecord = {
      ...before,
      ...(typeof patch.name === 'string' && patch.name.trim() ? { name: patch.name.trim().slice(0, 80) } : {}),
      ...(patch.baseURL !== undefined && preset.editableURL ? { baseURL: cleanURL(patch.baseURL) } : {}),
      ...(patch.models !== undefined ? { models: cleanModels(patch.models) } : {}),
      ...(patch.noAuth !== undefined && before.kind === 'custom' ? { noAuth: patch.noAuth === true } : {}),
      ...(patch.api !== undefined && before.kind === 'custom' && APIS.includes(patch.api) ? { api: patch.api } : {}),
    };
    this.records = this.records.map((r) => (r.id === id ? next : r));
    await this.save();
    return next;
  }

  async remove(id: string): Promise<void> {
    assertCanChangeConnection(id);
    if (!this.get(id)) return;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.speech?.connection === id) this.speech = null;
    await this.save();
  }

  async setTranscription(choice: TranscriptionChoice | null): Promise<void> {
    this.speech = choice ? this.cleanSpeech(choice) : null;
    if (choice && !this.speech) throw new Error('Choose a connection and type the model that writes down speech.');
    await this.save();
  }

  private writes = new KeyedQueue();
  /** connections.json written whole, one save at a time, each through its own temp (saves at once shared one
   *  <file>.<pid>.tmp: a rename failed with ENOENT and the file could be half of each). Each save writes what is
   *  current when its turn comes. */
  private async save(): Promise<void> {
    await this.writes.run(this.file, async () => {
      await fsp.mkdir(this.dir, { recursive: true });
      // Only the named fields are written: never a key, whatever a caller handed in.
      const connections = this.records.map(({ id, name, kind, baseURL, api, models, noAuth }) => ({ id, name, kind, baseURL, api, models, noAuth }));
      await writeFileAtomic(this.file, JSON.stringify({ version: 1, connections, transcription: this.speech }, null, 2));
    });
    for (const fn of this.listeners) fn();
  }
}

export interface RemoteModel {
  id: string;
  name: string;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** The headers that carry a connection's key, as its provider wants it. */
export function authHeaders(conn: Connection, key: string | undefined): Record<string, string> {
  if (!key) return {};
  if (conn.api === 'anthropic-messages') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (conn.api === 'google-generative-ai') return { 'x-goog-api-key': key };
  return { authorization: `Bearer ${key}` };
}

const statusWords = (conn: Connection, status: number): string =>
  status === 401 || status === 403 ? `${conn.name} didn’t accept the key. Check it and try again.` : status === 404 ? `${conn.name} has no model list at that address. Type the model’s name instead.` : `${conn.name} answered with an error (${status}). Type the model’s name instead, or try again.`;

/** The models a provider says it has (GET {base}/models; Ollama's own /api/tags first). Throws plain words when it can't. */
export async function listRemoteModels(conn: Connection, key: string | undefined, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 15_000): Promise<RemoteModel[]> {
  const signal = AbortSignal.timeout(timeoutMs);
  const get = async (url: string): Promise<unknown> => {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json', ...authHeaders(conn, key) }, signal });
    } catch {
      throw new Error(conn.kind === 'ollama' ? 'Ollama isn’t answering at that address. Start Ollama and try again.' : `${conn.name} couldn’t be reached. Check the address and this PC’s connection.`);
    }
    if (!res.ok) throw new Error(statusWords(conn, res.status));
    try {
      return await res.json();
    } catch {
      throw new Error(`${conn.name} answered with something that isn’t a model list. Type the model’s name instead.`);
    }
  };
  const tidy = (list: RemoteModel[]): RemoteModel[] => {
    const seen = new Set<string>();
    return list.filter((m) => m.id && m.id.length <= 200 && !seen.has(m.id) && !!seen.add(m.id)).slice(0, MAX_MODELS).sort((a, b) => a.id.localeCompare(b.id));
  };
  const rows = (value: unknown, field: string): Record<string, unknown>[] => {
    const list = (value as Record<string, unknown> | null)?.[field] ?? (Array.isArray(value) ? value : []);
    return Array.isArray(list) ? list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
  };
  if (conn.kind === 'ollama') {
    try {
      const tags = await get(conn.restBase.replace(/\/v1$/, '') + '/api/tags');
      const found = rows(tags, 'models').map((r) => ({ id: String(r.name ?? r.model ?? ''), name: String(r.name ?? r.model ?? '') }));
      if (found.length) return tidy(found);
    } catch (err) {
      // An address that isn't Ollama's own (a proxy in front of it): its OpenAI-compatible list is asked next.
      if (!/error \(|model list/.test(err instanceof Error ? err.message : '')) throw err;
    }
  }
  if (conn.api === 'google-generative-ai') {
    const data = await get(conn.restBase + '/models?pageSize=1000');
    return tidy(
      rows(data, 'models')
        .filter((r) => !Array.isArray(r.supportedGenerationMethods) || (r.supportedGenerationMethods as unknown[]).includes('generateContent'))
        .map((r) => ({ id: String(r.name ?? '').replace(/^models\//, ''), name: String(r.displayName ?? '') || String(r.name ?? '').replace(/^models\//, '') })),
    );
  }
  const data = await get(conn.restBase + '/models' + (conn.api === 'anthropic-messages' ? '?limit=1000' : ''));
  return tidy(rows(data, 'data').map((r) => ({ id: String(r.id ?? ''), name: String(r.display_name ?? r.name ?? r.id ?? '') })));
}
