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
  /**
   * Hard prompt ceiling reported by the bridge, in characters. Undefined means
   * the transport has none. Only the bridge can know this — it follows from the
   * binary and the platform, not from the model.
   */
  maxPromptChars?: number;
}

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
  // Limits come from the bridge (conduit-bridge 0.8.2+), which discovers them
  // per provider and can be overridden in ~/.conduit/models.json. The table
  // that used to live here could not know an id released after this build,
  // which is every id once catalogs became discovered rather than pinned.
  // `local-*` models are fetched by this extension straight from a configured
  // endpoint, so the bridge never sees them and cannot report their limits.
  // Small local models are the ones that actually overflow, so assume little.
  const isLocal = m.id.startsWith('local-');
  const contextWindow = m.context_window ?? (isLocal ? 8_192 : 128_000);
  const maxTokens = m.max_output_tokens ?? (isLocal ? 2_048 : 8_192);
  const category = Object.entries(CATEGORY_MAP).find(([k]) => m.id.startsWith(k))?.[1] ?? 'api';
  const provider = extractProvider(m.id);
  // The bridge supplies the label. Its catalog is discovered, so a table here
  // could never know the ids that appear between releases — 493 of 508 live
  // models rendered as a bare slug under a misleading provider heading.
  const name = m.display_name?.trim() || shortModelName(m.id);

  // Every model handles every mode. Tiering them here was a local guess that
  // silently withheld Agent from any id this build had not heard of — which,
  // with a discovered catalog, is most of them. The bridge does not rank
  // models and neither should a hardcoded list.
  const tier: 1 | 2 | 3 = 1;
  return {
    id: m.id,
    name,
    provider,
    contextWindow,
    maxTokens,
    supportsTools: m.capabilities?.tools !== false,
    category,
    supportedModes: TIER_MODES[tier],
    tier,
    maxPromptChars: m.max_prompt_chars,
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
  const windowChars = ((caps?.contextWindow ?? 128_000) - reserveTokens) * 3; // rough char estimate
  // A token window is not the only limit. agy takes the prompt on argv, so the
  // bridge rejects anything past ~30000 chars — two orders of magnitude below
  // Gemini's million-token window. The bridge reports that ceiling because only
  // it knows the transport; honour it, or a turn the client thought was
  // comfortably in budget dies, and in agent mode takes the loop with it.
  const maxChars = caps?.maxPromptChars
    ? Math.min(windowChars, caps.maxPromptChars)
    : windowChars;

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
