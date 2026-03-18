/**
 * cli-runner-failover.test.ts — Tests for model failover chain.
 *
 * Mocks @elvatis_com/agent-backends at the module level so cli-runner.ts
 * picks up controlled runCli behavior for testing failover logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock agent-backends — vi.mock is hoisted, so we use vi.fn() inline
vi.mock('@elvatis_com/agent-backends', () => ({
  formatPrompt: vi.fn((msgs: any[]) => msgs.map((m: any) => String(m.content ?? '')).join('\n')),
  buildMinimalEnv: vi.fn(() => ({})),
  ensureGitRepo: vi.fn(),
  runCli: vi.fn(),
  detectInstalledClis: vi.fn(() => []),
  buildBackendConfig: vi.fn(() => ({
    cmd: 'mock', args: [], stdinPrompt: 'test', cwd: '/tmp', shell: false,
  })),
  spawnAgent: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => false), readFileSync: vi.fn(() => '{}') };
});

// Import AFTER mocks are set up
import { runCli } from '@elvatis_com/agent-backends';
import { routeToCliRunnerWithFallback, MODEL_FALLBACKS, type ChatMessage } from '../cli-runner';

const mockRunCli = vi.mocked(runCli);

function msgs(content: string): ChatMessage[] {
  return [{ role: 'user', content }];
}

describe('model failover chain', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns primary model on success', async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: 'Gemini ok', stderr: '', exitCode: 0 });
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', msgs('test'), 30_000);
    expect(r.fallbackUsed).toBe(false);
    expect(r.model).toBe('cli-gemini/gemini-2.5-pro');
    expect(r.output).toContain('Gemini ok');
  });

  it('falls back on 429', async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: '429 Too Many Requests', exitCode: 1 });
    mockRunCli.mockResolvedValueOnce({ stdout: 'Flash ok', stderr: '', exitCode: 0 });
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', msgs('test'), 30_000);
    expect(r.fallbackUsed).toBe(true);
    expect(r.model).toBe('cli-gemini/gemini-2.5-flash');
    expect(r.fallbackReason).toContain('429');
  });

  it('does NOT fall back on non-transient errors', async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: 'SyntaxError: unexpected', exitCode: 1 });
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', msgs('t'), 30_000))
      .rejects.toThrow('SyntaxError');
  });

  it('walks multi-step chain (opus -> sonnet -> haiku)', async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: 'rate limit', exitCode: 1 });
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: 'too many requests', exitCode: 1 });
    mockRunCli.mockResolvedValueOnce({ stdout: 'Haiku ok', stderr: '', exitCode: 0 });
    const r = await routeToCliRunnerWithFallback('cli-claude/claude-opus-4-6', msgs('t'), 30_000, undefined, 3);
    expect(r.model).toBe('cli-claude/claude-haiku-4-5');
  });

  it('throws when all fallbacks exhausted', async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: '429', exitCode: 1 });
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: '503', exitCode: 1 });
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', msgs('t'), 30_000))
      .rejects.toThrow(/All models failed/);
  });

  it('respects maxFallbacks=0', async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: '429', exitCode: 1 });
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', msgs('t'), 30_000, undefined, 0))
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
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: 'ETIMEDOUT', exitCode: 1 });
    mockRunCli.mockResolvedValueOnce({ stdout: 'Flash ok', stderr: '', exitCode: 0 });
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', msgs('t'), 30_000);
    expect(r.fallbackUsed).toBe(true);
  });

  it('falls back on overloaded errors', async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: '', stderr: 'overloaded', exitCode: 1 });
    mockRunCli.mockResolvedValueOnce({ stdout: 'Sonnet ok', stderr: '', exitCode: 0 });
    const r = await routeToCliRunnerWithFallback('cli-claude/claude-opus-4-6', msgs('t'), 30_000);
    expect(r.fallbackUsed).toBe(true);
    expect(r.model).toBe('cli-claude/claude-sonnet-4-6');
  });
});
