import { ModelInfo, listModels } from './proxy-client';
import { extractProvider, shortModelName } from './utils';
import { getConfig } from './config';
import * as http from 'http';
import * as https from 'https';

/**
 * Model registry - caches model info, provides context window limits,
 * auto-selection logic, and provider-specific formatting.
 */

export type ChatMode = 'ask' | 'edit' | 'agent' | 'plan';

export interface ModelCapabilities {
  id: string;
  name: string;
  provider: string;       // e.g. "web-grok", "cli-claude", "openai-codex"
  contextWindow: number;
  maxTokens: number;
  supportsTools: boolean;
  category: 'cli' | 'web' | 'local' | 'codex';
  /** Which chat modes this model handles well */
  supportedModes: ChatMode[];
  /** Reasoning tier: 1 = top (all modes), 2 = good (ask/edit/plan), 3 = fast (ask only) */
  tier: 1 | 2 | 3;
}

// Per-model context windows (ctx) and max output tokens (max)
// Sources: platform.claude.com, ai.google.dev, developers.openai.com, docs.x.ai
const MODEL_LIMITS: Record<string, { ctx: number; max: number }> = {
  // Claude 4.6 - 1M context, Opus 128K output, Sonnet 64K output
  'web-claude/claude-opus':          { ctx: 1_000_000, max: 128_000 },
  'web-claude/claude-opus-4-6':      { ctx: 1_000_000, max: 128_000 },
  'web-claude/claude-sonnet':        { ctx: 1_000_000, max: 64_000 },
  'web-claude/claude-sonnet-4-6':    { ctx: 1_000_000, max: 64_000 },
  'web-claude/claude-haiku':         { ctx: 200_000,   max: 64_000 },
  'web-claude/claude-haiku-4-5':     { ctx: 200_000,   max: 64_000 },
  // Claude 4.5 legacy
  'web-claude/claude-opus-4-5':      { ctx: 200_000,   max: 32_768 },
  'web-claude/claude-sonnet-4-5':    { ctx: 200_000,   max: 16_384 },
  // CLI Claude (same models via API)
  'cli-claude/claude-opus-4-6':      { ctx: 1_000_000, max: 128_000 },
  'cli-claude/claude-sonnet-4-6':    { ctx: 1_000_000, max: 64_000 },
  'cli-claude/claude-haiku-4-5':     { ctx: 200_000,   max: 64_000 },
  // Gemini - 1M context, 65K output
  'web-gemini/gemini-3.1-pro':       { ctx: 1_000_000, max: 65_536 },
  'web-gemini/gemini-3-thinking':    { ctx: 1_000_000, max: 65_536 },
  'web-gemini/gemini-3-fast':        { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-2.5-pro':       { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-2.5-flash':     { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-3-pro-preview': { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-3-flash-preview': { ctx: 1_000_000, max: 65_536 },
  // OpenAI / Codex - GPT-5.4 1M context 128K output
  'openai-codex/gpt-5.4':            { ctx: 1_050_000, max: 128_000 },
  'openai-codex/gpt-5.3-codex':      { ctx: 400_000,   max: 128_000 },
  'openai-codex/gpt-5.3-codex-spark': { ctx: 400_000,  max: 64_000 },
  'openai-codex/gpt-5.2-codex':      { ctx: 200_000,   max: 32_768 },
  'openai-codex/gpt-5.1-codex-mini': { ctx: 128_000,   max: 16_384 },
  // ChatGPT web
  'web-chatgpt/gpt-5.4-pro':         { ctx: 1_050_000, max: 128_000 },
  'web-chatgpt/gpt-5.4-thinking':    { ctx: 1_050_000, max: 128_000 },
  'web-chatgpt/gpt-5.3-instant':     { ctx: 400_000,   max: 64_000 },
  'web-chatgpt/gpt-5-thinking-mini': { ctx: 128_000,   max: 16_384 },
  'web-chatgpt/o3':                   { ctx: 200_000,   max: 100_000 },
  // Grok - Fast 2M context, Expert/Heavy 256K context
  'web-grok/grok-fast':              { ctx: 2_000_000,  max: 131_072 },
  'web-grok/grok-expert':            { ctx: 256_000,    max: 131_072 },
  'web-grok/grok-heavy':             { ctx: 256_000,    max: 131_072 },
  'web-grok/grok-4.20-beta':         { ctx: 256_000,    max: 131_072 },
  // Local
  'local-bitnet/bitnet-2b':          { ctx: 4_096,      max: 2_048 },
};

// Fallback limits per provider prefix (for unknown models from that provider)
const PROVIDER_FALLBACK_LIMITS: Record<string, { ctx: number; max: number }> = {
  'cli-claude/':    { ctx: 200_000,   max: 64_000 },
  'cli-gemini/':    { ctx: 1_000_000, max: 65_536 },
  'openai-codex/':  { ctx: 200_000,   max: 32_768 },
  'web-grok/':      { ctx: 256_000,   max: 131_072 },
  'web-gemini/':    { ctx: 1_000_000, max: 65_536 },
  'web-claude/':    { ctx: 200_000,   max: 64_000 },
  'web-chatgpt/':   { ctx: 128_000,   max: 32_768 },
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
  'web-grok/grok-expert': 'Grok Expert',
  'web-grok/grok-fast': 'Grok Fast',
  'web-grok/grok-heavy': 'Grok Heavy',
  'web-grok/grok-4.20-beta': 'Grok 4.20 Beta',
  // Web Gemini
  'web-gemini/gemini-3-fast': 'Gemini 3 Fast',
  'web-gemini/gemini-3-thinking': 'Gemini 3 Thinking',
  'web-gemini/gemini-3.1-pro': 'Gemini 3.1 Pro',
  // Web Claude (bridge returns short IDs without version suffix)
  'web-claude/claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'web-claude/claude-opus-4-6': 'Claude Opus 4.6',
  'web-claude/claude-haiku-4-5': 'Claude Haiku 4.5',
  'web-claude/claude-sonnet': 'Claude Sonnet 4.6',
  'web-claude/claude-opus': 'Claude Opus 4.6',
  'web-claude/claude-haiku': 'Claude Haiku 4.5',
  'web-claude/claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'web-claude/claude-opus-4-5': 'Claude Opus 4.5',
  // Web ChatGPT
  'web-chatgpt/gpt-5.4-pro': 'GPT-5.4 Pro',
  'web-chatgpt/gpt-5.4-thinking': 'GPT-5.4 Thinking',
  'web-chatgpt/gpt-5.3-instant': 'GPT-5.3 Instant',
  'web-chatgpt/gpt-5-thinking-mini': 'GPT-5 Thinking Mini',
  'web-chatgpt/o3': 'o3',
  // Local
  'local-bitnet/bitnet-2b': 'BitNet 1.58 2B',
};

// Model reasoning tiers - determines which chat modes are supported
// Tier 1: Strong reasoning, all modes (ask, edit, agent, plan)
// Tier 2: Good reasoning, most modes (ask, edit, plan)
// Tier 3: Fast/compact, basic mode only (ask)
const MODEL_TIERS: Record<string, 1 | 2 | 3> = {
  // Tier 1 - Full capability
  'web-claude/claude-opus':        1,
  'web-claude/claude-opus-4-6':    1,
  'web-claude/claude-sonnet':      1,
  'web-claude/claude-sonnet-4-6':  1,
  'web-claude/claude-opus-4-5':    1,
  'web-chatgpt/gpt-5.4-pro':      1,
  'web-chatgpt/gpt-5.4-thinking': 1,
  'web-gemini/gemini-3.1-pro':     1,
  'web-gemini/gemini-3-thinking':  1,
  'web-grok/grok-expert':          1,
  'web-grok/grok-heavy':           1,
  'cli-claude/claude-opus-4-6':    1,
  'cli-claude/claude-sonnet-4-6':  1,
  'cli-gemini/gemini-2.5-pro':     1,
  'cli-gemini/gemini-3-pro-preview': 1,
  'openai-codex/gpt-5.4':         1,
  'openai-codex/gpt-5.3-codex':   1,
  // Tier 2 - Good for ask, edit, plan
  'web-claude/claude-haiku':       2,
  'web-claude/claude-haiku-4-5':   2,
  'web-claude/claude-sonnet-4-5':  2,
  'web-chatgpt/gpt-5.3-instant':  2,
  'web-gemini/gemini-3-fast':      2,
  'web-grok/grok-fast':            2,
  'web-chatgpt/o3':                2,
  'web-grok/grok-4.20-beta':      2,
  'cli-claude/claude-haiku-4-5':   2,
  'cli-gemini/gemini-2.5-flash':   2,
  'cli-gemini/gemini-3-flash-preview': 2,
  'openai-codex/gpt-5.3-codex-spark': 2,
  'openai-codex/gpt-5.2-codex':   2,
  // Tier 3 - Fast, mainly ask
  'web-chatgpt/gpt-5-thinking-mini': 3,
  'openai-codex/gpt-5.1-codex-mini': 3,
  'local-bitnet/bitnet-2b':       3,
};

const TIER_MODES: Record<number, ChatMode[]> = {
  1: ['ask', 'edit', 'agent', 'plan'],
  2: ['ask', 'edit', 'plan'],
  3: ['ask'],
};

const CATEGORY_MAP: Record<string, ModelCapabilities['category']> = {
  'cli-': 'cli',
  'web-': 'web',
  'openai-codex/': 'codex',
  'local-': 'local',
};

let _cacheList: ModelCapabilities[] = [];
let _cacheMap = new Map<string, ModelCapabilities>();
let _cacheTime = 0;
const CACHE_TTL = 30_000;

export async function getModelRegistry(): Promise<ModelCapabilities[]> {
  if (Date.now() - _cacheTime < CACHE_TTL && _cacheList.length > 0) {
    return _cacheList;
  }
  try {
    const models = await listModels();
    const localModels = await fetchLocalModels();
    const allModels = [...models, ...localModels];
    _cacheList = allModels.map(m => toCapabilities(m));
    _cacheMap = new Map(_cacheList.map(m => [m.id, m]));
    _cacheTime = Date.now();
  } catch {
    // keep stale cache
  }
  return _cacheList;
}

/** Fetch models from configured local endpoints (Ollama, LM Studio, etc.) */
async function fetchLocalModels(): Promise<ModelInfo[]> {
  const cfg = getConfig();
  if (!cfg.localEndpoints || cfg.localEndpoints.length === 0) return [];

  const results: ModelInfo[] = [];
  for (const endpoint of cfg.localEndpoints) {
    try {
      const text = await httpGetLocal(endpoint.url + '/models', endpoint.apiKey);
      const json = JSON.parse(text);
      const models = json.data ?? json.models ?? [];
      for (const m of models) {
        const id = m.id ?? m.name ?? m.model;
        if (!id) continue;
        const prefixedId = `local-${endpoint.name.toLowerCase().replace(/\s+/g, '-')}/${id}`;
        results.push({
          id: prefixedId,
          object: 'model',
          created: m.created ?? 0,
          owned_by: endpoint.name,
        });
      }
    } catch { /* endpoint not reachable */ }
  }
  return results;
}

function httpGetLocal(url: string, apiKey?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = url.startsWith('https://') ? https : http;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

export function getModelCapabilities(modelId: string): ModelCapabilities | undefined {
  return _cacheMap.get(modelId);
}

function toCapabilities(m: ModelInfo): ModelCapabilities {
  // Per-model limits first, then provider prefix fallback
  const limits = MODEL_LIMITS[m.id]
    ?? Object.entries(PROVIDER_FALLBACK_LIMITS).find(([p]) => m.id.startsWith(p))?.[1]
    ?? { ctx: 128_000, max: 8_192 };
  const category = Object.entries(CATEGORY_MAP).find(([k]) => m.id.startsWith(k))?.[1] ?? 'web';
  const provider = extractProvider(m.id);
  const name = MODEL_DISPLAY_NAMES[m.id] ?? shortModelName(m.id);

  const tier = MODEL_TIERS[m.id] ?? 2; // default to tier 2
  return {
    id: m.id,
    name,
    provider,
    contextWindow: limits.ctx,
    maxTokens: limits.max,
    supportsTools: m.capabilities?.tools !== false,
    category,
    supportedModes: TIER_MODES[tier],
    tier,
  };
}

/**
 * Check if a model supports a given chat mode.
 */
export function supportsMode(modelId: string, mode: ChatMode): boolean {
  const caps = getModelCapabilities(modelId);
  if (!caps) return true; // unknown model, assume yes
  return caps.supportedModes.includes(mode);
}

/**
 * Get a mode-compatible recommendation if the current model doesn't support the mode.
 * Returns null if the current model is fine, or a suggested model ID.
 */
export function getModeRecommendation(
  models: ModelCapabilities[],
  currentModelId: string,
  mode: ChatMode,
): { compatible: boolean; suggestion?: string; reason?: string } {
  const current = models.find(m => m.id === currentModelId);
  if (!current) return { compatible: true };

  if (current.supportedModes.includes(mode)) {
    return { compatible: true };
  }

  // Find the best compatible model
  const compatible = models.filter(m => m.supportedModes.includes(mode));
  if (compatible.length === 0) return { compatible: false, reason: `No available models support ${mode} mode` };

  // Prefer same provider, then by tier
  const sameProvider = compatible.filter(m => m.provider === current.provider);
  const suggestion = (sameProvider.length > 0 ? sameProvider : compatible)
    .sort((a, b) => a.tier - b.tier)[0];

  const modeLabels: Record<string, string> = {
    agent: 'Agent mode needs strong reasoning',
    plan: 'Plan mode needs detailed reasoning',
    edit: 'Edit mode needs precise instruction-following',
  };

  return {
    compatible: false,
    suggestion: suggestion.id,
    reason: `${current.name} is a ${current.tier === 3 ? 'fast' : 'mid-tier'} model. ${modeLabels[mode] ?? ''} - try ${suggestion.name}`,
  };
}

/**
 * Auto-select the best model based on task complexity.
 * Prefers larger context models for complex tasks, faster models for simple ones.
 * @param feedbackScores - optional model feedback from user (good/poor counts)
 */
export function autoSelectModel(
  models: ModelCapabilities[],
  taskType: 'simple' | 'moderate' | 'complex',
  mode: ChatMode = 'ask',
  feedbackScores?: Record<string, { good: number; poor: number }>,
): string | undefined {
  if (models.length === 0) return undefined;

  // Filter to models that support the current mode
  const modeCompatible = models.filter(m => m.supportedModes.includes(mode));
  const pool = modeCompatible.length > 0 ? modeCompatible : models;

  // Preference order per complexity
  const preferences: Record<string, string[]> = {
    simple: [
      'web-grok/grok-fast', 'web-gemini/gemini-3-fast',
      'web-chatgpt/gpt-5.3-instant', 'web-claude/claude-haiku',
      'web-chatgpt/gpt-5-thinking-mini',
    ],
    moderate: [
      'web-gemini/gemini-3-thinking', 'web-grok/grok-expert',
      'web-claude/claude-sonnet', 'web-chatgpt/gpt-5.4-thinking',
      'web-gemini/gemini-3.1-pro',
    ],
    complex: [
      'web-claude/claude-opus', 'web-gemini/gemini-3.1-pro',
      'web-chatgpt/gpt-5.4-pro', 'web-grok/grok-heavy',
      'web-grok/grok-4.20-beta', 'web-claude/claude-sonnet',
    ],
  };

  const ids = new Set(pool.map(m => m.id));

  // If we have feedback data, boost models with good ratings and penalize poor ones
  if (feedbackScores) {
    const prefs = preferences[taskType].filter(id => ids.has(id));
    const scored = prefs.map(id => {
      const fb = feedbackScores[id];
      const score = fb ? (fb.good - fb.poor * 2) : 0; // penalize poor ratings more heavily
      return { id, score };
    });
    scored.sort((a, b) => b.score - a.score);
    // If the top-scored model has positive feedback, prefer it
    if (scored.length > 0 && scored[0].score > 0) {
      return scored[0].id;
    }
  }

  for (const pref of preferences[taskType]) {
    if (ids.has(pref)) return pref;
  }
  return pool[0].id;
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
 * Get fallback models for a given model, ordered by preference.
 * Same-provider models are preferred, then cross-provider models of the same tier.
 */
export function getFallbackModels(
  models: ModelCapabilities[],
  primaryModelId: string,
): string[] {
  const primary = models.find(m => m.id === primaryModelId);
  if (!primary) return [];

  const candidates = models.filter(m =>
    m.id !== primaryModelId &&
    m.supportedModes.length >= primary.supportedModes.length,
  );

  // Sort: same provider first, then by tier distance (closest first), then by context window (larger first)
  return candidates
    .sort((a, b) => {
      const aProvider = a.provider === primary.provider ? 0 : 1;
      const bProvider = b.provider === primary.provider ? 0 : 1;
      if (aProvider !== bProvider) return aProvider - bProvider;
      const aTierDist = Math.abs(a.tier - primary.tier);
      const bTierDist = Math.abs(b.tier - primary.tier);
      if (aTierDist !== bTierDist) return aTierDist - bTierDist;
      return b.contextWindow - a.contextWindow;
    })
    .slice(0, 3)
    .map(m => m.id);
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

  // Walk backwards to keep most recent messages (push + reverse avoids O(n^2) unshift)
  for (let i = rest.length - 1; i >= 0; i--) {
    const msgChars = rest[i].content.length;
    if (totalChars + msgChars > maxChars) break;
    totalChars += msgChars;
    kept.push(rest[i]);
  }
  kept.reverse();

  return [...system, ...kept];
}
