import * as vscode from 'vscode';
import { buildEditorContext, buildSystemPrompt } from './context-builder';
import { complete, stream, listModels } from './proxy-client';
import { getConfig } from './config';
import { ConduitChatPanel } from './chat-panel';
import { stripFences } from './utils';
import { ConduitInlineProvider } from './inline-provider';
import { CLI_MODELS, spawnCliAgent } from './cli-runner';
import { loadAahpContext, buildAahpContextBlock } from './aahp-context';
import {
  addBackgroundSession,
  killBackgroundSession,
  getBackgroundSession,
  getBackgroundSessions,
  removeBackgroundSession,
  clearFinishedSessions,
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

    // Auto-detect AAHP context and prepend to prompt
    const aahpCtx = loadAahpContext(workdir);
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (aahpCtx) {
      messages.push({ role: 'system', content: buildAahpContextBlock(aahpCtx) });
    }
    messages.push({ role: 'user', content: prompt });

    const handle = spawnCliAgent(picked.id, messages, 600_000, workdir);
    const session = addBackgroundSession(prompt.slice(0, 60), picked.id, handle);

    // Log AAHP context info
    if (aahpCtx) {
      session.outputChannel.appendLine(`[AAHP] Project: ${aahpCtx.project} | Phase: ${aahpCtx.phase} | ~${aahpCtx.tokenEstimate} tokens`);
    }

    vscode.window.showInformationMessage(
      `Conduit: agent spawned (PID ${handle.pid})${aahpCtx ? ` [AAHP: ${aahpCtx.project}]` : ''}`,
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

    // Auto-detect AAHP context from the worktree (inherits from main repo)
    const aahpCtx = loadAahpContext(worktreePath) ?? loadAahpContext(workdir);
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (aahpCtx) {
      messages.push({ role: 'system', content: buildAahpContextBlock(aahpCtx) });
    }
    messages.push({ role: 'user', content: prompt });

    const handle = spawnCliAgent(picked.id, messages, 600_000, worktreePath);
    const session = addBackgroundSession(`Fix #${issueNumber}`, picked.id, handle);

    if (aahpCtx) {
      session.outputChannel.appendLine(`[AAHP] Project: ${aahpCtx.project} | Phase: ${aahpCtx.phase}`);
    }

    vscode.window.showInformationMessage(
      `Conduit: agent spawned on branch ${branch} (worktree: ${worktreePath})${aahpCtx ? ` [AAHP: ${aahpCtx.project}]` : ''}`,
      'View Output',
    ).then(action => {
      if (action === 'View Output') {
        session.outputChannel.show();
      }
    });
  }));

  // ── Batch Fix Issues ──────────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.batchFixIssues', async () => {
    const workdir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workdir) {
      vscode.window.showWarningMessage('Conduit: open a workspace folder first.');
      return;
    }

    const label = await vscode.window.showInputBox({
      prompt: 'GitHub label to filter issues (leave empty for all open issues)',
      placeHolder: 'e.g. bug, good-first-issue',
    });
    if (label === undefined) return; // cancelled

    const maxStr = await vscode.window.showInputBox({
      prompt: 'Max issues to process',
      placeHolder: '5',
      value: '5',
      validateInput: (v) => /^\d+$/.test(v) && parseInt(v) > 0 ? null : 'Enter a positive number',
    });
    if (!maxStr) return;
    const maxIssues = parseInt(maxStr);

    const modelItems = CLI_MODELS.map(m => ({ label: m.name, description: m.id, id: m.id }));
    const picked = await vscode.window.showQuickPick(modelItems, {
      placeHolder: 'Select a model for the agents',
      title: 'Conduit — Batch Fix Issues',
    });
    if (!picked) return;

    // Fetch issues via gh CLI
    const cp = require('child_process') as typeof import('child_process');
    const pathMod = require('path') as typeof import('path');
    const fsMod = require('fs') as typeof import('fs');

    let issueNumbers: number[];
    try {
      const labelArg = label ? `--label "${label}"` : '';
      const ghOutput = cp.execSync(
        `gh issue list --state open ${labelArg} --limit ${maxIssues} --json number,title`,
        { cwd: workdir, timeout: 15_000, encoding: 'utf-8' },
      );
      const issues = JSON.parse(ghOutput) as Array<{ number: number; title: string }>;
      if (issues.length === 0) {
        vscode.window.showInformationMessage(`Conduit: no open issues found${label ? ` with label "${label}"` : ''}.`);
        return;
      }

      // Show confirmation
      const issueList = issues.map(i => `#${i.number}: ${i.title}`).join('\n');
      const confirm = await vscode.window.showInformationMessage(
        `Conduit: found ${issues.length} issues. Spawn agents for all?`,
        { modal: true, detail: issueList },
        'Start All',
      );
      if (confirm !== 'Start All') return;

      issueNumbers = issues.map(i => i.number);
    } catch (err) {
      vscode.window.showErrorMessage(`Conduit: failed to fetch issues: ${(err as Error).message}`);
      return;
    }

    // Spawn agents with concurrency limit
    const MAX_CONCURRENT = 3;
    const results: Array<{ issue: number; status: 'spawned' | 'failed'; error?: string }> = [];
    const outputChannel = vscode.window.createOutputChannel('Conduit Batch Fix');
    outputChannel.show();
    outputChannel.appendLine(`[Batch] Starting ${issueNumbers.length} issue fixes with ${picked.label}`);
    outputChannel.appendLine(`[Batch] Max concurrent: ${MAX_CONCURRENT}`);
    outputChannel.appendLine('---');

    const aahpCtx = loadAahpContext(workdir);

    // Process in batches
    for (let i = 0; i < issueNumbers.length; i += MAX_CONCURRENT) {
      const batch = issueNumbers.slice(i, i + MAX_CONCURRENT);
      const batchPromises = batch.map(async (issueNum) => {
        const branch = `fix/issue-${issueNum}`;
        const worktreePath = pathMod.join(workdir, '..', `worktree-fix-issue-${issueNum}`);

        // Acquire lock for worktree creation
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
              } catch { /* gone */ }
              await new Promise(r => setTimeout(r, 500));
              continue;
            }
            break;
          }
        }

        try {
          cp.execSync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: workdir, timeout: 15_000 });
        } catch (err) {
          results.push({ issue: issueNum, status: 'failed', error: (err as Error).message });
          outputChannel.appendLine(`[#${issueNum}] FAILED: ${(err as Error).message}`);
          return;
        } finally {
          await new Promise(r => setTimeout(r, 2_500));
          if (lockFd !== null) { try { fsMod.closeSync(lockFd); } catch { /* */ } }
          try { fsMod.unlinkSync(lockPath); } catch { /* */ }
        }

        const prompt = `Fix GitHub issue #${issueNum}. Analyze the codebase, identify the problem, and implement a fix. Create a commit when done.`;
        const messages: { role: 'system' | 'user'; content: string }[] = [];
        if (aahpCtx) {
          messages.push({ role: 'system', content: buildAahpContextBlock(aahpCtx) });
        }
        messages.push({ role: 'user', content: prompt });

        const handle = spawnCliAgent(picked.id, messages, 600_000, worktreePath);
        const session = addBackgroundSession(`Fix #${issueNum}`, picked.id, handle);
        results.push({ issue: issueNum, status: 'spawned' });
        outputChannel.appendLine(`[#${issueNum}] Agent spawned on branch ${branch} (PID ${handle.pid})`);
      });

      // Wait for current batch of worktree creations before starting next
      await Promise.all(batchPromises);
    }

    // Summary
    const spawned = results.filter(r => r.status === 'spawned').length;
    const failed = results.filter(r => r.status === 'failed').length;
    outputChannel.appendLine('---');
    outputChannel.appendLine(`[Batch] Done. Spawned: ${spawned}, Failed: ${failed}`);
    vscode.window.showInformationMessage(
      `Conduit: batch fix started. ${spawned} agents spawned, ${failed} failed.`,
    );
  }));

  // ── Resume Interrupted Session ──────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.resumeSession', async (item?: { bgSession: BackgroundSession }) => {
    let session: BackgroundSession | undefined;
    if (item?.bgSession) {
      session = item.bgSession;
    } else {
      // Show quick pick of interrupted sessions
      const interrupted = getBackgroundSessions().filter(s => s.status === 'interrupted');
      if (interrupted.length === 0) {
        vscode.window.showInformationMessage('Conduit: no interrupted sessions to resume.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        interrupted.map(s => ({ label: s.title, description: `${s.model}`, id: s.id })),
        { placeHolder: 'Select session to resume' },
      );
      if (!picked) return;
      session = getBackgroundSession(picked.id);
    }

    if (!session || session.status !== 'interrupted') {
      vscode.window.showWarningMessage('Conduit: session is not in interrupted state.');
      return;
    }

    // Re-run the same prompt with the same model
    const workdir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const messages: { role: 'user'; content: string }[] = [
      { role: 'user', content: session.title },
    ];

    const handle = spawnCliAgent(session.model, messages, 600_000, workdir);
    const newSession = addBackgroundSession(`${session.title} (resumed)`, session.model, handle);

    // Remove the old interrupted session
    removeBackgroundSession(session.id);

    vscode.window.showInformationMessage(
      `Conduit: resumed agent "${session.title}" (PID ${handle.pid})`,
      'View Output',
    ).then(action => {
      if (action === 'View Output') {
        newSession.outputChannel.show();
      }
    });
  }));

  // ── Remove Finished Session ────────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.removeSession', (item?: { bgSession: BackgroundSession }) => {
    if (item?.bgSession) {
      if (removeBackgroundSession(item.bgSession.id)) {
        vscode.window.showInformationMessage(`Conduit: removed session "${item.bgSession.title}"`);
      }
      return;
    }
    vscode.window.showInformationMessage('Conduit: right-click a finished session to remove it.');
  }));

  // ── Clear All Finished Sessions ────────────────────────────────────────────
  disposables.push(vscode.commands.registerCommand('conduit.clearFinishedSessions', () => {
    const count = clearFinishedSessions();
    if (count > 0) {
      vscode.window.showInformationMessage(`Conduit: cleared ${count} finished session${count !== 1 ? 's' : ''}.`);
    } else {
      vscode.window.showInformationMessage('Conduit: no finished sessions to clear.');
    }
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
