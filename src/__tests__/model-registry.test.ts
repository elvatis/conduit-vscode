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
    { id: 'web-claude/claude-opus', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'web-claude/claude-sonnet', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'web-claude/claude-haiku', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'web-grok/grok-fast', object: 'model', created: 0, owned_by: 'xai', capabilities: { tools: false } },
    { id: 'web-grok/grok-expert', object: 'model', created: 0, owned_by: 'xai', capabilities: { tools: true } },
    { id: 'web-gemini/gemini-3.1-pro', object: 'model', created: 0, owned_by: 'google', capabilities: { tools: true } },
    { id: 'web-chatgpt/gpt-5.4-pro', object: 'model', created: 0, owned_by: 'openai', capabilities: { tools: true } },
    { id: 'web-chatgpt/gpt-5-thinking-mini', object: 'model', created: 0, owned_by: 'openai', capabilities: { tools: true } },
    { id: 'local-bitnet/bitnet-2b', object: 'model', created: 0, owned_by: 'local', capabilities: { tools: false } },
    { id: 'cli-claude/claude-opus-4-6', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'openai-codex/gpt-5.4', object: 'model', created: 0, owned_by: 'openai', capabilities: { tools: true } },
    // Unknown model to test fallback
    { id: 'web-claude/claude-unknown-99', object: 'model', created: 0, owned_by: 'anthropic' },
  ]),
}));

describe('model-registry', () => {
  beforeEach(async () => {
    // Force cache refresh
    await getModelRegistry();
  });

  // ── Context windows and max tokens ──────────────────────────────────────

  describe('per-model limits', () => {
    it('Claude Opus 4.6 (web) has 1M context and 128K max output', async () => {
      const caps = getModelCapabilities('web-claude/claude-opus');
      expect(caps).toBeDefined();
      expect(caps!.contextWindow).toBe(1_000_000);
      expect(caps!.maxTokens).toBe(128_000);
    });

    it('Claude Sonnet 4.6 (web) has 1M context and 64K max output', () => {
      const caps = getModelCapabilities('web-claude/claude-sonnet');
      expect(caps!.contextWindow).toBe(1_000_000);
      expect(caps!.maxTokens).toBe(64_000);
    });

    it('Claude Haiku 4.5 (web) has 200K context and 64K max output', () => {
      const caps = getModelCapabilities('web-claude/claude-haiku');
      expect(caps!.contextWindow).toBe(200_000);
      expect(caps!.maxTokens).toBe(64_000);
    });

    it('Claude Opus 4.6 (CLI) has 1M context and 128K max output', () => {
      const caps = getModelCapabilities('cli-claude/claude-opus-4-6');
      expect(caps!.contextWindow).toBe(1_000_000);
      expect(caps!.maxTokens).toBe(128_000);
    });

    it('Grok Fast has 2M context and 131K max output', () => {
      const caps = getModelCapabilities('web-grok/grok-fast');
      expect(caps!.contextWindow).toBe(2_000_000);
      expect(caps!.maxTokens).toBe(131_072);
    });

    it('Grok Expert has 256K context and 131K max output', () => {
      const caps = getModelCapabilities('web-grok/grok-expert');
      expect(caps!.contextWindow).toBe(256_000);
      expect(caps!.maxTokens).toBe(131_072);
    });

    it('Gemini 3.1 Pro has 1M context and 65K max output', () => {
      const caps = getModelCapabilities('web-gemini/gemini-3.1-pro');
      expect(caps!.contextWindow).toBe(1_000_000);
      expect(caps!.maxTokens).toBe(65_536);
    });

    it('GPT-5.4 Pro has 1M context and 128K max output', () => {
      const caps = getModelCapabilities('web-chatgpt/gpt-5.4-pro');
      expect(caps!.contextWindow).toBe(1_050_000);
      expect(caps!.maxTokens).toBe(128_000);
    });

    it('GPT-5 Thinking Mini has 128K context and 16K max output', () => {
      const caps = getModelCapabilities('web-chatgpt/gpt-5-thinking-mini');
      expect(caps!.contextWindow).toBe(128_000);
      expect(caps!.maxTokens).toBe(16_384);
    });

    it('OpenAI Codex GPT-5.4 has 1M context and 128K max output', () => {
      const caps = getModelCapabilities('openai-codex/gpt-5.4');
      expect(caps!.contextWindow).toBe(1_050_000);
      expect(caps!.maxTokens).toBe(128_000);
    });

    it('BitNet has 4K context and 2K max output', () => {
      const caps = getModelCapabilities('local-bitnet/bitnet-2b');
      expect(caps!.contextWindow).toBe(4_096);
      expect(caps!.maxTokens).toBe(2_048);
    });

    it('unknown model from known provider uses provider fallback', () => {
      const caps = getModelCapabilities('web-claude/claude-unknown-99');
      expect(caps).toBeDefined();
      // Should use web-claude fallback: 200K ctx, 64K max
      expect(caps!.contextWindow).toBe(200_000);
      expect(caps!.maxTokens).toBe(64_000);
    });
  });

  // ── Provider extraction ─────────────────────────────────────────────────

  describe('provider', () => {
    it('extracts provider from model ID prefix', () => {
      expect(getModelCapabilities('web-claude/claude-opus')!.provider).toBe('web-claude');
      expect(getModelCapabilities('web-grok/grok-fast')!.provider).toBe('web-grok');
      expect(getModelCapabilities('cli-claude/claude-opus-4-6')!.provider).toBe('cli-claude');
      expect(getModelCapabilities('openai-codex/gpt-5.4')!.provider).toBe('openai-codex');
    });
  });

  // ── Tier and mode support ───────────────────────────────────────────────

  describe('tiers and modes', () => {
    it('tier 1 models support all modes', () => {
      const caps = getModelCapabilities('web-claude/claude-opus');
      expect(caps!.tier).toBe(1);
      expect(caps!.supportedModes).toEqual(['ask', 'edit', 'agent', 'plan']);
    });

    it('tier 2 models support ask, edit, plan but not agent', () => {
      const caps = getModelCapabilities('web-grok/grok-fast');
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
      expect(getModelCapabilities('web-claude/claude-opus')!.name).toBe('Claude Opus 4.6');
      expect(getModelCapabilities('web-grok/grok-fast')!.name).toBe('Grok Fast');
      expect(getModelCapabilities('local-bitnet/bitnet-2b')!.name).toBe('BitNet 1.58 2B');
    });

    it('unknown models use the model ID part after the slash', () => {
      expect(getModelCapabilities('web-claude/claude-unknown-99')!.name).toBe('claude-unknown-99');
    });
  });

  // ── supportsMode ────────────────────────────────────────────────────────

  describe('supportsMode', () => {
    it('returns true for supported modes', () => {
      expect(supportsMode('web-claude/claude-opus', 'agent')).toBe(true);
      expect(supportsMode('web-claude/claude-opus', 'ask')).toBe(true);
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
      const result = getModeRecommendation(models, 'web-claude/claude-opus', 'agent');
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
      const trimmed = trimHistoryForModel(messages, 'web-claude/claude-opus');
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
    it('maps web- prefix to web category', () => {
      expect(getModelCapabilities('web-claude/claude-opus')!.category).toBe('web');
      expect(getModelCapabilities('web-grok/grok-fast')!.category).toBe('web');
    });

    it('maps cli- prefix to cli category', () => {
      expect(getModelCapabilities('cli-claude/claude-opus-4-6')!.category).toBe('cli');
    });

    it('maps openai-codex/ to codex category', () => {
      expect(getModelCapabilities('openai-codex/gpt-5.4')!.category).toBe('codex');
    });

    it('maps local- prefix to local category', () => {
      expect(getModelCapabilities('local-bitnet/bitnet-2b')!.category).toBe('local');
    });
  });

  // ── Tools support ───────────────────────────────────────────────────────

  describe('supportsTools', () => {
    it('reflects capabilities from model info', () => {
      expect(getModelCapabilities('web-claude/claude-opus')!.supportsTools).toBe(true);
      expect(getModelCapabilities('web-grok/grok-fast')!.supportsTools).toBe(false);
      expect(getModelCapabilities('local-bitnet/bitnet-2b')!.supportsTools).toBe(false);
    });
  });
});
