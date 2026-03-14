import { ModelInfo, listModels } from './proxy-client';

/**
 * Model registry - caches model info, provides context window limits,
 * auto-selection logic, and provider-specific formatting.
 */

export interface ModelCapabilities {
  id: string;
  name: string;
  provider: string;       // e.g. "web-grok", "cli-claude", "openai-codex"
  contextWindow: number;
  maxTokens: number;
  supportsTools: boolean;
  category: 'cli' | 'web' | 'local' | 'codex';
}

// Known context windows per model prefix (from openclaw-cli-bridge)
const KNOWN_CONTEXT_WINDOWS: Record<string, { ctx: number; max: number }> = {
  'cli-claude/':    { ctx: 200_000,   max: 8_192 },
  'cli-gemini/':    { ctx: 1_000_000, max: 8_192 },
  'openai-codex/':  { ctx: 200_000,   max: 32_768 },
  'web-grok/':      { ctx: 131_072,   max: 131_072 },
  'web-gemini/':    { ctx: 1_000_000, max: 8_192 },
  'web-claude/':    { ctx: 200_000,   max: 8_192 },
  'web-chatgpt/':   { ctx: 128_000,   max: 16_384 },
  'local-bitnet/':  { ctx: 4_096,     max: 2_048 },
};

// Friendly display names for known models - ALWAYS include version numbers
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // CLI Claude
  'cli-claude/claude-sonnet-4-6': 'Claude Sonnet 4.6 (CLI)',
  'cli-claude/claude-opus-4-6': 'Claude Opus 4.6 (CLI)',
  'cli-claude/claude-haiku-4-5': 'Claude Haiku 4.5 (CLI)',
  // CLI Gemini
  'cli-gemini/gemini-2.5-pro': 'Gemini 2.5 Pro (CLI)',
  'cli-gemini/gemini-2.5-flash': 'Gemini 2.5 Flash (CLI)',
  'cli-gemini/gemini-3-pro-preview': 'Gemini 3.0 Pro Preview (CLI)',
  'cli-gemini/gemini-3-flash-preview': 'Gemini 3.0 Flash Preview (CLI)',
  // OpenAI Codex
  'openai-codex/gpt-5.4': 'GPT-5.4 (Codex)',
  'openai-codex/gpt-5.3-codex': 'GPT-5.3 Codex',
  'openai-codex/gpt-5.3-codex-spark': 'GPT-5.3 Codex Spark',
  'openai-codex/gpt-5.2-codex': 'GPT-5.2 Codex',
  'openai-codex/gpt-5.1-codex-mini': 'GPT-5.1 Codex Mini',
  // Web Grok (IDs from bridge /v1/models)
  'web-grok/grok-3': 'Grok 3.0',
  'web-grok/grok-3-fast': 'Grok 3.0 Fast',
  'web-grok/grok-3-mini': 'Grok 3.0 Mini',
  'web-grok/grok-3-mini-fast': 'Grok 3.0 Mini Fast',
  'web-grok/grok-2': 'Grok 2.0',
  // Web Gemini
  'web-gemini/gemini-2-5-pro': 'Gemini 2.5 Pro',
  'web-gemini/gemini-2-5-flash': 'Gemini 2.5 Flash',
  'web-gemini/gemini-3-pro': 'Gemini 3.0 Pro',
  'web-gemini/gemini-3-flash': 'Gemini 3.0 Flash',
  // Web Claude (bridge returns short IDs without version suffix)
  'web-claude/claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'web-claude/claude-opus-4-6': 'Claude Opus 4.6',
  'web-claude/claude-haiku-4-5': 'Claude Haiku 4.5',
  'web-claude/claude-sonnet': 'Claude Sonnet 4.6',
  'web-claude/claude-opus': 'Claude Opus 4.6',
  'web-claude/claude-haiku': 'Claude Haiku 4.5',
  'web-claude/claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'web-claude/claude-opus-4-5': 'Claude Opus 4.5',
  // Web ChatGPT (bridge returns gpt-o3, gpt-o4-mini with prefix)
  'web-chatgpt/gpt-5': 'GPT-5.0',
  'web-chatgpt/gpt-5-mini': 'GPT-5.0 Mini',
  'web-chatgpt/gpt-4o': 'GPT-4o',
  'web-chatgpt/gpt-4o-mini': 'GPT-4o Mini',
  'web-chatgpt/gpt-4.1': 'GPT-4.1',
  'web-chatgpt/o3': 'o3',
  'web-chatgpt/o4-mini': 'o4 Mini',
  'web-chatgpt/gpt-o3': 'o3',
  'web-chatgpt/gpt-o4-mini': 'o4 Mini',
  // Local
  'local-bitnet/bitnet-2b': 'BitNet 1.58 2B',
};

const CATEGORY_MAP: Record<string, ModelCapabilities['category']> = {
  'cli-': 'cli',
  'web-': 'web',
  'openai-codex/': 'codex',
  'local-': 'local',
};

let _cache: ModelCapabilities[] = [];
let _cacheTime = 0;
const CACHE_TTL = 30_000;

export async function getModelRegistry(): Promise<ModelCapabilities[]> {
  if (Date.now() - _cacheTime < CACHE_TTL && _cache.length > 0) {
    return _cache;
  }
  try {
    const models = await listModels();
    _cache = models.map(m => toCapabilities(m));
    _cacheTime = Date.now();
  } catch {
    // keep stale cache
  }
  return _cache;
}

export function getModelCapabilities(modelId: string): ModelCapabilities | undefined {
  return _cache.find(m => m.id === modelId);
}

function toCapabilities(m: ModelInfo): ModelCapabilities {
  const prefix = Object.keys(KNOWN_CONTEXT_WINDOWS).find(p => m.id.startsWith(p)) ?? '';
  const limits = KNOWN_CONTEXT_WINDOWS[prefix] ?? { ctx: 128_000, max: 8_192 };
  const category = Object.entries(CATEGORY_MAP).find(([k]) => m.id.startsWith(k))?.[1] ?? 'web';
  const provider = m.id.includes('/') ? m.id.split('/')[0] : 'unknown';
  const name = MODEL_DISPLAY_NAMES[m.id]
    ?? (m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id);

  return {
    id: m.id,
    name,
    provider,
    contextWindow: limits.ctx,
    maxTokens: limits.max,
    supportsTools: m.capabilities?.tools !== false,
    category,
  };
}

/**
 * Auto-select the best model based on task complexity.
 * Prefers larger context models for complex tasks, faster models for simple ones.
 */
export function autoSelectModel(
  models: ModelCapabilities[],
  taskType: 'simple' | 'moderate' | 'complex',
): string | undefined {
  if (models.length === 0) return undefined;

  // Preference order per complexity
  const preferences: Record<string, string[]> = {
    simple: [
      'web-grok/grok-3-mini-fast', 'cli-gemini/gemini-3-flash-preview',
      'cli-gemini/gemini-2.5-flash', 'web-gemini/gemini-3-flash',
      'web-gemini/gemini-2-5-flash', 'web-grok/grok-3-fast',
      'web-chatgpt/gpt-4o-mini', 'cli-claude/claude-haiku-4-5',
      'openai-codex/gpt-5.1-codex-mini',
    ],
    moderate: [
      'cli-gemini/gemini-2.5-pro', 'web-grok/grok-3',
      'cli-claude/claude-sonnet-4-6', 'web-gemini/gemini-2-5-pro',
      'openai-codex/gpt-5.3-codex', 'web-chatgpt/gpt-5',
      'web-chatgpt/o3', 'openai-codex/gpt-5.3-codex-spark',
    ],
    complex: [
      'cli-claude/claude-opus-4-6', 'cli-gemini/gemini-3-pro-preview',
      'openai-codex/gpt-5.4', 'openai-codex/gpt-5.3-codex',
      'web-gemini/gemini-3-pro', 'web-chatgpt/gpt-5',
      'web-grok/grok-3', 'web-claude/claude-opus-4-6',
    ],
  };

  const ids = new Set(models.map(m => m.id));
  for (const pref of preferences[taskType]) {
    if (ids.has(pref)) return pref;
  }
  return models[0].id;
}

/**
 * Estimate task complexity from user input.
 */
export function estimateComplexity(text: string): 'simple' | 'moderate' | 'complex' {
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Complex indicators
  if (wordCount > 50) return 'complex';
  if (/\b(architect|design|refactor|migrate|implement|build|create.*system|plan)\b/.test(lower)) return 'complex';
  if (/\b(multiple files|across.*project|full|complete|comprehensive)\b/.test(lower)) return 'complex';

  // Simple indicators
  if (wordCount < 10) return 'simple';
  if (/\b(explain|what is|how does|fix this|rename|typo)\b/.test(lower)) return 'simple';

  return 'moderate';
}

/**
 * Trim conversation history to fit within a model's context window.
 * Keeps system prompt + last N messages that fit.
 */
export function trimHistoryForModel(
  messages: Array<{ role: string; content: string }>,
  modelId: string,
  reserveTokens = 4096,
): Array<{ role: string; content: string }> {
  const caps = getModelCapabilities(modelId);
  const maxChars = ((caps?.contextWindow ?? 128_000) - reserveTokens) * 3; // rough char estimate

  // Always keep the system message
  const system = messages.filter(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');

  let totalChars = system.reduce((a, m) => a + m.content.length, 0);
  const kept: typeof rest = [];

  // Walk backwards to keep most recent messages
  for (let i = rest.length - 1; i >= 0; i--) {
    const msgChars = rest[i].content.length;
    if (totalChars + msgChars > maxChars) break;
    totalChars += msgChars;
    kept.unshift(rest[i]);
  }

  return [...system, ...kept];
}
