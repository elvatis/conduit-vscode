/**
 * agent-backends.test.ts — Tests for the shared agent backend abstraction.
 *
 * Covers:
 * - formatPrompt (message serialization)
 * - buildMinimalEnv (environment construction)
 * - buildBackendConfig (CLI command building for each provider)
 * - ensureGitRepo (git init for codex)
 * - detectInstalledClis (CLI availability check)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '/usr/bin/claude'),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
  };
});

import { execSync } from 'child_process';
import * as fs from 'fs';
import {
  formatPrompt,
  buildMinimalEnv,
  buildBackendConfig,
  ensureGitRepo,
  detectInstalledClis,
  type ChatMessage,
} from '../agent-backends';

describe('agent-backends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── formatPrompt ──────────────────────────────────────────────────────

  describe('formatPrompt', () => {
    it('returns empty string for empty messages', () => {
      expect(formatPrompt([])).toBe('');
    });

    it('returns plain text for single user message', () => {
      const msgs: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
      expect(formatPrompt(msgs)).toBe('Hello');
    });

    it('formats multi-role conversation', () => {
      const msgs: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'How are you?' },
      ];
      const result = formatPrompt(msgs);
      expect(result).toContain('[System]');
      expect(result).toContain('You are helpful');
      expect(result).toContain('[User]');
      expect(result).toContain('[Assistant]');
    });

    it('handles content parts array', () => {
      const msgs: ChatMessage[] = [{
        role: 'user',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
          { type: 'image', text: undefined },
        ],
      }];
      const result = formatPrompt(msgs);
      expect(result).toContain('Part 1');
      expect(result).toContain('Part 2');
    });

    it('truncates long messages', () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'x'.repeat(5000) },
      ];
      const result = formatPrompt(msgs);
      expect(result.length).toBeLessThan(5000);
      expect(result).toContain('truncated');
    });

    it('limits to MAX_MESSAGES recent messages', () => {
      const msgs: ChatMessage[] = [];
      for (let i = 0; i < 30; i++) {
        msgs.push({ role: 'user', content: `Message ${i}` });
      }
      const result = formatPrompt(msgs);
      // Should contain recent messages but not the oldest ones
      expect(result).toContain('Message 29');
      expect(result).not.toContain('Message 0');
    });

    it('always includes system message regardless of position', () => {
      const msgs: ChatMessage[] = [
        { role: 'system', content: 'SYSTEM PROMPT' },
        ...Array.from({ length: 25 }, (_, i) => ({
          role: 'user' as const,
          content: `Msg ${i}`,
        })),
      ];
      const result = formatPrompt(msgs);
      expect(result).toContain('SYSTEM PROMPT');
    });
  });

  // ── buildMinimalEnv ───────────────────────────────────────────────────

  describe('buildMinimalEnv', () => {
    it('includes NO_COLOR and TERM', () => {
      const env = buildMinimalEnv();
      expect(env.NO_COLOR).toBe('1');
      expect(env.TERM).toBe('dumb');
    });

    it('passes through HOME and PATH', () => {
      const env = buildMinimalEnv();
      // These should be present on any system
      if (process.env.HOME) expect(env.HOME).toBe(process.env.HOME);
      if (process.env.PATH) expect(env.PATH).toBe(process.env.PATH);
    });

    it('passes through API keys if set', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const env = buildMinimalEnv();
      expect(env.ANTHROPIC_API_KEY).toBe('test-key');
      if (original) process.env.ANTHROPIC_API_KEY = original;
      else delete process.env.ANTHROPIC_API_KEY;
    });
  });

  // ── buildBackendConfig ────────────────────────────────────────────────

  describe('buildBackendConfig', () => {
    it('builds gemini config', () => {
      const config = buildBackendConfig('cli-gemini/gemini-2.5-pro', 'test prompt', '/workspace');
      expect(config.cmd).toBe('gemini');
      expect(config.args).toContain('-m');
      expect(config.args).toContain('gemini-2.5-pro');
      expect(config.stdinPrompt).toBe('test prompt');
      expect(config.cwd).toBe('/workspace');
    });

    it('builds claude config', () => {
      const config = buildBackendConfig('cli-claude/claude-sonnet-4-6', 'test', '/workspace');
      expect(config.cmd).toBe('claude');
      expect(config.args).toContain('--model');
      expect(config.args).toContain('claude-sonnet-4-6');
      expect(config.args).toContain('--permission-mode');
      expect(config.args).toContain('plan');
    });

    it('builds codex config with git init', () => {
      (fs.existsSync as any).mockReturnValue(false);
      const config = buildBackendConfig('openai-codex/gpt-5.3-codex', 'test', '/workspace');
      expect(config.cmd).toBe('codex');
      expect(config.args).toContain('--full-auto');
      expect(config.shell).toBe(true);
      // ensureGitRepo should have been called
      expect(execSync).toHaveBeenCalledWith('git init', expect.objectContaining({ cwd: '/workspace' }));
    });

    it('builds opencode config', () => {
      const config = buildBackendConfig('opencode/default', 'test prompt');
      expect(config.cmd).toBe('opencode');
      expect(config.args).toContain('run');
      expect(config.stdinPrompt).toBe(''); // opencode gets prompt via args
    });

    it('builds pi config', () => {
      const config = buildBackendConfig('pi/default', 'test prompt');
      expect(config.cmd).toBe('pi');
      expect(config.args).toContain('-p');
      expect(config.stdinPrompt).toBe(''); // pi gets prompt via args
    });

    it('throws for unknown model prefix', () => {
      expect(() => buildBackendConfig('unknown/model', 'test')).toThrow('Unknown model');
    });
  });

  // ── ensureGitRepo ─────────────────────────────────────────────────────

  describe('ensureGitRepo', () => {
    it('inits git if .git does not exist', () => {
      (fs.existsSync as any).mockReturnValue(false);
      ensureGitRepo('/some/dir');
      expect(execSync).toHaveBeenCalledWith('git init', expect.objectContaining({ cwd: '/some/dir' }));
    });

    it('skips init if .git already exists', () => {
      (fs.existsSync as any).mockReturnValue(true);
      ensureGitRepo('/some/dir');
      // execSync should NOT be called for git init
      expect(execSync).not.toHaveBeenCalledWith('git init', expect.anything());
    });
  });

  // ── detectInstalledClis ───────────────────────────────────────────────

  describe('detectInstalledClis', () => {
    it('returns array of CLI info objects', () => {
      (execSync as any).mockReturnValue('/usr/bin/claude\n');
      const clis = detectInstalledClis();
      expect(clis.length).toBe(5);
      expect(clis.map(c => c.name)).toEqual(['claude', 'gemini', 'codex', 'opencode', 'pi']);
    });

    it('marks unavailable CLIs', () => {
      (execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/bin/claude';
        throw new Error('not found');
      });
      const clis = detectInstalledClis();
      const claude = clis.find(c => c.name === 'claude');
      const gemini = clis.find(c => c.name === 'gemini');
      expect(claude?.available).toBe(true);
      expect(gemini?.available).toBe(false);
    });
  });
});
