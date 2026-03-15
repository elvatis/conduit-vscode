import * as vscode from 'vscode';

export interface LocalEndpoint {
  name: string;
  url: string;
  apiKey?: string;
}

export interface ConduitConfig {
  proxyUrl: string;
  apiKey: string;
  defaultModel: string;
  inlineSuggestions: boolean;
  inlineTriggerDelay: number;
  contextLines: number;
  includeOpenFiles: boolean;
  maxOpenFilesContext: number;
  terminalIntegration: boolean;
  autoStatusBar: boolean;
  agentMaxIterations: number;
  agentAutoApprove: boolean;
  localEndpoints: LocalEndpoint[];
}

export function getConfig(): ConduitConfig {
  const cfg = vscode.workspace.getConfiguration('conduit');
  return {
    proxyUrl:             cfg.get<string>('proxyUrl', 'http://127.0.0.1:31338'),
    apiKey:               cfg.get<string>('apiKey', 'cli-bridge'),
    defaultModel:         cfg.get<string>('defaultModel', 'cli-gemini/gemini-2.5-pro'),
    inlineSuggestions:    cfg.get<boolean>('inlineSuggestions', true),
    inlineTriggerDelay:   cfg.get<number>('inlineTriggerDelay', 600),
    contextLines:         cfg.get<number>('contextLines', 80),
    includeOpenFiles:     cfg.get<boolean>('includeOpenFiles', true),
    maxOpenFilesContext:  cfg.get<number>('maxOpenFilesContext', 3),
    terminalIntegration:  cfg.get<boolean>('terminalIntegration', true),
    autoStatusBar:        cfg.get<boolean>('autoStatusBar', true),
    agentMaxIterations:   cfg.get<number>('agentMaxIterations', 25),
    agentAutoApprove:     cfg.get<boolean>('agentAutoApprove', false),
    localEndpoints:       cfg.get<LocalEndpoint[]>('localEndpoints', []),
  };
}

export function onConfigChange(cb: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('conduit')) cb();
  });
}
