import * as vscode from 'vscode';
import type { ChatMode } from './model-registry';
import { extractProvider, shortModelName } from './utils';
import type { CliAgentHandle } from './cli-runner';
import * as fs from 'fs';
import * as path from 'path';
import { estimateCost, formatCost, formatTokens, type CostEstimate } from './cost-tracker';

interface SessionEntry {
  id: string;
  title: string;
  customTitle?: string;
  model: string;
  mode: ChatMode;
  modelsUsed?: string[];
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

// ── Background agent sessions ─────────────────────────────────────────────────

export type BackgroundSessionStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface BackgroundSession {
  id: string;
  title: string;
  model: string;
  status: BackgroundSessionStatus;
  startedAt: number;
  finishedAt?: number;
  handle: CliAgentHandle;
  outputChannel: vscode.OutputChannel;
  /** Last line of agent output (for live tree item description) */
  lastOutputLine: string;
  /** Interval for polling output */
  _outputPollInterval?: ReturnType<typeof setInterval>;
  /** Cost estimate parsed from agent output */
  costEstimate?: CostEstimate;
}

/** Serializable subset of BackgroundSession for persistence */
interface PersistedSession {
  id: string;
  title: string;
  model: string;
  status: BackgroundSessionStatus;
  startedAt: number;
  finishedAt?: number;
  lastOutputLine: string;
  logFile?: string;
}

const _backgroundSessions = new Map<string, BackgroundSession>();
let _bgIdCounter = 0;
let _treeRefreshCb: (() => void) | null = null;
let _extensionContext: vscode.ExtensionContext | null = null;

export function setBackgroundRefreshCallback(cb: () => void): void {
  _treeRefreshCb = cb;
}

/** Get the session log directory, creating it if needed */
function getSessionLogDir(): string | undefined {
  const workdir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workdir) return undefined;
  const dir = path.join(workdir, '.conduit', 'sessions');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }
  return dir;
}

/** Persist session metadata to globalState */
function persistSessions(): void {
  if (!_extensionContext) return;
  const sessions: PersistedSession[] = [];
  for (const s of _backgroundSessions.values()) {
    sessions.push({
      id: s.id,
      title: s.title,
      model: s.model,
      status: s.status,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      lastOutputLine: s.lastOutputLine,
      logFile: getSessionLogPath(s.id),
    });
  }
  _extensionContext.globalState.update('conduit.backgroundSessions', sessions);
}

/** Get path for a session log file */
function getSessionLogPath(sessionId: string): string | undefined {
  const dir = getSessionLogDir();
  if (!dir) return undefined;
  return path.join(dir, `${sessionId}.log`);
}

/** Write session output to a log file */
function writeSessionLog(session: BackgroundSession): void {
  const logPath = getSessionLogPath(session.id);
  if (!logPath) return;
  try {
    const output = session.handle.output.join('');
    fs.writeFileSync(logPath, output, 'utf-8');
  } catch {
    // best-effort log persistence
  }
}

/** Restore sessions from globalState (called during activation) */
export function restorePersistedSessions(context: vscode.ExtensionContext): void {
  _extensionContext = context;
  const persisted = context.globalState.get<PersistedSession[]>('conduit.backgroundSessions', []);
  for (const p of persisted) {
    // Mark previously running sessions as interrupted
    const status: BackgroundSessionStatus = p.status === 'running' ? 'interrupted' : p.status;

    // Load log content if available
    let logContent = '';
    if (p.logFile) {
      try {
        logContent = fs.readFileSync(p.logFile, 'utf-8');
      } catch {
        // log file may have been cleaned up
      }
    }

    // Create a read-only output channel with the saved log
    const outputChannel = vscode.window.createOutputChannel(`Conduit Agent: ${p.title}`);
    if (logContent) {
      outputChannel.append(logContent);
    } else {
      outputChannel.appendLine(`[Agent] Model: ${p.model}`);
      outputChannel.appendLine(`[Agent] Status: ${status} (restored from previous session)`);
      outputChannel.appendLine(`[Agent] Started: ${new Date(p.startedAt).toLocaleString()}`);
      if (p.finishedAt) {
        outputChannel.appendLine(`[Agent] Finished: ${new Date(p.finishedAt).toLocaleString()}`);
      }
    }

    // Create a dummy handle for the restored session (not runnable)
    const dummyHandle: CliAgentHandle = {
      pid: 0,
      output: logContent ? [logContent] : [],
      kill: () => {},
      result: Promise.resolve({ stdout: '', stderr: '', exitCode: status === 'completed' ? 0 : 1 }),
    };

    const session: BackgroundSession = {
      id: p.id,
      title: p.title,
      model: p.model,
      status,
      startedAt: p.startedAt,
      finishedAt: p.finishedAt ?? (status === 'interrupted' ? Date.now() : undefined),
      handle: dummyHandle,
      outputChannel,
      lastOutputLine: status === 'interrupted' ? 'interrupted (VS Code restarted)' : p.lastOutputLine,
    };

    _backgroundSessions.set(p.id, session);
    // Update ID counter to avoid collisions
    const idNum = parseInt(p.id.replace(/^bg-/, '').split('-')[0], 10);
    if (!isNaN(idNum) && idNum >= _bgIdCounter) {
      _bgIdCounter = idNum + 1;
    }
  }
}

export function addBackgroundSession(
  title: string,
  model: string,
  handle: CliAgentHandle,
): BackgroundSession {
  const id = `bg-${++_bgIdCounter}-${Date.now()}`;
  const outputChannel = vscode.window.createOutputChannel(`Conduit Agent: ${title}`);
  outputChannel.appendLine(`[Agent] Model: ${model}`);
  outputChannel.appendLine(`[Agent] PID: ${handle.pid}`);
  outputChannel.appendLine(`[Agent] Started: ${new Date().toLocaleString()}`);
  outputChannel.appendLine('---');

  const session: BackgroundSession = {
    id, title, model, status: 'running', startedAt: Date.now(), handle, outputChannel,
    lastOutputLine: 'starting...',
  };
  _backgroundSessions.set(id, session);
  persistSessions();

  // Live output streaming: poll handle.output and append new chunks
  let lastOutputLength = 0;
  session._outputPollInterval = setInterval(() => {
    if (session.status !== 'running') return;

    const currentOutput = handle.output.join('');
    if (currentOutput.length > lastOutputLength) {
      const newChunk = currentOutput.slice(lastOutputLength);
      lastOutputLength = currentOutput.length;
      outputChannel.append(newChunk);

      // Update last output line for tree item description
      const lines = currentOutput.split('\n').filter(l => l.trim().length > 0);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1].trim();
        session.lastOutputLine = lastLine.length > 60
          ? lastLine.slice(0, 57) + '...'
          : lastLine;
        _treeRefreshCb?.();
      }

      // Live cost check: parse tokens periodically and enforce budget
      const liveCost = estimateCost(currentOutput, session.model);
      if (liveCost) {
        session.costEstimate = liveCost;
        const budgetLimit = vscode.workspace.getConfiguration('conduit').get<number>('maxSessionCost', 0);
        if (budgetLimit > 0 && liveCost.costUsd > budgetLimit) {
          outputChannel.appendLine(`\n[Cost] ⚠️ Budget limit exceeded (${formatCost(liveCost.costUsd)} > ${formatCost(budgetLimit)}). Killing agent.`);
          handle.kill();
          session.status = 'failed';
          session.finishedAt = Date.now();
          session.lastOutputLine = 'killed: budget exceeded';
          if (session._outputPollInterval) clearInterval(session._outputPollInterval);
          _treeRefreshCb?.();
          vscode.window.showWarningMessage(
            `Conduit: agent "${title}" killed (cost ${formatCost(liveCost.costUsd)} exceeded budget ${formatCost(budgetLimit)}).`,
          );
        }
      }
    }
  }, 1_000);

  // Update status when done
  handle.result.then((result) => {
    session.status = result.exitCode === 0 ? 'completed' : 'failed';
    session.finishedAt = Date.now();

    // Flush remaining output
    const currentOutput = handle.output.join('');
    if (currentOutput.length > lastOutputLength) {
      outputChannel.append(currentOutput.slice(lastOutputLength));
    }

    outputChannel.appendLine('\n---');
    outputChannel.appendLine(`[Agent] ${session.status} (exit code ${result.exitCode})`);

    // Parse token usage and estimate cost
    const fullOutput = handle.output.join('');
    const cost = estimateCost(fullOutput, session.model);
    if (cost) {
      session.costEstimate = cost;
      outputChannel.appendLine(`[Cost] ${formatTokens(cost.usage)}`);
      outputChannel.appendLine(`[Cost] Estimated: ${formatCost(cost.costUsd)} (${session.model})`);
    }

    // Check budget limit
    const budgetLimit = vscode.workspace.getConfiguration('conduit').get<number>('maxSessionCost', 0);
    if (budgetLimit > 0 && cost && cost.costUsd > budgetLimit) {
      outputChannel.appendLine(`[Cost] ⚠️ Session cost (${formatCost(cost.costUsd)}) exceeded budget limit (${formatCost(budgetLimit)})`);
    }

    if (session._outputPollInterval) clearInterval(session._outputPollInterval);

    // Persist session log and state
    writeSessionLog(session);
    persistSessions();
    _treeRefreshCb?.();

    // Completion notification with cost info
    const costSuffix = cost ? ` [${formatCost(cost.costUsd)}]` : '';
    vscode.window.showInformationMessage(
      `Conduit: agent "${title}" ${session.status}.${costSuffix}`,
      'View Output',
    ).then(action => {
      if (action === 'View Output') outputChannel.show();
    });
  }).catch(() => {
    session.status = 'failed';
    session.finishedAt = Date.now();
    if (session._outputPollInterval) clearInterval(session._outputPollInterval);
    writeSessionLog(session);
    persistSessions();
    _treeRefreshCb?.();
  });

  _treeRefreshCb?.();
  return session;
}

export function killBackgroundSession(id: string): boolean {
  const session = _backgroundSessions.get(id);
  if (!session || session.status !== 'running') return false;
  session.handle.kill();
  session.status = 'failed';
  session.finishedAt = Date.now();
  session.lastOutputLine = 'killed by user';
  if (session._outputPollInterval) clearInterval(session._outputPollInterval);
  session.outputChannel.appendLine('\n[Agent] Killed by user');
  writeSessionLog(session);
  persistSessions();
  _treeRefreshCb?.();
  return true;
}

/** Remove a completed/failed/interrupted session from the tree */
export function removeBackgroundSession(id: string): boolean {
  const session = _backgroundSessions.get(id);
  if (!session) return false;
  if (session.status === 'running') return false; // don't remove running sessions
  session.outputChannel.dispose();
  _backgroundSessions.delete(id);
  persistSessions();
  _treeRefreshCb?.();
  return true;
}

/** Clear all completed/failed/interrupted sessions */
export function clearFinishedSessions(): number {
  let cleared = 0;
  for (const [id, session] of _backgroundSessions.entries()) {
    if (session.status !== 'running') {
      session.outputChannel.dispose();
      _backgroundSessions.delete(id);
      cleared++;
    }
  }
  if (cleared > 0) {
    persistSessions();
    _treeRefreshCb?.();
  }
  return cleared;
}

export function getBackgroundSessions(): BackgroundSession[] {
  return [..._backgroundSessions.values()];
}

export function getBackgroundSession(id: string): BackgroundSession | undefined {
  return _backgroundSessions.get(id);
}

// ── Provider display metadata ────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  'web-claude':    'Claude',
  'cli-claude':    'Claude (CLI)',
  'web-grok':      'Grok',
  'web-gemini':    'Gemini',
  'cli-gemini':    'Gemini (CLI)',
  'web-chatgpt':   'ChatGPT',
  'openai-codex':  'OpenAI Codex',
  'opencode':      'OpenCode',
  'pi':            'Pi',
  'local-bitnet':  'BitNet (Local)',
};

const PROVIDER_ICONS: Record<string, string> = {
  'web-claude':    'hubot',
  'cli-claude':    'hubot',
  'web-grok':      'rocket',
  'web-gemini':    'sparkle',
  'cli-gemini':    'sparkle',
  'web-chatgpt':   'comment-discussion',
  'openai-codex':  'code',
  'opencode':      'terminal',
  'pi':            'terminal',
  'local-bitnet':  'server',
};

// ── Tree items ───────────────────────────────────────────────────────────────

type TreeNode = ProviderGroupItem | SessionItem | BackgroundSessionItem;

class ProviderGroupItem extends vscode.TreeItem {
  readonly kind = 'provider' as const;

  constructor(
    public readonly providerId: string,
    public readonly sessions: SessionEntry[],
    hasActiveSessions: boolean,
  ) {
    const label = PROVIDER_LABELS[providerId] ?? providerId;
    super(label, vscode.TreeItemCollapsibleState.Expanded);

    this.description = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon(
      PROVIDER_ICONS[providerId] ?? 'folder',
      hasActiveSessions
        ? new vscode.ThemeColor('charts.green')
        : undefined,
    );
    this.contextValue = 'providerGroup';
  }
}

class SessionItem extends vscode.TreeItem {
  readonly kind = 'session' as const;

  constructor(public readonly session: SessionEntry, isActive: boolean) {
    super(session.customTitle || session.title, vscode.TreeItemCollapsibleState.None);

    const modelsUsed = session.modelsUsed ?? [];
    const modelLabel = modelsUsed.length > 1
      ? 'Multi-model'
      : shortModelName(session.model);
    const ago = timeAgo(session.updatedAt);

    this.description = `${modelLabel} - ${ago}`;

    const modelsDetail = modelsUsed.length > 1
      ? `Models used: ${modelsUsed.map(m => shortModelName(m)).join(', ')}`
      : `Model: ${session.model}`;
    this.tooltip = new vscode.MarkdownString(
      `**${session.customTitle || session.title}**\n\n` +
      `${modelsDetail}\n\n` +
      `Mode: ${session.mode}\n\n` +
      `Messages: ${session.messageCount}\n\n` +
      `Updated: ${new Date(session.updatedAt).toLocaleString()}`,
    );
    this.iconPath = new vscode.ThemeIcon(
      isActive ? 'comment-discussion' : 'comment',
    );
    this.contextValue = isActive ? 'activeSession' : 'session';
    this.command = {
      command: 'conduit.loadSession',
      title: 'Load Session',
      arguments: [session.id],
    };
  }
}

class BackgroundSessionItem extends vscode.TreeItem {
  readonly kind = 'backgroundSession' as const;

  constructor(public readonly bgSession: BackgroundSession) {
    super(bgSession.title, vscode.TreeItemCollapsibleState.None);

    // Live output line for running agents, model + time for completed
    if (bgSession.status === 'running' && bgSession.lastOutputLine) {
      this.description = bgSession.lastOutputLine;
    } else {
      const ago = timeAgo(bgSession.startedAt);
      this.description = `${shortModelName(bgSession.model)} - ${ago}`;
    }

    const statusIcon = bgSession.status === 'running' ? 'sync~spin'
      : bgSession.status === 'completed' ? 'check'
      : bgSession.status === 'interrupted' ? 'debug-pause'
      : 'error';
    const statusColor = bgSession.status === 'running' ? 'charts.blue'
      : bgSession.status === 'completed' ? 'charts.green'
      : bgSession.status === 'interrupted' ? 'charts.yellow'
      : 'charts.red';

    this.iconPath = new vscode.ThemeIcon(statusIcon, new vscode.ThemeColor(statusColor));

    const durationStr = bgSession.finishedAt
      ? `Duration: ${Math.round((bgSession.finishedAt - bgSession.startedAt) / 1000)}s`
      : `Running for: ${Math.round((Date.now() - bgSession.startedAt) / 1000)}s`;

    let costStr = '';
    if (bgSession.costEstimate) {
      costStr = `\n\nTokens: ${formatTokens(bgSession.costEstimate.usage)}\n\n` +
        `Cost: ${formatCost(bgSession.costEstimate.costUsd)}`;
    }

    this.tooltip = new vscode.MarkdownString(
      `**${bgSession.title}**\n\n` +
      `Model: ${bgSession.model}\n\n` +
      `Status: ${bgSession.status}\n\n` +
      `PID: ${bgSession.handle.pid}\n\n` +
      `${durationStr}\n\n` +
      `Started: ${new Date(bgSession.startedAt).toLocaleString()}` +
      costStr,
    );

    this.contextValue = bgSession.status === 'running' ? 'runningAgent'
      : bgSession.status === 'interrupted' ? 'interruptedAgent'
      : 'completedAgent';
  }
}

// ── Tree data provider ───────────────────────────────────────────────────────

export class SessionsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _context: vscode.ExtensionContext;
  private _activeSessionId: string | null = null;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    _extensionContext = context;
    setBackgroundRefreshCallback(() => this.refresh());
  }

  refresh(activeSessionId?: string): void {
    if (activeSessionId !== undefined) {
      this._activeSessionId = activeSessionId;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const sessions = this._context.globalState.get<SessionEntry[]>('conduit.chatSessions', []);
    const bgSessions = getBackgroundSessions();

    if (!element) {
      const items: TreeNode[] = [];

      // Show background agent sessions at the top
      if (bgSessions.length > 0) {
        const sorted = [...bgSessions].sort((a, b) => b.startedAt - a.startedAt);
        items.push(...sorted.map(s => new BackgroundSessionItem(s)));
      }

      // Root level: group by primary provider
      if (sessions.length === 0) return items;

      const groups = new Map<string, SessionEntry[]>();
      for (const s of sessions) {
        const provider = extractProvider(s.model);
        if (!groups.has(provider)) groups.set(provider, []);
        groups.get(provider)!.push(s);
      }

      // Sort providers: providers with active session first, then alphabetically
      const sorted = [...groups.entries()].sort((a, b) => {
        const aHasActive = a[1].some(s => s.id === this._activeSessionId);
        const bHasActive = b[1].some(s => s.id === this._activeSessionId);
        if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
        // Then by most recent session
        const aRecent = Math.max(...a[1].map(s => s.updatedAt));
        const bRecent = Math.max(...b[1].map(s => s.updatedAt));
        return bRecent - aRecent;
      });

      // If only one provider and no bg sessions, skip grouping and show sessions directly
      if (sorted.length === 1 && bgSessions.length === 0) {
        const [, providerSessions] = sorted[0];
        return providerSessions.map(
          s => new SessionItem(s, s.id === this._activeSessionId),
        );
      }

      items.push(...sorted.map(([providerId, providerSessions]) => {
        const hasActive = providerSessions.some(s => s.id === this._activeSessionId);
        return new ProviderGroupItem(providerId, providerSessions, hasActive);
      }));

      return items;
    }

    if (element instanceof ProviderGroupItem) {
      // Provider group children: sessions sorted by updatedAt (newest first)
      const sorted = [...element.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
      return sorted.map(s => new SessionItem(s, s.id === this._activeSessionId));
    }

    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
