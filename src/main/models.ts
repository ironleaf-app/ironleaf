// The model seam: every AI feature asks through this (src/main/ai.ts), and the person's own connections answer it
// (src/main/providers/index.ts).

import type { ChatMessageIn, ModelChoice, ProvidersView, StreamResult, ToolSpec } from './providers/types';
import type { ConnectionInput, RemoteModel, TranscriptionChoice } from './providers/connections';

export interface StreamOptions {
  signal: AbortSignal;
  onText?: (delta: string) => void;
  maxTokens?: number;
  /** Tools the model may ask to use (the chat's notes and folders tools). */
  tools?: ToolSpec[];
  /** One question's id, the same for each round of its tools. */
  conversation?: string;
  /** How hard the ask thinks (a one-shot JSON ask names low): the route drops what the model doesn't offer. */
  effort?: string;
}

/** What the rest of Ironleaf needs from its models, wherever they come from. */
export interface ModelsService {
  start(): Promise<void>;
  stop(): void;
  onChange(fn: () => void): () => void;
  view(): ProvidersView;
  effectiveChoice(choice: ModelChoice | null | undefined): ModelChoice | null;
  stream(choice: ModelChoice | null, systemPrompt: string, messages: ChatMessageIn[], opts: StreamOptions): Promise<StreamResult>;
  test(connectionId: string, modelId: string): Promise<{ ok: boolean; words: string }>;
  /** Whether Ironleaf keeps the keys (it does: the person's own, in the KeyStore). */
  readonly ownKeys: boolean;
  /** The person's connections: added, changed and removed in Settings › AI. */
  addConnection?(input: ConnectionInput): Promise<string>;
  updateConnection?(id: string, patch: Partial<Pick<ConnectionInput, 'name' | 'baseURL' | 'models' | 'noAuth' | 'api'>>): Promise<void>;
  removeConnection?(id: string): Promise<void>;
  setKey?(id: string, key: string | null): Promise<void>;
  listRemote?(id: string): Promise<RemoteModel[]>;
  /** Speech-to-text through a connection the person chose: which, whether it is ready, and one piece written down. */
  setTranscription?(choice: TranscriptionChoice | null): Promise<void>;
  transcribeStatus?(): { ready: boolean; route: string; provider?: string; error?: string; setUp?: boolean };
  transcribe?(audio: Uint8Array, mime: string, hints?: string[], opts?: { signal?: AbortSignal; language?: string }): Promise<unknown>;
}
