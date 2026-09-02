/**
 * cli-runner-failover.test.ts — Failover through conduit-bridge complete().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../proxy-client', () => ({
  complete: vi.fn(),
  stream: vi.fn(),
}));

import { complete } from '../proxy-client';
import { routeToCliRunnerWithFallback, MODEL_FALLBACKS, type ChatMessage } from '../cli-runner';

const mockComplete = vi.mocked(complete);

function msgs(content: string): ChatMessage[] {
  return [{ role: 'user', content }];
}

describe('model failover chain', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns primary model on success', async () => {
    mockComplete.mockResolvedValueOnce('Gemini ok');
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-3.1-pro-high', msgs('test'));
    expect(r.fallbackUsed).toBe(false);
    expect(r.model).toBe('cli-gemini/gemini-3.1-pro-high');
    expect(r.output).toContain('Gemini ok');
  });

  it('falls back on 429', async () => {
    mockComplete.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    mockComplete.mockResolvedValueOnce('Flash ok');
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-3.1-pro-high', msgs('test'));
    expect(r.fallbackUsed).toBe(true);
    expect(r.model).toBe('cli-gemini/gemini-3.6-flash-high');
    expect(r.fallbackReason).toContain('429');
  });

  it('does NOT fall back on non-transient errors', async () => {
    mockComplete.mockRejectedValueOnce(new Error('SyntaxError: unexpected'));
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-3.1-pro-high', msgs('t')))
      .rejects.toThrow('SyntaxError');
  });

  it('walks multi-step chain (opus -> sonnet -> haiku)', async () => {
    mockComplete.mockRejectedValueOnce(new Error('rate limit'));
    mockComplete.mockRejectedValueOnce(new Error('too many requests'));
    mockComplete.mockResolvedValueOnce('Haiku ok');
    const r = await routeToCliRunnerWithFallback('cli-claude/claude-opus-5', msgs('t'), undefined, undefined, 3);
    expect(r.model).toBe('cli-claude/claude-haiku-4-5');
  });

  it('throws when all fallbacks exhausted', async () => {
    mockComplete.mockRejectedValueOnce(new Error('429'));
    mockComplete.mockRejectedValueOnce(new Error('503'));
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-3.1-pro-high', msgs('t')))
      .rejects.toThrow(/All models failed/);
  });

  it('respects maxFallbacks=0', async () => {
    mockComplete.mockRejectedValueOnce(new Error('429'));
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-3.1-pro-high', msgs('t'), undefined, undefined, 0))
      .rejects.toThrow('429');
  });

  it('no circular references in fallback chain', () => {
    for (const [primary, fallback] of Object.entries(MODEL_FALLBACKS)) {
      const visited = new Set<string>();
      let current: string | undefined = fallback;
      while (current) {
        expect(visited.has(current), `Circular: ${primary} -> ... -> ${current}`).toBe(false);
        visited.add(current);
        current = MODEL_FALLBACKS[current];
      }
    }
  });

  it('falls back on timeout errors', async () => {
    mockComplete.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    mockComplete.mockResolvedValueOnce('Flash ok');
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-3.1-pro-high', msgs('t'));
    expect(r.fallbackUsed).toBe(true);
  });

  it('falls back on overloaded errors', async () => {
    mockComplete.mockRejectedValueOnce(new Error('overloaded'));
    mockComplete.mockResolvedValueOnce('Sonnet ok');
    const r = await routeToCliRunnerWithFallback('cli-claude/claude-opus-5', msgs('t'));
    expect(r.fallbackUsed).toBe(true);
    expect(r.model).toBe('cli-claude/claude-sonnet-5');
  });
});
