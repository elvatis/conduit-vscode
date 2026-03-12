import * as vscode from 'vscode';
import { buildEditorContext, buildSystemPrompt } from './context-builder';
import { stream } from './proxy-client';
import { getConfig } from './config';
import { listModels } from './proxy-client';

export class ConduitChatPanel {
  private static _instance: ConduitChatPanel | undefined;
  private _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private _model: string;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._model = getConfig().defaultModel;

    this._panel.webview.options = { enableScripts: true };
    this._panel.webview.html = this._getHtml(extensionUri);

    this._panel.webview.onDidReceiveMessage(
      msg => this._handleMessage(msg),
      null,
      this._disposables,
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (ConduitChatPanel._instance) {
      ConduitChatPanel._instance._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'conduitChat',
      'Conduit Chat',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    ConduitChatPanel._instance = new ConduitChatPanel(panel, extensionUri);
  }

  static sendMessage(text: string) {
    ConduitChatPanel._instance?._handleMessage({ type: 'send', text });
  }

  private async _handleMessage(msg: { type: string; text?: string; model?: string }) {
    switch (msg.type) {
      case 'send':
        await this._handleUserMessage(msg.text ?? '');
        break;
      case 'switchModel':
        if (msg.model) {
          this._model = msg.model;
          this._postMessage({ type: 'modelChanged', model: this._model });
        }
        break;
      case 'clearHistory':
        this._history = [];
        this._postMessage({ type: 'cleared' });
        break;
      case 'getModels':
        this._sendModelList();
        break;
      case 'getContext':
        this._sendCurrentContext();
        break;
    }
  }

  private async _handleUserMessage(text: string) {
    if (!text.trim()) return;

    // Build system prompt with editor context
    const ctx = buildEditorContext();
    const systemPrompt = ctx
      ? buildSystemPrompt(ctx)
      : 'You are Conduit, an expert AI coding assistant integrated into VS Code.';

    this._history.push({ role: 'user', content: text });
    this._postMessage({ type: 'userMessage', text });
    this._postMessage({ type: 'assistantStart' });

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...this._history,
    ];

    let fullResponse = '';

    try {
      for await (const chunk of stream({ messages, model: this._model })) {
        if (chunk.done) break;
        fullResponse += chunk.delta;
        this._postMessage({ type: 'assistantChunk', delta: chunk.delta });
      }
    } catch (err) {
      const errMsg = `Error: ${(err as Error).message}`;
      this._postMessage({ type: 'assistantChunk', delta: errMsg });
      fullResponse = errMsg;
    }

    this._history.push({ role: 'assistant', content: fullResponse });
    this._postMessage({ type: 'assistantDone' });
  }

  private async _sendModelList() {
    const models = await listModels();
    this._postMessage({ type: 'models', list: models.map(m => m.id) });
  }

  private _sendCurrentContext() {
    const ctx = buildEditorContext();
    if (ctx) {
      this._postMessage({
        type: 'context',
        fileName: ctx.fileName,
        language: ctx.language,
        hasSelection: !!ctx.selection,
        diagnostics: ctx.diagnostics,
      });
    }
  }

  private _postMessage(msg: object) {
    this._panel.webview.postMessage(msg);
  }

  dispose() {
    ConduitChatPanel._instance = undefined;
    this._panel.dispose();
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }

  private _getHtml(extensionUri: vscode.Uri): string {
    void extensionUri; // may be used for resource URIs later
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conduit Chat</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex; flex-direction: column; height: 100vh;
  }
  #toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }
  #toolbar select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    padding: 3px 6px; border-radius: 3px; font-size: 12px; flex: 1;
  }
  #toolbar button {
    background: transparent; border: none; cursor: pointer;
    color: var(--vscode-icon-foreground); padding: 2px 6px;
    border-radius: 3px; font-size: 12px;
  }
  #toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
  #context-bar {
    font-size: 11px; color: var(--vscode-descriptionForeground);
    padding: 4px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    display: none; flex-shrink: 0;
  }
  #messages {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .msg { display: flex; flex-direction: column; gap: 4px; }
  .msg-user .bubble {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-radius: 12px 12px 2px 12px;
    padding: 8px 12px; align-self: flex-end; max-width: 85%;
    white-space: pre-wrap; word-break: break-word;
  }
  .msg-assistant .bubble {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 12px 12px 12px 2px;
    padding: 10px 14px; align-self: flex-start; max-width: 95%;
    white-space: pre-wrap; word-break: break-word; line-height: 1.5;
  }
  .msg-assistant .bubble pre {
    background: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px; padding: 8px; overflow-x: auto;
    margin: 6px 0; font-family: var(--vscode-editor-font-family);
    font-size: 12px;
  }
  .msg-assistant .bubble code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textBlockQuote-background);
    padding: 1px 4px; border-radius: 3px; font-size: 12px;
  }
  .copy-btn {
    font-size: 10px; align-self: flex-end; cursor: pointer;
    color: var(--vscode-descriptionForeground);
    background: none; border: none; padding: 2px 6px;
  }
  .copy-btn:hover { color: var(--vscode-foreground); }
  #input-area {
    padding: 10px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    display: flex; gap: 8px; align-items: flex-end;
    flex-shrink: 0;
  }
  #input {
    flex: 1; resize: none; min-height: 38px; max-height: 160px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px; padding: 8px 10px;
    font-family: inherit; font-size: inherit;
    line-height: 1.4;
  }
  #input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: transparent; }
  #send-btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 6px; padding: 8px 14px;
    cursor: pointer; font-size: 13px; flex-shrink: 0;
  }
  #send-btn:hover { background: var(--vscode-button-hoverBackground); }
  #send-btn:disabled { opacity: 0.5; cursor: default; }
  .spinner { display: inline-block; width: 14px; height: 14px;
    border: 2px solid var(--vscode-panel-border);
    border-top-color: var(--vscode-progressBar-background);
    border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="toolbar">
  <select id="model-select" title="Select model"></select>
  <button id="clear-btn" title="Clear history">✕ Clear</button>
  <button id="ctx-btn" title="Show context">⊙ Context</button>
</div>
<div id="context-bar" id="ctx-bar"></div>
<div id="messages"></div>
<div id="input-area">
  <textarea id="input" placeholder="Ask Conduit… (Enter to send, Shift+Enter for newline)" rows="1"></textarea>
  <button id="send-btn">Send</button>
</div>

<script>
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const modelSelect = document.getElementById('model-select');
const ctxBar = document.getElementById('context-bar');
let currentAssistantBubble = null;
let currentAssistantText = '';
let streaming = false;

// Request model list on load
vscode.postMessage({ type: 'getModels' });
vscode.postMessage({ type: 'getContext' });

window.addEventListener('message', event => {
  const msg = event.data;
  switch (msg.type) {
    case 'models':
      renderModelList(msg.list);
      break;
    case 'modelChanged':
      setSelectedModel(msg.model);
      break;
    case 'userMessage':
      appendMessage('user', msg.text);
      break;
    case 'assistantStart':
      streaming = true;
      sendBtn.disabled = true;
      currentAssistantText = '';
      currentAssistantBubble = appendMessage('assistant', '');
      break;
    case 'assistantChunk':
      currentAssistantText += msg.delta;
      if (currentAssistantBubble) {
        currentAssistantBubble.innerHTML = renderMarkdown(currentAssistantText);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      break;
    case 'assistantDone':
      streaming = false;
      sendBtn.disabled = false;
      addCopyButton(currentAssistantBubble, currentAssistantText);
      currentAssistantBubble = null;
      break;
    case 'cleared':
      messagesEl.innerHTML = '';
      break;
    case 'context':
      ctxBar.style.display = 'block';
      ctxBar.textContent = msg.fileName
        ? '📄 ' + msg.fileName + (msg.hasSelection ? ' · selection active' : '') + (msg.diagnostics ? ' · ⚠ errors' : '')
        : '';
      break;
  }
});

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg msg-' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function addCopyButton(bubble, text) {
  if (!bubble) return;
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = 'Copy';
  btn.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  };
  bubble.parentElement.appendChild(btn);
}

function renderMarkdown(text) {
  // Basic markdown: code blocks, inline code, bold
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\`\`\`([\s\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderModelList(list) {
  modelSelect.innerHTML = '';
  for (const id of list) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = id;
    modelSelect.appendChild(opt);
  }
}

function setSelectedModel(model) {
  modelSelect.value = model;
}

modelSelect.addEventListener('change', () => {
  vscode.postMessage({ type: 'switchModel', model: modelSelect.value });
});

document.getElementById('clear-btn').addEventListener('click', () => {
  vscode.postMessage({ type: 'clearHistory' });
});

document.getElementById('ctx-btn').addEventListener('click', () => {
  vscode.postMessage({ type: 'getContext' });
});

sendBtn.addEventListener('click', sendMessage);

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  // Auto-resize
  setTimeout(() => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }, 0);
});

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || streaming) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  vscode.postMessage({ type: 'send', text });
}
</script>
</body>
</html>`;
  }
}
