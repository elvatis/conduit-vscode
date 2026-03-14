import * as vscode from 'vscode';
import { checkHealth, listModels } from './proxy-client';
import { getConfig } from './config';

export class ConduitStatusBar {
  private _item: vscode.StatusBarItem;
  private _modelItem: vscode.StatusBarItem;
  private _timer: NodeJS.Timeout | null = null;
  private _healthy = false;

  constructor() {
    // Main status indicator
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this._item.command = 'conduit.showHealthPanel';
    this._item.tooltip = 'Conduit AI - click to open health dashboard';

    // Model selector in status bar
    this._modelItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99,
    );
    this._modelItem.command = 'conduit.switchModel';
    this._modelItem.tooltip = 'Conduit - click to switch model';

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
      this._modelItem.hide();
      return;
    }

    this._healthy = await checkHealth();
    if (this._healthy) {
      const models = await listModels();
      const count = models.length;
      this._item.text = `$(circuit-board) Conduit ${count} models`;
      this._item.backgroundColor = undefined;

      // Show current model
      const shortModel = cfg.defaultModel.includes('/')
        ? cfg.defaultModel.split('/').pop()!
        : cfg.defaultModel;
      this._modelItem.text = `$(symbol-misc) ${shortModel}`;
      this._modelItem.show();
    } else {
      this._item.text = `$(circuit-board) Conduit offline`;
      this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this._modelItem.hide();
    }
    this._item.show();
  }

  async showStatus() {
    await this._update();
    if (this._healthy) {
      vscode.commands.executeCommand('conduit.showHealthPanel');
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
    this._modelItem.dispose();
  }
}
