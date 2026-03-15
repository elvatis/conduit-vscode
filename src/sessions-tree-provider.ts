import * as vscode from 'vscode';
import type { ChatMode } from './model-registry';
import { extractProvider, shortModelName } from './utils';

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

// ── Provider display metadata ────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  'web-claude':    'Claude',
  'cli-claude':    'Claude (CLI)',
  'web-grok':      'Grok',
  'web-gemini':    'Gemini',
  'cli-gemini':    'Gemini (CLI)',
  'web-chatgpt':   'ChatGPT',
  'openai-codex':  'OpenAI Codex',
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
  'local-bitnet':  'server',
};

// ── Tree items ───────────────────────────────────────────────────────────────

type TreeNode = ProviderGroupItem | SessionItem;

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

// ── Tree data provider ───────────────────────────────────────────────────────

export class SessionsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _context: vscode.ExtensionContext;
  private _activeSessionId: string | null = null;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
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

    if (!element) {
      // Root level: group by primary provider
      if (sessions.length === 0) return [];

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

      // If only one provider, skip grouping and show sessions directly
      if (sorted.length === 1) {
        const [, providerSessions] = sorted[0];
        return providerSessions.map(
          s => new SessionItem(s, s.id === this._activeSessionId),
        );
      }

      return sorted.map(([providerId, providerSessions]) => {
        const hasActive = providerSessions.some(s => s.id === this._activeSessionId);
        return new ProviderGroupItem(providerId, providerSessions, hasActive);
      });
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
