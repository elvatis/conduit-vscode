import * as vscode from 'vscode';
import { buildEditorContext, buildSystemPrompt } from './context-builder';
import { stream } from './proxy-client';
import { getConfig } from './config';
import { stripFences } from './utils';

/**
 * Inline Chat - triggered by Ctrl+I.
 * Shows an input box at the cursor, streams the response, and applies as an inline diff.
 */
export async function inlineChat(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Conduit: open a file first.');
    return;
  }

  const instruction = await vscode.window.showInputBox({
    prompt: 'Conduit Inline Chat',
    placeHolder: 'Describe the change... (e.g. add error handling, convert to async, add types)',
    ignoreFocusOut: true,
  });

  if (!instruction) return;

  const ctx = buildEditorContext(editor);
  if (!ctx) return;

  const hasSelection = !editor.selection.isEmpty;
  const targetRange = hasSelection
    ? editor.selection
    : new vscode.Range(0, 0, editor.document.lineCount - 1, editor.document.lineAt(editor.document.lineCount - 1).text.length);
  const targetCode = editor.document.getText(targetRange);

  const cfg = getConfig();

  const systemPrompt = ctx
    ? buildSystemPrompt(ctx)
    : 'You are Conduit, an expert AI coding assistant.';

  const userPrompt = hasSelection
    ? `${instruction}\n\nSelected code (${ctx.language}):\n\`\`\`${ctx.language}\n${targetCode}\n\`\`\`\n\nReturn ONLY the modified code. No markdown fences. No explanation.`
    : `${instruction}\n\nFull file ${ctx.fileName} (${ctx.language}):\n\`\`\`${ctx.language}\n${targetCode}\n\`\`\`\n\nReturn ONLY the modified full file content. No markdown fences. No explanation.`;

  let result = '';

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Conduit: generating...', cancellable: true },
    async (_progress, token) => {
      try {
        for await (const chunk of stream({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          model: cfg.defaultModel,
          temperature: 0.2,
        })) {
          if (token.isCancellationRequested) break;
          if (chunk.done) break;
          result += chunk.delta;
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Conduit: ${(err as Error).message}`);
        return;
      }
    },
  );

  if (!result.trim()) return;

  // Strip markdown fences if the model wrapped them
  result = stripFences(result);

  // Show diff and let user accept/reject
  await showInlineDiff(editor, targetRange, result);
}

/**
 * Show a diff between original and proposed code, let user accept or reject.
 */
async function showInlineDiff(
  editor: vscode.TextEditor,
  range: vscode.Range,
  newCode: string,
): Promise<void> {
  const originalUri = editor.document.uri;
  const originalCode = editor.document.getText(range);

  // Create a virtual document with the proposed code
  const proposedUri = vscode.Uri.parse(`conduit-diff:${originalUri.path}?proposed`);

  // Register a temporary content provider
  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string {
      // Show the full document with the proposed change applied
      const fullText = editor.document.getText();
      const before = fullText.slice(0, editor.document.offsetAt(range.start));
      const after = fullText.slice(editor.document.offsetAt(range.end));
      return before + newCode + after;
    }
  })();

  const reg = vscode.workspace.registerTextDocumentContentProvider('conduit-diff', provider);

  try {
    await vscode.commands.executeCommand('vscode.diff',
      originalUri,
      proposedUri,
      'Conduit: Review Changes',
      { preview: true },
    );

    const action = await vscode.window.showInformationMessage(
      'Conduit: Apply these changes?',
      'Apply',
      'Discard',
    );

    if (action === 'Apply') {
      await editor.edit(editBuilder => {
        editBuilder.replace(range, newCode);
      });
    }
  } finally {
    reg.dispose();
  }
}
