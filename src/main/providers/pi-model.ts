// One connection's model, as the model library (pi-ai 0.87.1) takes it: the declared reasoning levels carry their wire
// spelling, levels not declared are marked unsupported, a declared "off" without a value means "send nothing", and
// `false` (or nothing declared) means the model has no thinking control.

import type { Api, Model } from '@earendil-works/pi-ai';
import type { Connection, ModelEntry, ThinkingKey } from './connections';

const THINKING_LEVELS: ThinkingKey[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const PI_API: Record<Connection['api'], Api> = {
  'openai-completions': 'openai-completions',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic-messages',
  'google-generative-ai': 'google-generative-ai',
};

function reasoningOf(entry: ModelEntry): Pick<Model<Api>, 'reasoning' | 'thinkingLevelMap'> {
  const efforts = entry.reasoningEfforts;
  if (efforts === undefined || efforts === false || efforts === null) return { reasoning: false };
  const declared = THINKING_LEVELS.filter((level) => efforts[level] !== undefined);
  if (!declared.some((level) => level !== 'off')) return { reasoning: false };
  const map: Partial<Record<ThinkingKey, string | null>> = {};
  for (const level of THINKING_LEVELS) {
    const wire = efforts[level];
    if (wire === undefined) map[level] = null;
    else if (wire !== null && wire !== '') map[level] = wire;
  }
  return { reasoning: true, thinkingLevelMap: map };
}

/** The pi-ai model for one of a connection's models; an unknown model id is used with the connection's defaults
 * (a model typed by hand). */
export function toPiModel(connection: Connection, modelId: string): Model<Api> {
  const entry = connection.models.find((m) => m.id === modelId) ?? { id: modelId };
  const contextWindow = Math.max(1024, Math.min(2_000_000, Number(entry.contextWindow ?? connection.defaultContextWindow ?? 32768) || 32768));
  const maxTokens = Math.max(256, Math.min(Number(entry.maxTokens ?? connection.defaultMaxTokens ?? 8192) || 8192, contextWindow - 1024));
  return {
    id: entry.id,
    name: entry.name || entry.id,
    api: PI_API[connection.api],
    provider: connection.id,
    baseUrl: connection.engineBase,
    ...reasoningOf(entry),
    input: Array.isArray(entry.input) && entry.input.length ? entry.input : ['text'],
    cost: ZERO_COST,
    contextWindow,
    maxTokens,
    ...(Object.keys(connection.headers).length ? { headers: connection.headers } : {}),
    ...(entry.compat && typeof entry.compat === 'object' ? { compat: entry.compat as Model<Api>['compat'] } : {}),
  };
}

/** The reasoning levels a model offers, in order, for the level picker ('off' first when it can switch thinking off). */
export function levelsOf(connection: Connection, modelId: string): ThinkingKey[] {
  const efforts = connection.models.find((m) => m.id === modelId)?.reasoningEfforts;
  if (!efforts) return [];
  return THINKING_LEVELS.filter((level) => efforts[level] !== undefined);
}
