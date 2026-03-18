/**
 * agent-backends.test.ts — Tests for the shared agent backend abstraction.
 *
 * Tests:
 * 1. formatPrompt (shared with cli-runner, canonical implementation)
 * 2. buildMinimalEnv
 * 3. buildBackendConfig for each supported prefix
 * 4. detectInstalledClis
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

import {
  formatPrompt,
  buildMinimalEnv,
  buildBackendConfig,
  detectInstalledClis,
  type ChatMessage,
} from '../agent-backends';
import { execSync } from 'child_process';

describe('agent-backends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatPrompt', () => {
    it('returns empty string for empty messages', () => {
      expect(formatPrompt([])).toBe('');
    });

    it('returns plain text for single user message', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      expect(formatPrompt(messages)).toBe('Hello');
    });

    it('formats multi-role messages with labels', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ];
      const result = formatPrompt(messages);
      expect(result).toContain('[System]');
      expect(result).toContain('[User]');
      expect(result).toContain('[Assistant]');
    });

    it('handles ContentPart arrays', () => {
      const messages: ChatMessage[] = [{
        role: 'user',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'image_url', text: undefined },
          { type: 'text', text: 'Part 2' },
        ],
      }];
      const result = formatPrompt(messages);
      expect(result).toContain('Part 1');
      expect(result).toContain('Part 2');
    });

    it('truncates long content', () => {
      const longContent = 'x'.repeat(5000);
      const messages: ChatMessage[] = [{ role: 'user', content: longContent }];
      const result = formatPrompt(messages);
      expect(result.length).toBeLessThan(longContent.length);
      expect(result).toContain('truncated');
    });

    it('limits to last 20 non-system messages', () => {
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 30; i++) {
        messages.push({ role: 'user', content: `msg-${i}` });
      }
      const result = formatPrompt(messages);
      expect(result).not.toContain('msg-0');
      expect(result).toContain('msg-29');
    });

    it('keeps system message even with many non-system messages', () => {
      const messages: ChatMessage[] = [{ role: 'system', content: 'SYSTEM' }];
      for (let i = 0; i < 25; i++) {
        messages.push({ role: 'user', content: `msg-${i}` });
      }
      const result = formatPrompt(messages);
      expect(result).toContain('[System]');
      expect(result).toContain('SYSTEM');
    });

    it('handles null and undefined content', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: null },
        { role: 'user', content: undefined },
      ];
      const result = formatPrompt(messages);
      expect(result).toBeDefined();
    });
  });

  describe('buildMinimalEnv', () => {
    it('always includes NO_COLOR and TERM', () => {
      const env = buildMinimalEnv();
      expect(env.NO_COLOR).toBe('1');
      expect(env.TERM).toBe('dumb');
    });

    it('includes PATH if set', () => {
      const env = buildMinimalEnv();
      if (process.env.PATH) {
        expect(env.PATH).toBe(process.env.PATH);
      }
    });

    it('includes HOME if set', () => {
      const env = buildMinimalEnv();
      if (process.env.HOME) {
        expect(env.HOME).toBe(process.env.HOME);
      }
    });
  });

  describe('buildBackendConfig', () => {
    it('builds gemini config', () => {
      const config = buildBackendConfig('cli-gemini/gemini-2.5-flash', 'test prompt');
      expect(config.cmd).toBe('gemini');
      expect(config.args).toContain('-m');
      expect(config.args).toContain('gemini-2.5-flash');
      expect(config.stdinPrompt).toBe('test prompt');
      expect(config.shell).toBe(false);
    });

    it('builds claude config', () => {
      const config = buildBackendConfig('cli-claude/claude-sonnet-4-6', 'test prompt');
      expect(config.cmd).toBe('claude');
      expect(config.args).toContain('--model');
      expect(config.args).toContain('claude-sonnet-4-6');
      expect(config.args).toContain('--permission-mode');
      expect(config.stdinPrompt).toBe('test prompt');
    });

    it('builds codex config', () => {
      const config = buildBackendConfig('openai-codex/gpt-5.3-codex', 'test prompt', '/tmp/repo');
      expect(config.cmd).toBe('codex');
      expect(config.args).toContain('--model');
      expect(config.args).toContain('gpt-5.3-codex');
      expect(config.args).toContain('--full-auto');
      expect(config.shell).toBe(true);
    });

    it('builds opencode config', () => {
      const config = buildBackendConfig('opencode/default', 'test prompt');
      expect(config.cmd).toBe('opencode');
      expect(config.args).toContain('run');
      expect(config.stdinPrompt).toBe('');
    });

    it('builds pi config', () => {
      const config = buildBackendConfig('pi/default', 'test prompt');
      expect(config.cmd).toBe('pi');
      expect(config.args).toContain('-p');
      expect(config.stdinPrompt).toBe('');
    });

    it('throws for unknown model prefix', () => {
      expect(() => buildBackendConfig('unknown/model', 'test')).toThrow('Unknown model');
    });

    it('uses workdir when provided', () => {
      const config = buildBackendConfig('cli-claude/claude-sonnet-4-6', 'test', '/my/dir');
      expect(config.cwd).toBe('/my/dir');
    });

    it('extracts model name after slash', () => {
      const config = buildBackendConfig('cli-gemini/gemini-3-pro-preview', 'test');
      expect(config.args).toContain('gemini-3-pro-preview');
    });
  });

  describe('detectInstalledClis', () => {
    it('returns array of CliInfo objects', () => {
      const result = detectInstalledClis();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(5);
      expect(result.map(r => r.name)).toEqual(['claude', 'gemini', 'codex', 'opencode', 'pi']);
    });

    it('marks CLIs as available when found', () => {
      (execSync as any).mockReturnValue('/usr/bin/claude\n');
      const result = detectInstalledClis();
      expect(result[0].available).toBe(true);
      expect(result[0].path).toBe('/usr/bin/claude');
    });

    it('marks CLIs as unavailable on error', () => {
      (execSync as any).mockImplementation(() => { throw new Error('not found'); });
      const result = detectInstalledClis();
      for (const cli of result) {
        expect(cli.available).toBe(false);
      }
    });
  });
});
