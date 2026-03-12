import * as vscode from 'vscode';
import { ConduitInlineProvider } from './inline-provider';
import { ConduitChatPanel } from './chat-panel';
import { ConduitStatusBar } from './status-bar';
import { registerCommands } from './commands';
import { onConfigChange } from './config';

let statusBar: ConduitStatusBar | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Conduit: activating…');

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
      'Conduit AI is ready! Make sure cli-bridge is running on port 31337.',
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
