/**
 * embedded-proxy.ts — OpenAI-compatible HTTP proxy embedded in the VS Code extension.
 *
 * Starts automatically on extension activation. Routes requests to:
 *   - CLI tools (gemini, claude, codex) installed on the user's system
 *   - Web providers (Grok, Gemini, Claude, ChatGPT) via Playwright browser automation
 *
 * Endpoints:
 *   GET  /health              → { status: "ok" }
 *   GET  /healthz             → detailed status JSON
 *   GET  /v1/models           → model list with capabilities
 *   POST /v1/chat/completions → chat completion (streaming + non-streaming)
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { CLI_MODELS, MODEL_FALLBACKS, routeToCliRunner, detectInstalledClis, type ChatMessage } from './cli-runner';
import {
  isConnected, getConnectedProviders, autoConnect, disconnectAll, setLogger,
  grokComplete, grokCompleteStream, geminiWebComplete,
  type WebCompleteResult,
} from './browser-session';

// ── Model metadata with capabilities ─────────────────────────────────────────

export interface ModelCapability {
  id: string;
  name: string;
  provider: 'cli' | 'web';
  source: string;            // claude, gemini, codex, grok, etc.
  streaming: boolean;
  codeCompletion: boolean;
  codeExplanation: boolean;
  refactoring: boolean;
  testGeneration: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  available: boolean;        // computed at runtime
}

const MODEL_CAPABILITIES: Omit<ModelCapability, 'available'>[] = [
  // CLI models
  { id: 'cli-claude/claude-opus-4-6',   name: 'Claude Opus 4.6 (CLI)',   provider: 'cli', source: 'claude', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 8_192 },
  { id: 'cli-claude/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (CLI)', provider: 'cli', source: 'claude', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 8_192 },
  { id: 'cli-claude/claude-haiku-4-5',  name: 'Claude Haiku 4.5 (CLI)',  provider: 'cli', source: 'claude', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 8_192 },
  { id: 'cli-gemini/gemini-2.5-pro',          name: 'Gemini 2.5 Pro (CLI)',          provider: 'cli', source: 'gemini', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  { id: 'cli-gemini/gemini-2.5-flash',        name: 'Gemini 2.5 Flash (CLI)',        provider: 'cli', source: 'gemini', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  { id: 'cli-gemini/gemini-3-pro-preview',    name: 'Gemini 3 Pro Preview (CLI)',    provider: 'cli', source: 'gemini', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  { id: 'cli-gemini/gemini-3-flash-preview',  name: 'Gemini 3 Flash Preview (CLI)',  provider: 'cli', source: 'gemini', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  { id: 'openai-codex/gpt-5.3-codex',       name: 'GPT-5.3 Codex',       provider: 'cli', source: 'codex', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 32_768 },
  { id: 'openai-codex/gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', provider: 'cli', source: 'codex', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 32_768 },
  { id: 'openai-codex/gpt-5.2-codex',       name: 'GPT-5.2 Codex',       provider: 'cli', source: 'codex', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 32_768 },
  { id: 'openai-codex/gpt-5.4',             name: 'GPT-5.4',             provider: 'cli', source: 'codex', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 32_768 },
  { id: 'openai-codex/gpt-5.1-codex-mini',  name: 'GPT-5.1 Codex Mini',  provider: 'cli', source: 'codex', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 200_000, maxOutputTokens: 32_768 },
  // CLI models (OpenCode / Pi)
  { id: 'opencode/default',  name: 'OpenCode',   provider: 'cli', source: 'opencode', streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 128_000, maxOutputTokens: 16_384 },
  { id: 'pi/default',        name: 'Pi Agent',   provider: 'cli', source: 'pi',       streaming: false, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: false, contextWindow: 128_000, maxOutputTokens: 16_384 },
  // Web models (Grok)
  { id: 'web-grok/grok-3',           name: 'Grok 3 (web)',           provider: 'web', source: 'grok', streaming: true, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 131_072, maxOutputTokens: 131_072 },
  { id: 'web-grok/grok-3-fast',      name: 'Grok 3 Fast (web)',      provider: 'web', source: 'grok', streaming: true, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 131_072, maxOutputTokens: 131_072 },
  { id: 'web-grok/grok-3-mini',      name: 'Grok 3 Mini (web)',      provider: 'web', source: 'grok', streaming: true, codeCompletion: true, codeExplanation: true, refactoring: false, testGeneration: false, contextWindow: 131_072, maxOutputTokens: 131_072 },
  { id: 'web-grok/grok-3-mini-fast', name: 'Grok 3 Mini Fast (web)', provider: 'web', source: 'grok', streaming: true, codeCompletion: true, codeExplanation: true, refactoring: false, testGeneration: false, contextWindow: 131_072, maxOutputTokens: 131_072 },
  // Web models (Gemini)
  { id: 'web-gemini/gemini-2-5-pro',   name: 'Gemini 2.5 Pro (web)',   provider: 'web', source: 'gemini', streaming: true, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  { id: 'web-gemini/gemini-2-5-flash', name: 'Gemini 2.5 Flash (web)', provider: 'web', source: 'gemini', streaming: true, codeCompletion: true, codeExplanation: true, refactoring: true, testGeneration: true, contextWindow: 1_000_000, maxOutputTokens: 8_192 },
];

export interface EmbeddedProxyOptions {
  port: number;
  apiKey: string;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

let _server: http.Server | null = null;
let _startedAt: number = 0;
let _installedClis: ReturnType<typeof detectInstalledClis> = [];

export function isRunning(): boolean {
  return _server !== null && _server.listening;
}

export function getPort(): number {
  if (!_server) return 0;
  const addr = _server.address();
  if (typeof addr === 'object' && addr) return addr.port;
  return 0;
}

/** Get available models with capability info (for the UI model picker). */
export function getAvailableModels(): ModelCapability[] {
  return MODEL_CAPABILITIES.map(m => ({
    ...m,
    available: isModelAvailable(m),
  }));
}

function isModelAvailable(m: Omit<ModelCapability, 'available'>): boolean {
  if (m.provider === 'cli') {
    if (m.source === 'claude') return _installedClis.some(c => c.name === 'claude' && c.available);
    if (m.source === 'gemini') return _installedClis.some(c => c.name === 'gemini' && c.available);
    if (m.source === 'codex')    return _installedClis.some(c => c.name === 'codex' && c.available);
    if (m.source === 'opencode') return _installedClis.some(c => c.name === 'opencode' && c.available);
    if (m.source === 'pi')       return _installedClis.some(c => c.name === 'pi' && c.available);
  }
  if (m.provider === 'web') {
    if (m.source === 'grok')   return isConnected('grok');
    if (m.source === 'gemini') return isConnected('gemini');
  }
  return false;
}

export async function startProxy(opts: EmbeddedProxyOptions): Promise<void> {
  if (isRunning()) {
    opts.log('[conduit-proxy] Already running');
    return;
  }

  setLogger(opts.log);

  // Check if the port is already in use (e.g. openclaw gateway) before doing
  // any heavy work like Playwright browser launches.
  const portInUse = await isPortInUse(opts.port);
  if (portInUse) {
    opts.log(`[conduit-proxy] Port ${opts.port} in use — external proxy detected, using it instead`);
    return;
  }

  _installedClis = detectInstalledClis();
  const available = _installedClis.filter(c => c.available).map(c => c.name);
  opts.log(`[conduit-proxy] Detected CLIs: ${available.length > 0 ? available.join(', ') : 'none'}`);

  // Auto-connect web providers with saved profiles
  await autoConnect();
  const webProviders = getConnectedProviders();
  if (webProviders.length > 0) {
    opts.log(`[conduit-proxy] Web providers connected: ${webProviders.join(', ')}`);
  }

  const totalModels = getAvailableModels().filter(m => m.available).length;
  opts.log(`[conduit-proxy] ${totalModels} models available`);

  _startedAt = Date.now();

  return new Promise((resolve, reject) => {
    _server = http.createServer((req, res) => {
      handleRequest(req, res, opts).catch((err: Error) => {
        opts.warn(`[conduit-proxy] Request error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message, type: 'internal_error' } }));
        }
      });
    });

    _server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        opts.log(`[conduit-proxy] Port ${opts.port} in use — external proxy likely running, using it instead`);
        _server = null;
        resolve();
      } else {
        reject(err);
      }
    });

    _server.listen(opts.port, '127.0.0.1', () => {
      opts.log(`[conduit-proxy] Listening on http://127.0.0.1:${opts.port}`);
      resolve();
    });
  });
}

/** Quick TCP probe to check if a port is already listening. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net') as typeof import('net');
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

export async function stopProxy(): Promise<void> {
  if (_server) {
    _server.close();
    _server = null;
  }
  await disconnectAll();
}

// ── Request handler ──────────────────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: EmbeddedProxyOptions,
): Promise<void> {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const url = req.url ?? '/';

  // Health (simple)
  if (url === '/health' || url === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ status: 'ok', service: 'conduit-vscode' }));
    return;
  }

  // Health (detailed)
  if (url === '/healthz') {
    const uptime = Math.floor((Date.now() - _startedAt) / 1000);
    const webProviders = getConnectedProviders();
    const providers: Record<string, { status: string }> = {};
    for (const p of ['grok', 'gemini', 'claude', 'chatgpt'] as const) {
      providers[p] = { status: webProviders.includes(p) ? 'connected' : 'not_configured' };
    }
    const models = getAvailableModels();
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'conduit-vscode',
      version: '0.1.0',
      port: opts.port,
      uptime_s: uptime,
      providers,
      models: models.filter(m => m.available).length,
    }, null, 2));
    return;
  }

  // Status page
  if ((url === '/' || url === '/status') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderStatusHtml());
    return;
  }

  // Model list (with capabilities)
  if (url === '/v1/models' && req.method === 'GET') {
    const now = Math.floor(Date.now() / 1000);
    const models = getAvailableModels().filter(m => m.available);
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({
      object: 'list',
      data: models.map(m => ({
        id: m.id,
        object: 'model',
        created: now,
        owned_by: `conduit-${m.provider}`,
        capabilities: {
          streaming: m.streaming,
          code_completion: m.codeCompletion,
          code_explanation: m.codeExplanation,
          refactoring: m.refactoring,
          test_generation: m.testGeneration,
          context_window: m.contextWindow,
          max_output_tokens: m.maxOutputTokens,
        },
      })),
    }));
    return;
  }

  // Chat completions
  if (url === '/v1/chat/completions' && req.method === 'POST') {
    if (opts.apiKey) {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== opts.apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'auth_error' } }));
        return;
      }
    }

    const body = await readBody(req);
    let parsed: { model: string; messages: ChatMessage[]; stream?: boolean };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }));
      return;
    }

    const { model, messages, stream = false, workdir } = parsed as {
      model: string; messages: ChatMessage[]; stream?: boolean; workdir?: string;
    };
    if (!model || !messages?.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'model and messages required', type: 'invalid_request_error' } }));
      return;
    }

    opts.log(`[conduit-proxy] ${model} · ${messages.length} msg(s) · stream=${stream}`);

    const id = `chatcmpl-${crypto.randomBytes(6).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);

    // ── Web provider routing (Grok) ────────────────────────────────────────
    if (model.startsWith('web-grok/')) {
      try {
        if (stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors });
          writeSse(res, { id, created, model, delta: { role: 'assistant' }, finish_reason: null });
          const result = await grokCompleteStream(
            messages as Array<{ role: string; content: string }>,
            (token) => writeSse(res, { id, created, model, delta: { content: token }, finish_reason: null }),
            model,
          );
          writeSse(res, { id, created, model, delta: {}, finish_reason: result.finishReason });
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          const result = await grokComplete(messages as Array<{ role: string; content: string }>, model);
          res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({
            id, object: 'chat.completion', created, model,
            choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }));
        }
      } catch (err) {
        const msg = (err as Error).message;
        opts.warn(`[conduit-proxy] Grok error: ${msg}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({ error: { message: msg, type: 'grok_error' } }));
        }
      }
      return;
    }

    // ── Web provider routing (Gemini web) ──────────────────────────────────
    if (model.startsWith('web-gemini/')) {
      try {
        if (stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors });
          writeSse(res, { id, created, model, delta: { role: 'assistant' }, finish_reason: null });
          const result = await geminiWebComplete(
            messages as Array<{ role: string; content: string }>,
            (token) => writeSse(res, { id, created, model, delta: { content: token }, finish_reason: null }),
            model,
          );
          writeSse(res, { id, created, model, delta: {}, finish_reason: result.finishReason });
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          const result = await geminiWebComplete(messages as Array<{ role: string; content: string }>, undefined, model);
          res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({
            id, object: 'chat.completion', created, model,
            choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }));
        }
      } catch (err) {
        const msg = (err as Error).message;
        opts.warn(`[conduit-proxy] Gemini web error: ${msg}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({ error: { message: msg, type: 'gemini_web_error' } }));
        }
      }
      return;
    }

    // ── CLI routing (Gemini / Claude / Codex) ──────────────────────────────
    let content: string;
    let usedModel = model;
    try {
      content = await routeToCliRunner(model, messages, 120_000, workdir);
    } catch (err) {
      const msg = (err as Error).message;
      const fallback = MODEL_FALLBACKS[model];
      if (fallback) {
        opts.warn(`[conduit-proxy] ${model} failed (${msg}), falling back to ${fallback}`);
        try {
          content = await routeToCliRunner(fallback, messages, 120_000, workdir);
          usedModel = fallback;
        } catch (e2) {
          const msg2 = (e2 as Error).message;
          res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({ error: { message: `${model}: ${msg} | fallback ${fallback}: ${msg2}`, type: 'cli_error' } }));
          return;
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({ error: { message: msg, type: 'cli_error' } }));
        return;
      }
    }

    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors });
      writeSse(res, { id, created, model: usedModel, delta: { role: 'assistant' }, finish_reason: null });
      const chunkSize = 50;
      for (let i = 0; i < content.length; i += chunkSize) {
        writeSse(res, { id, created, model: usedModel, delta: { content: content.slice(i, i + chunkSize) }, finish_reason: null });
      }
      writeSse(res, { id, created, model: usedModel, delta: {}, finish_reason: 'stop' });
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({
        id, object: 'chat.completion', created, model: usedModel,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `Not found: ${url}`, type: 'not_found' } }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeSse(res: http.ServerResponse, params: {
  id: string; created: number; model: string;
  delta: Record<string, unknown>; finish_reason: string | null;
}): void {
  res.write(`data: ${JSON.stringify({
    id: params.id, object: 'chat.completion.chunk', created: params.created,
    model: params.model,
    choices: [{ index: 0, delta: params.delta, finish_reason: params.finish_reason }],
  })}\n\n`);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function renderStatusHtml(): string {
  const uptime = Math.floor((Date.now() - _startedAt) / 1000);
  const uptimeStr = uptime < 60 ? `${uptime}s`
    : uptime < 3600 ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
    : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

  const models = getAvailableModels();
  const clis = detectInstalledClis();
  const webProviders = getConnectedProviders();

  const cliRows = clis.map(c =>
    `<tr><td>${c.name}</td><td>${c.available ? '<span style="color:#3fb950">installed</span>' : '<span style="color:#f85149">not found</span>'}</td><td>${c.path ?? '-'}</td></tr>`
  ).join('');

  const webRows = (['grok', 'gemini', 'claude', 'chatgpt'] as const).map(p =>
    `<tr><td>${p}</td><td>${webProviders.includes(p) ? '<span style="color:#3fb950">connected</span>' : '<span style="color:#888">not connected</span>'}</td></tr>`
  ).join('');

  const modelRows = models.filter(m => m.available).map(m =>
    `<tr><td><code>${m.id}</code></td><td>${m.name}</td><td>${m.provider}</td>` +
    `<td>${m.streaming ? 'yes' : '-'}</td><td>${m.contextWindow.toLocaleString()}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Conduit Proxy</title>
<style>body{font-family:system-ui;background:#1e1e1e;color:#d4d4d4;padding:24px;max-width:900px;margin:0 auto}
h1{color:#fff}h3{margin-top:20px;color:#ccc}table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{text-align:left;padding:6px 12px;border-bottom:1px solid #333}th{color:#888;font-size:11px;text-transform:uppercase}
code{background:#2d2d2d;padding:2px 6px;border-radius:3px;font-size:12px}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;background:#1a7a3a;color:#fff;margin-left:8px}</style>
</head><body>
<h1>Conduit Proxy<span class="badge">Running</span></h1>
<p style="color:#888">Embedded in VS Code · Uptime: ${uptimeStr} · ${models.filter(m => m.available).length} models</p>
<h3>CLI Tools</h3><table><tr><th>CLI</th><th>Status</th><th>Path</th></tr>${cliRows}</table>
<h3>Web Providers (Playwright)</h3><table><tr><th>Provider</th><th>Status</th></tr>${webRows}</table>
<h3>Available Models</h3><table><tr><th>Model ID</th><th>Name</th><th>Type</th><th>Stream</th><th>Context</th></tr>${modelRows}</table>
</body></html>`;
}
