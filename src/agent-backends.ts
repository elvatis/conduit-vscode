/**
 * agent-backends.ts — Shared agent backend abstraction.
 *
 * Extracted from cli-runner.ts. Contains the core logic for:
 * - CLI detection (which claude/gemini/codex/opencode/pi)
 * - Prompt formatting (system/user/assistant message serialization)
 * - Subprocess spawning with stdin piping
 * - Minimal env construction
 * - Model alias resolution
 *
 * This module is designed to be extractable into a standalone
 * @elvatis/agent-backends package once aahp-runner needs it too.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContentPart { type: string; text?: string; }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[] | unknown;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliInfo {
  name: string;
  available: boolean;
  path?: string;
}

export interface BackendConfig {
  cmd: string;
  args: string[];
  stdinPrompt: string;
  cwd: string;
  shell: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_MESSAGES = 20;
const MAX_MSG_CHARS = 4000;

// ── CLI detection ────────────────────────────────────────────────────────────

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

export function buildMinimalEnv(): Record<string, string> {
  const env: Record<string, string> = { NO_COLOR: '1', TERM: 'dumb' };
  for (const key of [
    'HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'PATHEXT',
    'HOMEDRIVE', 'HOMEPATH', 'ComSpec',
  ]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
    'CODEX_API_KEY', 'OPENAI_API_KEY', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
    'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  ]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

// ── Git helpers ──────────────────────────────────────────────────────────────

export function ensureGitRepo(dir: string): void {
  const gitDir = path.join(dir, '.git');
  if (!fs.existsSync(gitDir)) {
    execSync('git init', { cwd: dir, timeout: 5000 });
  }
}

// ── Core subprocess runner ───────────────────────────────────────────────────

export function runCli(cmd: string, args: string[], prompt: string, timeoutMs: number, cwd?: string, shell?: boolean): Promise<CliRunResult> {
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

// ── Backend configuration builder ────────────────────────────────────────────

/**
 * Build the CLI command configuration for a given model.
 * Returns the command, args, stdin prompt, and working directory.
 * This is the single source of truth for how each backend is invoked.
 */
export function buildBackendConfig(
  normalized: string,
  prompt: string,
  workdir?: string,
): BackendConfig {
  if (normalized.startsWith('cli-gemini/')) {
    const model = normalized.slice(normalized.indexOf('/') + 1);
    const { tmpdir } = require('os');
    return {
      cmd: 'gemini', args: ['-m', model, '-p', ''],
      stdinPrompt: prompt, cwd: workdir ?? tmpdir(), shell: false,
    };
  }

  if (normalized.startsWith('cli-claude/')) {
    const model = normalized.slice(normalized.indexOf('/') + 1);
    return {
      cmd: 'claude',
      args: ['-p', '--output-format', 'text', '--permission-mode', 'plan', '--tools', '', '--model', model],
      stdinPrompt: prompt, cwd: workdir ?? homedir(), shell: false,
    };
  }

  if (normalized.startsWith('openai-codex/')) {
    const model = normalized.slice(normalized.indexOf('/') + 1);
    if (workdir) ensureGitRepo(workdir);
    return {
      cmd: 'codex', args: ['--model', model, '--quiet', '--full-auto'],
      stdinPrompt: prompt, cwd: workdir ?? homedir(), shell: true,
    };
  }

  if (normalized.startsWith('opencode/')) {
    return {
      cmd: 'opencode', args: ['run', prompt],
      stdinPrompt: '', cwd: workdir ?? homedir(), shell: true,
    };
  }

  if (normalized.startsWith('pi/')) {
    return {
      cmd: 'pi', args: ['-p', prompt],
      stdinPrompt: '', cwd: workdir ?? homedir(), shell: true,
    };
  }

  throw new Error(`Unknown model: "${normalized}". Supported prefixes: cli-gemini/, cli-claude/, openai-codex/, opencode/, pi/`);
}

// ── Background process spawning ──────────────────────────────────────────────

export interface AgentHandle {
  pid: number;
  output: string[];
  kill: () => void;
  result: Promise<CliRunResult>;
  process: ChildProcess;
}

/**
 * Spawn a background agent process.
 * Returns a handle with live output array, kill function, and result promise.
 */
export function spawnAgent(config: BackendConfig, timeoutMs: number): AgentHandle {
  const proc = spawn(config.cmd, config.args, {
    timeout: timeoutMs,
    env: buildMinimalEnv(),
    cwd: config.cwd,
    shell: config.shell,
  });

  const output: string[] = [];
  proc.stdout?.on('data', (d: Buffer) => { output.push(d.toString()); });
  proc.stderr?.on('data', (d: Buffer) => { output.push(d.toString()); });

  if (config.stdinPrompt) {
    proc.stdin?.write(config.stdinPrompt, 'utf8', () => { proc.stdin?.end(); });
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
    process: proc,
  };
}
