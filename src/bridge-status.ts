/**
 * conduit-bridge /v1/status contract (v0.5.2).
 *
 * Provider names, loginType, and connected semantics come from
 * elvatis/conduit-bridge src/types.ts. CLI connected means installed
 * and authenticated, not merely on PATH. There are no web-* providers.
 */

export type LoginType = 'api-key' | 'cli' | 'local';

export type ProviderName =
  | 'claude-api' | 'gemini-api' | 'codex-api'
  | 'openrouter-api' | 'perplexity-api'
  | 'lmstudio'
  | 'cli-grok' | 'cli-codex' | 'cli-claude' | 'cli-gemini';

export interface ProviderStatus {
  name: string;
  connected: boolean;
  models: string[];
  loginType: LoginType;
  credentialSource?: string;
}

export interface BridgeStatus {
  running: boolean;
  port: number;
  version: string;
  providers: ProviderStatus[];
  uptime: number;
}

export function isProviderConnected(provider: Pick<ProviderStatus, 'connected'>): boolean {
  return provider.connected === true;
}

export function connectedProviderCount(status: Pick<BridgeStatus, 'providers'>): number {
  return (status.providers ?? []).filter(isProviderConnected).length;
}

function asLoginType(value: unknown): LoginType {
  if (value === 'api-key' || value === 'cli' || value === 'local') return value;
  return 'api-key';
}

export function normalizeProvider(raw: unknown): ProviderStatus {
  const p = (raw ?? {}) as Record<string, unknown>;
  const name = typeof p.name === 'string' && p.name ? p.name : 'unknown';
  const models = Array.isArray(p.models)
    ? p.models.filter((m): m is string => typeof m === 'string')
    : [];
  const connected = p.connected === true;
  const loginType = asLoginType(p.loginType);
  const credentialSource = typeof p.credentialSource === 'string' ? p.credentialSource : undefined;
  return { name, connected, loginType, credentialSource, models };
}

export function normalizeBridgeStatus(raw: unknown): BridgeStatus {
  const s = (raw ?? {}) as Record<string, unknown>;
  const providers = Array.isArray(s.providers) ? s.providers.map(normalizeProvider) : [];
  return {
    running: s.running === true,
    port: typeof s.port === 'number' ? s.port : 31338,
    version: typeof s.version === 'string' ? s.version : '',
    providers,
    uptime: typeof s.uptime === 'number' ? s.uptime : 0,
  };
}

/** Labels match conduit-bridge dashboard.ts provider cards. */
export function providerStatusLabel(provider: ProviderStatus): string {
  if (provider.connected) {
    if (provider.loginType === 'api-key') return 'API credential available';
    if (provider.loginType === 'cli') return 'CLI authenticated';
    return 'Local service available';
  }
  if (provider.loginType === 'api-key') return 'No API credential - add a key in Settings';
  if (provider.loginType === 'cli') {
    return provider.credentialSource === 'CLI not installed'
      ? 'CLI unavailable - install the tool'
      : 'CLI unavailable - authenticate the tool';
  }
  return 'Local service unavailable';
}

const PROVIDER_DISPLAY: Record<string, string> = {
  'cli-grok': 'Grok (CLI)',
  'cli-claude': 'Claude (CLI)',
  'cli-gemini': 'Gemini (CLI)',
  'cli-codex': 'Codex (CLI)',
  'claude-api': 'Claude (API)',
  'gemini-api': 'Gemini (API)',
  'codex-api': 'Codex (API)',
  'openrouter-api': 'OpenRouter (API)',
  'perplexity-api': 'Perplexity (API)',
  lmstudio: 'LM Studio',
};

export interface ProviderView extends ProviderStatus {
  displayName: string;
  statusLabel: string;
  indicator: 'ok' | 'err';
}

export function toProviderView(provider: ProviderStatus): ProviderView {
  return {
    ...provider,
    displayName: displayProviderName(provider.name),
    statusLabel: providerStatusLabel(provider),
    indicator: provider.connected ? 'ok' : 'err',
  };
}

export function displayProviderName(name: string): string {
  if (PROVIDER_DISPLAY[name]) return PROVIDER_DISPLAY[name];
  if (name.startsWith('cli-')) return `${titleCase(name.slice(4))} (CLI)`;
  if (name.endsWith('-api')) return `${titleCase(name.slice(0, -4))} (API)`;
  return titleCase(name);
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
