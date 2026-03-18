/**
 * cli-runner-failover.test.ts — Tests for model failover chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '/usr/bin/claude'),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
  };
});

import { spawn } from 'child_process';
import { routeToCliRunnerWithFallback, MODEL_FALLBACKS, type ChatMessage } from '../cli-runner';

function makeMessages(content: string): ChatMessage[] {
  return [{ role: 'user', content }];
}

function mockSpawnResult(stdout: string, stderr: string, exitCode: number) {
  const mockProc = {
    stdin: {
      write: vi.fn((_data: string, _enc: string, cb: () => void) => cb()),
      end: vi.fn(),
    },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    pid: 12345,
  };

  mockProc.stdout.on.mockImplementation((event: string, handler: (d: Buffer) => void) => {
    if (event === 'data' && stdout) setTimeout(() => handler(Buffer.from(stdout)), 10);
  });
  mockProc.stderr.on.mockImplementation((event: string, handler: (d: Buffer) => void) => {
    if (event === 'data' && stderr) setTimeout(() => handler(Buffer.from(stderr)), 10);
  });
  mockProc.on.mockImplementation((event: string, handler: (code: number) => void) => {
    if (event === 'close') setTimeout(() => handler(exitCode), 20);
  });

  (spawn as any).mockReturnValueOnce(mockProc);
}

describe('model failover chain', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns primary model on success', async () => {
    mockSpawnResult('Hello', '', 0);
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', makeMessages('test'), 30_000);
    expect(r.fallbackUsed).toBe(false);
    expect(r.model).toBe('cli-gemini/gemini-2.5-pro');
  });

  it('falls back on 429', async () => {
    mockSpawnResult('', '429 Too Many Requests', 1);
    mockSpawnResult('Flash ok', '', 0);
    const r = await routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', makeMessages('test'), 30_000);
    expect(r.fallbackUsed).toBe(true);
    expect(r.model).toBe('cli-gemini/gemini-2.5-flash');
    expect(r.fallbackReason).toContain('429');
  });

  it('does NOT fall back on non-transient errors', async () => {
    mockSpawnResult('', 'SyntaxError: unexpected', 1);
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', makeMessages('t'), 30_000))
      .rejects.toThrow('SyntaxError');
  });

  it('walks multi-step chain (opus -> sonnet -> haiku)', async () => {
    mockSpawnResult('', 'rate limit', 1);
    mockSpawnResult('', 'too many requests', 1);
    mockSpawnResult('Haiku ok', '', 0);
    const r = await routeToCliRunnerWithFallback('cli-claude/claude-opus-4-6', makeMessages('t'), 30_000, undefined, 3);
    expect(r.model).toBe('cli-claude/claude-haiku-4-5');
  });

  it('throws when all fallbacks exhausted', async () => {
    mockSpawnResult('', '429', 1);
    mockSpawnResult('', '503', 1);
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', makeMessages('t'), 30_000))
      .rejects.toThrow(/All models failed/);
  });

  it('respects maxFallbacks=0', async () => {
    mockSpawnResult('', '429', 1);
    await expect(routeToCliRunnerWithFallback('cli-gemini/gemini-2.5-pro', makeMessages('t'), 30_000, undefined, 0))
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
});
