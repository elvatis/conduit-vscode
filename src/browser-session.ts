/**
 * browser-session.ts — Manages Playwright browser sessions for web AI providers.
 *
 * Uses persistent Chromium profiles so login sessions survive VS Code restarts.
 * Supports headed mode for initial login and headless mode for ongoing use.
 *
 * Profile dirs:
 *   ~/.conduit/grok-profile/
 *   ~/.conduit/gemini-profile/
 *   ~/.conduit/claude-profile/
 *   ~/.conduit/chatgpt-profile/
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

export type WebProvider = 'grok' | 'gemini' | 'claude' | 'chatgpt';

interface ProviderConfig {
  name: WebProvider;
  homeUrl: string;
  profileDir: string;
}

const CONDUIT_DIR = join(homedir(), '.conduit');

const PROVIDERS: Record<WebProvider, ProviderConfig> = {
  grok:    { name: 'grok',    homeUrl: 'https://grok.com',              profileDir: join(CONDUIT_DIR, 'grok-profile') },
  gemini:  { name: 'gemini',  homeUrl: 'https://gemini.google.com/app', profileDir: join(CONDUIT_DIR, 'gemini-profile') },
  claude:  { name: 'claude',  homeUrl: 'https://claude.ai/new',         profileDir: join(CONDUIT_DIR, 'claude-profile') },
  chatgpt: { name: 'chatgpt', homeUrl: 'https://chatgpt.com',           profileDir: join(CONDUIT_DIR, 'chatgpt-profile') },
};

const STEALTH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
];
const STEALTH_IGNORE_DEFAULTS = ['--enable-automation'];

// Dynamic import types — Playwright is optional
type BrowserContext = import('playwright').BrowserContext;
type Page = import('playwright').Page;

// Session state
const contexts: Partial<Record<WebProvider, BrowserContext>> = {};
let _log: (msg: string) => void = console.log;

export function setLogger(log: (msg: string) => void) {
  _log = log;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isConnected(provider: WebProvider): boolean {
  return contexts[provider] !== undefined && contexts[provider] !== null;
}

export function getContext(provider: WebProvider): BrowserContext | null {
  return contexts[provider] ?? null;
}

export function getConnectedProviders(): WebProvider[] {
  return (Object.keys(contexts) as WebProvider[]).filter(p => isConnected(p));
}

/**
 * Check if Playwright is installed (optional dependency).
 */
export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch a headed browser for the user to log in.
 * The browser stays open until the user closes it — session cookies are
 * saved in the persistent profile and reused for headless completions.
 */
export async function login(provider: WebProvider): Promise<boolean> {
  const cfg = PROVIDERS[provider];
  mkdirSync(cfg.profileDir, { recursive: true });

  try {
    const { chromium } = await import('playwright');
    _log(`[browser] Opening ${provider} login (headed)…`);

    // Close existing headless context if any
    if (contexts[provider]) {
      await contexts[provider]!.close().catch(() => {});
      contexts[provider] = undefined;
    }

    const ctx = await chromium.launchPersistentContext(cfg.profileDir, {
      headless: false,
      channel: 'chrome',
      args: STEALTH_ARGS,
      ignoreDefaultArgs: STEALTH_IGNORE_DEFAULTS,
    });

    const page = await ctx.newPage();
    await page.goto(cfg.homeUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    _log(`[browser] ${provider} browser opened — user logs in manually, then closes the browser`);

    // Wait for browser to close (user closes it after logging in)
    await new Promise<void>(resolve => {
      ctx.on('close', () => resolve());
    });

    _log(`[browser] ${provider} login browser closed — session saved`);

    // Now connect headlessly with saved cookies
    return await connect(provider);
  } catch (err) {
    _log(`[browser] ${provider} login failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Connect to a provider headlessly using saved persistent profile.
 * Returns true if the profile exists and the browser launches successfully.
 */
export async function connect(provider: WebProvider): Promise<boolean> {
  const cfg = PROVIDERS[provider];

  if (!existsSync(cfg.profileDir)) {
    _log(`[browser] ${provider} profile not found — login required`);
    return false;
  }

  try {
    const { chromium } = await import('playwright');
    _log(`[browser] Connecting to ${provider} headlessly…`);

    mkdirSync(cfg.profileDir, { recursive: true });
    const ctx = await chromium.launchPersistentContext(cfg.profileDir, {
      headless: true,
      channel: 'chrome',
      args: STEALTH_ARGS,
      ignoreDefaultArgs: STEALTH_IGNORE_DEFAULTS,
    });

    contexts[provider] = ctx;
    ctx.on('close', () => {
      contexts[provider] = undefined;
      _log(`[browser] ${provider} context closed`);
    });

    _log(`[browser] ${provider} connected`);
    return true;
  } catch (err) {
    _log(`[browser] ${provider} connect failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Disconnect a provider (close the browser context).
 */
export async function disconnect(provider: WebProvider): Promise<void> {
  if (contexts[provider]) {
    await contexts[provider]!.close().catch(() => {});
    contexts[provider] = undefined;
    _log(`[browser] ${provider} disconnected`);
  }
}

/**
 * Auto-connect all providers that have saved profiles.
 */
export async function autoConnect(): Promise<void> {
  if (!await isPlaywrightAvailable()) {
    _log('[browser] Playwright not installed — web providers unavailable');
    return;
  }

  for (const provider of Object.keys(PROVIDERS) as WebProvider[]) {
    const cfg = PROVIDERS[provider];
    if (existsSync(cfg.profileDir)) {
      await connect(provider).catch(() => {});
    }
  }
}

/**
 * Disconnect all providers.
 */
export async function disconnectAll(): Promise<void> {
  for (const provider of Object.keys(contexts) as WebProvider[]) {
    await disconnect(provider);
  }
}

// ── Grok completion ──────────────────────────────────────────────────────────

const STABLE_CHECKS = 3;
const STABLE_INTERVAL_MS = 500;

function resolveGrokModel(m?: string): string {
  const clean = (m ?? 'grok-3').replace('web-grok/', '');
  const allowed = ['grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast'];
  return allowed.includes(clean) ? clean : 'grok-3';
}

function flattenMessages(messages: Array<{ role: string; content: string }>): string {
  if (messages.length === 1) return messages[0].content;
  return messages.map(m => {
    if (m.role === 'system') return `[System]: ${m.content}`;
    if (m.role === 'assistant') return `[Assistant]: ${m.content}`;
    return m.content;
  }).join('\n\n');
}

export interface WebCompleteResult {
  content: string;
  model: string;
  finishReason: string;
}

/**
 * Non-streaming Grok completion via DOM automation.
 */
export async function grokComplete(
  messages: Array<{ role: string; content: string }>,
  model?: string,
  timeoutMs = 120_000,
): Promise<WebCompleteResult> {
  const ctx = contexts.grok;
  if (!ctx) throw new Error('Grok not connected. Use "Conduit: Login — Grok" first.');

  const resolvedModel = resolveGrokModel(model);
  const prompt = flattenMessages(messages);

  const page = await ctx.newPage();
  try {
    await page.goto('https://grok.com', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await new Promise(r => setTimeout(r, 2_000));
    const content = await sendAndWaitGrok(page, prompt, timeoutMs);
    return { content, model: resolvedModel, finishReason: 'stop' };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Streaming Grok completion — calls onToken as new text appears.
 */
export async function grokCompleteStream(
  messages: Array<{ role: string; content: string }>,
  onToken: (token: string) => void,
  model?: string,
  timeoutMs = 120_000,
): Promise<WebCompleteResult> {
  const ctx = contexts.grok;
  if (!ctx) throw new Error('Grok not connected. Use "Conduit: Login — Grok" first.');

  const resolvedModel = resolveGrokModel(model);
  const prompt = flattenMessages(messages);

  const page = await ctx.newPage();
  try {
    await page.goto('https://grok.com', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await new Promise(r => setTimeout(r, 2_000));

    const countBefore = await page.evaluate(() => document.querySelectorAll('.message-bubble').length);

    // Send message
    await page.evaluate((msg: string) => {
      const ed = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
      if (!ed) throw new Error('Grok editor not found');
      (ed as HTMLElement).focus();
      document.execCommand('insertText', false, msg);
    }, prompt);
    await new Promise(r => setTimeout(r, 300));
    await page.keyboard.press('Enter');

    _log('[grok] message sent, streaming…');

    const deadline = Date.now() + timeoutMs;
    let emittedLength = 0;
    let lastText = '';
    let stableCount = 0;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, STABLE_INTERVAL_MS));
      const text = await page.evaluate((before: number) => {
        const bubbles = [...document.querySelectorAll('.message-bubble')];
        if (bubbles.length <= before) return '';
        return bubbles[bubbles.length - 1].textContent?.trim() ?? '';
      }, countBefore);

      if (text && text.length > emittedLength) {
        onToken(text.slice(emittedLength));
        emittedLength = text.length;
      }
      if (text && text === lastText) {
        stableCount++;
        if (stableCount >= STABLE_CHECKS) return { content: text, model: resolvedModel, finishReason: 'stop' };
      } else {
        stableCount = 0;
        lastText = text;
      }
    }
    throw new Error(`Grok stream timeout after ${timeoutMs}ms`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function sendAndWaitGrok(page: Page, message: string, timeoutMs: number): Promise<string> {
  const countBefore = await page.evaluate(() => document.querySelectorAll('.message-bubble').length);

  await page.evaluate((msg: string) => {
    const ed = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    if (!ed) throw new Error('Grok editor not found');
    (ed as HTMLElement).focus();
    document.execCommand('insertText', false, msg);
  }, message);

  await new Promise(r => setTimeout(r, 300));
  await page.keyboard.press('Enter');

  _log(`[grok] message sent (${message.length} chars), waiting…`);

  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let stableCount = 0;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, STABLE_INTERVAL_MS));
    const text = await page.evaluate((before: number) => {
      const bubbles = [...document.querySelectorAll('.message-bubble')];
      if (bubbles.length <= before) return '';
      return bubbles[bubbles.length - 1].textContent?.trim() ?? '';
    }, countBefore);

    if (text && text === lastText) {
      stableCount++;
      if (stableCount >= STABLE_CHECKS) return text;
    } else {
      stableCount = 0;
      lastText = text;
    }
  }
  throw new Error(`Grok response timeout after ${timeoutMs}ms`);
}

// ── Gemini web completion ────────────────────────────────────────────────────

export async function geminiWebComplete(
  messages: Array<{ role: string; content: string }>,
  onToken?: (token: string) => void,
  _model?: string,
  timeoutMs = 120_000,
): Promise<WebCompleteResult> {
  const ctx = contexts.gemini;
  if (!ctx) throw new Error('Gemini web not connected. Use "Conduit: Login — Gemini" first.');

  const prompt = flattenMessages(messages);
  const page = await ctx.newPage();
  try {
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await new Promise(r => setTimeout(r, 2_000));

    // Type into Quill editor
    const editor = await page.$('.ql-editor, [contenteditable="true"]');
    if (!editor) throw new Error('Gemini editor not found');
    await editor.click();
    await page.keyboard.type(prompt, { delay: 5 });
    await new Promise(r => setTimeout(r, 300));
    await page.keyboard.press('Enter');

    _log('[gemini-web] message sent, waiting…');

    const deadline = Date.now() + timeoutMs;
    let emittedLength = 0;
    let lastText = '';
    let stableCount = 0;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 600));
      const text = await page.evaluate(() => {
        const msgs = [...document.querySelectorAll('message-content, .model-response-text, .response-content')];
        if (msgs.length === 0) return '';
        return msgs[msgs.length - 1].textContent?.trim() ?? '';
      });

      if (onToken && text && text.length > emittedLength) {
        onToken(text.slice(emittedLength));
        emittedLength = text.length;
      }
      if (text && text === lastText) {
        stableCount++;
        if (stableCount >= STABLE_CHECKS) return { content: text, model: 'gemini-web', finishReason: 'stop' };
      } else {
        stableCount = 0;
        lastText = text;
      }
    }
    throw new Error(`Gemini web timeout after ${timeoutMs}ms`);
  } finally {
    await page.close().catch(() => {});
  }
}
