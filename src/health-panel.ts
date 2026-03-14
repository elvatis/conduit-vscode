import * as vscode from 'vscode';
import type { BridgeManager, BridgeStatus } from './bridge-manager';
import { listModels } from './proxy-client';
import { getConfig } from './config';

export class HealthPanel {
  private static _instance: HealthPanel | undefined;
  private _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _refreshTimer: NodeJS.Timeout | null = null;

  private constructor(
    panel: vscode.WebviewPanel,
    private _manager: BridgeManager,
  ) {
    this._panel = panel;
    this._panel.webview.options = { enableScripts: true };

    this._panel.webview.onDidReceiveMessage(
      msg => this._handleMessage(msg),
      null, this._disposables,
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Push status updates to panel
    this._disposables.push(
      _manager.onStatusChange(() => this._refresh()),
    );

    // Initial render + auto-refresh every 15s
    this._refresh();
    this._refreshTimer = setInterval(() => this._refresh(), 15000);
  }

  static createOrShow(manager: BridgeManager) {
    const column = vscode.ViewColumn.Two;
    if (HealthPanel._instance) {
      HealthPanel._instance._panel.reveal(column);
      HealthPanel._instance._refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'conduitHealth', 'Conduit - Health Dashboard',
      column, { enableScripts: true, retainContextWhenHidden: true },
    );
    HealthPanel._instance = new HealthPanel(panel, manager);
  }

  private async _handleMessage(msg: { type: string }) {
    switch (msg.type) {
      case 'refresh': await this._refresh(); break;
      case 'start':   await this._manager.start(); break;
      case 'stop':    await this._manager.stop(); break;
      case 'restart': await this._manager.restart(); break;
      case 'logs':    this._manager.showLogs(); break;
    }
  }

  private async _refresh() {
    const status = await this._manager.getStatus();
    const models = await listModels();
    const cfg = getConfig();
    this._panel.webview.html = this._renderHtml(status, models.map(m => m.id), cfg.proxyUrl);
  }

  dispose() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    HealthPanel._instance = undefined;
    this._panel.dispose();
    this._disposables.forEach(d => d.dispose());
  }

  private _renderHtml(
    status: BridgeStatus | null,
    models: string[],
    proxyUrl: string,
  ): string {
    const isOnline = !!status;
    const uptime = status ? formatUptime(status.uptime) : '-';
    const port = status?.port ?? new URL(proxyUrl).port ?? '31337';
    const version = status?.version ?? '-';

    const providerRows = (status?.providers ?? []).map(p => {
      const ind = p.sessionValid ? 'ok' : (p.hasProfile ? 'warn' : 'err');
      const badge = p.sessionValid ? 'Connected' : (p.hasProfile ? 'Profile saved' : 'Not configured');
      const badgeClass = p.sessionValid ? 'badge-green' : (p.hasProfile ? 'badge-amber' : 'badge-gray');
      const modelList = p.models.length > 0 ? p.models.join(', ') : '-';
      return `<tr>
        <td><span class="ind ind-${ind}"></span> ${capitalize(p.name)}</td>
        <td><span class="badge ${badgeClass}">${badge}</span></td>
        <td class="mono">${modelList}</td>
      </tr>`;
    }).join('');

    // Group models by prefix
    const grouped: Record<string, string[]> = {};
    for (const m of models) {
      const prefix = m.includes('/') ? m.split('/')[0] : 'other';
      (grouped[prefix] ??= []).push(m);
    }
    const modelCards = Object.entries(grouped).map(([prefix, ids]) => {
      const items = ids.map(id => `<div class="model-item">${id}</div>`).join('');
      return `<div class="model-card">
        <div class="model-card-title">${prefix}</div>
        ${items}
      </div>`;
    }).join('');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conduit Health</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
    padding: 24px; max-width: 900px;
  }
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 10px; }
  .subtitle { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
  .status-badge { font-size: 11px; padding: 3px 10px; border-radius: 12px; font-weight: 600; }
  .status-online { background: #1a7a3a; color: #fff; }
  .status-offline { background: #7a1a1a; color: #fff; }
  .section { margin-bottom: 28px; }
  .section-title {
    font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin-bottom: 10px;
    padding-bottom: 6px; border-bottom: 1px solid var(--vscode-panel-border);
  }
  .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .info-card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px; padding: 12px;
  }
  .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .info-value { font-size: 16px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; }
  .mono { font-family: var(--vscode-editor-font-family); font-size: 11px; }
  .ind { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .ind-ok { background: #3fb950; }
  .ind-warn { background: #d29922; }
  .ind-err { background: #f85149; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 500; }
  .badge-green { background: rgba(63, 185, 80, 0.15); color: #3fb950; }
  .badge-amber { background: rgba(210, 153, 34, 0.15); color: #d29922; }
  .badge-gray { background: rgba(139, 148, 158, 0.15); color: #8b949e; }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  button { padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-family: inherit; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .model-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .model-card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px; padding: 12px;
  }
  .model-card-title { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .model-item { font-family: var(--vscode-editor-font-family); font-size: 11px; padding: 3px 0; color: #58a6ff; }
  .footer { margin-top: 24px; font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; gap: 16px; }
  .footer a { color: #58a6ff; text-decoration: none; }
  .footer a:hover { text-decoration: underline; }
  .empty-state { text-align: center; padding: 40px 20px; color: var(--vscode-descriptionForeground); }
  .empty-state p { margin-bottom: 16px; }
</style>
</head>
<body>
<h1>Conduit Bridge <span class="status-badge ${isOnline ? 'status-online' : 'status-offline'}">${isOnline ? 'Online' : 'Offline'}</span></h1>
<div class="subtitle">Health Dashboard - auto-refreshes every 15s</div>

${isOnline ? `
<div class="section">
  <div class="info-grid">
    <div class="info-card">
      <div class="info-label">Version</div>
      <div class="info-value">${version}</div>
    </div>
    <div class="info-card">
      <div class="info-label">Port</div>
      <div class="info-value">${port}</div>
    </div>
    <div class="info-card">
      <div class="info-label">Uptime</div>
      <div class="info-value">${uptime}</div>
    </div>
    <div class="info-card">
      <div class="info-label">Models</div>
      <div class="info-value">${models.length}</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Providers</div>
  <table>
    <tr><th>Provider</th><th>Status</th><th>Models</th></tr>
    ${providerRows || '<tr><td colspan="3" style="color: var(--vscode-descriptionForeground)">No provider data</td></tr>'}
  </table>
</div>

${models.length > 0 ? `
<div class="section">
  <div class="section-title">Available Models</div>
  <div class="model-grid">${modelCards}</div>
</div>
` : ''}
` : `
<div class="empty-state">
  <p>Bridge is not running.</p>
  <p>Start the bridge to see provider status and available models.</p>
</div>
`}

<div class="btn-row">
  ${isOnline
    ? '<button class="btn-secondary" onclick="send(\'restart\')">Restart</button><button class="btn-secondary" onclick="send(\'stop\')">Stop</button>'
    : '<button class="btn-primary" onclick="send(\'start\')">Start Bridge</button>'}
  <button class="btn-secondary" onclick="send('logs')">Show Logs</button>
  <button class="btn-secondary" onclick="send('refresh')">Refresh</button>
</div>

<div class="footer">
  <span>Conduit Bridge</span>
  <a href="${proxyUrl}/health">/health</a>
  <a href="${proxyUrl}/v1/models">/v1/models</a>
  <a href="${proxyUrl}/v1/status">/v1/status</a>
</div>

<script>
const vscode = acquireVsCodeApi();
function send(type) { vscode.postMessage({ type }); }
</script>
</body>
</html>`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatUptime(s: number): string {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + 'h ' + m + 'm';
}
