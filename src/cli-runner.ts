/**
 * cli-runner.ts — CLI subprocess routing for the embedded proxy.
 *
 * Spawns CLI subprocesses (gemini, claude, codex) and captures output.
 * Prompts delivered via stdin to avoid E2BIG errors.
 * Ported from openclaw-cli-bridge-elvatis.
 */

import { spawn, execSync } from 'child_process';
import { tmpdir, homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';

const MAX_MESSAGES = 20;
const MAX_MSG_CHARS = 4000;

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentPart { type: string; text?: string; }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[] | unknown;
}

interface CliRunResult { stdout: string; stderr: string; exitCode: number; }

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

const ALLOWED_MODELS = new Set(CLI_MODELS.map(m => m.id));

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

// ── CLI detection ────────────────────────────────────────────────────────────

export interface CliInfo { name: string; available: boolean; path?: string; }

export function detectInstalledClis(): CliInfo[] {
  const isWindows = process.platform === 'win32';
  const check = (name: string): CliInfo => {
    try {
      const cmd = isWindows ? `where ${name} 2>nul` : `which ${name} 2>/dev/null`;
      const p = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim().split('\n')[0];
      return { name, available: !!p, path: p || undefined };
    } catch {
      return { name, available: false };
    }
  };
  return [check('claude'), check('gemini'), check('codex'), check('opencode'), check('pi')];
}

// ── Prompt formatting ────────────────────────────────────────────────────────

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (Array.isArray(content)) {
    return (content as ContentPart[])
      .filter(c => c?.type === 'text' && typeof c.text === 'string')
      .map(c => c.text!)
      .join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

function truncateContent(raw: unknown): string {
  const s = contentToString(raw);
  if (s.length <= MAX_MSG_CHARS) return s;
  return s.slice(0, MAX_MSG_CHARS) + `\n...[truncated ${s.length - MAX_MSG_CHARS} chars]`;
}

export function formatPrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) return '';
  const system = messages.find(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');
  const recent = nonSystem.slice(-MAX_MESSAGES);
  const truncated = system ? [system, ...recent] : recent;

  if (truncated.length === 1 && truncated[0].role === 'user') {
    return truncateContent(truncated[0].content);
  }

  return truncated.map(m => {
    const content = truncateContent(m.content);
    switch (m.role) {
      case 'system':    return `[System]\n${content}`;
      case 'assistant': return `[Assistant]\n${content}`;
      default:          return `[User]\n${content}`;
    }
  }).join('\n\n');
}

// ── Minimal env ──────────────────────────────────────────────────────────────

function buildMinimalEnv(): Record<string, string> {
  const env: Record<string, string> = { NO_COLOR: '1', TERM: 'dumb' };
  // Core environment (cross-platform)
  for (const key of [
    'HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
    // Windows-specific
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'PATHEXT',
    'HOMEDRIVE', 'HOMEPATH', 'ComSpec',
  ]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  // API keys and config dirs
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
    'CODEX_API_KEY', 'OPENAI_API_KEY', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
    'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  ]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

// ── Core subprocess runner ───────────────────────────────────────────────────

function ensureGitRepo(dir: string): void {
  const gitDir = path.join(dir, '.git');
  if (!fs.existsSync(gitDir)) {
    execSync('git init', { cwd: dir, timeout: 5000 });
  }
}

function runCli(cmd: string, args: string[], prompt: string, timeoutMs: number, cwd?: string, shell?: boolean): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      timeout: timeoutMs,
      env: buildMinimalEnv(),
      cwd: cwd ?? homedir(),
      shell: shell ?? false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdin.write(prompt, 'utf8', () => { proc.stdin.end(); });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 }));
    proc.on('error', (err) => reject(new Error(`Failed to spawn '${cmd}': ${err.message}`)));
  });
}

// ── Claude auth ──────────────────────────────────────────────────────────────

async function ensureClaudeToken(): Promise<void> {
  // Claude stores credentials at ~/.claude/.credentials.json on all platforms
  // On Windows: %USERPROFILE%\.claude\.credentials.json
  const credPath = path.join(homedir(), '.claude', '.credentials.json');
  try {
    const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const expiresAt = data?.claudeAiOauth?.expiresAt;
    if (!expiresAt) return; // API key user, no-op
    const remaining = expiresAt - Date.now();
    if (remaining > 5 * 60 * 1000) return; // > 5 min remaining, fine
    // Token about to expire — force refresh via ping
    await runCli('claude', ['-p', 'ping', '--output-format', 'text'], '', 30_000);
  } catch {
    // No credentials file or parse error — skip
  }
}

// ── CLI runners ──────────────────────────────────────────────────────────────

async function runGemini(prompt: string, modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const model = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  const result = await runCli('gemini', ['-m', model, '-p', ''], prompt, timeoutMs, workdir ?? tmpdir());

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
  const model = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  const args = ['-p', '--output-format', 'text', '--permission-mode', 'plan', '--tools', '', '--model', model];

  const result = await runCli('claude', args, prompt, timeoutMs, workdir);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    const stderr = result.stderr || '(no output)';
    if (stderr.includes('401') || stderr.includes('authentication_error')) {
      // Try refresh + retry once
      await runCli('claude', ['-p', 'ping', '--output-format', 'text'], '', 30_000).catch(() => {});
      const retry = await runCli('claude', args, prompt, timeoutMs, workdir);
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
  const model = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  const args = ['--model', model, '--quiet', '--full-auto'];
  if (workdir) ensureGitRepo(workdir);
  const result = await runCli('codex', args, prompt, timeoutMs, workdir, true);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`codex exited ${result.exitCode}: ${result.stderr || '(no output)'}`);
  }
  return result.stdout;
}

async function runOpenCode(prompt: string, _modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const result = await runCli('opencode', ['run', prompt], '', timeoutMs, workdir, true);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`opencode exited ${result.exitCode}: ${result.stderr || '(no output)'}`);
  }
  return result.stdout;
}

async function runPi(prompt: string, _modelId: string, timeoutMs: number, workdir?: string): Promise<string> {
  const result = await runCli('pi', ['-p', prompt], '', timeoutMs, workdir, true);

  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(`pi exited ${result.exitCode}: ${result.stderr || '(no output)'}`);
  }
  return result.stdout;
}

// ── Router ───────────────────────────────────────────────────────────────────

export async function routeToCliRunner(
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  workdir?: string,
): Promise<string> {
  const prompt = formatPrompt(messages);
  let normalized = model.startsWith('vllm/') ? model.slice(5) : model;
  normalized = MODEL_ALIASES[normalized] ?? normalized;

  if (normalized.startsWith('cli-gemini/'))    return runGemini(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('cli-claude/'))    return runClaude(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('openai-codex/'))  return runCodex(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('opencode/'))      return runOpenCode(prompt, normalized, timeoutMs, workdir);
  if (normalized.startsWith('pi/'))            return runPi(prompt, normalized, timeoutMs, workdir);

  throw new Error(`Unknown model: "${model}". Supported prefixes: cli-gemini/, cli-claude/, openai-codex/, opencode/, pi/`);
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
  let normalized = model.startsWith('vllm/') ? model.slice(5) : model;
  normalized = MODEL_ALIASES[normalized] ?? normalized;

  let cmd: string;
  let args: string[];
  let stdinPrompt = prompt;
  let cwd = workdir;

  if (normalized.startsWith('cli-gemini/')) {
    const m = normalized.slice(normalized.indexOf('/') + 1);
    cmd = 'gemini'; args = ['-m', m, '-p', ''];
    cwd = cwd ?? tmpdir();
  } else if (normalized.startsWith('cli-claude/')) {
    const m = normalized.slice(normalized.indexOf('/') + 1);
    cmd = 'claude';
    args = ['-p', '--output-format', 'text', '--permission-mode', 'plan', '--tools', '', '--model', m];
  } else if (normalized.startsWith('openai-codex/')) {
    const m = normalized.slice(normalized.indexOf('/') + 1);
    cmd = 'codex'; args = ['--model', m, '--quiet', '--full-auto'];
    if (cwd) ensureGitRepo(cwd);
  } else if (normalized.startsWith('opencode/')) {
    cmd = 'opencode'; args = ['run', prompt];
    stdinPrompt = '';
  } else if (normalized.startsWith('pi/')) {
    cmd = 'pi'; args = ['-p', prompt];
    stdinPrompt = '';
  } else {
    throw new Error(`Unknown model for agent: "${model}"`);
  }

  const proc = spawn(cmd, args, {
    timeout: timeoutMs,
    env: buildMinimalEnv(),
    cwd: cwd ?? homedir(),
    shell: true,
  });

  const output: string[] = [];
  proc.stdout?.on('data', (d: Buffer) => { output.push(d.toString()); });
  proc.stderr?.on('data', (d: Buffer) => { output.push(d.toString()); });

  if (stdinPrompt) {
    proc.stdin?.write(stdinPrompt, 'utf8', () => { proc.stdin?.end(); });
  } else {
    proc.stdin?.end();
  }

  const result = new Promise<CliRunResult>((resolve, reject) => {
    proc.on('close', (code) => {
      resolve({ stdout: output.join(''), stderr: '', exitCode: code ?? 0 });
    });
    proc.on('error', reject);
  });

  return {
    pid: proc.pid ?? 0,
    output,
    kill: () => { proc.kill(); },
    result,
  };
}
