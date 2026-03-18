/**
 * cli-runner.ts — CLI subprocess routing for the embedded proxy.
 *
 * Spawns CLI subprocesses (gemini, claude, codex) and captures output.
 * Delegates shared logic (env, prompt formatting, subprocess spawning)
 * to agent-backends.ts for reuse across projects.
 */

import { homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';

import {
  type ChatMessage,
  type CliRunResult,
  type CliInfo,
  formatPrompt,
  buildMinimalEnv,
  ensureGitRepo,
  runCli,
  detectInstalledClis as _detectInstalledClis,
  buildBackendConfig,
  spawnAgent,
} from './agent-backends';

// Re-export types and shared functions for backward compatibility
export type { ChatMessage, CliRunResult, CliInfo };
export { formatPrompt };
export const detectInstalledClis = _detectInstalledClis;

// ── Available CLI models ─────────────────────────────────────────────────────

export const CLI_MODELS = [
  { id: 'cli-claude/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (CLI)' },
  { id: 'cli-claude/claude-opus-4-6',   name: 'Claude Opus 4.6 (CLI)' },
  { id: 'cli-claude/claude-haiku-4-5',  name: 'Claude Haiku 4.5 (CLI)' },
  { id: 'cli-gemini/gemini-2.5-pro',           name: 'Gemini 2.5 Pro (CLI)' },
  { id: 'cli-gemini/gemini-2.5-flash',         name: 'Gemini 2.5 Flash (CLI)' },
  { id: 'cli-gemini/gemini-3-pro-preview',     name: 'Gemini 3 Pro Preview (CLI)' },
  { id: 'cli-gemini/gemini-3-flash-preview',   name: 'Gemini 3 Flash Preview (CLI)' },
  { id: 'openai-codex/gpt-5.3-codex',       name: 'GPT-5.3 Codex' },
  { id: 'openai-codex/gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' },
  { id: 'openai-codex/gpt-5.2-codex',       name: 'GPT-5.2 Codex' },
  { id: 'openai-codex/gpt-5.4',             name: 'GPT-5.4' },
  { id: 'openai-codex/gpt-5.1-codex-mini',  name: 'GPT-5.1 Codex Mini' },
  { id: 'opencode/default',                 name: 'OpenCode' },
  { id: 'pi/default',                       name: 'Pi Agent' },
];

const MODEL_ALIASES: Record<string, string> = {
  'cli-gemini/gemini-3-pro':   'cli-gemini/gemini-3-pro-preview',
  'cli-gemini/gemini-3-flash': 'cli-gemini/gemini-3-flash-preview',
};

// ── Model fallback chain ─────────────────────────────────────────────────────

export const MODEL_FALLBACKS: Record<string, string> = {
  'cli-gemini/gemini-2.5-pro':       'cli-gemini/gemini-2.5-flash',
  'cli-gemini/gemini-3-pro-preview': 'cli-gemini/gemini-3-flash-preview',
  'cli-claude/claude-opus-4-6':      'cli-claude/claude-sonnet-4-6',
  'cli-claude/claude-sonnet-4-6':    'cli-claude/claude-haiku-4-5',
};

// ── Claude auth ──────────────────────────────────────────────────────────────

async function ensureClaudeToken(): Promise<void> {
  const credPath = path.join(homedir(), '.claude', '.credentials.json');
  try {
    const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const expiresAt = data?.claudeAiOauth?.expiresAt;
    if (!expiresAt) return;
    const remaining = expiresAt - Date.now();
    if (remaining > 5 * 60 * 1000) return;
    await runCli('claude', ['-p', 'ping', '--output-format', 'text'], '', 30_000);
  } catch {
    // No credentials file or parse error
  }
}

// ── CLI runners (use shared runCli from agent-backends) ──────────────────────

async function runGemini(prompt: string, modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const config = buildBackendConfig(modelId, prompt, workdir);
  const result = await runCli(config.cmd, config.args, config.stdinPrompt, timeoutMs, config.cwd, config.shell);

  const cleanStderr = result.stderr
    .split('\n')
    .filter(l => !l.startsWith('[WARN]') && !l.startsWith('Loaded cached'))
    .join('\n')
    .trim();

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`gemini exited ${result.exitCode}: ${cleanStderr || '(no output)'}`);
  }
  return result.stdout || cleanStderr;
}

async function runClaude(prompt: string, modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  await ensureClaudeToken();
  const config = buildBackendConfig(modelId, prompt, workdir);
  const result = await runCli(config.cmd, config.args, config.stdinPrompt, timeoutMs, config.cwd, config.shell);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    const stderr = result.stderr || '(no output)';
    if (stderr.includes('401') || stderr.includes('authentication_error')) {
      await runCli('claude', ['-p', 'ping', '--output-format', 'text'], '', 30_000).catch(() => {});
      const retry = await runCli(config.cmd, config.args, config.stdinPrompt, timeoutMs, config.cwd, config.shell);
      if (retry.exitCode !== 0 && retry.stdout.length === 0) {
        throw new Error(`Claude auth failed after refresh. Run: claude auth logout && claude auth login`);
      }
      return retry.stdout;
    }
    throw new Error(`claude exited ${result.exitCode}: ${stderr}`);
  }
  return result.stdout;
}

async function runCodex(prompt: string, modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const config = buildBackendConfig(modelId, prompt, workdir);
  const result = await runCli(config.cmd, config.args, config.stdinPrompt, timeoutMs, config.cwd, config.shell);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`codex exited ${result.exitCode}: ${result.stderr || '(no output)'}`);
  }
  return result.stdout;
}

async function runOpenCode(prompt: string, modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const config = buildBackendConfig(modelId, prompt, workdir);
  const result = await runCli(config.cmd, config.args, config.stdinPrompt, timeoutMs, config.cwd, config.shell);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`opencode exited ${result.exitCode}: ${result.stderr || '(no output)'}`);
  }
  return result.stdout;
}

async function runPi(prompt: string, modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const config = buildBackendConfig(modelId, prompt, workdir);
  const result = await runCli(config.cmd, config.args, config.stdinPrompt, timeoutMs, config.cwd, config.shell);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`pi exited ${result.exitCode}: ${result.stderr || '(no output)'}`);
  }
  return result.stdout;
}

// ── Router ───────────────────────────────────────────────────────────────────

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
  normalized = MODEL_ALIASES[normalized] ?? normalized;
  return normalized;
}

async function runModel(prompt: string, normalized: string, timeoutMs: number, workdir?: string): Promise<string> {
  if (normalized.startsWith('cli-gemini/'))    return runGemini(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('cli-claude/'))    return runClaude(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('openai-codex/'))  return runCodex(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('opencode/'))      return runOpenCode(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('pi/'))            return runPi(prompt, normalized, timeoutMs, workdir);
  throw new Error(`Unknown model: "${normalized}". Supported prefixes: cli-gemini/, cli-claude/, openai-codex/, opencode/, pi/`);
}

export async function routeToCliRunner(
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  workdir?: string,
): Promise<string> {
  const result = await routeToCliRunnerWithFallback(model, messages, timeoutMs, workdir);
  return result.output;
}

export async function routeToCliRunnerWithFallback(
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  workdir?: string,
  maxFallbacks: number = 1,
): Promise<RouteResult> {
  const prompt = formatPrompt(messages);
  const normalized = normalizeModel(model);

  try {
    const output = await runModel(prompt, normalized, timeoutMs, workdir);
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
        const output = await runModel(prompt, fallback, timeoutMs, workdir);
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

// ── Background agent spawning ─────────────────────────────────────────────────

export interface CliAgentHandle {
  pid: number;
  output: string[];
  kill: () => void;
  result: Promise<CliRunResult>;
}

export function spawnCliAgent(
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  workdir?: string,
): CliAgentHandle {
  const prompt = formatPrompt(messages);
  const normalized = normalizeModel(model);
  const config = buildBackendConfig(normalized, prompt, workdir);

  // Use shared spawnAgent from agent-backends
  const handle = spawnAgent(config, timeoutMs);

  return {
    pid: handle.pid,
    output: handle.output,
    kill: handle.kill,
    result: handle.result,
  };
}
