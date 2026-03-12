import * as vscode from 'vscode';
import { getConfig } from './config';
import { buildEditorContext, buildInlinePrompt } from './context-builder';
import { complete } from './proxy-client';

export class ConduitInlineProvider implements vscode.InlineCompletionItemProvider {
  private _enabled = true;
  private _pending: NodeJS.Timeout | null = null;
  private _lastResult: vscode.InlineCompletionItem[] = [];

  constructor() {
    const cfg = getConfig();
    this._enabled = cfg.inlineSuggestions;
  }

  setEnabled(enabled: boolean) {
    this._enabled = enabled;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | null> {
    if (!this._enabled) return null;

    const cfg = getConfig();

    // Debounce: cancel previous pending request
    if (this._pending) {
      clearTimeout(this._pending);
      this._pending = null;
    }

    // Only trigger at end of line or after whitespace
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (linePrefix.trim().length < 3) return null;

    await new Promise<void>((resolve, reject) => {
      this._pending = setTimeout(resolve, cfg.inlineTriggerDelay);
      token.onCancellationRequested(() => {
        clearTimeout(this._pending!);
        this._pending = null;
        reject(new Error('cancelled'));
      });
    }).catch(() => null);

    if (token.isCancellationRequested) return null;

    // Build context using a fake editor state at the current position
    const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
    const ctx = buildEditorContext(editor);
    if (!ctx) return null;

    try {
      const prompt = buildInlinePrompt(ctx);
      const completion = await complete({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
        temperature: 0.1,
      });

      if (!completion || token.isCancellationRequested) return null;

      // Strip markdown fences if model added them
      const clean = stripFences(completion);

      const item = new vscode.InlineCompletionItem(
        clean,
        new vscode.Range(position, position),
      );

      return { items: [item] };
    } catch {
      return null;
    }
  }
}

function stripFences(text: string): string {
  return text
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trimEnd();
}
