import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    proxyUrl: 'http://127.0.0.1:31338',
    apiKey: 'cli-bridge',
    defaultModel: 'cli-claude/claude-opus-5',
    requestTimeout: 330_000,
    localEndpoints: [],
  })),
}));

import { RequestTimeoutError, isRequestTimeout } from '../proxy-client';
import { CLI_MODELS, MODEL_FALLBACKS } from '../cli-runner';

// Captured from a live conduit-bridge 0.8.0 GET /v1/models.
const LIVE_IDS = [
  'cli-claude/claude-opus-5', 'cli-claude/claude-sonnet-5',
  'cli-claude/claude-haiku-4-5', 'cli-claude/claude-fable-5',
  'cli-gemini/gemini-3.8-flash-high', 'cli-gemini/gemini-3.8-flash-medium',
  'cli-gemini/gemini-3.8-flash-low', 'cli-gemini/gemini-3.7-flash-high',
  'cli-gemini/gemini-3.6-flash-high', 'cli-gemini/gemini-3.1-pro-high',
  'cli-gemini/gemini-3.1-pro-low', 'cli-gemini/claude-sonnet-4-6',
  'cli-grok/grok-4.6', 'cli-grok/grok-4.5',
  'cli-codex/gpt-5.6-sol', 'cli-codex/gpt-5.6-terra', 'cli-codex/gpt-5.6-luna',
  'cli-codex/gpt-5.5', 'cli-codex/gpt-5.4', 'cli-codex/gpt-5.4-mini',
];

describe('RequestTimeoutError', () => {
  // The old code threw Error('timeout') here and 'Stream request timed out
  // after 120s' there, and callers tested msg.includes('timeout'). "timed out"
  // has no "timeout" in it, so the streaming case never matched — while the
  // bridge's own "timeout: … killed by supervisor" (a provider failure) did.
  it('is recognisable without matching on message text', () => {
    const err = new RequestTimeoutError(330_000);
    expect(isRequestTimeout(err)).toBe(true);
    expect(err.timeoutMs).toBe(330_000);
  });

  it('does not classify a provider failure as a client timeout', () => {
    const providerKill = new Error(
      'cli-gemini exited 143: timeout: agy/gemini CLI killed by supervisor (exit 143)',
    );
    expect(isRequestTimeout(providerKill)).toBe(false);
    // The substring test the old code used would have got this exactly backwards.
    expect(providerKill.message.includes('timeout')).toBe(true);
    expect(new RequestTimeoutError(1000).message.includes('timeout')).toBe(false);
  });

  it('says how long it waited, so the number is actionable', () => {
    expect(new RequestTimeoutError(330_000).message).toMatch(/330s/);
  });
});

describe('model ids the bridge still serves', () => {
  // conduit-bridge 0.8.0 discovers catalogs at runtime, so a hardcoded id can be
  // retired upstream without anything here noticing. gemini-3.5-flash-high was
  // exactly that: offered in three quick pickers, and agy rejects it (HTTP 503).
  it('the spawn picker offers no retired model', () => {
    for (const m of CLI_MODELS) {
      expect(LIVE_IDS, m.id).toContain(m.id);
    }
  });

  it('every fallback chain ends somewhere the bridge can serve', () => {
    for (const [from, to] of Object.entries(MODEL_FALLBACKS)) {
      expect(LIVE_IDS, `${from} -> ${to}`).toContain(to);
    }
  });

  it('no chain points at the retired gemini-3.5 family', () => {
    const targets = Object.values(MODEL_FALLBACKS);
    expect(targets.some(t => t.includes('gemini-3.5'))).toBe(false);
    expect(CLI_MODELS.some(m => m.id.includes('gemini-3.5'))).toBe(false);
  });

  it('a fallback never points back at its own source', () => {
    for (const [from, to] of Object.entries(MODEL_FALLBACKS)) {
      expect(to, from).not.toBe(from);
    }
  });
});

describe('spawnCliAgent without a workspace', () => {
  beforeEach(() => vi.resetModules());

  // mode=agent needs cwd; the bridge answers HTTP 400 without it. Undefined is
  // dropped by JSON.stringify, so the request looked valid and the reason landed
  // only in the output channel — after the caller had already created a worktree
  // and a branch for the run.
  it('fails with an actionable message instead of a bridge 400', async () => {
    const { spawnCliAgent } = await import('../cli-runner');
    const handle = spawnCliAgent('cli-claude/claude-opus-5', [{ role: 'user', content: 'hi' }]);
    const result = await handle.result;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/workspace folder/i);
    expect(result.stderr).toMatch(/cwd/);
  });
});
