/**
 * aahp-context.ts — AAHP v3 context auto-detection and injection.
 *
 * When a workspace contains .ai/handoff/MANIFEST.json, this module reads
 * the AAHP context (project phase, conventions, active tasks) and builds
 * a context block that agents can use for onboarding.
 *
 * Compatible with aahp-orchestrator (VS Code) and aahp-runner (CLI).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

interface ManifestFile {
  summary?: string;
  updated?: string;
  lines?: number;
}

interface AahpManifest {
  aahp_version?: string;
  project?: string;
  last_session?: {
    agent?: string;
    phase?: string;
    timestamp?: string;
    commit?: string;
  };
  files?: Record<string, ManifestFile>;
  quick_context?: string;
  token_budget?: {
    manifest_only?: number;
    manifest_plus_core?: number;
    full_read?: number;
  };
}

export interface AahpContext {
  project: string;
  phase: string;
  quickContext: string;
  conventions: string | null;
  activeTasks: string | null;
  lastSession: string | null;
  tokenEstimate: number;
}

// ── Size limits ──────────────────────────────────────────────────────────────

const MAX_CONVENTIONS_CHARS = 3000;
const MAX_TASKS_CHARS = 2000;

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Check if the workspace has an AAHP v3 handoff directory.
 */
export function detectAahpWorkspace(workspaceRoot?: string): string | null {
  const root = workspaceRoot ?? getWorkspaceRoot();
  if (!root) return null;

  const manifestPath = path.join(root, '.ai', 'handoff', 'MANIFEST.json');
  if (fs.existsSync(manifestPath)) return manifestPath;
  return null;
}

/**
 * Load AAHP context from a workspace.
 * Returns null if no AAHP handoff directory is found.
 */
export function loadAahpContext(workspaceRoot?: string): AahpContext | null {
  const manifestPath = detectAahpWorkspace(workspaceRoot);
  if (!manifestPath) return null;

  const handoffDir = path.dirname(manifestPath);

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest: AahpManifest = JSON.parse(raw);

    const project = manifest.project ?? path.basename(path.resolve(handoffDir, '..', '..'));
    const phase = manifest.last_session?.phase ?? 'unknown';
    const quickContext = manifest.quick_context ?? '';

    // Read CONVENTIONS.md if referenced
    const conventions = readHandoffFile(handoffDir, 'CONVENTIONS.md', MAX_CONVENTIONS_CHARS);

    // Read NEXT_ACTIONS.md for active tasks
    const activeTasks = readHandoffFile(handoffDir, 'NEXT_ACTIONS.md', MAX_TASKS_CHARS);

    // Last session info
    let lastSession: string | null = null;
    if (manifest.last_session) {
      const ls = manifest.last_session;
      const parts = [`Agent: ${ls.agent ?? 'unknown'}`, `Phase: ${ls.phase ?? 'unknown'}`];
      if (ls.timestamp) parts.push(`Time: ${ls.timestamp}`);
      if (ls.commit) parts.push(`Commit: ${ls.commit}`);
      lastSession = parts.join(', ');
    }

    // Estimate token usage
    const tokenEstimate = manifest.token_budget?.manifest_plus_core ?? estimateTokens(quickContext, conventions, activeTasks);

    return { project, phase, quickContext, conventions, activeTasks, lastSession, tokenEstimate };
  } catch {
    return null;
  }
}

/**
 * Build a context block string from AAHP context.
 * This is prepended to the agent's prompt.
 */
export function buildAahpContextBlock(ctx: AahpContext): string {
  const lines: string[] = [
    `[AAHP v3 Context: ${ctx.project}]`,
    `Phase: ${ctx.phase}`,
  ];

  if (ctx.quickContext) {
    lines.push(`\nProject Summary:\n${ctx.quickContext}`);
  }

  if (ctx.lastSession) {
    lines.push(`\nLast Session: ${ctx.lastSession}`);
  }

  if (ctx.conventions) {
    lines.push(`\nConventions:\n${ctx.conventions}`);
  }

  if (ctx.activeTasks) {
    lines.push(`\nActive Tasks:\n${ctx.activeTasks}`);
  }

  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath ?? null;
}

function readHandoffFile(handoffDir: string, filename: string, maxChars: number): string | null {
  const filePath = path.join(handoffDir, filename);
  try {
    if (!fs.existsSync(filePath)) return null;
    let content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + '\n\n(truncated)';
    }
    return content;
  } catch {
    return null;
  }
}

function estimateTokens(...parts: (string | null)[]): number {
  const totalChars = parts.reduce((sum, p) => sum + (p?.length ?? 0), 0);
  return Math.ceil(totalChars / 4); // rough char-to-token ratio
}
