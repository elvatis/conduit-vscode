import * as vscode from 'vscode';
import type { ChatMode } from './model-registry';
import { extractProvider, shortModelName } from './utils';
import type { CliAgentHandle } from './cli-runner';

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

export type BackgroundSessionStatus = 'running' | 'completed' | 'failed';

export interface BackgroundSession {
  id: string;
  title: string;
  model: string;
  status: BackgroundSessionStatus;
  startedAt: number;
  finishedAt?: number;
  handle: CliAgentHandle;
  outputChannel: vscode.OutputChannel;
}

const _backgroundSessions = new Map<string, BackgroundSession>();
let _bgIdCounter = 0;
let _treeRefreshCb: (() => void) | null = null;

export function setBackgroundRefreshCallback(cb: () => void): void {
  _treeRefreshCb = cb;
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
  };
  _backgroundSessions.set(id, session);

  // Update output and status when done
  handle.result.then((result) => {
    session.status = result.exitCode === 0 ? 'completed' : 'failed';
    session.finishedAt = Date.now();
    const text = handle.output.join('');
    outputChannel.appendLine(text);
    outputChannel.appendLine('\n---');
    outputChannel.appendLine(`[Agent] ${session.status} (exit code ${result.exitCode})`);
    _treeRefreshCb?.();
  }).catch(() => {
    session.status = 'failed';
    session.finishedAt = Date.now();
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
  session.outputChannel.appendLine('\n[Agent] Killed by user');
  _treeRefreshCb?.();
  return true;
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

    const ago = timeAgo(bgSession.startedAt);
    this.description = `${shortModelName(bgSession.model)} - ${ago}`;

    const statusIcon = bgSession.status === 'running' ? 'sync~spin'
      : bgSession.status === 'completed' ? 'check'
      : 'error';
    const statusColor = bgSession.status === 'running' ? 'charts.blue'
      : bgSession.status === 'completed' ? 'charts.green'
      : 'charts.red';

    this.iconPath = new vscode.ThemeIcon(statusIcon, new vscode.ThemeColor(statusColor));

    this.tooltip = new vscode.MarkdownString(
      `**${bgSession.title}**\n\n` +
      `Model: ${bgSession.model}\n\n` +
      `Status: ${bgSession.status}\n\n` +
      `PID: ${bgSession.handle.pid}\n\n` +
      `Started: ${new Date(bgSession.startedAt).toLocaleString()}`,
    );

    this.contextValue = bgSession.status === 'running' ? 'runningAgent' : 'completedAgent';
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
