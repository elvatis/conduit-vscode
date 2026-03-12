import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { getConfig } from './config';

export type ProviderName = 'grok' | 'claude' | 'gemini' | 'chatgpt';

export interface ProviderStatus {
  name: ProviderName;
  connected: boolean;
  hasProfile: boolean;
  sessionValid: boolean;
  models: string[];
}

export interface BridgeStatus {
  running: boolean;
  port: number;
  version: string;
  providers: ProviderStatus[];
  uptime: number;
}

export class BridgeManager {
  private _process: cp.ChildProcess | null = null;
  private _outputChannel: vscode.OutputChannel;
  private _statusBar: vscode.StatusBarItem;
  private _healthTimer: NodeJS.Timeout | null = null;
  private _onStatusChange = new vscode.EventEmitter<BridgeStatus | null>();
  private _lastStatus: BridgeStatus | null = null;

  readonly onStatusChange = this._onStatusChange.event;

  constructor() {
    this._outputChannel = vscode.window.createOutputChannel('Conduit Bridge', 'log');
    this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this._statusBar.command = 'conduit.showBridgePanel';
    this._updateStatusBar(null);
    this._statusBar.show();
    this._startHealthPoll();
  }

  // ── Process management ────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (await this._isRunning()) {
      this._log('Bridge already running — reusing existing instance');
      await this._refreshStatus();
      return;
    }

    const bridgePath = this._findBridgeCli();
    if (!bridgePath) {
      const action = await vscode.window.showErrorMessage(
        'conduit-bridge is not installed. Install it to use web AI providers.',
        'Install',
        'Dismiss',
      );
      if (action === 'Install') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/elvatis/conduit-bridge'));
      }
      return;
    }

    const cfg = getConfig();
    const port = this._extractPort(cfg.proxyUrl);
    this._log(`Starting conduit-bridge on port ${port}…`);

    this._process = cp.spawn('node', [bridgePath, 'start', `--port=${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this._process.stdout?.on('data', (data: Buffer) => {
      this._log(data.toString().trimEnd());
    });

    this._process.stderr?.on('data', (data: Buffer) => {
      this._log(data.toString().trimEnd());
    });

    this._process.on('exit', (code) => {
      this._log(`Bridge process exited with code ${code}`);
      this._process = null;
      this._updateStatusBar(null);
      this._onStatusChange.fire(null);
    });

    // Wait up to 8s for bridge to come up
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this._isRunning()) {
        this._log('Bridge started ✅');
        await this._refreshStatus();
        return;
      }
    }

    vscode.window.showWarningMessage('conduit-bridge started but health check timed out.');
  }

  async stop(): Promise<void> {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
      this._log('Bridge stopped');
    }
    this._updateStatusBar(null);
    this._onStatusChange.fire(null);
  }

  async restart(): Promise<void> {
    this._log('Restarting bridge…');
    await this.stop();
    await new Promise(r => setTimeout(r, 1000));
    await this.start();
  }

  get isRunning(): boolean {
    return this._process !== null;
  }

  get lastStatus(): BridgeStatus | null {
    return this._lastStatus;
  }

  showLogs() {
    this._outputChannel.show();
  }

  // ── Login / Logout ────────────────────────────────────────────────────────

  async login(provider: ProviderName): Promise<void> {
    const cfg = getConfig();
    this._log(`Requesting ${provider} login…`);

    try {
      await this._apiPost(`${cfg.proxyUrl}/v1/login/${provider}`, {});
      vscode.window.showInformationMessage(
        `Conduit: ${provider} browser opened — log in and close when done. Sessions are saved for next time.`,
      );
      // Refresh status after 10s
      setTimeout(() => this._refreshStatus(), 10000);
    } catch (err) {
      vscode.window.showErrorMessage(`Conduit: failed to start ${provider} login — is the bridge running?`);
    }
  }

  async logout(provider: ProviderName): Promise<void> {
    const cfg = getConfig();
    try {
      await this._apiPost(`${cfg.proxyUrl}/v1/logout/${provider}`, {});
      this._log(`${provider} logged out`);
      await this._refreshStatus();
    } catch (err) {
      this._log(`logout error: ${(err as Error).message}`);
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async getStatus(): Promise<BridgeStatus | null> {
    const cfg = getConfig();
    try {
      const text = await this._apiGet(`${cfg.proxyUrl}/v1/status`);
      const status = JSON.parse(text) as BridgeStatus;
      this._lastStatus = status;
      this._updateStatusBar(status);
      this._onStatusChange.fire(status);
      return status;
    } catch {
      this._updateStatusBar(null);
      this._onStatusChange.fire(null);
      return null;
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _refreshStatus() {
    await this.getStatus();
  }

  private _startHealthPoll() {
    this._healthTimer = setInterval(() => this._refreshStatus(), 15000);
  }

  private async _isRunning(): Promise<boolean> {
    const cfg = getConfig();
    try {
      const text = await this._apiGet(`${cfg.proxyUrl}/health`);
      const json = JSON.parse(text);
      return json.status === 'ok';
    } catch {
      return false;
    }
  }

  private _findBridgeCli(): string | null {
    // Look for conduit-bridge CLI in common locations
    const candidates = [
      // Installed globally via npm
      '/usr/local/bin/conduit-bridge',
      `${process.env.HOME}/.npm-global/bin/conduit-bridge`,
      // npx-resolved (node_modules/.bin)
      path.join(__dirname, '..', 'node_modules', '.bin', 'conduit-bridge'),
      path.join(__dirname, '..', '..', 'conduit-bridge', 'dist', 'cli.js'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    // Try which/where
    try {
      const result = cp.execSync('which conduit-bridge 2>/dev/null || where conduit-bridge 2>/dev/null', {
        encoding: 'utf-8', timeout: 3000,
      }).trim().split('\n')[0];
      if (result && fs.existsSync(result)) return result;
    } catch { /* not found */ }

    return null;
  }

  private _extractPort(proxyUrl: string): number {
    try {
      return parseInt(new URL(proxyUrl).port) || 31338;
    } catch {
      return 31338;
    }
  }

  private _log(msg: string) {
    const ts = new Date().toISOString().slice(11, 19);
    this._outputChannel.appendLine(`[${ts}] ${msg}`);
  }

  private _updateStatusBar(status: BridgeStatus | null) {
    if (!status) {
      this._statusBar.text = '$(circuit-board) Conduit ✗';
      this._statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this._statusBar.tooltip = 'Conduit: bridge offline — click to manage';
      return;
    }
    const connected = status.providers.filter(p => p.sessionValid).length;
    const total = status.providers.length;
    this._statusBar.text = `$(circuit-board) Conduit ${connected}/${total}`;
    this._statusBar.backgroundColor = connected > 0
      ? undefined
      : new vscode.ThemeColor('statusBarItem.warningBackground');
    this._statusBar.tooltip = `Conduit v${status.version} — ${connected}/${total} providers active — click to manage`;
  }

  private _apiGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(url, { timeout: 5000 }, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve(data));
      }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
  }

  private _apiPost(url: string, body: object): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const parsed = new URL(url);
      const req = http.request({
        hostname: parsed.hostname, port: parsed.port,
        path: parsed.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 5000,
      }, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  dispose() {
    if (this._healthTimer) clearInterval(this._healthTimer);
    this._process?.kill();
    this._outputChannel.dispose();
    this._statusBar.dispose();
    this._onStatusChange.dispose();
  }
}
