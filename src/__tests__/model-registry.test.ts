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
    { id: 'cli-claude/claude-opus-5', object: 'model', created: 0, owned_by: 'claude-code', display_name: 'Claude Opus 5', context_window: 1_000_000, max_output_tokens: 128_000, capabilities: { tools: true } },
    { id: 'cli-claude/claude-sonnet-5', object: 'model', created: 0, owned_by: 'anthropic', capabilities: { tools: true } },
    { id: 'cli-claude/claude-haiku-4-5', object: 'model', created: 0, owned_by: 'claude-code', context_window: 200_000, max_output_tokens: 64_000, capabilities: { tools: true } },
    { id: 'cli-grok/grok-4.6', object: 'model', created: 0, owned_by: 'grok', context_window: 256_000, max_output_tokens: 131_072, capabilities: { tools: true } },
    { id: 'cli-grok/grok-4.3', object: 'model', created: 0, owned_by: 'xai', capabilities: { tools: false } },
    { id: 'cli-gemini/gemini-3.1-pro-high', object: 'model', created: 0, owned_by: 'agy', context_window: 1_000_000, max_output_tokens: 65_536, max_prompt_chars: 30_000, capabilities: { tools: true } },
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

  describe('limits come from the bridge', () => {
    // These numbers used to live in a MODEL_LIMITS table here, which could not
    // know any id released after the build — and once conduit-bridge started
    // discovering catalogs, that was most of them. The bridge reports them now
    // (context_window / max_output_tokens), discovered per provider where one
    // says, and overridable in ~/.conduit/models.json.
    it('uses the window the bridge reports', () => {
      const opus = getModelCapabilities('cli-claude/claude-opus-5');
      expect(opus!.contextWindow).toBe(1_000_000);
      expect(opus!.maxTokens).toBe(128_000);

      const haiku = getModelCapabilities('cli-claude/claude-haiku-4-5');
      expect(haiku!.contextWindow).toBe(200_000);
      expect(haiku!.maxTokens).toBe(64_000);
    });

    it('does not invent a number when the bridge omits one', () => {
      // An older bridge sends no limits; fall back rather than guess per model.
      const unknown = getModelCapabilities('cli-claude/claude-unknown-99');
      expect(unknown!.contextWindow).toBe(128_000);
      expect(unknown!.maxTokens).toBe(8_192);
    });

    it('carries the transport prompt ceiling through', () => {
      const gemini = getModelCapabilities('cli-gemini/gemini-3.1-pro-high');
      expect(gemini!.maxPromptChars).toBe(30_000);
      // agy takes the prompt on argv, so this is far below the token window.
      expect(gemini!.maxPromptChars!).toBeLessThan(gemini!.contextWindow);
    });

    it('every model handles every mode', () => {
      // Tiering was a local guess that silently withheld Agent from any id this
      // build had not heard of.
      for (const id of ['cli-claude/claude-opus-5', 'cli-claude/claude-unknown-99']) {
        expect(getModelCapabilities(id)!.supportedModes, id)
          .toEqual(['ask', 'edit', 'agent', 'plan']);
      }
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

    it('no model is barred from a mode', () => {
      // Tiering was a local guess about model quality. With a discovered catalog
      // every new id was unknown to the table and silently lost Agent mode — the
      // newest and usually strongest models first.
      for (const id of ['cli-claude/claude-haiku-4-5', 'cli-gemini/gemini-3.6-flash-high']) {
        expect(getModelCapabilities(id)!.supportedModes, id)
          .toEqual(['ask', 'edit', 'agent', 'plan']);
      }
    });

    it('an id this build has never heard of still supports every mode', () => {
      expect(getModelCapabilities('cli-claude/claude-unknown-99')!.supportedModes)
        .toEqual(['ask', 'edit', 'agent', 'plan']);
    });
  });

  // ── Display names ──────────────────────────────────────────────────────

  describe('display names', () => {
    it('uses the label the bridge supplies', () => {
      // The extension's own MODEL_DISPLAY_NAMES could not name an id released
      // after the build, so most of a discovered catalog rendered as a raw slug.
      expect(getModelCapabilities('cli-claude/claude-opus-5')!.name).toBe('Claude Opus 5');
    });

    it('falls back to a short name when the bridge sends none', () => {
      expect(getModelCapabilities('cli-claude/claude-unknown-99')!.name)
        .toBe('claude-unknown-99');
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

    it('returns true for every mode, because nothing is gated any more', () => {
      expect(supportsMode('cli-claude/claude-haiku-4-5', 'agent')).toBe(true);
      expect(supportsMode('cli-gemini/gemini-3.6-flash-high', 'agent')).toBe(true);
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

    it('reports every model compatible, because nothing is gated any more', async () => {
      // The recommendation existed to route around the tier gate. With no gate
      // there is nothing to route around — and the gate was the thing that
      // withheld Agent from every model this build had not heard of.
      const models = await getModelRegistry();
      for (const id of ['cli-claude/claude-haiku-4-5', 'cli-claude/claude-unknown-99']) {
        const result = getModeRecommendation(models, id, 'agent');
        expect(result.compatible, id).toBe(true);
        expect(result.suggestion, id).toBeUndefined();
      }
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
      // A local model the bridge never sees: 8192-token assumption,
      // so (8192 - 6000) * 3 = 6576 chars of budget for 16015 chars of history.
      const trimmed = trimHistoryForModel(messages, 'local-bitnet/bitnet-2b', 6000);
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
