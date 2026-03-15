import * as vscode from 'vscode';
import { buildEditorContext, buildSystemPrompt } from './context-builder';
import { stream, listModels } from './proxy-client';
import { getConfig } from './config';
import { BridgeManager } from './bridge-manager';
import { parseMentions } from './mention-parser';
import { loadCustomInstructions } from './custom-instructions';
import {
  getModelRegistry, getModelCapabilities,
  autoSelectModel, estimateComplexity, trimHistoryForModel,
  supportsMode, getModeRecommendation,
  ModelCapabilities, ChatMode as RegistryChatMode,
} from './model-registry';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  model?: string;      // which model generated this response
  timestamp?: number;
  tokenEstimate?: number;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
}

type ChatMode = 'ask' | 'edit' | 'agent' | 'plan';

const MAX_SESSIONS = 50;

const MODE_SYSTEM_PROMPTS: Record<ChatMode, string> = {
  ask: 'You are Conduit, an expert AI coding assistant integrated into VS Code. Answer questions clearly and concisely. Provide code examples when helpful.',
  edit: 'You are Conduit, an expert AI coding assistant integrated into VS Code. The user wants you to edit code. Return ONLY the modified code in a fenced code block. Preserve the original style and formatting.',
  agent: 'You are Conduit, an autonomous AI coding agent integrated into VS Code. Break down the task into steps, reason through each step, and provide complete implementations. Be thorough and proactive - anticipate follow-up needs. When proposing changes, show complete file contents.',
  plan: 'You are Conduit, a planning assistant integrated into VS Code. Create a detailed implementation plan with numbered steps. For each step, describe: 1) What changes are needed, 2) Which files are affected, 3) Any risks or considerations. Do NOT write code yet - just plan. Format as a clear markdown checklist.',
};

// ── Slash command definitions ────────────────────────────────────────────────

interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string, provider: ConduitChatViewProvider) => Promise<string | null>;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'help',
    description: 'Show available commands and features',
    handler: async () => {
      return `**Conduit - Available Commands**

| Command | Description |
|---------|-------------|
| \`/help\` | Show this help message |
| \`/fix\` | Fix errors in the current file |
| \`/explain\` | Explain selected code |
| \`/tests\` | Generate tests for selected code |
| \`/refactor [instruction]\` | Refactor selected code |
| \`/plan [task]\` | Create an implementation plan |
| \`/commit\` | Generate a commit message |
| \`/clear\` | Clear current chat |
| \`/new\` | Start a new chat session |
| \`/cost\` | Show estimated token usage |
| \`/model [name]\` | Switch model |
| \`/mode [ask|edit|agent|plan]\` | Switch chat mode |

**Context mentions:** Use \`#file:path\`, \`#selection\`, \`#problems\`, \`#codebase\` to attach context.

**Keyboard shortcuts:**
- \`Ctrl+Shift+I\` - Inline Chat (edit code in-place)
- \`Ctrl+Shift+G\` - Open Chat panel
- \`Ctrl+Shift+E\` - Explain selection
- \`Enter\` - Send message
- \`Shift+Enter\` - New line`;
    },
  },
  {
    name: 'fix',
    description: 'Fix errors in the current file',
    handler: async (_args, provider) => {
      const ctx = buildEditorContext();
      if (!ctx?.diagnostics) return '[No errors or warnings found in the current file.]';
      provider.setModeInternal('edit');
      return `Fix these errors in ${ctx.fileName}:\n\n${ctx.diagnostics}\n\nFile content:\n\`\`\`${ctx.language}\n${ctx.fullFile}\n\`\`\``;
    },
  },
  {
    name: 'explain',
    description: 'Explain selected code',
    handler: async () => {
      const ctx = buildEditorContext();
      if (!ctx?.selection) return '[Select some code first.]';
      return `Explain this ${ctx.language} code:\n\n\`\`\`${ctx.language}\n${ctx.selection}\n\`\`\``;
    },
  },
  {
    name: 'tests',
    description: 'Generate tests for selected code',
    handler: async () => {
      const ctx = buildEditorContext();
      if (!ctx?.selection) return '[Select some code first.]';
      return `Write comprehensive unit tests for this ${ctx.language} code:\n\n\`\`\`${ctx.language}\n${ctx.selection}\n\`\`\``;
    },
  },
  {
    name: 'refactor',
    description: 'Refactor selected code',
    handler: async (args) => {
      const ctx = buildEditorContext();
      if (!ctx?.selection) return '[Select some code first.]';
      const instruction = args || 'improve readability and maintainability';
      return `Refactor this ${ctx.language} code - ${instruction}:\n\n\`\`\`${ctx.language}\n${ctx.selection}\n\`\`\``;
    },
  },
  {
    name: 'plan',
    description: 'Create an implementation plan',
    handler: async (args, provider) => {
      if (!args) return '[Provide a task description: /plan <what to implement>]';
      provider.setModeInternal('plan');
      return args;
    },
  },
  {
    name: 'commit',
    description: 'Generate commit message (use SCM panel)',
    handler: async () => {
      vscode.commands.executeCommand('conduit.generateCommitMessage');
      return null; // handled externally
    },
  },
  {
    name: 'clear',
    description: 'Clear current chat',
    handler: async (_args, provider) => {
      provider.clearChat();
      return null;
    },
  },
  {
    name: 'new',
    description: 'Start new chat session',
    handler: async (_args, provider) => {
      provider.newChat();
      return null;
    },
  },
  {
    name: 'cost',
    description: 'Show estimated token usage',
    handler: async (_args, provider) => {
      const stats = provider.getSessionStats();
      return `**Session Token Estimate**\n\n- Messages: ${stats.messageCount}\n- Input tokens: ~${stats.inputTokens.toLocaleString()}\n- Output tokens: ~${stats.outputTokens.toLocaleString()}\n- Total: ~${stats.totalTokens.toLocaleString()}\n- Model: ${stats.model}`;
    },
  },
  {
    name: 'model',
    description: 'Switch model',
    handler: async (args, provider) => {
      if (!args) {
        const models = await getModelRegistry();
        const list = models.map(m => `- \`${m.id}\``).join('\n');
        return `**Available models:**\n${list}\n\nUsage: \`/model <model-id>\``;
      }
      provider.switchModelInternal(args.trim());
      return null;
    },
  },
  {
    name: 'mode',
    description: 'Switch chat mode',
    handler: async (args, provider) => {
      const mode = args.trim() as ChatMode;
      if (['ask', 'edit', 'agent', 'plan'].includes(mode)) {
        provider.setModeInternal(mode);
        return null;
      }
      return '[Valid modes: ask, edit, agent, plan]';
    },
  },
];

// ── Provider ─────────────────────────────────────────────────────────────────

export class ConduitChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'conduit.chatView';

  private _view?: vscode.WebviewView;
  private _messages: ChatMessage[] = [];
  private _model: string;
  private _mode: ChatMode = 'ask';
  private _bridgeManager: BridgeManager;
  private _context: vscode.ExtensionContext;
  private _session: ChatSession;
  private _models: ModelCapabilities[] = [];
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _autoModel = false;

  constructor(
    context: vscode.ExtensionContext,
    bridgeManager: BridgeManager,
  ) {
    this._context = context;
    this._model = getConfig().defaultModel;
    this._bridgeManager = bridgeManager;
    this._session = this._createSession();

    bridgeManager.onStatusChange(() => {
      if (this._view) this._sendModelList();
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };
    webviewView.webview.html = this._getHtml();
    webviewView.webview.onDidReceiveMessage(msg => this._handleMessage(msg));
  }

  // ── Public methods (called from extension.ts and slash commands) ──────────

  refreshModels(): void { this._sendModelList(); }

  setModeInternal(mode: ChatMode): void {
    this._mode = mode;
    this._post({ type: 'modeChanged', mode });

    // Check if current model supports this mode and warn if not
    if (!this._autoModel && this._model) {
      const rec = getModeRecommendation(this._models, this._model, mode as RegistryChatMode);
      if (!rec.compatible) {
        this._post({ type: 'modeWarning', mode, reason: rec.reason, suggestion: rec.suggestion });
      }
    }
  }

  switchModelInternal(modelId: string): void {
    this._model = modelId;
    this._autoModel = false;
    this._post({ type: 'modelChanged', model: modelId });
    vscode.workspace.getConfiguration('conduit').update(
      'defaultModel', modelId, vscode.ConfigurationTarget.Global,
    );

    // Check if new model supports current mode
    const rec = getModeRecommendation(this._models, modelId, this._mode as RegistryChatMode);
    if (!rec.compatible) {
      this._post({ type: 'modeWarning', mode: this._mode, reason: rec.reason, suggestion: rec.suggestion });
    }
  }

  clearChat(): void {
    this._messages = [];
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._post({ type: 'cleared' });
  }

  newChat(): void {
    this._saveCurrentSession();
    this._session = this._createSession();
    this._messages = [];
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._post({ type: 'cleared' });
    this._post({ type: 'sessionInfo', id: this._session.id, title: this._session.title });
    this._sessionChangeEmitter.fire(this._session.id);
  }

  getSessionStats() {
    return {
      messageCount: this._messages.length,
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      totalTokens: this._inputTokens + this._outputTokens,
      model: this._model,
    };
  }

  // ── Session management (called from extension.ts for tree view) ──────────

  private _sessionChangeEmitter = new vscode.EventEmitter<string | null>();
  onSessionChange = this._sessionChangeEmitter.event;

  loadSessionExternal(sessionId: string): void {
    if (this._loadSession(sessionId)) {
      this._post({
        type: 'sessionLoaded',
        messages: this._session.messages,
        model: this._model,
        mode: this._mode,
      });
      this._post({ type: 'sessionInfo', id: this._session.id, title: this._session.title });
      this._sessionChangeEmitter.fire(this._session.id);
    }
  }

  deleteSessionExternal(sessionId: string): void {
    this._deleteSession(sessionId);
    this._sessionChangeEmitter.fire(this._session.id);
  }

  // ── Session persistence ──────────────────────────────────────────────────

  private _createSession(): ChatSession {
    return {
      id: `chat-${Date.now()}`,
      title: 'New Chat',
      messages: [],
      model: this._model,
      mode: this._mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private _getSessions(): ChatSession[] {
    return this._context.globalState.get<ChatSession[]>('conduit.chatSessions', []);
  }

  private _saveCurrentSession(): void {
    if (this._session.messages.length === 0) return;
    this._session.updatedAt = Date.now();
    this._session.model = this._model;
    this._session.mode = this._mode;

    if (this._session.title === 'New Chat') {
      const firstMsg = this._session.messages.find(m => m.role === 'user');
      if (firstMsg) {
        this._session.title = firstMsg.content.slice(0, 60) + (firstMsg.content.length > 60 ? '...' : '');
      }
    }

    const sessions = this._getSessions();
    const idx = sessions.findIndex(s => s.id === this._session.id);
    if (idx >= 0) sessions[idx] = this._session;
    else sessions.unshift(this._session);
    this._context.globalState.update('conduit.chatSessions', sessions.slice(0, MAX_SESSIONS));
    this._sessionChangeEmitter.fire(this._session.id);
  }

  private _loadSession(id: string): boolean {
    const session = this._getSessions().find(s => s.id === id);
    if (!session) return false;
    this._session = session;
    this._model = session.model;
    this._mode = (session.mode as ChatMode) || 'ask';
    this._messages = [...session.messages];
    return true;
  }

  private _deleteSession(id: string): void {
    const sessions = this._getSessions().filter(s => s.id !== id);
    this._context.globalState.update('conduit.chatSessions', sessions);
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private async _handleMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'send':
        await this._handleUserInput(msg.text as string ?? '');
        break;
      case 'switchModel':
        if (msg.model) {
          if (msg.model === 'auto') {
            this._autoModel = true;
            this._post({ type: 'modelChanged', model: 'auto' });
          } else {
            this.switchModelInternal(msg.model as string);
          }
        }
        break;
      case 'showModelPicker':
        this._showModelQuickPick();
        break;
      case 'showModePicker':
        this._showModeQuickPick();
        break;
      case 'switchMode':
        if (msg.mode) this.setModeInternal(msg.mode as ChatMode);
        break;
      case 'getModels':
        this._sendModelList();
        break;
      case 'newChat':
        this.newChat();
        break;
      case 'getContext':
        this._sendContext();
        break;
      case 'getSessions':
        this._sendSessionList();
        break;
      case 'loadSession':
        if (msg.sessionId && this._loadSession(msg.sessionId as string)) {
          this._post({
            type: 'sessionLoaded',
            messages: this._session.messages,
            model: this._model,
            mode: this._mode,
          });
          this._post({ type: 'sessionInfo', id: this._session.id, title: this._session.title });
        }
        break;
      case 'deleteSession':
        if (msg.sessionId) {
          this._deleteSession(msg.sessionId as string);
          this._sendSessionList();
        }
        break;
      case 'attachSelection': {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
          const sel = editor.document.getText(editor.selection);
          const lang = editor.document.languageId;
          const fname = editor.document.fileName.split(/[\\/]/).pop();
          this._post({ type: 'selectionAttached', text: sel, language: lang, fileName: fname });
        } else {
          vscode.window.showInformationMessage('Conduit: select some code first.');
        }
        break;
      }
      case 'attachFile': {
        const uris = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Attach' });
        if (uris && uris.length > 0) {
          const doc = await vscode.workspace.openTextDocument(uris[0]);
          this._post({
            type: 'fileAttached',
            text: doc.getText(),
            language: doc.languageId,
            fileName: uris[0].fsPath.split(/[\\/]/).pop(),
          });
        }
        break;
      }
      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'conduit');
        break;
    }
  }

  private async _handleUserInput(text: string) {
    if (!text.trim()) return;

    // ── Slash commands ─────────────────────────────────────────────────────
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const cmdName = (spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1)).toLowerCase();
      const cmdArgs = spaceIdx > 0 ? text.slice(spaceIdx + 1) : '';

      const cmd = SLASH_COMMANDS.find(c => c.name === cmdName);
      if (cmd) {
        const result = await cmd.handler(cmdArgs, this);
        if (result === null) return; // command handled internally
        // Some commands return a prompt to send to the model
        if (result.startsWith('[')) {
          // Info message, show directly
          this._post({ type: 'userMessage', text });
          this._post({ type: 'assistantStart' });
          this._post({ type: 'assistantChunk', delta: result });
          this._post({ type: 'assistantDone' });
          return;
        }
        if (result.startsWith('**')) {
          // Help/info - show directly without sending to model
          this._post({ type: 'userMessage', text });
          this._post({ type: 'assistantStart' });
          this._post({ type: 'assistantChunk', delta: result });
          this._post({ type: 'assistantDone' });
          this._messages.push({ role: 'user', content: text });
          this._messages.push({ role: 'assistant', content: result });
          this._session.messages = [...this._messages];
          return;
        }
        // Send the resolved prompt to the model
        text = result;
      }
    }

    // ── Parse #-mentions ───────────────────────────────────────────────────
    const { cleanText, mentions } = await parseMentions(text);
    let finalText = cleanText;
    if (mentions.length > 0) {
      const mentionContext = mentions.map(m => m.content).join('\n\n');
      finalText = `${cleanText}\n\n${mentionContext}`;
    }

    await this._sendToModel(text, finalText);
  }

  private async _sendToModel(displayText: string, fullText: string) {
    // ── Auto model selection ───────────────────────────────────────────────
    let modelToUse = this._model;
    if (this._autoModel) {
      const registry = await getModelRegistry();
      const complexity = estimateComplexity(fullText);
      modelToUse = autoSelectModel(registry, complexity, this._mode as RegistryChatMode) ?? this._model;
      this._post({ type: 'autoModelSelected', model: modelToUse, complexity });
    }

    // ── Build system prompt ────────────────────────────────────────────────
    const ctx = buildEditorContext();
    const modePrompt = MODE_SYSTEM_PROMPTS[this._mode];
    const customInstructions = loadCustomInstructions();
    const parts = [modePrompt];
    if (customInstructions) parts.push(`\n--- Custom Instructions ---\n${customInstructions}`);
    if (ctx) parts.push('\n' + buildSystemPrompt(ctx));
    const systemPrompt = parts.join('\n');

    // ── Push user message ──────────────────────────────────────────────────
    const userMsg: ChatMessage = {
      role: 'user',
      content: fullText,
      timestamp: Date.now(),
      tokenEstimate: Math.ceil(fullText.length / 4),
    };
    this._messages.push(userMsg);
    this._session.messages = [...this._messages];
    this._post({ type: 'userMessage', text: displayText });
    this._post({ type: 'assistantStart', model: modelToUse });

    // ── Trim history for model context window ──────────────────────────────
    const allMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...this._messages.map(m => ({ role: m.role, content: m.content })),
    ];
    const trimmed = trimHistoryForModel(allMessages, modelToUse);

    // Track input tokens
    const inputChars = trimmed.reduce((a, m) => a + m.content.length, 0);
    this._inputTokens += Math.ceil(inputChars / 4);

    // ── Stream response ────────────────────────────────────────────────────
    let fullResponse = '';
    try {
      for await (const chunk of stream({ messages: trimmed as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, model: modelToUse })) {
        if (chunk.done) break;
        fullResponse += chunk.delta;
        this._post({ type: 'assistantChunk', delta: chunk.delta });
      }
    } catch (err) {
      const errMsg = `Error: ${(err as Error).message}`;
      this._post({ type: 'assistantChunk', delta: errMsg });
      fullResponse = errMsg;
    }

    if (!fullResponse.trim()) {
      const noResp = `No response received from model \`${modelToUse}\`. The bridge may not support this model, or it returned an empty reply.`;
      this._post({ type: 'assistantChunk', delta: noResp });
      fullResponse = noResp;
    }

    // Track output tokens
    this._outputTokens += Math.ceil(fullResponse.length / 4);

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: fullResponse,
      model: modelToUse,
      timestamp: Date.now(),
      tokenEstimate: Math.ceil(fullResponse.length / 4),
    };
    this._messages.push(assistantMsg);
    this._session.messages = [...this._messages];
    this._post({ type: 'assistantDone', model: modelToUse });
    this._saveCurrentSession();
  }

  // ── Data senders ──────────────────────────────────────────────────────────

  private async _sendModelList() {
    try {
      this._models = await getModelRegistry();
    } catch {
      this._models = [];
    }
    const grouped: Record<string, Array<{ id: string; name: string; ctx: string }>> = {};
    for (const m of this._models) {
      const group = m.provider;
      const ctxLabel = m.contextWindow >= 1_000_000
        ? `${(m.contextWindow / 1_000_000).toFixed(0)}M`
        : `${(m.contextWindow / 1_000).toFixed(0)}K`;
      (grouped[group] ??= []).push({ id: m.id, name: m.name, ctx: ctxLabel });
    }
    this._post({ type: 'models', grouped, current: this._autoModel ? 'auto' : this._model });
  }

  private async _showModelQuickPick() {
    try {
      this._models = await getModelRegistry();
    } catch {
      this._models = [];
    }

    const items: vscode.QuickPickItem[] = [];

    // Auto option
    items.push({
      label: '$(sparkle) Auto',
      description: 'best for task',
      detail: this._autoModel ? '$(check) Currently selected' : undefined,
    });

    // Group by provider
    const grouped: Record<string, ModelCapabilities[]> = {};
    for (const m of this._models) {
      (grouped[m.provider] ??= []).push(m);
    }

    for (const [provider, models] of Object.entries(grouped)) {
      items.push({ label: provider.toUpperCase(), kind: vscode.QuickPickItemKind.Separator });
      for (const m of models) {
        const ctxLabel = m.contextWindow >= 1_000_000
          ? `${(m.contextWindow / 1_000_000).toFixed(0)}M context`
          : `${(m.contextWindow / 1_000).toFixed(0)}K context`;
        const isCurrent = !this._autoModel && m.id === this._model;
        const modeIcons = m.supportedModes.map(mode => {
          const labels: Record<string, string> = { ask: 'Ask', edit: 'Edit', agent: 'Agent', plan: 'Plan' };
          return labels[mode] || mode;
        }).join(', ');
        const tierLabel = m.tier === 1 ? '$(star-full) ' : m.tier === 2 ? '$(star-half) ' : '';
        items.push({
          label: `${isCurrent ? '$(check) ' : '     '}${tierLabel}${m.name}`,
          description: `${ctxLabel} - ${modeIcons}`,
          detail: isCurrent ? 'Currently selected' : undefined,
        });
      }
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a model',
      matchOnDescription: true,
    });

    if (!picked || picked.kind === vscode.QuickPickItemKind.Separator) return;

    if (picked.label.includes('Auto')) {
      this._autoModel = true;
      this._post({ type: 'modelChanged', model: 'auto' });
      return;
    }

    // Find the model by name
    const cleanLabel = picked.label.replace(/^\$\(check\)\s*/, '').trim();
    const model = this._models.find(m => m.name === cleanLabel);
    if (model) {
      this.switchModelInternal(model.id);
    }
  }

  private async _showModeQuickPick() {
    const modes: Array<{ mode: ChatMode; label: string; desc: string }> = [
      { mode: 'ask', label: 'Ask', desc: 'Answer questions about code' },
      { mode: 'edit', label: 'Edit', desc: 'Modify and refactor code' },
      { mode: 'agent', label: 'Agent', desc: 'Plan and build features' },
      { mode: 'plan', label: 'Plan', desc: 'Create implementation plans' },
    ];

    const items = modes.map(m => ({
      label: `${m.mode === this._mode ? '$(check) ' : '     '}${m.label}`,
      description: m.desc,
      mode: m.mode,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select chat mode',
    });

    if (picked) {
      this.setModeInternal((picked as typeof items[number]).mode);
    }
  }

  private _sendContext() {
    const ctx = buildEditorContext();
    if (ctx) {
      this._post({
        type: 'context',
        fileName: ctx.fileName,
        language: ctx.language,
        hasSelection: !!ctx.selection,
        diagnostics: ctx.diagnostics,
      });
    }
  }

  private _sendSessionList() {
    const sessions = this._getSessions().map(s => ({
      id: s.id,
      title: s.title,
      model: s.model,
      mode: s.mode || 'ask',
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
    }));
    this._post({ type: 'sessions', list: sessions, currentId: this._session.id });
  }

  private _post(msg: object) {
    this._view?.webview.postMessage(msg);
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _getHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conduit Chat</title>
<style>
:root { --radius: 4px; --gap: 6px; --pad: 8px; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
  color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
  display: flex; flex-direction: column; height: 100vh; overflow: hidden;
}

/* Messages */
#messages { flex:1; overflow-y:auto; padding:var(--pad); display:flex; flex-direction:column; gap:10px; }
#empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--vscode-descriptionForeground); font-size:12px; text-align:center; padding:20px; gap:8px; }
#empty-state .hint { font-size:11px; opacity:0.7; }
#empty-state .shortcuts { text-align:left; font-size:11px; margin-top:8px; line-height:1.6; }
.msg { display:flex; flex-direction:column; gap:2px; }
.msg-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--vscode-descriptionForeground); padding:0 2px; display:flex; align-items:center; gap:6px; }
.msg-label .model-tag { font-weight:400; font-size:9px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); padding:0 4px; border-radius:6px; text-transform:none; letter-spacing:0; }
.msg-user .bubble { background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); border-radius:var(--radius); padding:8px 10px; max-width:100%; white-space:pre-wrap; word-break:break-word; font-size:12px; }
.msg-assistant .bubble { padding:8px 2px; max-width:100%; white-space:pre-wrap; word-break:break-word; line-height:1.5; font-size:12px; }
.msg-assistant .bubble pre { background:var(--vscode-textBlockQuote-background); border:1px solid var(--vscode-panel-border); border-radius:var(--radius); padding:8px; overflow-x:auto; margin:6px 0; font-family:var(--vscode-editor-font-family); font-size:11px; position:relative; }
.msg-assistant .bubble code { font-family:var(--vscode-editor-font-family); background:var(--vscode-textBlockQuote-background); padding:1px 4px; border-radius:2px; font-size:11px; }
.msg-assistant .bubble table { border-collapse:collapse; margin:6px 0; font-size:11px; }
.msg-assistant .bubble th, .msg-assistant .bubble td { border:1px solid var(--vscode-panel-border); padding:4px 8px; text-align:left; }
.msg-assistant .bubble th { background:var(--vscode-textBlockQuote-background); font-weight:600; }
.msg-actions { display:flex; gap:4px; padding:2px 0; }
.msg-actions button { font-size:10px; cursor:pointer; color:var(--vscode-descriptionForeground); background:none; border:none; padding:2px 6px; border-radius:3px; }
.msg-actions button:hover { color:var(--vscode-foreground); background:var(--vscode-toolbar-hoverBackground); }

/* Attachments */
#attachments { padding:0 var(--pad); display:none; }
#attachments.has-items { display:flex; flex-wrap:wrap; gap:4px; padding-bottom:4px; }
.attach-chip { display:flex; align-items:center; gap:4px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); font-size:10px; padding:2px 6px; border-radius:10px; max-width:200px; }
.attach-chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.attach-chip button { background:none; border:none; cursor:pointer; color:inherit; font-size:12px; line-height:1; padding:0; }

/* Slash command autocomplete */
#cmd-suggest { display:none; position:absolute; bottom:100%; left:0; right:0; background:var(--vscode-menu-background); border:1px solid var(--vscode-menu-border,var(--vscode-panel-border)); border-radius:6px; padding:4px 0; box-shadow:0 4px 16px rgba(0,0,0,0.3); z-index:100; margin-bottom:2px; max-height:200px; overflow-y:auto; }
#cmd-suggest.open { display:block; }
.cmd-item { display:flex; align-items:center; gap:6px; padding:5px 10px; cursor:pointer; font-size:12px; color:var(--vscode-menu-foreground,var(--vscode-foreground)); }
.cmd-item:hover, .cmd-item.active { background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground)); }
.cmd-item .cmd-name { font-weight:600; min-width:60px; }
.cmd-item .cmd-desc { color:var(--vscode-descriptionForeground); font-size:11px; }

/* Input area */
#input-container { flex-shrink:0; border-top:1px solid var(--vscode-panel-border); background:var(--vscode-sideBar-background); position:relative; z-index:10; }
#input-box { margin:var(--pad); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); border-radius:6px; display:flex; flex-direction:column; }
#input-box:focus-within { border-color:var(--vscode-focusBorder); }
#input { border:none; outline:none; resize:none; min-height:36px; max-height:140px; background:transparent; color:var(--vscode-input-foreground); padding:8px 10px 4px; font-family:inherit; font-size:12px; line-height:1.4; width:100%; }
#input-toolbar { display:flex; align-items:center; gap:2px; padding:2px 4px 4px; }
.it-btn { background:none; border:none; cursor:pointer; color:var(--vscode-descriptionForeground); padding:3px 6px; border-radius:3px; font-size:11px; display:flex; align-items:center; gap:3px; white-space:nowrap; }
.it-btn:hover { background:var(--vscode-toolbar-hoverBackground); color:var(--vscode-foreground); }
.it-btn.active { color:var(--vscode-foreground); background:var(--vscode-toolbar-hoverBackground); }
.it-spacer { flex:1; }
#send-btn { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:4px; width:26px; height:26px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; flex-shrink:0; }
#send-btn:hover { background:var(--vscode-button-hoverBackground); }
#send-btn:disabled { opacity:0.4; cursor:default; }

/* Bottom bar */
#bottom-bar { display:flex; align-items:center; gap:6px; padding:4px var(--pad) 6px; font-size:10px; color:var(--vscode-descriptionForeground); }
#bottom-bar .ctx-label { display:flex; align-items:center; gap:3px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); padding:1px 6px; border-radius:8px; }

/* Attach dropdown (only remaining HTML dropdown) */
.dropdown-anchor { position:relative; }
.dropdown-menu { display:none; position:absolute; bottom:100%; left:0; min-width:160px; background:var(--vscode-menu-background); border:1px solid var(--vscode-menu-border,var(--vscode-panel-border)); border-radius:6px; padding:4px 0; box-shadow:0 4px 16px rgba(0,0,0,0.3); z-index:100; margin-bottom:4px; }
.dropdown-menu.open { display:block; }
.dm-item { padding:5px 10px; cursor:pointer; font-size:12px; color:var(--vscode-menu-foreground,var(--vscode-foreground)); }
.dm-item:hover { background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground)); }


.spinner { display:inline-block; width:12px; height:12px; border:2px solid var(--vscode-panel-border); border-top-color:var(--vscode-progressBar-background); border-radius:50%; animation:spin .7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }

/* Mode warning banner */
.mode-warning { display:flex; align-items:center; gap:6px; padding:6px 10px; margin:0 var(--pad); border-radius:var(--radius); background:var(--vscode-inputValidation-warningBackground,rgba(200,150,0,0.15)); border:1px solid var(--vscode-inputValidation-warningBorder,rgba(200,150,0,0.4)); font-size:11px; color:var(--vscode-foreground); }
.mode-warning .warn-text { flex:1; }
.mode-warning button { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:3px; padding:2px 8px; cursor:pointer; font-size:11px; white-space:nowrap; }
.mode-warning button:hover { background:var(--vscode-button-hoverBackground); }
.mode-warning .dismiss { background:none; color:var(--vscode-descriptionForeground); padding:2px 4px; font-size:14px; }

/* Typing indicator */
.typing-indicator { display:flex; align-items:center; gap:5px; padding:6px 2px; }
.typing-indicator span { width:7px; height:7px; border-radius:50%; background:var(--vscode-descriptionForeground); animation:typing-bounce 1.4s ease-in-out infinite; }
.typing-indicator span:nth-child(2) { animation-delay:0.2s; }
.typing-indicator span:nth-child(3) { animation-delay:0.4s; }
@keyframes typing-bounce { 0%,60%,100%{ opacity:0.3; transform:translateY(0); } 30%{ opacity:1; transform:translateY(-4px); } }
</style>
</head>
<body>

<div id="messages">
  <div id="empty-state">
    <div>Describe what to build</div>
    <div class="hint">Use the toolbar below to switch modes, pick a model, or attach code</div>
    <div class="shortcuts">
      <strong>Quick commands:</strong><br>
      /help - show all commands<br>
      /fix - fix errors in file<br>
      /explain - explain selection<br>
      /tests - generate tests<br>
      /plan - create implementation plan<br>
      /commit - generate commit message<br>
      #file:path - attach a file<br>
      #selection - attach current selection<br>
      #codebase - attach workspace overview
    </div>
  </div>
</div>

<div id="mode-warning-bar" style="display:none"></div>
<div id="attachments"></div>


<div id="input-container">
  <div id="cmd-suggest"></div>
  <div id="input-box">
    <textarea id="input" placeholder="Describe what to build" rows="1"></textarea>
    <div id="input-toolbar">
      <div class="dropdown-anchor">
        <button class="it-btn" id="attach-btn" title="Attach context">+</button>
        <div class="dropdown-menu" id="attach-menu">
          <div class="dm-item" data-action="attachSelection">Current selection</div>
          <div class="dm-item" data-action="attachFile">File from disk...</div>
        </div>
      </div>
      <button class="it-btn" id="mode-btn" title="Chat mode"><span id="mode-label">Ask</span></button>
      <button class="it-btn" id="model-btn" title="Select model"><span id="model-label">Auto</span></button>
      <span class="it-spacer"></span>
      <button class="it-btn" id="settings-btn" title="Settings">&#9881;</button>
      <button id="send-btn" title="Send (Enter)" disabled>&#8593;</button>
    </div>
  </div>
  <div id="bottom-bar"><span id="ctx-indicator"></span></div>
</div>

<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const messagesEl = $('messages');
const emptyState = $('empty-state');
const inputEl = $('input');
const sendBtn = $('send-btn');
const attachmentsEl = $('attachments');
const modelBtn = $('model-btn');
const modelLabel = $('model-label');
const modeBtn = $('mode-btn');
const modeLabel = $('mode-label');
const attachBtn = $('attach-btn');
const attachMenu = $('attach-menu');
const ctxIndicator = $('ctx-indicator');
const cmdSuggest = $('cmd-suggest');

let currentBubble = null, currentText = '', streaming = false, hasMessages = false;
let currentMode = 'ask', currentModel = '', currentSessionId = null;
let attachments = [];
let cmdSuggestIdx = -1;

const MODES = {
  ask: { label:'Ask', ph:'Ask a question...' },
  edit: { label:'Edit', ph:'Describe the edit...' },
  agent: { label:'Agent', ph:'Describe what to build' },
  plan: { label:'Plan', ph:'What should we plan?' },
};
const COMMANDS = [
  { name:'help', desc:'Show available commands' },
  { name:'fix', desc:'Fix errors in current file' },
  { name:'explain', desc:'Explain selected code' },
  { name:'tests', desc:'Generate tests for selection' },
  { name:'refactor', desc:'Refactor selected code' },
  { name:'plan', desc:'Create implementation plan' },
  { name:'commit', desc:'Generate commit message' },
  { name:'clear', desc:'Clear current chat' },
  { name:'new', desc:'Start new chat session' },
  { name:'cost', desc:'Show token usage' },
  { name:'model', desc:'Switch model' },
  { name:'mode', desc:'Switch chat mode' },
];

vscode.postMessage({ type:'getModels' });
vscode.postMessage({ type:'getContext' });
setMode('ask');
updateSendBtn();

// Message handler
window.addEventListener('message', e => {
  const m = e.data;
  switch(m.type) {
    case 'models': currentModel=m.current; if(m.grouped){for(const g of Object.values(m.grouped)){for(const x of g){modelNames[x.id]=x.name;}}} updateModelLabel(); break;
    case 'modelChanged': currentModel=m.model; updateModelLabel(); $('mode-warning-bar').style.display='none'; break;
    case 'modeChanged': setMode(m.mode); $('mode-warning-bar').style.display='none'; break;
    case 'userMessage': hideEmpty(); appendMsg('user', m.text); break;
    case 'assistantStart': streaming=true; sendBtn.disabled=true; currentText=''; currentBubble=appendMsg('assistant','',m.model); showTyping(currentBubble); break;
    case 'assistantChunk': hideTyping(currentBubble); currentText+=m.delta; if(currentBubble){currentBubble.innerHTML=renderMd(currentText); messagesEl.scrollTop=messagesEl.scrollHeight;} break;
    case 'assistantDone': streaming=false; updateSendBtn(); addActions(currentBubble,currentText,m.model); currentBubble=null; break;
    case 'cleared': messagesEl.innerHTML=''; hasMessages=false; showEmpty(); attachments=[]; renderAttach(); break;
    case 'context': if(m.fileName) ctxIndicator.innerHTML='<span class="ctx-label">'+esc(m.fileName)+(m.hasSelection?' (sel)':'')+'</span>'; break;
    case 'sessionLoaded': messagesEl.innerHTML=''; hasMessages=false; for(const x of m.messages){hideEmpty();appendMsg(x.role,x.content,x.model);} if(m.model){currentModel=m.model;updateModelLabel();} if(m.mode)setMode(m.mode); break;
    case 'sessionInfo': currentSessionId=m.id; break;
    case 'selectionAttached': case 'fileAttached': attachments.push({fileName:m.fileName,language:m.language,text:m.text}); renderAttach(); break;
    case 'autoModelSelected': ctxIndicator.innerHTML='<span class="ctx-label">Auto: '+esc(m.model.split('/').pop())+' ('+m.complexity+')</span>'; break;
    case 'modeWarning': showModeWarning(m.reason, m.suggestion); break;
  }
});

function setMode(mode) {
  currentMode=mode;
  const cfg=MODES[mode]||MODES.ask;
  modeLabel.textContent=cfg.label;
  inputEl.placeholder=cfg.ph;
}

const modelNames = {};
function updateModelLabel() {
  if(currentModel==='auto') { modelLabel.textContent='Auto'; return; }
  modelLabel.textContent = modelNames[currentModel] || (currentModel.includes('/') ? currentModel.split('/').pop() : (currentModel||'Auto'));
}

function renderAttach() {
  attachmentsEl.innerHTML='';
  if(!attachments.length){attachmentsEl.classList.remove('has-items');return;}
  attachmentsEl.classList.add('has-items');
  attachments.forEach((a,i) => {
    const c=document.createElement('div'); c.className='attach-chip';
    c.innerHTML='<span>'+esc(a.fileName||'selection')+'</span><button data-idx="'+i+'">&times;</button>';
    c.querySelector('button').addEventListener('click',()=>{attachments.splice(i,1);renderAttach();});
    attachmentsEl.appendChild(c);
  });
}

// Slash command autocomplete
inputEl.addEventListener('input', () => {
  updateSendBtn();
  const val=inputEl.value;
  if(val.startsWith('/')&&!val.includes(' ')&&val.length>1) {
    const q=val.slice(1).toLowerCase();
    const matches=COMMANDS.filter(c=>c.name.startsWith(q));
    if(matches.length>0) {
      cmdSuggest.innerHTML='';
      matches.forEach((c,i)=>{
        const el=document.createElement('div');
        el.className='cmd-item'+(i===0?' active':'');
        el.innerHTML='<span class="cmd-name">/'+c.name+'</span><span class="cmd-desc">'+c.desc+'</span>';
        el.addEventListener('click',()=>{inputEl.value='/'+c.name+' ';cmdSuggest.classList.remove('open');inputEl.focus();updateSendBtn();});
        cmdSuggest.appendChild(el);
      });
      cmdSuggest.classList.add('open');
      cmdSuggestIdx=0;
      return;
    }
  }
  cmdSuggest.classList.remove('open');
  cmdSuggestIdx=-1;
});

// Dropdown logic
function toggleMenu(m){const o=m.classList.contains('open');closeMenus();if(!o)m.classList.add('open');}
function closeMenus(){document.querySelectorAll('.dropdown-menu').forEach(m=>m.classList.remove('open'));}
document.addEventListener('click',e=>{if(!e.target.closest('.dropdown-anchor')&&!e.target.closest('.dropdown-menu'))closeMenus();});
modelBtn.addEventListener('click',e=>{e.stopPropagation();vscode.postMessage({type:'showModelPicker'});});
modeBtn.addEventListener('click',e=>{e.stopPropagation();vscode.postMessage({type:'showModePicker'});});
attachBtn.addEventListener('click',e=>{e.stopPropagation();toggleMenu(attachMenu);});
attachMenu.querySelectorAll('.dm-item').forEach(el=>el.addEventListener('click',()=>{vscode.postMessage({type:el.dataset.action});closeMenus();}));

$('settings-btn').addEventListener('click',()=>vscode.postMessage({type:'openSettings'}));

// Send
sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', e => {
  // Cmd suggest navigation
  if(cmdSuggest.classList.contains('open')) {
    const items=cmdSuggest.querySelectorAll('.cmd-item');
    if(e.key==='ArrowDown'||e.key==='ArrowUp') {
      e.preventDefault();
      items[cmdSuggestIdx]?.classList.remove('active');
      cmdSuggestIdx = e.key==='ArrowDown' ? Math.min(cmdSuggestIdx+1,items.length-1) : Math.max(cmdSuggestIdx-1,0);
      items[cmdSuggestIdx]?.classList.add('active');
      return;
    }
    if(e.key==='Tab'||e.key==='Enter') {
      e.preventDefault();
      const active=items[cmdSuggestIdx];
      if(active) { inputEl.value=active.querySelector('.cmd-name').textContent+' '; cmdSuggest.classList.remove('open'); updateSendBtn(); }
      return;
    }
    if(e.key==='Escape') { cmdSuggest.classList.remove('open'); return; }
  }
  if(e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendMessage(); }
  setTimeout(()=>{inputEl.style.height='auto';inputEl.style.height=Math.min(inputEl.scrollHeight,140)+'px';updateSendBtn();},0);
});
inputEl.addEventListener('input', updateSendBtn);
function updateSendBtn(){sendBtn.disabled=streaming||!inputEl.value.trim();}

function sendMessage() {
  let text=inputEl.value.trim();
  if(!text||streaming) return;
  cmdSuggest.classList.remove('open');
  // Prepend attachments
  if(attachments.length>0) {
    let ctx='';
    for(const a of attachments) ctx+='\\n\\n--- Attached: '+(a.fileName||'selection')+' ---\\n\`\`\`'+(a.language||'')+'\\n'+a.text+'\\n\`\`\`';
    text+=ctx;
    attachments=[];renderAttach();
  }
  inputEl.value='';inputEl.style.height='auto';updateSendBtn();
  vscode.postMessage({type:'send',text});
}

// Messages
function hideEmpty(){if(!hasMessages){hasMessages=true;emptyState?.remove();}}
function showEmpty(){
  const el=document.createElement('div');el.id='empty-state';
  el.innerHTML='<div>Describe what to build</div><div class="hint">Type /help for commands, #file:path to attach files</div>';
  messagesEl.appendChild(el);
}

function appendMsg(role, text, model) {
  const div=document.createElement('div');div.className='msg msg-'+role;
  const label=document.createElement('div');label.className='msg-label';
  if(role==='user') { label.textContent='You'; }
  else {
    label.innerHTML='Conduit';
    if(model) {
      const tag=document.createElement('span');tag.className='model-tag';
      tag.textContent=model.includes('/')?model.split('/').pop():model;
      label.appendChild(tag);
    }
  }
  div.appendChild(label);
  const bubble=document.createElement('div');bubble.className='bubble';
  bubble.innerHTML=role==='assistant'?renderMd(text):esc(text);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  messagesEl.scrollTop=messagesEl.scrollHeight;
  return bubble;
}

function addActions(bubble,text,model) {
  if(!bubble) return;
  const acts=document.createElement('div');acts.className='msg-actions';
  const copyBtn=document.createElement('button');copyBtn.textContent='Copy';
  copyBtn.onclick=()=>{navigator.clipboard.writeText(text).then(()=>{copyBtn.textContent='Copied!';setTimeout(()=>copyBtn.textContent='Copy',1500);});};
  acts.appendChild(copyBtn);
  const insBtn=document.createElement('button');insBtn.textContent='Insert code';
  insBtn.onclick=()=>{
    const m=text.match(/\`\`\`[\\w]*\\n([\\s\\S]*?)\`\`\`/);
    navigator.clipboard.writeText(m?m[1]:text);
    insBtn.textContent='Copied!';setTimeout(()=>insBtn.textContent='Insert code',1500);
  };
  acts.appendChild(insBtn);
  if(model){
    const tag=document.createElement('span');tag.style.cssText='font-size:9px;color:var(--vscode-descriptionForeground);margin-left:auto;';
    tag.textContent=model.includes('/')?model.split('/').pop():model;
    acts.appendChild(tag);
  }
  bubble.parentElement.appendChild(acts);
}

function renderMd(text) {
  let h=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Tables
  h=h.replace(/^(\\|.+\\|\\n)(\\|[-| :]+\\|\\n)((?:\\|.+\\|\\n?)*)/gm, (_,header,sep,body) => {
    const hCells=header.trim().split('|').filter(Boolean).map(c=>'<th>'+c.trim()+'</th>').join('');
    const rows=body.trim().split('\\n').map(r=>{
      const cells=r.trim().split('|').filter(Boolean).map(c=>'<td>'+c.trim()+'</td>').join('');
      return '<tr>'+cells+'</tr>';
    }).join('');
    return '<table><thead><tr>'+hCells+'</tr></thead><tbody>'+rows+'</tbody></table>';
  });
  h=h.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g,(_,lang,code)=>'<pre><code>'+code+'</code></pre>');
  h=h.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  h=h.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
  h=h.replace(/\\n/g,'<br>');
  return h;
}
function esc(t){return(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function showTyping(bubble) {
  if(!bubble) return;
  const d=document.createElement('div');d.className='typing-indicator';
  d.innerHTML='<span></span><span></span><span></span>';
  bubble.appendChild(d);
  messagesEl.scrollTop=messagesEl.scrollHeight;
}
function hideTyping(bubble) {
  if(!bubble) return;
  const t=bubble.querySelector('.typing-indicator');
  if(t) t.remove();
}

function showModeWarning(reason, suggestion) {
  const bar=$('mode-warning-bar');
  bar.style.display='block';
  bar.className='mode-warning';
  bar.innerHTML='<span class="warn-text">'+esc(reason)+'</span>'
    +(suggestion?'<button data-switch="'+esc(suggestion)+'">Switch</button>':'')
    +'<button class="dismiss">&times;</button>';
  bar.querySelector('.dismiss')?.addEventListener('click',()=>{bar.style.display='none';});
  const switchBtn=bar.querySelector('[data-switch]');
  if(switchBtn) switchBtn.addEventListener('click',()=>{
    vscode.postMessage({type:'switchModel',model:switchBtn.dataset.switch});
    bar.style.display='none';
  });
}
</script>
</body>
</html>`;
  }
}
