import * as https from 'https';
import * as http from 'http';
import { getConfig } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  capabilities?: { tools?: boolean };
}

/** Provider metadata from conduit-bridge (thinking, tool use, tokens, timing) */
export interface StreamMeta {
  thinking?: boolean;
  toolName?: string | null;
  toolRunning?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs?: number;
}

/** Raw streaming chunk from SSE */
export interface StreamChunk {
  delta: string;
  done: boolean;
  meta?: StreamMeta;
}

/** POST /v1/chat/completions — returns full response text */
export async function complete(opts: CompletionOptions): Promise<string> {
  const cfg = getConfig();
  const model = opts.model ?? cfg.defaultModel;
  const { url, apiKey, actualModel } = resolveEndpoint(model);
  const body = JSON.stringify({ ...opts, model: actualModel, stream: false });

  const text = await httpPost(url, body, apiKey);
  const json = JSON.parse(text);
  return json.choices?.[0]?.message?.content ?? '';
}

/** Resolve the endpoint URL and API key for a model - local models bypass the bridge */
function resolveEndpoint(model: string): { url: string; apiKey: string; actualModel: string } {
  const cfg = getConfig();
  // Check if model belongs to a local endpoint (format: local-endpoint-name/model-id)
  if (model.startsWith('local-')) {
    const slashIdx = model.indexOf('/');
    if (slashIdx > 0) {
      const prefix = model.slice(6, slashIdx); // e.g. "ollama" from "local-ollama/llama3"
      const actualModel = model.slice(slashIdx + 1);
      const endpoint = cfg.localEndpoints?.find(
        e => e.name.toLowerCase().replace(/\s+/g, '-') === prefix,
      );
      if (endpoint) {
        return { url: endpoint.url + '/chat/completions', apiKey: endpoint.apiKey || '', actualModel };
      }
    }
  }
  return { url: cfg.proxyUrl + '/v1/chat/completions', apiKey: cfg.apiKey, actualModel: model };
}

/** POST /v1/chat/completions — streams chunks via async generator */
export async function* stream(opts: CompletionOptions): AsyncGenerator<StreamChunk> {
  const cfg = getConfig();
  const model = opts.model ?? cfg.defaultModel;
  const { url, apiKey, actualModel } = resolveEndpoint(model);
  const body = JSON.stringify({ ...opts, model: actualModel, stream: true });

  yield* httpPostStream(url, body, apiKey);
}

/**
 * Stream with automatic fallback to alternative models on failure.
 * Yields a special meta chunk with the fallback model name if a fallback occurs.
 */
export async function* streamWithFallback(
  opts: CompletionOptions,
  fallbackModels: string[],
): AsyncGenerator<StreamChunk & { fallbackModel?: string }> {
  const cfg = getConfig();
  const primaryModel = opts.model ?? cfg.defaultModel;
  const modelsToTry = [primaryModel, ...fallbackModels.filter(m => m !== primaryModel)];

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      const { url, apiKey, actualModel } = resolveEndpoint(model);
      const body = JSON.stringify({ ...opts, model: actualModel, stream: true });
      let gotContent = false;

      for await (const chunk of httpPostStream(url, body, apiKey)) {
        if (i > 0 && !gotContent && !chunk.done) {
          // First real chunk from fallback - notify caller
          yield { ...chunk, fallbackModel: model };
          gotContent = true;
        } else {
          yield chunk;
        }
      }
      return; // success - no need to try next model
    } catch (err) {
      if (i === modelsToTry.length - 1) {
        throw err; // all models failed
      }
      // Try next model
    }
  }
}

/** GET /v1/models */
export async function listModels(): Promise<ModelInfo[]> {
  const cfg = getConfig();
  try {
    const text = await httpGet(cfg.proxyUrl + '/v1/models', cfg.apiKey);
    const json = JSON.parse(text);
    return json.data ?? [];
  } catch {
    return [];
  }
}

/** GET /health */
export async function checkHealth(): Promise<boolean> {
  const cfg = getConfig();
  try {
    const text = await httpGet(cfg.proxyUrl + '/health', cfg.apiKey);
    const json = JSON.parse(text);
    return json.status === 'ok';
  } catch {
    return false;
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function pickTransport(url: string) {
  return url.startsWith('https://') ? https : http;
}

function httpGet(url: string, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    };
    const req = pickTransport(url).request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function httpPost(url: string, body: string, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${apiKey}`,
      },
    };
    const req = pickTransport(url).request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function* httpPostStream(url: string, body: string, apiKey: string): AsyncGenerator<StreamChunk> {
  const chunks: StreamChunk[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let error: Error | null = null;

  const parsed = new URL(url);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Authorization: `Bearer ${apiKey}`,
    },
  };

  const req = pickTransport(url).request(options, res => {
    // Handle non-200 status codes - read body as error message
    if (res.statusCode && res.statusCode >= 400) {
      let errBody = '';
      res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
      res.on('end', () => {
        let errMsg = `HTTP ${res.statusCode}`;
        try {
          const parsed = JSON.parse(errBody);
          errMsg += ': ' + (parsed.error?.message ?? parsed.message ?? parsed.detail ?? errBody.slice(0, 200));
        } catch {
          if (errBody) errMsg += ': ' + errBody.slice(0, 200);
        }
        error = new Error(errMsg);
        done = true;
        resolve?.();
      });
      return;
    }

    let buf = '';
    res.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          chunks.push({ delta: '', done: true });
        } else {
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content ?? '';
            const meta = json.conduit_meta as StreamMeta | undefined;
            const finishReason = json.choices?.[0]?.finish_reason;
            // Always yield chunks that have content, metadata, or a finish signal
            if (delta || meta || finishReason) {
              chunks.push({ delta, done: false, meta });
            }
          } catch { /* ignore malformed */ }
        }
      }
      resolve?.();
    });
    res.on('end', () => {
      done = true;
      resolve?.();
    });
    res.on('error', (err: Error) => {
      error = err;
      resolve?.();
    });
  });

  req.on('error', (err: Error) => {
    error = err;
    done = true;
    resolve?.();
  });

  req.setTimeout(120000, () => {
    req.destroy();
    error = new Error('Stream request timed out after 120s');
    done = true;
    resolve?.();
  });

  req.write(body);
  req.end();

  while (!done || chunks.length > 0) {
    if (chunks.length === 0) {
      await new Promise<void>(r => { resolve = r; });
      resolve = null;
    }
    while (chunks.length > 0) {
      yield chunks.shift()!;
    }
  }

  if (error) throw error;
}
