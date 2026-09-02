import { describe, it, expect } from 'vitest';
import {
  normalizeProvider,
  normalizeBridgeStatus,
  isProviderConnected,
  connectedProviderCount,
  providerStatusLabel,
  displayProviderName,
} from '../bridge-status';

/** Live-shaped v0.5.2 payloads from GET /v1/status. */
const cliGrok = {
  name: 'cli-grok',
  connected: true,
  models: ['cli-grok/grok-4.6', 'cli-grok/grok-4.5', 'cli-grok/grok-4.3'],
  loginType: 'cli',
  credentialSource: 'CLI login',
};

const claudeApi = {
  name: 'claude-api',
  connected: false,
  models: ['api-claude/claude-opus-5'],
  loginType: 'api-key',
  credentialSource: 'Not detected',
};

const lmStudio = {
  name: 'lmstudio',
  connected: true,
  models: ['lmstudio/gpt-oss-20b'],
  loginType: 'local',
  credentialSource: '',
};

describe('normalizeProvider', () => {
  it('treats a connected CLI provider as connected', () => {
    const p = normalizeProvider(cliGrok);
    expect(p.name).toBe('cli-grok');
    expect(p.connected).toBe(true);
    expect(p.loginType).toBe('cli');
    expect(p.credentialSource).toBe('CLI login');
    expect(p.models).toEqual(['cli-grok/grok-4.6', 'cli-grok/grok-4.5', 'cli-grok/grok-4.3']);
    expect(isProviderConnected(p)).toBe(true);
  });

  it('treats a disconnected API provider as not connected', () => {
    const p = normalizeProvider(claudeApi);
    expect(p.connected).toBe(false);
    expect(p.loginType).toBe('api-key');
    expect(isProviderConnected(p)).toBe(false);
  });

  it('does not invent connected from missing fields', () => {
    const p = normalizeProvider({
      name: 'cli-claude',
      models: ['cli-claude/claude-opus-5'],
    });
    expect(p.connected).toBe(false);
    expect(isProviderConnected(p)).toBe(false);
  });
});

describe('connectedProviderCount', () => {
  it('counts CLI and local providers that report connected', () => {
    const status = normalizeBridgeStatus({
      running: true,
      port: 31338,
      version: '0.5.2',
      uptime: 12,
      providers: [cliGrok, claudeApi, lmStudio],
    });
    expect(status.running).toBe(true);
    expect(status.version).toBe('0.5.2');
    expect(connectedProviderCount(status)).toBe(2);
  });

  it('returns 0 when every provider is disconnected', () => {
    const status = normalizeBridgeStatus({
      running: true,
      port: 31338,
      version: '0.5.2',
      uptime: 1,
      providers: [claudeApi],
    });
    expect(connectedProviderCount(status)).toBe(0);
  });
});

describe('providerStatusLabel', () => {
  it('labels a connected CLI provider as CLI authenticated', () => {
    expect(providerStatusLabel(normalizeProvider(cliGrok))).toBe('CLI authenticated');
  });

  it('labels a disconnected API provider as missing credential', () => {
    expect(providerStatusLabel(normalizeProvider(claudeApi))).toBe('No API credential - add a key in Settings');
  });

  it('labels a connected local provider as local service available', () => {
    expect(providerStatusLabel(normalizeProvider(lmStudio))).toBe('Local service available');
  });

  it('labels an uninstalled CLI from credentialSource', () => {
    const p = normalizeProvider({
      name: 'cli-gemini',
      connected: false,
      loginType: 'cli',
      credentialSource: 'CLI not installed',
      models: [],
    });
    expect(providerStatusLabel(p)).toBe('CLI unavailable - install the tool');
  });
});

describe('displayProviderName', () => {
  it('renders the ten v0.5.2 provider ids', () => {
    expect(displayProviderName('cli-grok')).toBe('Grok (CLI)');
    expect(displayProviderName('cli-claude')).toBe('Claude (CLI)');
    expect(displayProviderName('cli-codex')).toBe('Codex (CLI)');
    expect(displayProviderName('cli-gemini')).toBe('Gemini (CLI)');
    expect(displayProviderName('claude-api')).toBe('Claude (API)');
    expect(displayProviderName('openrouter-api')).toBe('OpenRouter (API)');
    expect(displayProviderName('lmstudio')).toBe('LM Studio');
  });
});
