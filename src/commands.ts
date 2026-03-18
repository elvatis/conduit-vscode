import * as vscode from 'vscode';
import { buildEditorContext, buildSystemPrompt } from './context-builder';
import { complete, stream, listModels } from './proxy-client';
import { getConfig } from './config';
import { ConduitChatPanel } from './chat-panel';
import { stripFences } from './utils';
import { ConduitInlineProvider } from './inline-provider';
import { CLI_MODELS, spawnCliAgent } from './cli-runner';
import {
  addBackgroundSession,
  killBackgroundSession,
  getBackgroundSession,
  getBackgroundSessions,
  type BackgroundSession,
} from './sessions-tree-provider';

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

  // ── Spawn Background Agent ─────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.spawnAgent', async () => {
    const modelItems = CLI_MODELS.map(m => ({ label: m.name, description: m.id, id: m.id }));
    const picked = await vscode.window.showQuickPick(modelItems, {
      placeHolder: 'Select a model for the agent',
      title: 'Conduit — Spawn Agent',
    });
    if (!picked) return;

    const prompt = await vscode.window.showInputBox({
      prompt: 'What should the agent do?',
      placeHolder: 'e.g. refactor auth module, fix failing tests…',
    });
    if (!prompt) return;

    const workdir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const messages = [{ role: 'user' as const, content: prompt }];
    const handle = spawnCliAgent(picked.id, messages, 600_000, workdir);
    const session = addBackgroundSession(prompt.slice(0, 60), picked.id, handle);

    vscode.window.showInformationMessage(
      `Conduit: agent spawned (PID ${handle.pid})`,
      'View Output',
    ).then(action => {
      if (action === 'View Output') {
        session.outputChannel.show();
      }
    });
  }));

  // ── Kill Background Session ────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.killSession', async (item?: { bgSession: BackgroundSession }) => {
    if (item?.bgSession) {
      killBackgroundSession(item.bgSession.id);
      vscode.window.showInformationMessage(`Conduit: killed agent "${item.bgSession.title}"`);
      return;
    }

    // No context item - show quick pick of running sessions
    const running = getBackgroundSessions().filter(s => s.status === 'running');
    if (running.length === 0) {
      vscode.window.showInformationMessage('Conduit: no running agent sessions.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      running.map(s => ({ label: s.title, description: `PID ${s.handle.pid}`, id: s.id })),
      { placeHolder: 'Select session to kill' },
    );
    if (picked) {
      killBackgroundSession(picked.id);
      vscode.window.showInformationMessage(`Conduit: killed agent "${picked.label}"`);
    }
  }));

  // ── View Agent Output ─────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.viewAgentOutput', (item?: { bgSession: BackgroundSession }) => {
    if (item?.bgSession) {
      item.bgSession.outputChannel.show();
      return;
    }

    const sessions = getBackgroundSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage('Conduit: no agent sessions.');
      return;
    }

    // Show the most recent session output
    const latest = sessions.sort((a, b) => b.startedAt - a.startedAt)[0];
    latest.outputChannel.show();
  }));

  // ── Fix Issue (worktree + agent) ──────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.fixIssue', async () => {
    const issueNumber = await vscode.window.showInputBox({
      prompt: 'GitHub issue number',
      placeHolder: 'e.g. 42',
      validateInput: (v) => /^\d+$/.test(v) ? null : 'Enter a number',
    });
    if (!issueNumber) return;

    const workdir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workdir) {
      vscode.window.showWarningMessage('Conduit: open a workspace folder first.');
      return;
    }

    const modelItems = CLI_MODELS.map(m => ({ label: m.name, description: m.id, id: m.id }));
    const picked = await vscode.window.showQuickPick(modelItems, {
      placeHolder: 'Select a model for the agent',
      title: 'Conduit — Fix Issue',
    });
    if (!picked) return;

    const branch = `fix/issue-${issueNumber}`;
    const cp = require('child_process') as typeof import('child_process');
    const pathMod = require('path') as typeof import('path');
    const fsMod = require('fs') as typeof import('fs');
    const worktreePath = pathMod.join(workdir, '..', `worktree-fix-issue-${issueNumber}`);

    // Serialize worktree creation to avoid .git/config.lock contention
    // when multiple Fix Issue commands run in parallel (hat tip: @m13v)
    const lockPath = pathMod.join(workdir, '.git', 'worktree-create.lock');
    const lockDeadline = Date.now() + 30_000;
    let lockFd: number | null = null;
    while (Date.now() < lockDeadline) {
      try {
        lockFd = fsMod.openSync(lockPath, fsMod.constants.O_CREAT | fsMod.constants.O_EXCL | fsMod.constants.O_WRONLY);
        break;
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
          try {
            const stat = fsMod.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > 30_000) { fsMod.unlinkSync(lockPath); continue; }
          } catch { /* gone, retry */ }
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        break;
      }
    }

    try {
      cp.execSync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: workdir, timeout: 15_000 });
    } catch (err) {
      vscode.window.showErrorMessage(`Conduit: failed to create worktree: ${(err as Error).message}`);
      return;
    } finally {
      // Release lock with stagger delay
      await new Promise(r => setTimeout(r, 2_500));
      if (lockFd !== null) { try { fsMod.closeSync(lockFd); } catch { /* ignore */ } }
      try { fsMod.unlinkSync(lockPath); } catch { /* ignore */ }
    }

    const prompt = `Fix GitHub issue #${issueNumber}. Analyze the codebase, identify the problem, and implement a fix. Create a commit when done.`;
    const messages = [{ role: 'user' as const, content: prompt }];
    const handle = spawnCliAgent(picked.id, messages, 600_000, worktreePath);
    const session = addBackgroundSession(`Fix #${issueNumber}`, picked.id, handle);

    vscode.window.showInformationMessage(
      `Conduit: agent spawned on branch ${branch} (worktree: ${worktreePath})`,
      'View Output',
    ).then(action => {
      if (action === 'View Output') {
        session.outputChannel.show();
      }
    });
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
