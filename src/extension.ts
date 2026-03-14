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

let statusBar: ConduitStatusBar | undefined;
let bridgeManager: BridgeManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Conduit: activating…');

  // ── Initialize chat panel with extension context (for persistence) ─────────
  ConduitChatPanel.init(context);

  // ── Bridge Manager ──────────────────────────────────────────────────────────
  bridgeManager = new BridgeManager();
  context.subscriptions.push({ dispose: () => bridgeManager?.dispose() });

  // Bridge panel command
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

  // ── Auto-start bridge if not reachable ─────────────────────────────────────
  (async () => {
    const healthy = await checkHealth();
    if (!healthy) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Conduit: starting bridge...', cancellable: false },
        async () => {
          await bridgeManager!.start();
        },
      );
    } else {
      // Bridge is already running - refresh status for status bar
      await bridgeManager!.getStatus();
    }
  })();

  // ── Status bar ──────────────────────────────────────────────────────────────
  statusBar = new ConduitStatusBar();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // ── Inline completion provider ──────────────────────────────────────────────
  const inlineProvider = new ConduitInlineProvider();
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' }, // all files
      inlineProvider,
    ),
  );

  // ── Check proxy status command ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('conduit.checkStatus', () => {
      statusBar?.showStatus();
    }),
  );

  // ── All other commands ──────────────────────────────────────────────────────
  const commandDisposables = registerCommands(context, inlineProvider);
  context.subscriptions.push(...commandDisposables);

  // ── Re-read config on change ────────────────────────────────────────────────
  context.subscriptions.push(
    onConfigChange(() => {
      // Config is read fresh on each call — no action needed here
      // but inlineProvider needs to know about enable/disable
    }),
  );

  // ── Welcome message on first install ───────────────────────────────────────
  const isFirstRun = !context.globalState.get('conduit.installed');
  if (isFirstRun) {
    context.globalState.update('conduit.installed', true);
    vscode.window.showInformationMessage(
      'Conduit AI is ready! Make sure conduit-bridge is running on port 31338.',
      'Open Chat',
      'Settings',
    ).then(action => {
      if (action === 'Open Chat') {
        ConduitChatPanel.createOrShow(context.extensionUri);
      } else if (action === 'Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'conduit');
      }
    });
  }

  console.log('Conduit: activated ✓');
}

export function deactivate() {
  statusBar?.dispose();
}
