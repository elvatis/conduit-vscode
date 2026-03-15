import * as vscode from 'vscode';
import { listModels } from './proxy-client';
import { getConfig } from './config';
import type { BridgeManager } from './bridge-manager';

interface BridgeStatus {
  providers: Array<{ sessionValid: boolean }>;
  version: string;
}

export class ConduitStatusBar {
  private _item: vscode.StatusBarItem;
  private _timer: NodeJS.Timeout | null = null;
  private _bridgeStatus: BridgeStatus | null = null;
  private _bridgeManager: BridgeManager | null = null;
  private _disposables: vscode.Disposable[] = [];

  constructor() {
    // Single consolidated status bar item
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this._item.command = 'conduit.showBridgePanel';
    this._item.tooltip = 'Conduit AI - click to manage';
    this._update();
    this._startPolling();
  }

  /** Connect to bridge manager to receive status updates */
  setBridgeManager(bm: BridgeManager): void {
    this._bridgeManager = bm;
    this._disposables.push(
      bm.onStatusChange((status) => {
        this._bridgeStatus = status as BridgeStatus | null;
        this._update();
      }),
    );
  }

  private _startPolling() {
    this._timer = setInterval(() => this._update(), 30000);
  }

  private async _update() {
    const cfg = getConfig();
    if (!cfg.autoStatusBar) {
      this._item.hide();
      return;
    }

    const parts: string[] = ['$(circuit-board)'];

    // Bridge status (providers connected)
    if (this._bridgeStatus) {
      const connected = this._bridgeStatus.providers.filter(p => p.sessionValid).length;
      const total = this._bridgeStatus.providers.length;
      parts.push(`${connected}/${total}`);
    }

    // Model count
    try {
      const models = await listModels();
      if (models.length > 0) {
        parts.push(`${models.length} models`);
      }
    } catch { /* offline */ }

    // Current model
    const shortModel = cfg.defaultModel.includes('/')
      ? cfg.defaultModel.split('/').pop()!
      : cfg.defaultModel;
    parts.push(`$(symbol-misc) ${shortModel}`);

    this._item.text = parts.join('  ');

    // Background color based on bridge status
    if (this._bridgeStatus) {
      const connected = this._bridgeStatus.providers.filter(p => p.sessionValid).length;
      this._item.backgroundColor = connected > 0
        ? undefined
        : new vscode.ThemeColor('statusBarItem.warningBackground');
      this._item.tooltip = `Conduit v${this._bridgeStatus.version} - ${connected}/${this._bridgeStatus.providers.length} providers - ${shortModel} - click to manage`;
    } else {
      this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this._item.tooltip = 'Conduit: bridge offline - click to manage';
    }

    this._item.show();
  }

  async showStatus() {
    if (this._bridgeStatus) {
      vscode.commands.executeCommand('conduit.showBridgePanel');
    } else {
      const cfg = getConfig();
      vscode.window.showWarningMessage(
        `Conduit proxy is offline at ${cfg.proxyUrl}. Make sure cli-bridge is running.`,
        'Start Bridge',
        'Open Settings',
      ).then(action => {
        if (action === 'Start Bridge') {
          vscode.commands.executeCommand('conduit.startBridge');
        } else if (action === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'conduit');
        }
      });
    }
  }

  dispose() {
    if (this._timer) clearInterval(this._timer);
    this._item.dispose();
    for (const d of this._disposables) d.dispose();
  }
}
