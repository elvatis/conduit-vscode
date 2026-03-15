import * as vscode from 'vscode';
import { buildEditorContext, buildSystemPrompt } from './context-builder';
import { complete, stream, listModels } from './proxy-client';
import { getConfig } from './config';
import { ConduitChatPanel } from './chat-panel';
import { stripFences } from './utils';
import { ConduitInlineProvider } from './inline-provider';

export function registerCommands(
  ctx: vscode.ExtensionContext,
  inlineProvider: ConduitInlineProvider,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // ── Open Chat ────────────────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.openChat', () => {
    // Focus the sidebar chat view in the secondary sidebar instead of opening an editor tab
    vscode.commands.executeCommand('conduit.chatView.focus');
  }));

  // ── Switch Model ─────────────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.switchModel', async () => {
    const models = await listModels();
    if (models.length === 0) {
      vscode.window.showWarningMessage('Conduit: proxy offline or no models available.');
      return;
    }
    const cfg = getConfig();
    const picked = await vscode.window.showQuickPick(
      models.map(m => ({ label: m.id, description: m.owned_by })),
      { placeHolder: `Current: ${cfg.defaultModel}`, title: 'Conduit — Select Model' },
    );
    if (picked) {
      await vscode.workspace.getConfiguration('conduit').update(
        'defaultModel', picked.label, vscode.ConfigurationTarget.Global,
      );
      vscode.window.showInformationMessage(`Conduit: switched to ${picked.label}`);
    }
  }));

  // ── Explain Selection ────────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.explainSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showInformationMessage('Conduit: select some code first.');
      return;
    }
    const editorCtx = buildEditorContext(editor);
    if (!editorCtx) return;

    const selected = editorCtx.selection;
    ConduitChatPanel.createOrShow(ctx.extensionUri);

    // Small delay to let the panel open
    setTimeout(() => {
      ConduitChatPanel.sendMessage(
        `Explain this ${editorCtx.language} code:\n\n\`\`\`${editorCtx.language}\n${selected}\n\`\`\``,
      );
    }, 300);
  }));

  // ── Refactor Selection ───────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.refactorSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showInformationMessage('Conduit: select some code first.');
      return;
    }
    const editorCtx = buildEditorContext(editor);
    if (!editorCtx) return;

    const instruction = await vscode.window.showInputBox({
      prompt: 'How should this code be refactored?',
      placeHolder: 'e.g. extract into function, add error handling, make async…',
    });
    if (!instruction) return;

    await streamIntoNewEditor(
      editorCtx.language,
      [
        { role: 'system', content: buildSystemPrompt(editorCtx) },
        { role: 'user', content: `Refactor this ${editorCtx.language} code — ${instruction}:\n\n\`\`\`${editorCtx.language}\n${editorCtx.selection}\n\`\`\`\n\nReturn only the refactored code, no explanation.` },
      ],
    );
  }));

  // ── Generate Tests ───────────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.generateTests', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showInformationMessage('Conduit: select some code first.');
      return;
    }
    const editorCtx = buildEditorContext(editor);
    if (!editorCtx) return;

    await streamIntoNewEditor(
      editorCtx.language,
      [
        { role: 'system', content: buildSystemPrompt(editorCtx) },
        { role: 'user', content: `Write comprehensive unit tests for this ${editorCtx.language} code:\n\n\`\`\`${editorCtx.language}\n${editorCtx.selection}\n\`\`\`\n\nReturn only the test code, no prose.` },
      ],
    );
  }));

  // ── Fix Diagnostics ──────────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.fixDiagnostics', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const editorCtx = buildEditorContext(editor);
    if (!editorCtx) return;

    if (!editorCtx.diagnostics) {
      vscode.window.showInformationMessage('Conduit: no errors or warnings found in this file.');
      return;
    }

    ConduitChatPanel.createOrShow(ctx.extensionUri);
    setTimeout(() => {
      ConduitChatPanel.sendMessage(
        `Fix the following errors/warnings in ${editorCtx.fileName}:\n\n${editorCtx.diagnostics}\n\nFile content:\n\`\`\`${editorCtx.language}\n${editorCtx.fullFile}\n\`\`\``,
      );
    }, 300);
  }));

  // ── Inline Edit (prompt) ─────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.inlineEdit', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showInformationMessage('Conduit: select some code first.');
      return;
    }

    const editorCtx = buildEditorContext(editor);
    if (!editorCtx) return;

    const instruction = await vscode.window.showInputBox({
      prompt: 'What should Conduit do with this code?',
      placeHolder: 'e.g. add types, optimize, add comments…',
    });
    if (!instruction) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Conduit: editing…', cancellable: false },
      async () => {
        const result = await complete({
          messages: [
            { role: 'system', content: buildSystemPrompt(editorCtx) },
            { role: 'user', content: `${instruction}:\n\n\`\`\`${editorCtx.language}\n${editorCtx.selection}\n\`\`\`\n\nReturn ONLY the modified code, no explanation, no markdown fences.` },
          ],
          temperature: 0.2,
        });

        if (!result) return;
        const clean = stripFences(result);

        await editor.edit(editBuilder => {
          editBuilder.replace(editor.selection, clean);
        });
      },
    );
  }));

  // ── Terminal Command Suggestion ──────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.askInTerminal', async () => {
    const cfg = getConfig();
    if (!cfg.terminalIntegration) {
      vscode.window.showInformationMessage('Conduit: terminal integration is disabled in settings.');
      return;
    }

    const task = await vscode.window.showInputBox({
      prompt: 'What do you want to do in the terminal?',
      placeHolder: 'e.g. find all .ts files modified today, kill process on port 3000…',
    });
    if (!task) return;

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? '~';
    const os = process.platform;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Conduit: generating command…' },
      async () => {
        const cmd = await complete({
          messages: [
            {
              role: 'system',
              content: `You are a terminal expert. The user is on ${os}, working in ${workspacePath}. Return ONLY the shell command, nothing else. No markdown, no explanation.`,
            },
            { role: 'user', content: task },
          ],
          max_tokens: 100,
          temperature: 0,
        });

        if (!cmd?.trim()) return;
        const cleanCmd = stripFences(cmd);

        const action = await vscode.window.showInformationMessage(
          `Conduit suggests: ${cleanCmd}`,
          'Run in Terminal',
          'Copy',
          'Cancel',
        );

        if (action === 'Run in Terminal') {
          let terminal = vscode.window.activeTerminal;
          if (!terminal) terminal = vscode.window.createTerminal('Conduit');
          terminal.show();
          terminal.sendText(cleanCmd);
        } else if (action === 'Copy') {
          await vscode.env.clipboard.writeText(cleanCmd);
          vscode.window.showInformationMessage('Conduit: command copied to clipboard.');
        }
      },
    );
  }));

  // ── Toggle Inline Suggestions ────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.toggleInline', () => {
    const cfg = getConfig();
    const newValue = !cfg.inlineSuggestions;
    vscode.workspace.getConfiguration('conduit').update(
      'inlineSuggestions', newValue, vscode.ConfigurationTarget.Global,
    );
    inlineProvider.setEnabled(newValue);
    vscode.window.showInformationMessage(
      `Conduit inline suggestions ${newValue ? 'enabled' : 'disabled'}.`,
    );
  }));

  return disposables;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function streamIntoNewEditor(
  language: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
) {
  const doc = await vscode.workspace.openTextDocument({ language, content: '' });
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

  let position = new vscode.Position(0, 0);
  let fullText = '';

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Conduit: generating…', cancellable: false },
    async () => {
      for await (const chunk of stream({ messages })) {
        if (chunk.done) break;
        fullText += chunk.delta;
        await editor.edit(editBuilder => {
          editBuilder.insert(position, chunk.delta);
        });
        // Update position
        const lines = fullText.split('\n');
        position = new vscode.Position(
          lines.length - 1,
          lines[lines.length - 1].length,
        );
      }
    },
  );
}
