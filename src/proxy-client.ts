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
  /** Workspace path for CLI providers on conduit-bridge (ignored by API transports). */
  cwd?: string;
  /**
   * CLI run mode on conduit-bridge. `plan` calls the provider's native planner.
   * `agent` writes the workspace (requires cwd). Chat Agent mode in this
   * extension stays host-side and must not send `agent`.
   */
  mode?: 'chat' | 'plan' | 'agent';
  /**
   * Cancels the request AND the CLI run behind it. The bridge kills the child
   * process when the client disconnects, so destroying the socket is the only
   * thing that actually stops the model — Stop used to set a flag and leave it
   * running to completion.
   */
  signal?: AbortSignal;
}

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  /**
   * Human label from conduit-bridge 0.8.0+. The bridge knows the real name —
   * "Claude Sonnet 4.6 (Thinking) (agy CLI)" — and this extension's own table
   * cannot keep up with a catalog that is discovered at runtime, so prefer this
   * whenever it is present.
   */
  display_name?: string;
  /**
   * Largest prompt this model's transport accepts, in characters
   * (conduit-bridge 0.8.1+). Present only where a real ceiling exists: agy takes
   * the prompt on argv, so the OS command line bounds it far below the model's
   * token window. Absent for stdin and prompt-file transports.
   */
  max_prompt_chars?: number;
  /**
   * Token window and output cap (conduit-bridge 0.8.2+). Discovered per provider
   * where one reports them, otherwise from the bridge's own table, which
   * ~/.conduit/models.json can override. The extension used to ship its own copy.
   */
  context_window?: number;
  max_output_tokens?: number;
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
  const { signal, ...wire } = opts;
  const body = JSON.stringify({ ...wire, model: actualModel, stream: false });

  const text = await httpPost(url, body, apiKey, signal);
  const json = JSON.parse(text);
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }
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
  const { signal, ...wire } = opts;
  const body = JSON.stringify({ ...wire, model: actualModel, stream: true });

  yield* httpPostStream(url, body, apiKey, signal);
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
      const { signal, ...wire } = opts;
      const body = JSON.stringify({ ...wire, model: actualModel, stream: true });
      let gotContent = false;

      for await (const chunk of httpPostStream(url, body, apiKey, signal)) {
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
      // A timeout is not evidence that this model is unavailable — the bridge
      // was still working on it, and it kills the CLI when we disconnect. Trying
      // the next model would spend another full budget, and another CLI run of
      // the user's quota, for each fallback: four blank minutes and four killed
      // runs before anything appears. Surface it instead.
      if (isRequestTimeout(err)) throw err;
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

/**
 * A request timeout that cannot be mistaken for anything else.
 *
 * The old code threw `new Error('timeout')` here and
 * `'Stream request timed out after 120s'` on the streaming path, and callers
 * classified with `msg.includes('timeout')`. "timed out" does not contain
 * "timeout", so the streaming case was never recognised — while the bridge's own
 * supervisor message ("timeout: agy/gemini CLI killed by supervisor") does
 * contain it and was reported to the user as a client timeout. Exactly backwards.
 */
export class RequestTimeoutError extends Error {
  readonly isTimeout = true;
  constructor(readonly timeoutMs: number) {
    super(`No response from the bridge within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'RequestTimeoutError';
  }
}

export function isRequestTimeout(err: unknown): err is RequestTimeoutError {
  return !!(err as RequestTimeoutError)?.isTimeout;
}

/**
 * How long to wait for a chat completion.
 *
 * This is effectively a budget on the WHOLE turn, not an idle timeout: no CLI
 * provider streams incrementally, and the bridge writes nothing on the socket
 * until the child exits. Measured against a live bridge — headers at 3956ms,
 * first byte at 3957ms, total 3957ms: the socket is silent for 100% of the run.
 *
 * So it has to clear the bridge's own ceiling, which kills a CLI at
 * DEFAULT_CLI_TIMEOUT_MS = 300s. Anything lower makes the client give up on a
 * request the server is still working on, which is what made a long Opus turn
 * look like the extension doing nothing.
 */
function chatTimeoutMs(): number {
  const configured = getConfig().requestTimeout;
  return Number.isFinite(configured) && configured > 0 ? configured : 330_000;
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
    req.setTimeout(10_000, () => { req.destroy(); reject(new RequestTimeoutError(10_000)); });
    req.end();
  });
}

function httpPost(url: string, body: string, apiKey: string, signal?: AbortSignal): Promise<string> {
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
    const timeoutMs = chatTimeoutMs();
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new RequestTimeoutError(timeoutMs)); });
    req.write(body);
    req.end();
  });
}

async function* httpPostStream(url: string, body: string, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
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

  const timeoutMs = chatTimeoutMs();
  req.setTimeout(timeoutMs, () => {
    req.destroy();
    error = new RequestTimeoutError(timeoutMs);
    done = true;
    resolve?.();
  });

  // Stopping means stopping the CLI, not just looking away. The bridge cancels
  // the child process when the client disconnects (server.ts), so destroying the
  // socket is what actually ends the run — previously nothing here touched it,
  // so Stop left the model working and the quota draining.
  const onAbort = () => {
    error = new Error('Request cancelled');
    done = true;
    req.destroy();
    resolve?.();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  req.write(body);
  req.end();

  try {
    while (!done || chunks.length > 0) {
      if (chunks.length === 0) {
        await new Promise<void>(r => { resolve = r; });
        resolve = null;
      }
      while (chunks.length > 0) {
        yield chunks.shift()!;
      }
    }
  } finally {
    // Reached on a normal end AND when the consumer breaks out of `for await`,
    // which calls generator.return(). Without this, abandoning the loop left the
    // socket open and the CLI running to completion.
    signal?.removeEventListener('abort', onAbort);
    req.destroy();
  }

  if (error) throw error;
}
