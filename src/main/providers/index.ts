// The models Ironleaf uses: the person's own connections (connections.ts: Anthropic, OpenAI, Google Gemini, a local
// Ollama, or any OpenAI-compatible address), each run through pi-ai 0.87.1. Keys are the person's, typed once and kept
// by the KeyStore. Requests go straight from this PC to the provider; nothing is sent until a connection is added.

import type { Api, AssistantMessageEvent, Model, ThinkingLevel } from '@earendil-works/pi-ai';
import { ConnectionStore, authHeaders, listRemoteModels, presetOf, toConnection, type Connection, type ConnectionInput, type RemoteModel, type TranscriptionChoice } from './connections';
import { levelsOf, toPiModel } from './pi-model';
import type { ModelsService } from '../models';
import { keysUnderPolicy } from '../policy';

import type { ChatMessageIn, ConnectionView, ModelChoice, ProvidersView, StreamResult, ToolCall, ToolSpec } from './types';
export type { ChatMessageIn, ConnectionView, ModelChoice, ProvidersView, StreamResult };

/** A stream that sends nothing for this long is ended, so a silent turn doesn't wait for ever. */
const IDLE_MS = 120_000;

type StreamSimple = (model: Model<Api>, context: unknown, options?: Record<string, unknown>) => AsyncIterable<AssistantMessageEvent>;

// pi-ai is an ES module and the main process is bundled as CommonJS, so each format's code is loaded with import().
async function streamFor(api: Api): Promise<StreamSimple> {
  switch (api) {
    case 'openai-completions':
      return (await import('@earendil-works/pi-ai/api/openai-completions')).streamSimple as unknown as StreamSimple;
    case 'openai-responses':
      return (await import('@earendil-works/pi-ai/api/openai-responses')).streamSimple as unknown as StreamSimple;
    case 'anthropic-messages':
      return (await import('@earendil-works/pi-ai/api/anthropic-messages')).streamSimple as unknown as StreamSimple;
    case 'google-generative-ai':
      return (await import('@earendil-works/pi-ai/api/google-generative-ai')).streamSimple as unknown as StreamSimple;
    default:
      throw new Error('This kind of connection isn’t available in Ironleaf yet.');
  }
}

const parseArgs = (text: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

async function contextOf(systemPrompt: string, messages: ChatMessageIn[], tools?: ToolSpec[]): Promise<unknown> {
  const { normalizeContext } = await import('@earendil-works/pi-ai');
  const now = Date.now();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  return normalizeContext({
    systemPrompt,
    messages: messages.map((m, i) => {
      const timestamp = now - (messages.length - i);
      // Pictures the person attached go with their words (a model that can't see them gets pi-ai's note instead).
      if (m.role === 'user') return { role: 'user' as const, content: m.images?.length ? [...m.images.map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mediaType })), { type: 'text' as const, text: m.text }] : m.text, timestamp };
      if (m.role === 'tool') return { role: 'toolResult' as const, toolCallId: m.callId, toolName: m.name, content: [{ type: 'text' as const, text: m.text }], isError: !!m.isError, timestamp } as never;
      // An answer from this conversation's own step goes back exactly as it came (its reasoning included).
      if (m.replay && typeof m.replay === 'object' && (m.replay as { role?: string }).role === 'assistant') return m.replay as never;
      // Earlier answers go back as the assistant's text (and its tool calls), with no usage or provider details to carry.
      const content = [...(m.text ? [{ type: 'text' as const, text: m.text }] : []), ...(m.toolCalls ?? []).map((c) => ({ type: 'toolCall' as const, id: c.id, name: c.name, arguments: parseArgs(c.arguments) }))];
      return { role: 'assistant' as const, content, api: 'openai-completions', provider: 'history', model: 'history', usage, stopReason: m.toolCalls?.length ? ('toolUse' as const) : ('stop' as const), timestamp } as never;
    }),
    ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) } : {}),
  } as never);
}

/** Where the keys are kept (the KeyStore: encrypted by the operating system, one per connection id). */
export interface Keys {
  has(connectionId: string): boolean;
  get(connectionId: string): string | undefined;
  set(connectionId: string, key: string): Promise<void>;
  remove(connectionId: string): Promise<void>;
}

/** The words every AI entry point shows while no connection is set up. */
export const NO_CONNECTION = 'Add an AI connection in Settings › AI to use this.';

/**
 * The ceiling one ask sends: what it asked for, within the model's own. Claude counts its thinking against the same
 * ceiling, and the models that think by default (Sonnet 5.5, Opus 5.5) do so whether or not a level is chosen, so an
 * ask's words would otherwise lose their room to it (a 4,000-word ask could come back empty). Anthropic gets the
 * thinking's room on top; a ceiling costs nothing unused.
 */
export const THINKING_ROOM = 32_000;
export function answerRoom(model: { api: string; maxTokens: number }, asked: number): number {
  return Math.min(model.api === 'anthropic-messages' ? asked + THINKING_ROOM : asked, model.maxTokens);
}

export class ProviderService implements ModelsService {
  readonly ownKeys = true;
  private listeners = new Set<() => void>();
  private stopWatching: (() => void) | undefined;

  private keys: Keys;

  // The keys as managed policy allows them (src/main/policy.ts): a managed connection's key from its environment variable.
  constructor(keys: Keys, private store: ConnectionStore) {
    this.keys = keysUnderPolicy(keys);
  }

  async start(): Promise<void> {
    await this.store.load();
    this.stopWatching = this.store.onChange(() => this.changed());
  }

  stop(): void {
    this.stopWatching?.();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  connections(): Connection[] {
    return this.store.list().map(toConnection);
  }

  /** The model to use: the person's choice when it still exists, else the first model of the first connection that
   * has one. A choice names a connection and a model on it: a typo'd model falls back like a gone connection (never
   * streams with guessed limits). */
  effectiveChoice(choice: ModelChoice | null | undefined): ModelChoice | null {
    const all = this.connections();
    const exists = (c: ModelChoice | null | undefined) => !!c && all.some((conn) => conn.id === c.provider && conn.models.some((m) => m.id === c.model));
    if (exists(choice)) return choice!;
    const usable = (conn: Connection) => conn.models.length && (conn.noAuth || this.keys.has(conn.id));
    const first = all.find(usable) ?? all.find((conn) => conn.models.length);
    return first ? { provider: first.id, model: first.models[0].id } : null;
  }

  view(): ProvidersView {
    const connections = this.connections().map<ConnectionView>((conn) => {
      let host = '';
      try {
        host = new URL(conn.restBase).host;
      } catch {
        host = conn.restBase;
      }
      return {
        id: conn.id,
        name: conn.name,
        kind: conn.kind,
        api: conn.api,
        host,
        baseURL: this.store.get(conn.id)?.baseURL ?? conn.restBase,
        editableURL: presetOf(conn.kind).editableURL,
        key: conn.noAuth ? 'not-needed' : this.keys.has(conn.id) ? 'here' : 'missing',
        // A model that declares no picture input is sent none (toPiModel takes it as text only), so it is said to see none.
        models: conn.models.map((m) => ({ id: m.id, name: m.name || m.id, levels: levelsOf(conn, m.id), images: Array.isArray(m.input) && m.input.includes('image') })),
      };
    });
    return { connections, transcription: this.store.transcription() };
  }

  private keyFor(conn: Connection): string | undefined {
    // A local server needs no key, but the libraries want something to send; a key typed anyway is used.
    if (conn.noAuth) return this.keys.get(conn.id) || 'local';
    return this.keys.get(conn.id);
  }

  async addConnection(input: ConnectionInput): Promise<string> {
    return (await this.store.add(input)).id;
  }

  async updateConnection(id: string, patch: Partial<Pick<ConnectionInput, 'name' | 'baseURL' | 'models' | 'noAuth' | 'api'>>): Promise<void> {
    await this.store.update(id, patch);
  }

  /** Removes a connection and its key. */
  async removeConnection(id: string): Promise<void> {
    await this.keys.remove(id).catch(() => undefined);
    await this.store.remove(id);
  }

  async setKey(id: string, key: string | null): Promise<void> {
    if (!this.store.get(id)) throw new Error('That connection is no longer here.');
    if (key === null) await this.keys.remove(id);
    else await this.keys.set(id, key);
    this.changed();
  }

  /** The models the provider says it has, for the picker (the person can still type one). */
  async listRemote(id: string): Promise<RemoteModel[]> {
    const conn = this.connections().find((c) => c.id === id);
    if (!conn) throw new Error('That connection is no longer here.');
    const key = this.keys.get(id);
    if (!conn.noAuth && !key) throw new Error(`Add ${conn.name}’s key first, then its models can be listed.`);
    return listRemoteModels(conn, key);
  }

  async setTranscription(choice: TranscriptionChoice | null): Promise<void> {
    await this.store.setTranscription(choice);
  }

  /** Whether speech can be written down now: {ready, route, provider} or {ready: false, error} in plain words. */
  transcribeStatus(): { ready: boolean; route: string; provider?: string; error?: string; setUp?: boolean } {
    const chosen = this.store.transcription();
    const conn = chosen ? this.connections().find((c) => c.id === chosen.connection) : undefined;
    if (!chosen || !conn) return { ready: false, route: '', setUp: false, error: 'No transcription connection is set up yet.' };
    if (!conn.noAuth && !this.keys.has(conn.id)) return { ready: false, route: '', provider: conn.name, setUp: true, error: `${conn.name} needs its key before it can write recordings down: add it in Settings › AI.` };
    // The route is the wire it speaks (the OpenAI-compatible /audio/transcriptions), whoever serves it.
    return { ready: true, route: 'openai', provider: conn.name, setUp: true };
  }

  /** Speech-to-text: one piece of sound sent to the chosen connection's OpenAI-compatible /audio/transcriptions.
   *  Answers {text, segments?: [{start, text}]} or {error} in plain words. */
  async transcribe(audio: Uint8Array, mime: string, hints?: string[], opts?: { signal?: AbortSignal; language?: string }): Promise<{ text: string; segments?: { start: number; text: string }[] } | { error: string; code?: string }> {
    const status = this.transcribeStatus();
    if (!status.ready) return { error: status.setUp ? status.error! : 'Add a transcription connection in Settings › AI to have this written down.', code: 'not-set-up' };
    const chosen = this.store.transcription()!;
    const conn = this.connections().find((c) => c.id === chosen.connection)!;
    if (conn.api === 'anthropic-messages' || conn.api === 'google-generative-ai') return { error: `${conn.name} has no speech-to-text here. Choose an OpenAI-compatible connection for transcription in Settings › AI.`, code: 'not-set-up' };
    const ext = /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audio as BlobPart], { type: mime || 'audio/webm' }), `audio.${ext}`);
    form.append('model', chosen.model);
    // Timed pieces where the model gives them (whisper-1 and Whisper servers); the gpt-4o models answer plain json.
    form.append('response_format', /whisper/i.test(chosen.model) ? 'verbose_json' : 'json');
    const prompt = (hints ?? []).filter((h) => typeof h === 'string' && h.trim()).join(', ').slice(0, 800);
    if (prompt) form.append('prompt', prompt);
    // The language asked for rides along (meetings ask for English), as its two-letter code.
    if (opts?.language && /^[a-z]{2,3}$/i.test(opts.language)) form.append('language', opts.language.toLowerCase());
    const signal = opts?.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
    let res: Response;
    try {
      res = await fetch(`${conn.restBase}/audio/transcriptions`, { method: 'POST', headers: authHeaders(conn, this.keyFor(conn)), body: form, signal });
    } catch {
      if (opts?.signal?.aborted) return { error: 'Stopped.', code: 'aborted' };
      return { error: `${conn.name} couldn’t be reached to write this down. Check this PC’s connection and try again.`, code: 'network' };
    }
    if (!res.ok) {
      const detail = await res.text().then((t) => {
        try {
          const j = JSON.parse(t);
          return String(j?.error?.message ?? j?.error ?? j?.message ?? '');
        } catch {
          return '';
        }
      }, () => '');
      if (res.status === 401 || res.status === 403) return { error: `${conn.name} didn’t accept the key. Check it in Settings › AI.`, code: 'auth' };
      if (res.status === 404) return { error: `${conn.name} has no speech-to-text at that address, or no model named ${chosen.model}. Check Transcription in Settings › AI.`, code: 'not-found' };
      return { error: `${conn.name} couldn’t write this down (${res.status})${detail ? `: ${detail.slice(0, 200)}` : '.'}`, code: String(res.status) };
    }
    try {
      const data = (await res.json()) as { text?: unknown; segments?: unknown };
      const segments = Array.isArray(data.segments) ? data.segments.flatMap((s) => (s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string' ? [{ start: Number((s as { start?: unknown }).start) || 0, text: (s as { text: string }).text }] : [])) : [];
      return { text: typeof data.text === 'string' ? data.text : '', ...(segments.length ? { segments } : {}) };
    } catch {
      return { error: `${conn.name} answered with something that isn’t a transcript.`, code: 'other' };
    }
  }

  /** Streams one reply. `onText` gets each piece of text as it arrives. */
  async stream(choice: ModelChoice | null, systemPrompt: string, messages: ChatMessageIn[], opts: { signal: AbortSignal; onText?: (delta: string) => void; maxTokens?: number; tools?: ToolSpec[]; effort?: string }): Promise<StreamResult> {
    const picked = this.effectiveChoice(choice);
    if (!picked) return { text: '', stopReason: 'error', error: NO_CONNECTION };
    const conn = this.connections().find((c) => c.id === picked.provider)!;
    const apiKey = this.keyFor(conn);
    if (!apiKey) return { text: '', stopReason: 'error', error: `${conn.name} needs its key: add it in Settings › AI.` };
    const model = toPiModel(conn, picked.model);
    const levels = levelsOf(conn, picked.model);
    // One ask's effort wins over the choice's (a one-shot JSON ask names low); offered or not sent.
    const level = (opts.effort && (levels as string[]).includes(opts.effort) ? opts.effort : undefined) ?? (picked.reasoning && levels.includes(picked.reasoning) ? picked.reasoning : undefined);
    let text = '';
    const idle = new AbortController();
    const signal = AbortSignal.any([opts.signal, idle.signal]);
    let timer = setTimeout(() => idle.abort(), IDLE_MS);
    try {
      const streamSimple = await streamFor(model.api);
      const context = await contextOf(systemPrompt, messages, opts.tools);
      const events = streamSimple(model, context, {
        apiKey,
        signal,
        maxRetries: conn.maxRetries,
        ...(opts.maxTokens ? { maxTokens: answerRoom(model, opts.maxTokens) } : {}),
        ...(level && level !== 'off' ? { reasoning: level as ThinkingLevel } : {}),
      });
      for await (const event of events) {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(), IDLE_MS);
        if (event.type === 'text_delta') {
          text += event.delta;
          opts.onText?.(event.delta);
        } else if (event.type === 'done') {
          const toolCalls: ToolCall[] = event.message.content.flatMap((c) => (c.type === 'toolCall' ? [{ id: c.id, name: c.name, arguments: JSON.stringify(c.arguments ?? {}) }] : []));
          if (toolCalls.length) return { text, stopReason: 'stop', toolCalls, replay: event.message };
          return { text, stopReason: event.reason === 'stop' ? 'stop' : event.reason === 'length' ? 'length' : 'other' };
        } else if (event.type === 'error') {
          if (opts.signal.aborted) return { text, stopReason: 'aborted', error: 'Stopped.' };
          if (idle.signal.aborted) return { text, stopReason: 'error', error: `${conn.name} stopped sending anything, so Ironleaf ended the reply. Try again.` };
          return { text, stopReason: 'error', error: event.error.errorMessage || `${conn.name} could not answer.` };
        }
      }
      return { text, stopReason: 'other' };
    } catch (err) {
      if (opts.signal.aborted) return { text, stopReason: 'aborted', error: 'Stopped.' };
      return { text, stopReason: 'error', error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Test connection: one short request ("Reply OK."). */
  async test(connectionId: string, modelId: string): Promise<{ ok: boolean; words: string }> {
    const conn = this.connections().find((c) => c.id === connectionId);
    if (!conn) return { ok: false, words: 'That connection is no longer here.' };
    if (!modelId) return { ok: false, words: `Choose one of ${conn.name}’s models first.` };
    if (!conn.models.some((m) => m.id === modelId)) return { ok: false, words: `${modelId} is not one of ${conn.name}’s models here. Its models: ${conn.models.map((m) => m.id).join(', ') || 'none'}.` };
    const result = await this.stream({ provider: connectionId, model: modelId }, 'Reply with the single word OK.', [{ role: 'user', text: 'Reply OK.' }], { signal: AbortSignal.timeout(60_000), maxTokens: 256 });
    if (result.error) return { ok: false, words: result.error };
    return { ok: true, words: `${conn.name} answered${result.text.trim() ? `: “${result.text.trim().slice(0, 40)}”` : '.'}` };
  }
}
