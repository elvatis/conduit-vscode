/**
 * Background-agent routing through conduit-bridge.
 *
 * Chat and spawn both use the OpenAI-compatible HTTP API on
 * conduit.proxyUrl (default 127.0.0.1:31338). Local CLI subprocesses
 * belong to the bridge, not to this extension.
 */

import { complete, stream, type ChatMessage } from './proxy-client';

export type { ChatMessage };

export const CLI_MODELS = [
  { id: 'cli-claude/claude-opus-5',           name: 'Claude Opus 5 (CLI)' },
  { id: 'cli-claude/claude-sonnet-5',         name: 'Claude Sonnet 5 (CLI)' },
  { id: 'cli-claude/claude-fable-5',          name: 'Claude Fable 5 (CLI)' },
  { id: 'cli-claude/claude-haiku-4-5',        name: 'Claude Haiku 4.5 (CLI)' },
  { id: 'cli-gemini/gemini-3.1-pro-high',     name: 'Gemini 3.1 Pro High (CLI)' },
  { id: 'cli-gemini/gemini-3.6-flash-high',   name: 'Gemini 3.6 Flash High (CLI)' },
  { id: 'cli-gemini/gemini-3.5-flash-high',   name: 'Gemini 3.5 Flash High (CLI)' },
  { id: 'cli-grok/grok-4.6',                  name: 'Grok 4.6 (CLI)' },
  { id: 'cli-grok/grok-4.5',                  name: 'Grok 4.5 (CLI)' },
  { id: 'cli-codex/gpt-5.6-sol',              name: 'GPT-5.6 Sol (CLI)' },
  { id: 'cli-codex/gpt-5.6-terra',            name: 'GPT-5.6 Terra (CLI)' },
  { id: 'cli-codex/gpt-5.6-luna',             name: 'GPT-5.6 Luna (CLI)' },
];

const MODEL_ALIASES: Record<string, string> = {
  'cli-gemini/gemini-2.5-pro':     'cli-gemini/gemini-3.1-pro-high',
  'cli-gemini/gemini-2.5-flash':   'cli-gemini/gemini-3.6-flash-high',
  'cli-claude/claude-opus-4-6':    'cli-claude/claude-opus-5',
  'cli-claude/claude-sonnet-4-6':  'cli-claude/claude-sonnet-5',
  'openai-codex/gpt-5.4':          'cli-codex/gpt-5.6-sol',
};

export const MODEL_FALLBACKS: Record<string, string> = {
  'cli-gemini/gemini-3.1-pro-high':   'cli-gemini/gemini-3.6-flash-high',
  'cli-gemini/gemini-3.6-flash-high':  'cli-gemini/gemini-3.5-flash-high',
  'cli-claude/claude-opus-5':          'cli-claude/claude-sonnet-5',
  'cli-claude/claude-sonnet-5':        'cli-claude/claude-haiku-4-5',
  'cli-grok/grok-4.6':                 'cli-grok/grok-4.5',
  'cli-codex/gpt-5.6-sol':             'cli-codex/gpt-5.6-terra',
};

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const FAILOVER_PATTERNS = [
  /rate.?limit/i,
  /429/,
  /503/,
  /too many requests/i,
  /capacity/i,
  /overloaded/i,
  /unavailable/i,
  /quota/i,
  /authentication/i,
  /auth.?failed/i,
  /401/,
  /timeout/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
];

function isFailoverEligible(error: Error): boolean {
  return FAILOVER_PATTERNS.some(p => p.test(error.message));
}

export interface RouteResult {
  output: string;
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

function normalizeModel(model: string): string {
  let normalized = model.startsWith('vllm/') ? model.slice(5) : model;
  return MODEL_ALIASES[normalized] ?? normalized;
}

export async function routeToCliRunner(
  model: string,
  messages: ChatMessage[],
  _timeoutMs?: number,
  workdir?: string,
): Promise<string> {
  const result = await routeToCliRunnerWithFallback(model, messages, _timeoutMs, workdir);
  return result.output;
}

export async function routeToCliRunnerWithFallback(
  model: string,
  messages: ChatMessage[],
  _timeoutMs?: number,
  workdir?: string,
  maxFallbacks: number = 1,
): Promise<RouteResult> {
  const normalized = normalizeModel(model);

  try {
    const output = await complete({ model: normalized, messages, cwd: workdir });
    return { output, model: normalized, fallbackUsed: false };
  } catch (primaryError) {
    if (!isFailoverEligible(primaryError as Error) || maxFallbacks <= 0) {
      throw primaryError;
    }

    let currentModel = normalized;
    let lastError = primaryError as Error;

    for (let attempt = 0; attempt < maxFallbacks; attempt++) {
      const fallback = MODEL_FALLBACKS[currentModel];
      if (!fallback) break;

      try {
        const output = await complete({ model: fallback, messages, cwd: workdir });
        return {
          output,
          model: fallback,
          fallbackUsed: true,
          fallbackReason: `${currentModel} failed (${lastError.message}), fell back to ${fallback}`,
        };
      } catch (fallbackError) {
        lastError = fallbackError as Error;
        currentModel = fallback;
        if (!isFailoverEligible(lastError)) break;
      }
    }

    throw new Error(
      `All models failed. Primary: ${normalized} (${(primaryError as Error).message}). ` +
      `Last fallback: ${currentModel} (${lastError.message})`,
    );
  }
}

export interface CliAgentHandle {
  pid: number;
  output: string[];
  kill: () => void;
  result: Promise<CliRunResult>;
}

/** Run a background agent through conduit-bridge /v1/chat/completions. */
export function spawnCliAgent(
  model: string,
  messages: ChatMessage[],
  _timeoutMs?: number,
  workdir?: string,
): CliAgentHandle {
  const output: string[] = [];
  let killed = false;
  const normalized = normalizeModel(model);

  const result = (async (): Promise<CliRunResult> => {
    try {
      let stdout = '';
      for await (const chunk of stream({ model: normalized, messages, cwd: workdir })) {
        if (killed) {
          return { stdout, stderr: 'killed', exitCode: 1 };
        }
        if (chunk.delta) {
          output.push(chunk.delta);
          stdout += chunk.delta;
        }
      }
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err) {
      const msg = (err as Error).message;
      output.push(msg);
      return { stdout: output.join(''), stderr: msg, exitCode: 1 };
    }
  })();

  return {
    pid: 0,
    output,
    kill: () => { killed = true; },
    result,
  };
}
