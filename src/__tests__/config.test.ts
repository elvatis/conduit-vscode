import { describe, it, expect, vi } from 'vitest';
import { getConfig, onConfigChange } from '../config';

describe('getConfig', () => {
  it('returns default values when no configuration is set', () => {
    const cfg = getConfig();
    expect(cfg.proxyUrl).toBe('http://127.0.0.1:31337');
    expect(cfg.apiKey).toBe('cli-bridge');
    expect(cfg.defaultModel).toBe('cli-gemini/gemini-2.5-pro');
    expect(cfg.inlineSuggestions).toBe(true);
    expect(cfg.inlineTriggerDelay).toBe(600);
    expect(cfg.contextLines).toBe(80);
    expect(cfg.includeOpenFiles).toBe(true);
    expect(cfg.maxOpenFilesContext).toBe(3);
    expect(cfg.terminalIntegration).toBe(true);
    expect(cfg.autoStatusBar).toBe(true);
  });

  it('returns all expected config keys', () => {
    const cfg = getConfig();
    const keys = Object.keys(cfg);
    expect(keys).toContain('proxyUrl');
    expect(keys).toContain('apiKey');
    expect(keys).toContain('defaultModel');
    expect(keys).toContain('inlineSuggestions');
    expect(keys).toContain('inlineTriggerDelay');
    expect(keys).toContain('contextLines');
    expect(keys).toContain('includeOpenFiles');
    expect(keys).toContain('maxOpenFilesContext');
    expect(keys).toContain('terminalIntegration');
    expect(keys).toContain('autoStatusBar');
  });

  it('proxyUrl is a valid URL', () => {
    const cfg = getConfig();
    expect(() => new URL(cfg.proxyUrl)).not.toThrow();
  });
});

describe('onConfigChange', () => {
  it('returns a disposable', () => {
    const disposable = onConfigChange(() => {});
    expect(disposable).toBeDefined();
    expect(typeof disposable.dispose).toBe('function');
  });
});
