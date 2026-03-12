import * as vscode from 'vscode';
import type { BridgeManager, BridgeStatus, ProviderName } from './bridge-manager';

export class BridgePanel {
  private static _instance: BridgePanel | undefined;
  private _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private _manager: BridgeManager,
  ) {
    this._panel = panel;
    this._panel.webview.options = { enableScripts: true };
    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(
      msg => this._handleMessage(msg),
      null, this._disposables,
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Push status updates to panel
    this._disposables.push(
      _manager.onStatusChange(status => {
        this._panel.webview.postMessage({ type: 'status', data: status });
      }),
    );

    // Send current status immediately
    this._refreshStatus();
  }

  static createOrShow(manager: BridgeManager) {
    const column = vscode.ViewColumn.Two;
    if (BridgePanel._instance) {
      BridgePanel._instance._panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'conduitBridge', 'Conduit — Bridge Manager',
      column, { enableScripts: true, retainContextWhenHidden: true },
    );
    BridgePanel._instance = new BridgePanel(panel, manager);
  }

  private async _handleMessage(msg: { type: string; provider?: ProviderName }) {
    switch (msg.type) {
      case 'start':   await this._manager.start(); break;
      case 'stop':    await this._manager.stop(); break;
      case 'restart': await this._manager.restart(); break;
      case 'refresh': await this._refreshStatus(); break;
      case 'logs':    this._manager.showLogs(); break;
      case 'login':   if (msg.provider) await this._manager.login(msg.provider); break;
      case 'logout':  if (msg.provider) await this._manager.logout(msg.provider); break;
    }
  }

  private async _refreshStatus() {
    const status = await this._manager.getStatus();
    this._panel.webview.postMessage({ type: 'status', data: status });
  }

  dispose() {
    BridgePanel._instance = undefined;
    this._panel.dispose();
    this._disposables.forEach(d => d.dispose());
  }

  private _getHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conduit Bridge Manager</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
  h1 { font-size: 16px; font-weight: 600; margin-bottom: 20px; color: var(--vscode-foreground); display: flex; align-items: center; gap: 8px; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
  .badge-online { background: #1a7a3a; color: #fff; }
  .badge-offline { background: #7a1a1a; color: #fff; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
  button { padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-family: inherit; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-danger { background: #7a1a1a; color: #fff; }
  .btn-danger:hover { background: #9a2020; }
  .provider-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .provider-card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; }
  .provider-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .provider-name { font-weight: 600; font-size: 13px; }
  .provider-status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .provider-actions { display: flex; gap: 6px; }
  .provider-actions button { padding: 4px 10px; font-size: 11px; }
  .indicator { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .indicator-ok { background: #3fb950; }
  .indicator-warn { background: #d29922; }
  .indicator-err { background: #f85149; }
  .models-list { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
  .uptime { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
  #loading { color: var(--vscode-descriptionForeground); font-size: 12px; }
</style>
</head>
<body>
<h1>⚡ Conduit Bridge <span class="badge badge-offline" id="bridge-badge">Offline</span></h1>

<div class="section">
  <div class="section-title">Bridge Process</div>
  <div class="btn-row">
    <button class="btn-primary" onclick="send('start')">▶ Start</button>
    <button class="btn-secondary" onclick="send('restart')">↺ Restart</button>
    <button class="btn-danger" onclick="send('stop')">■ Stop</button>
    <button class="btn-secondary" onclick="send('logs')">📋 Show Logs</button>
    <button class="btn-secondary" onclick="send('refresh')">↻ Refresh</button>
  </div>
  <div class="uptime" id="uptime"></div>
</div>

<div class="section">
  <div class="section-title">Providers</div>
  <div id="loading">Loading…</div>
  <div class="provider-grid" id="providers" style="display:none;"></div>
</div>

<script>
const vscode = acquireVsCodeApi();

function send(type, extra) {
  vscode.postMessage({ type, ...extra });
}

window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type === 'status') renderStatus(msg.data);
});

function renderStatus(status) {
  const badge = document.getElementById('bridge-badge');
  const loading = document.getElementById('loading');
  const provGrid = document.getElementById('providers');
  const uptime = document.getElementById('uptime');

  if (!status) {
    badge.textContent = 'Offline';
    badge.className = 'badge badge-offline';
    loading.textContent = 'Bridge is not running.';
    loading.style.display = 'block';
    provGrid.style.display = 'none';
    uptime.textContent = '';
    return;
  }

  badge.textContent = 'Online v' + status.version;
  badge.className = 'badge badge-online';
  uptime.textContent = 'Uptime: ' + formatUptime(status.uptime) + ' · Port: ' + status.port;
  loading.style.display = 'none';
  provGrid.style.display = 'grid';

  provGrid.innerHTML = status.providers.map(p => {
    const ind = p.sessionValid ? 'indicator-ok' : (p.hasProfile ? 'indicator-warn' : 'indicator-err');
    const statusText = p.sessionValid ? 'Connected' : (p.hasProfile ? 'Profile saved, not connected' : 'No profile');
    return \`<div class="provider-card">
      <div class="provider-header">
        <span class="provider-name"><span class="indicator \${ind}"></span>\${capitalize(p.name)}</span>
      </div>
      <div class="provider-status">\${statusText}</div>
      <div class="provider-actions">
        \${!p.sessionValid ? \`<button class="btn-primary" onclick="send('login', {provider:'\${p.name}'})">Login</button>\` : ''}
        \${p.sessionValid ? \`<button class="btn-secondary" onclick="send('logout', {provider:'\${p.name}'})">Logout</button>\` : ''}
      </div>
      <div class="models-list">\${p.models.slice(0,3).join(' · ')}\${p.models.length > 3 ? ' …' : ''}</div>
    </div>\`;
  }).join('');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}
</script>
</body>
</html>`;
  }
}
