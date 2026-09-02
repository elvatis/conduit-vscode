import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getModelRegistry, getModelCapabilities,
  supportsMode, getModeRecommendation,
  autoSelectModel, estimateComplexity, trimHistoryForModel,
  type ModelCapabilities,
} from '../model-registry';

// Mock proxy-client to avoid real HTTP calls
vi.mock('../proxy-client', () => ({
  listModels: vi.fn().mockResolvedValue([
    { id: 'cli-claude/claude-opus-5', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'cli-claude/claude-sonnet-5', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'cli-claude/claude-haiku-4-5', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'cli-grok/grok-4.6', object: 'model', created: 0, owned_by: 'xai', capabilities: { tools: true } },
    { id: 'cli-grok/grok-4.3', object: 'model', created: 0, owned_by: 'xai', capabilities: { tools: false } },
    { id: 'cli-gemini/gemini-3.1-pro-high', object: 'model', created: 0, owned_by: 'google', capabilities: { tools: true } },
    { id: 'cli-gemini/gemini-3.6-flash-high', object: 'model', created: 0, owned_by: 'google', capabilities: { tools: true } },
    { id: 'cli-codex/gpt-5.6-sol', object: 'model', created: 0, owned_by: 'openai', capabilities: { tools: true } },
    { id: 'api-claude/claude-opus-5', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'lmstudio/gpt-oss-20b', object: 'model', created: 0, owned_by: 'lmstudio', capabilities: { tools: false } },
    { id: 'local-bitnet/bitnet-2b', object: 'model', created: 0, owned_by: 'local', capabilities: { tools: false } },
    { id: 'cli-claude/claude-unknown-99', object: 'model', created: 0, owned_by: 'anthropic' },
    { id: 'api-codex/text-embedding-3-small', object: 'model', created: 0, owned_by: 'openai' },
  ]),
}));

describe('model-registry', () => {
  beforeEach(async () => {
    // Force cache refresh
    await getModelRegistry();
  });

  // ── Context windows and max tokens ──────────────────────────────────────

  describe('per-model limits', () => {
    it('Claude Opus 5 (CLI) has 1M context and 128K max output', async () => {
      const caps = getModelCapabilities('cli-claude/claude-opus-5');
      expect(caps).toBeDefined();
      expect(caps!.contextWindow).toBe(1_000_000);
      expect(caps!.maxTokens).toBe(128_000);
    });

    it('Claude Sonnet 5 (CLI) has 1M context and 64K max output', () => {
      const caps = getModelCapabilities('cli-claude/claude-sonnet-5');
      expect(caps!.contextWindow).toBe(1_000_000);
      expect(caps!.maxTokens).toBe(64_000);
    });

    it('Claude Haiku 4.5 (CLI) has 200K context and 64K max output', () => {
      const caps = getModelCapabilities('cli-claude/claude-haiku-4-5');
      expect(caps!.contextWindow).toBe(200_000);
      expect(caps!.maxTokens).toBe(64_000);
    });

    it('Grok 4.6 has 2M context and 131K max output', () => {
      const caps = getModelCapabilities('cli-grok/grok-4.6');
      expect(caps!.contextWindow).toBe(2_000_000);
      expect(caps!.maxTokens).toBe(131_072);
    });

    it('Grok 4.3 has 256K context and 131K max output', () => {
      const caps = getModelCapabilities('cli-grok/grok-4.3');
      expect(caps!.contextWindow).toBe(256_000);
      expect(caps!.maxTokens).toBe(131_072);
    });

    it('Gemini 3.1 Pro High has 1M context and 65K max output', () => {
      const caps = getModelCapabilities('cli-gemini/gemini-3.1-pro-high');
      expect(caps!.contextWindow).toBe(1_000_000);
      expect(caps!.maxTokens).toBe(65_536);
    });

    it('GPT-5.6 Sol (CLI) has 1M context and 128K max output', () => {
      const caps = getModelCapabilities('cli-codex/gpt-5.6-sol');
      expect(caps!.contextWindow).toBe(1_050_000);
      expect(caps!.maxTokens).toBe(128_000);
    });

    it('BitNet has 4K context and 2K max output', () => {
      const caps = getModelCapabilities('local-bitnet/bitnet-2b');
      expect(caps!.contextWindow).toBe(4_096);
      expect(caps!.maxTokens).toBe(2_048);
    });

    it('unknown model from known provider uses provider fallback', () => {
      const caps = getModelCapabilities('cli-claude/claude-unknown-99');
      expect(caps).toBeDefined();
      expect(caps!.contextWindow).toBe(200_000);
      expect(caps!.maxTokens).toBe(64_000);
    });
  });

  // ── Provider extraction ─────────────────────────────────────────────────

  describe('provider', () => {
    it('extracts provider from model ID prefix', () => {
      expect(getModelCapabilities('cli-claude/claude-opus-5')!.provider).toBe('cli-claude');
      expect(getModelCapabilities('cli-grok/grok-4.6')!.provider).toBe('cli-grok');
      expect(getModelCapabilities('cli-codex/gpt-5.6-sol')!.provider).toBe('cli-codex');
      expect(getModelCapabilities('api-claude/claude-opus-5')!.provider).toBe('api-claude');
    });
  });

  // ── Tier and mode support ───────────────────────────────────────────────

  describe('tiers and modes', () => {
    it('tier 1 models support all modes', () => {
      const caps = getModelCapabilities('cli-claude/claude-opus-5');
      expect(caps!.tier).toBe(1);
      expect(caps!.supportedModes).toEqual(['ask', 'edit', 'agent', 'plan']);
    });

    it('tier 2 models support ask, edit, plan but not agent', () => {
      const caps = getModelCapabilities('cli-grok/grok-4.3');
      expect(caps!.tier).toBe(2);
      expect(caps!.supportedModes).toContain('ask');
      expect(caps!.supportedModes).toContain('edit');
      expect(caps!.supportedModes).toContain('plan');
      expect(caps!.supportedModes).not.toContain('agent');
    });

    it('tier 3 models only support ask', () => {
      const caps = getModelCapabilities('local-bitnet/bitnet-2b');
      expect(caps!.tier).toBe(3);
      expect(caps!.supportedModes).toEqual(['ask']);
    });
  });

  // ── Display names ──────────────────────────────────────────────────────

  describe('display names', () => {
    it('known models get friendly display names', () => {
      expect(getModelCapabilities('cli-claude/claude-opus-5')!.name).toBe('Claude Opus 5 (CLI)');
      expect(getModelCapabilities('cli-grok/grok-4.6')!.name).toBe('Grok 4.6 (CLI)');
      expect(getModelCapabilities('local-bitnet/bitnet-2b')!.name).toBe('BitNet 1.58 2B');
    });

    it('unknown models use the model ID part after the slash', () => {
      expect(getModelCapabilities('cli-claude/claude-unknown-99')!.name).toBe('claude-unknown-99');
    });
  });

  // ── supportsMode ────────────────────────────────────────────────────────

  describe('supportsMode', () => {
    it('returns true for supported modes', () => {
      expect(supportsMode('cli-claude/claude-opus-5', 'agent')).toBe(true);
      expect(supportsMode('cli-claude/claude-opus-5', 'ask')).toBe(true);
    });

    it('returns false for unsupported modes', () => {
      expect(supportsMode('local-bitnet/bitnet-2b', 'agent')).toBe(false);
      expect(supportsMode('local-bitnet/bitnet-2b', 'edit')).toBe(false);
    });

    it('returns true for unknown models (permissive)', () => {
      expect(supportsMode('unknown/model', 'agent')).toBe(true);
    });
  });

  // ── getModeRecommendation ───────────────────────────────────────────────

  describe('getModeRecommendation', () => {
    it('returns compatible when model supports the mode', async () => {
      const models = await getModelRegistry();
      const result = getModeRecommendation(models, 'cli-claude/claude-opus-5', 'agent');
      expect(result.compatible).toBe(true);
    });

    it('suggests alternative when model does not support agent mode', async () => {
      const models = await getModelRegistry();
      const result = getModeRecommendation(models, 'local-bitnet/bitnet-2b', 'agent');
      expect(result.compatible).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.reason).toContain('fast');
    });
  });

  // ── estimateComplexity ──────────────────────────────────────────────────

  describe('estimateComplexity', () => {
    it('short simple questions are simple', () => {
      expect(estimateComplexity('explain this function')).toBe('simple');
      expect(estimateComplexity('what is this?')).toBe('simple');
      expect(estimateComplexity('fix this bug')).toBe('simple');
    });

    it('long messages are complex', () => {
      const long = Array(60).fill('word').join(' ');
      expect(estimateComplexity(long)).toBe('complex');
    });

    it('architecture keywords trigger complex', () => {
      expect(estimateComplexity('refactor the authentication system across multiple files')).toBe('complex');
      expect(estimateComplexity('design a new caching layer')).toBe('complex');
    });

    it('medium-length messages default to moderate', () => {
      expect(estimateComplexity('I need to update the sidebar component with a new loading spinner and also add error handling for the API calls')).toBe('moderate');
    });
  });

  // ── autoSelectModel ─────────────────────────────────────────────────────

  describe('autoSelectModel', () => {
    it('selects a fast model for simple tasks', async () => {
      const models = await getModelRegistry();
      const selected = autoSelectModel(models, 'simple');
      expect(selected).toBeDefined();
      // Should prefer grok-fast or similar fast model
      const caps = getModelCapabilities(selected!);
      expect(caps).toBeDefined();
    });

    it('selects a strong model for complex tasks', async () => {
      const models = await getModelRegistry();
      const selected = autoSelectModel(models, 'complex');
      expect(selected).toBeDefined();
      const caps = getModelCapabilities(selected!);
      expect(caps!.tier).toBe(1);
    });

    it('filters by mode when selecting', async () => {
      const models = await getModelRegistry();
      const selected = autoSelectModel(models, 'complex', 'agent');
      expect(selected).toBeDefined();
      expect(supportsMode(selected!, 'agent')).toBe(true);
    });
  });

  // ── trimHistoryForModel ─────────────────────────────────────────────────

  describe('trimHistoryForModel', () => {
    it('keeps all messages if they fit within context window', () => {
      const messages = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const trimmed = trimHistoryForModel(messages, 'cli-claude/claude-opus-5');
      expect(trimmed).toHaveLength(3);
    });

    it('always keeps system message', () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'A'.repeat(100_000) },
        { role: 'assistant', content: 'B'.repeat(100_000) },
        { role: 'user', content: 'Latest question' },
      ];
      const trimmed = trimHistoryForModel(messages, 'local-bitnet/bitnet-2b');
      expect(trimmed[0].role).toBe('system');
      expect(trimmed[0].content).toBe('System prompt');
    });

    it('keeps most recent messages when trimming', () => {
      const messages = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'A'.repeat(8000) },
        { role: 'assistant', content: 'B'.repeat(8000) },
        { role: 'user', content: 'new question' },
      ];
      // BitNet: (4096 - 512) * 3 = 10752 chars budget
      // sys (3) + 8000 + 8000 + 12 = 16015 chars > 10752, so old messages get dropped
      const trimmed = trimHistoryForModel(messages, 'local-bitnet/bitnet-2b', 512);
      expect(trimmed[0].content).toBe('sys');
      const lastMsg = trimmed[trimmed.length - 1];
      expect(lastMsg.content).toBe('new question');
      expect(trimmed.length).toBeLessThan(messages.length);
    });

    it('uses fallback context window for unknown models', () => {
      const messages = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ];
      // Unknown model defaults to 128K context
      const trimmed = trimHistoryForModel(messages, 'unknown/model');
      expect(trimmed).toHaveLength(2);
    });
  });

  // ── Category mapping ────────────────────────────────────────────────────

  describe('category', () => {
    it('maps cli- prefix to cli category', () => {
      expect(getModelCapabilities('cli-claude/claude-opus-5')!.category).toBe('cli');
      expect(getModelCapabilities('cli-grok/grok-4.6')!.category).toBe('cli');
    });

    it('maps api- prefix to api category', () => {
      expect(getModelCapabilities('api-claude/claude-opus-5')!.category).toBe('api');
    });

    it('maps lmstudio/ to local category', () => {
      expect(getModelCapabilities('lmstudio/gpt-oss-20b')!.category).toBe('local');
    });

    it('maps local- prefix to local category', () => {
      expect(getModelCapabilities('local-bitnet/bitnet-2b')!.category).toBe('local');
    });
  });

  // ── Tools support ───────────────────────────────────────────────────────

  describe('supportsTools', () => {
    it('reflects capabilities from model info', () => {
      expect(getModelCapabilities('cli-claude/claude-opus-5')!.supportsTools).toBe(true);
      expect(getModelCapabilities('cli-grok/grok-4.3')!.supportsTools).toBe(false);
      expect(getModelCapabilities('local-bitnet/bitnet-2b')!.supportsTools).toBe(false);
    });
  });

  describe('non-chat filter', () => {
    it('drops embedding models from the registry', async () => {
      const models = await getModelRegistry();
      expect(models.some(m => m.id.includes('embedding'))).toBe(false);
      expect(getModelCapabilities('api-codex/text-embedding-3-small')).toBeUndefined();
    });
  });
});
