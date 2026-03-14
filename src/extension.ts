import * as vscode from 'vscode';
import { ConduitInlineProvider } from './inline-provider';
import { ConduitChatPanel } from './chat-panel';
import { ConduitStatusBar } from './status-bar';
import { registerCommands } from './commands';
import { onConfigChange } from './config';
import { BridgeManager } from './bridge-manager';
import { BridgePanel } from './bridge-panel';
import { HealthPanel } from './health-panel';
import { checkHealth } from './proxy-client';
import { ConduitChatViewProvider } from './chat-view-provider';
import { SessionsTreeProvider } from './sessions-tree-provider';
import { inlineChat } from './inline-chat';
import { generateCommitMessage } from './commit-message';

let statusBar: ConduitStatusBar | undefined;
let bridgeManager: BridgeManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('Conduit: activating...');

    // ── Initialize chat panel with extension context (for persistence) ─────
    ConduitChatPanel.init(context);

    // ── Bridge Manager ────────────────────────────────────────────────────
    bridgeManager = new BridgeManager();
    context.subscriptions.push({ dispose: () => bridgeManager?.dispose() });

    // Bridge commands
    context.subscriptions.push(
      vscode.commands.registerCommand('conduit.showBridgePanel', () => {
        BridgePanel.createOrShow(bridgeManager!);
      }),
      vscode.commands.registerCommand('conduit.startBridge', () => bridgeManager!.start()),
      vscode.commands.registerCommand('conduit.stopBridge', () => bridgeManager!.stop()),
      vscode.commands.registerCommand('conduit.restartBridge', () => bridgeManager!.restart()),
      vscode.commands.registerCommand('conduit.bridgeLogs', () => bridgeManager!.showLogs()),
      vscode.commands.registerCommand('conduit.loginGrok',    () => bridgeManager!.login('grok')),
      vscode.commands.registerCommand('conduit.loginClaude',  () => bridgeManager!.login('claude')),
      vscode.commands.registerCommand('conduit.loginGemini',  () => bridgeManager!.login('gemini')),
      vscode.commands.registerCommand('conduit.loginChatGPT', () => bridgeManager!.login('chatgpt')),
      vscode.commands.registerCommand('conduit.showHealthPanel', () => {
        HealthPanel.createOrShow(bridgeManager!);
      }),
    );

    // ── Sidebar chat view provider ──────────────────────────────────────────
    const chatViewProvider = new ConduitChatViewProvider(context, bridgeManager);
    const sessionsTree = new SessionsTreeProvider(context);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('conduit.chatView', chatViewProvider),
      vscode.window.registerTreeDataProvider('conduit.sessionsView', sessionsTree),
      vscode.commands.registerCommand('conduit.refreshModels', () => chatViewProvider.refreshModels()),
      vscode.commands.registerCommand('conduit.newSession', () => {
        chatViewProvider.newChat();
        sessionsTree.refresh(undefined);
      }),
      vscode.commands.registerCommand('conduit.refreshSessions', () => sessionsTree.refresh()),
      vscode.commands.registerCommand('conduit.loadSession', (sessionId: string) => {
        chatViewProvider.loadSessionExternal(sessionId);
        sessionsTree.refresh(sessionId);
      }),
      vscode.commands.registerCommand('conduit.deleteSessionFromTree', (item: { session: { id: string } }) => {
        chatViewProvider.deleteSessionExternal(item.session.id);
        sessionsTree.refresh();
      }),
    );

    // Refresh sessions tree when chat state changes
    chatViewProvider.onSessionChange((activeId) => {
      sessionsTree.refresh(activeId);
    });

    // ── Inline Chat (Ctrl+I) ────────────────────────────────────────────────
    context.subscriptions.push(
      vscode.commands.registerCommand('conduit.inlineChat', () => inlineChat()),
    );

    // ── Commit message generation ───────────────────────────────────────────
    context.subscriptions.push(
      vscode.commands.registerCommand('conduit.generateCommitMessage', () => generateCommitMessage()),
    );

    // ── Status bar ──────────────────────────────────────────────────────────
    statusBar = new ConduitStatusBar();
    context.subscriptions.push({ dispose: () => statusBar?.dispose() });

    // ── Inline completion provider ──────────────────────────────────────────
    const inlineProvider = new ConduitInlineProvider();
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        inlineProvider,
      ),
    );

    // ── Check proxy status command ──────────────────────────────────────────
    context.subscriptions.push(
      vscode.commands.registerCommand('conduit.checkStatus', () => {
        statusBar?.showStatus();
      }),
    );

    // ── All other commands ──────────────────────────────────────────────────
    const commandDisposables = registerCommands(context, inlineProvider);
    context.subscriptions.push(...commandDisposables);

    // ── Re-read config on change ────────────────────────────────────────────
    context.subscriptions.push(
      onConfigChange(() => {
        // Config is read fresh on each call
      }),
    );

    // ── Move chat view to secondary sidebar on first install ───────────────
    const isFirstRun = !context.globalState.get('conduit.installed');
    if (isFirstRun) {
      context.globalState.update('conduit.installed', true);
      // Try to move the chat view to the secondary sidebar (right panel)
      setTimeout(async () => {
        try {
          await vscode.commands.executeCommand('conduit.chatView.focus');
          await vscode.commands.executeCommand('workbench.action.moveFocusedView', {
            destination: 'workbench.parts.auxiliarybar',
          });
        } catch {
          // Fallback: stays in panel - user can drag it manually
        }
      }, 3000);
      vscode.window.showInformationMessage(
        'Conduit AI is ready! Make sure conduit-bridge is running on port 31338.',
        'Open Chat',
        'Settings',
      ).then(action => {
        if (action === 'Open Chat') {
          vscode.commands.executeCommand('conduit.chatView.focus');
        } else if (action === 'Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'conduit');
        }
      });
    }

    // ── Auto-start bridge (non-blocking) ────────────────────────────────────
    checkHealth().then(async healthy => {
      if (!healthy) {
        try {
          await bridgeManager!.start();
        } catch (err) {
          console.error('Conduit: failed to auto-start bridge:', err);
        }
      } else {
        bridgeManager!.getStatus().catch(() => {});
      }
    }).catch(err => {
      console.error('Conduit: health check failed:', err);
    });

    console.log('Conduit: activated');
  } catch (err) {
    console.error('Conduit: activation failed:', err);
    vscode.window.showErrorMessage(`Conduit failed to activate: ${(err as Error).message}`);
  }
}

export function deactivate() {
  statusBar?.dispose();
}
