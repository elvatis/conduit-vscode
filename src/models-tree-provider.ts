import * as vscode from 'vscode';
import { listModels, ModelInfo } from './proxy-client';
import { BridgeManager } from './bridge-manager';

class ModelItem extends vscode.TreeItem {
  constructor(model: ModelInfo) {
    const shortName = model.id.includes('/') ? model.id.split('/').pop()! : model.id;
    super(shortName, vscode.TreeItemCollapsibleState.None);
    this.description = model.owned_by;
    this.tooltip = model.id;
    this.iconPath = new vscode.ThemeIcon('symbol-misc');
    this.contextValue = 'model';
    this.command = {
      command: 'conduit.selectModelFromTree',
      title: 'Use this model',
      arguments: [model.id],
    };
  }
}

export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ModelItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _models: ModelInfo[] = [];

  constructor(bridgeManager: BridgeManager) {
    bridgeManager.onStatusChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async getChildren(): Promise<ModelItem[]> {
    try {
      this._models = await listModels();
    } catch {
      this._models = [];
    }
    if (this._models.length === 0) {
      return [];
    }
    return this._models.map(m => new ModelItem(m));
  }

  getTreeItem(element: ModelItem): vscode.TreeItem {
    return element;
  }
}
