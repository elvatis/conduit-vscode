import * as vscode from 'vscode';

interface SessionEntry {
  id: string;
  title: string;
  model: string;
  mode: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

class SessionItem extends vscode.TreeItem {
  constructor(public readonly session: SessionEntry, isActive: boolean) {
    super(session.title, vscode.TreeItemCollapsibleState.None);

    const modelShort = session.model?.includes('/')
      ? session.model.split('/').pop()!
      : session.model || 'unknown';
    const ago = timeAgo(session.updatedAt);

    this.description = `${modelShort} - ${ago}`;
    this.tooltip = new vscode.MarkdownString(
      `**${session.title}**\n\n` +
      `Model: ${session.model}\n\n` +
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

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined | void>();
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

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SessionItem[]> {
    const sessions = this._context.globalState.get<SessionEntry[]>('conduit.chatSessions', []);
    if (sessions.length === 0) {
      return [];
    }
    return sessions.map(s => new SessionItem(s, s.id === this._activeSessionId));
  }
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
