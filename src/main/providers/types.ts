// The shapes Ironleaf's models share (no model library is loaded for these).
export type ApiFormat = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
/** What a connection is to: one of the named providers, a local Ollama, or any OpenAI-compatible address. */
export type ConnectionKind = 'anthropic' | 'openai' | 'google' | 'ollama' | 'custom';
export type ThinkingKey = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelChoice {
  provider: string;
  model: string;
  reasoning?: ThinkingKey;
}

/** A tool the model asked to use: its id (to answer), name and arguments as the JSON text the model wrote. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** A tool offered to the model: what it does, and its arguments as a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A picture the person attached, for a model that sees pictures (base64). */
export interface ChatImage {
  mediaType: string;
  data: string;
  name?: string;
}

/**
 * A message of the conversation. An answer that used tools carries its calls, and `replay` (whatever the model service
 * needs to send it back exactly: reasoning it must see again in the next step); a tool's answer names its call.
 */
export type ChatMessageIn =
  | { role: 'user'; text: string; images?: ChatImage[] }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[]; replay?: unknown }
  | { role: 'tool'; callId: string; name: string; text: string; isError?: boolean };

export interface StreamResult {
  text: string;
  stopReason: 'stop' | 'length' | 'error' | 'aborted' | 'other';
  error?: string;
  /** Tools the model asked to use before it answers (empty or missing: this is the answer). */
  toolCalls?: ToolCall[];
  replay?: unknown;
}

export interface ConnectionView {
  id: string;
  name: string;
  kind: ConnectionKind;
  api: ApiFormat;
  host: string;
  baseURL: string;
  /** Whether the address is the person's to change (a local server or an OpenAI-compatible service). */
  editableURL: boolean;
  /** The connection's key: typed in Ironleaf, not needed (a local server), or missing. */
  key: 'here' | 'missing' | 'not-needed';
  models: { id: string; name: string; levels: ThinkingKey[]; images?: boolean }[];
}

export interface ProvidersView {
  connections: ConnectionView[];
  /** Speech-to-text: the connection and model that write down what was said; null when none is chosen. */
  transcription: { connection: string; model: string } | null;
}
