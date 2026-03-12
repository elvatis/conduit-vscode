import * as vscode from 'vscode';
import { checkHealth, listModels } from './proxy-client';
import { getConfig } from './config';

export class ConduitStatusBar {
  private _item: vscode.StatusBarItem;
  private _timer: NodeJS.Timeout | null = null;
  private _healthy = false;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this._item.command = 'conduit.checkStatus';
    this._item.tooltip = 'Conduit AI — click to check status';
    this._update();
    this._startPolling();
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

    this._healthy = await checkHealth();
    if (this._healthy) {
      const models = await listModels();
      const count = models.length;
      this._item.text = `$(circuit-board) Conduit ✓ ${count} models`;
      this._item.backgroundColor = undefined;
    } else {
      this._item.text = `$(circuit-board) Conduit ✗ offline`;
      this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    this._item.show();
  }

  async showStatus() {
    await this._update();
    if (this._healthy) {
      const models = await listModels();
      vscode.window.showInformationMessage(
        `Conduit proxy is online. Available models: ${models.map(m => m.id).join(', ')}`,
      );
    } else {
      const cfg = getConfig();
      vscode.window.showWarningMessage(
        `Conduit proxy is offline at ${cfg.proxyUrl}. Make sure cli-bridge is running.`,
        'Open Settings',
      ).then(action => {
        if (action === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'conduit');
        }
      });
    }
  }

  dispose() {
    if (this._timer) clearInterval(this._timer);
    this._item.dispose();
  }
}
