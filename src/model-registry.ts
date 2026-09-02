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
  provider: string;       // e.g. "cli-grok", "cli-claude", "api-claude"
  contextWindow: number;
  maxTokens: number;
  supportsTools: boolean;
  category: 'cli' | 'api' | 'local' | 'codex';
  /** Which chat modes this model handles well */
  supportedModes: ChatMode[];
  /** Reasoning tier: 1 = top (all modes), 2 = good (ask/edit/plan), 3 = fast (ask only) */
  tier: 1 | 2 | 3;
}

// Per-model context windows (ctx) and max output tokens (max)
// Catalog aligned with conduit-bridge v0.5.2 /v1/models
const MODEL_LIMITS: Record<string, { ctx: number; max: number }> = {
  // CLI Claude
  'cli-claude/claude-opus-5':        { ctx: 1_000_000, max: 128_000 },
  'cli-claude/claude-sonnet-5':      { ctx: 1_000_000, max: 64_000 },
  'cli-claude/claude-fable-5':       { ctx: 1_000_000, max: 64_000 },
  'cli-claude/claude-haiku-4-5':     { ctx: 200_000,   max: 64_000 },
  // CLI Gemini
  'cli-gemini/gemini-3.1-pro-high':  { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-3.1-pro-low':   { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-3.6-flash-high': { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-3.6-flash-medium': { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-3.6-flash-low': { ctx: 1_000_000, max: 65_536 },
  'cli-gemini/gemini-3.5-flash-high': { ctx: 1_000_000, max: 65_536 },
  // CLI Grok
  'cli-grok/grok-4.6':               { ctx: 2_000_000, max: 131_072 },
  'cli-grok/grok-4.5':               { ctx: 256_000,   max: 131_072 },
  'cli-grok/grok-4.3':               { ctx: 256_000,   max: 131_072 },
  // CLI Codex
  'cli-codex/gpt-5.6-sol':           { ctx: 1_050_000, max: 128_000 },
  'cli-codex/gpt-5.6-terra':         { ctx: 400_000,   max: 128_000 },
  'cli-codex/gpt-5.6-luna':          { ctx: 400_000,   max: 64_000 },
  'cli-codex/gpt-5.5':               { ctx: 400_000,   max: 128_000 },
  'cli-codex/gpt-5.5-pro':           { ctx: 1_050_000, max: 128_000 },
  // Direct APIs
  'api-claude/claude-opus-5':        { ctx: 1_000_000, max: 128_000 },
  'api-claude/claude-sonnet-5':      { ctx: 1_000_000, max: 64_000 },
  'api-claude/claude-fable-5':       { ctx: 1_000_000, max: 64_000 },
  'api-claude/claude-haiku-4-5':     { ctx: 200_000,   max: 64_000 },
  'api-gemini/gemini-3.1-pro':       { ctx: 1_000_000, max: 65_536 },
  'api-gemini/gemini-3.7-flash':     { ctx: 1_000_000, max: 65_536 },
  'api-gemini/gemini-3.6-flash':     { ctx: 1_000_000, max: 65_536 },
  'api-codex/gpt-5.6-sol':           { ctx: 1_050_000, max: 128_000 },
  'api-codex/gpt-5.6-terra':         { ctx: 400_000,   max: 128_000 },
  'api-codex/gpt-5.6-luna':          { ctx: 400_000,   max: 64_000 },
  // OpenCode / Pi
  'opencode/default':                { ctx: 128_000,   max: 16_384 },
  'pi/default':                      { ctx: 128_000,   max: 16_384 },
  // Local
  'local-bitnet/bitnet-2b':          { ctx: 4_096,     max: 2_048 },
};

// Fallback limits per provider prefix (for unknown models from that provider)
const PROVIDER_FALLBACK_LIMITS: Record<string, { ctx: number; max: number }> = {
  'cli-claude/':    { ctx: 200_000,   max: 64_000 },
  'cli-gemini/':    { ctx: 1_000_000, max: 65_536 },
  'cli-grok/':      { ctx: 256_000,   max: 131_072 },
  'cli-codex/':     { ctx: 200_000,   max: 32_768 },
  'api-claude/':    { ctx: 200_000,   max: 64_000 },
  'api-gemini/':    { ctx: 1_000_000, max: 65_536 },
  'api-codex/':     { ctx: 200_000,   max: 32_768 },
  'api-openrouter/': { ctx: 128_000,  max: 16_384 },
  'api-perplexity/': { ctx: 128_000,  max: 16_384 },
  'lmstudio/':      { ctx: 32_768,    max: 8_192 },
  'openai-codex/':  { ctx: 200_000,   max: 32_768 },
  'opencode/':      { ctx: 128_000,   max: 16_384 },
  'pi/':            { ctx: 128_000,   max: 16_384 },
  'local-':         { ctx: 4_096,     max: 2_048 },
};

// Friendly display names for known models - ALWAYS include version numbers
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'cli-claude/claude-opus-5': 'Claude Opus 5 (CLI)',
  'cli-claude/claude-sonnet-5': 'Claude Sonnet 5 (CLI)',
  'cli-claude/claude-fable-5': 'Claude Fable 5 (CLI)',
  'cli-claude/claude-haiku-4-5': 'Claude Haiku 4.5 (CLI)',
  'cli-gemini/gemini-3.1-pro-high': 'Gemini 3.1 Pro High (CLI)',
  'cli-gemini/gemini-3.1-pro-low': 'Gemini 3.1 Pro Low (CLI)',
  'cli-gemini/gemini-3.6-flash-high': 'Gemini 3.6 Flash High (CLI)',
  'cli-gemini/gemini-3.6-flash-medium': 'Gemini 3.6 Flash Medium (CLI)',
  'cli-gemini/gemini-3.6-flash-low': 'Gemini 3.6 Flash Low (CLI)',
  'cli-gemini/gemini-3.5-flash-high': 'Gemini 3.5 Flash High (CLI)',
  'cli-grok/grok-4.6': 'Grok 4.6 (CLI)',
  'cli-grok/grok-4.5': 'Grok 4.5 (CLI)',
  'cli-grok/grok-4.3': 'Grok 4.3 (CLI)',
  'cli-codex/gpt-5.6-sol': 'GPT-5.6 Sol (CLI)',
  'cli-codex/gpt-5.6-terra': 'GPT-5.6 Terra (CLI)',
  'cli-codex/gpt-5.6-luna': 'GPT-5.6 Luna (CLI)',
  'cli-codex/gpt-5.5': 'GPT-5.5 (CLI)',
  'cli-codex/gpt-5.5-pro': 'GPT-5.5 Pro (CLI)',
  'api-claude/claude-opus-5': 'Claude Opus 5 (API)',
  'api-claude/claude-sonnet-5': 'Claude Sonnet 5 (API)',
  'api-claude/claude-fable-5': 'Claude Fable 5 (API)',
  'api-claude/claude-haiku-4-5': 'Claude Haiku 4.5 (API)',
  'api-gemini/gemini-3.1-pro': 'Gemini 3.1 Pro (API)',
  'api-gemini/gemini-3.7-flash': 'Gemini 3.7 Flash (API)',
  'api-gemini/gemini-3.6-flash': 'Gemini 3.6 Flash (API)',
  'api-codex/gpt-5.6-sol': 'GPT-5.6 Sol (API)',
  'opencode/default': 'OpenCode',
  'pi/default': 'Pi Agent',
  'local-bitnet/bitnet-2b': 'BitNet 1.58 2B',
};

// Model reasoning tiers - determines which chat modes are supported
// Tier 1: Strong reasoning, all modes (ask, edit, agent, plan)
// Tier 2: Good reasoning, most modes (ask, edit, plan)
// Tier 3: Fast/compact, basic mode only (ask)
const MODEL_TIERS: Record<string, 1 | 2 | 3> = {
  'cli-claude/claude-opus-5': 1,
  'cli-claude/claude-sonnet-5': 1,
  'cli-claude/claude-fable-5': 1,
  'cli-gemini/gemini-3.1-pro-high': 1,
  'cli-grok/grok-4.6': 1,
  'cli-codex/gpt-5.6-sol': 1,
  'cli-codex/gpt-5.5-pro': 1,
  'api-claude/claude-opus-5': 1,
  'api-claude/claude-sonnet-5': 1,
  'api-claude/claude-fable-5': 1,
  'api-gemini/gemini-3.1-pro': 1,
  'api-codex/gpt-5.6-sol': 1,
  'opencode/default': 1,
  'cli-claude/claude-haiku-4-5': 2,
  'cli-gemini/gemini-3.6-flash-high': 2,
  'cli-gemini/gemini-3.6-flash-medium': 2,
  'cli-gemini/gemini-3.5-flash-high': 2,
  'cli-grok/grok-4.5': 2,
  'cli-grok/grok-4.3': 2,
  'cli-codex/gpt-5.6-terra': 2,
  'cli-codex/gpt-5.5': 2,
  'api-claude/claude-haiku-4-5': 2,
  'api-gemini/gemini-3.7-flash': 2,
  'api-gemini/gemini-3.6-flash': 2,
  'pi/default': 2,
  'cli-gemini/gemini-3.6-flash-low': 3,
  'cli-gemini/gemini-3.1-pro-low': 3,
  'cli-codex/gpt-5.6-luna': 3,
  'local-bitnet/bitnet-2b': 3,
};

const TIER_MODES: Record<number, ChatMode[]> = {
  1: ['ask', 'edit', 'agent', 'plan'],
  2: ['ask', 'edit', 'plan'],
  3: ['ask'],
};

const CATEGORY_MAP: Record<string, ModelCapabilities['category']> = {
  'cli-': 'cli',
  'api-': 'api',
  'lmstudio/': 'local',
  'openai-codex/': 'codex',
  'opencode/': 'cli',
  'pi/': 'cli',
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
    const allModels = [...models, ...localModels].filter(m => !isNonChatModel(m.id));
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

function isNonChatModel(id: string): boolean {
  return /embedding|whisper|tts|moderation|image|lyria/i.test(id);
}

function toCapabilities(m: ModelInfo): ModelCapabilities {
  // Per-model limits first, then provider prefix fallback
  const limits = MODEL_LIMITS[m.id]
    ?? Object.entries(PROVIDER_FALLBACK_LIMITS).find(([p]) => m.id.startsWith(p))?.[1]
    ?? { ctx: 128_000, max: 8_192 };
  const category = Object.entries(CATEGORY_MAP).find(([k]) => m.id.startsWith(k))?.[1] ?? 'api';
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
      'cli-gemini/gemini-3.6-flash-high', 'cli-grok/grok-4.3',
      'cli-claude/claude-haiku-4-5', 'api-gemini/gemini-3.7-flash',
    ],
    moderate: [
      'cli-gemini/gemini-3.1-pro-high', 'cli-grok/grok-4.5',
      'cli-claude/claude-sonnet-5', 'cli-codex/gpt-5.6-terra',
      'api-gemini/gemini-3.1-pro',
    ],
    complex: [
      'cli-claude/claude-opus-5', 'cli-grok/grok-4.6',
      'cli-codex/gpt-5.6-sol', 'cli-claude/claude-fable-5',
      'api-claude/claude-opus-5', 'cli-gemini/gemini-3.1-pro-high',
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
