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
} from '@elvatis_com/agent-backends';

// Re-export types and shared functions for backward compatibility
export type { ChatMessage, CliRunResult, CliInfo };
export { formatPrompt };
export const detectInstalledClis = _detectInstalledClis;

// ── Available CLI models ─────────────────────────────────────────────────────

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
  { id: 'opencode/default',                   name: 'OpenCode' },
  { id: 'pi/default',                         name: 'Pi Agent' },
];

const MODEL_ALIASES: Record<string, string> = {
  'cli-gemini/gemini-2.5-pro':     'cli-gemini/gemini-3.1-pro-high',
  'cli-gemini/gemini-2.5-flash':   'cli-gemini/gemini-3.6-flash-high',
  'cli-gemini/gemini-3-pro':       'cli-gemini/gemini-3.1-pro-high',
  'cli-gemini/gemini-3-flash':     'cli-gemini/gemini-3.6-flash-high',
  'cli-claude/claude-opus-4-6':    'cli-claude/claude-opus-5',
  'cli-claude/claude-sonnet-4-6':  'cli-claude/claude-sonnet-5',
};

// ── Model fallback chain ─────────────────────────────────────────────────────

export const MODEL_FALLBACKS: Record<string, string> = {
  'cli-gemini/gemini-3.1-pro-high':   'cli-gemini/gemini-3.6-flash-high',
  'cli-gemini/gemini-3.6-flash-high':  'cli-gemini/gemini-3.5-flash-high',
  'cli-claude/claude-opus-5':          'cli-claude/claude-sonnet-5',
  'cli-claude/claude-sonnet-5':        'cli-claude/claude-haiku-4-5',
  'cli-grok/grok-4.6':                 'cli-grok/grok-4.5',
  'cli-codex/gpt-5.6-sol':             'cli-codex/gpt-5.6-terra',
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

async function runGrok(prompt: string, modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const model = modelId.slice(modelId.indexOf('/') + 1);
  const result = await runCli(
    'grok',
    ['--model', model, '--output-format', 'plain', '--no-plan', '--always-approve'],
    prompt,
    timeoutMs,
    workdir,
    false,
  );
  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`grok exited ${result.exitCode}: ${result.stderr || '(no output)'}`);
  }
  return result.stdout || result.stderr;
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
  if (normalized.startsWith('cli-codex/')) {
    normalized = 'openai-codex/' + normalized.slice('cli-codex/'.length);
  }
  return normalized;
}

async function runModel(prompt: string, normalized: string, timeoutMs: number, workdir?: string): Promise<string> {
  if (normalized.startsWith('cli-gemini/'))    return runGemini(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('cli-claude/'))    return runClaude(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('cli-grok/'))      return runGrok(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('openai-codex/'))  return runCodex(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('opencode/'))      return runOpenCode(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('pi/'))            return runPi(prompt, normalized, timeoutMs, workdir);
  throw new Error(`Unknown model: "${normalized}". Supported prefixes: cli-gemini/, cli-claude/, cli-grok/, cli-codex/, openai-codex/, opencode/, pi/`);
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
