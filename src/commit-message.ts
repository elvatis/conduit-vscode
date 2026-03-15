import * as vscode from 'vscode';
import * as cp from 'child_process';
import { complete } from './proxy-client';
import { getConfig } from './config';
import { stripFences } from './utils';

/**
 * Generate a commit message from staged changes using AI.
 */
export async function generateCommitMessage(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Conduit: no workspace folder open.');
    return;
  }

  const cwd = workspaceFolder.uri.fsPath;

  // Get staged diff
  let diff: string;
  try {
    diff = cp.execSync('git diff --cached --stat && echo "---" && git diff --cached', {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    vscode.window.showWarningMessage('Conduit: no staged changes found. Stage files first with git add.');
    return;
  }

  if (!diff || diff === '---') {
    vscode.window.showWarningMessage('Conduit: no staged changes found.');
    return;
  }

  // Truncate diff if too large
  const maxDiffChars = 12000;
  const truncatedDiff = diff.length > maxDiffChars
    ? diff.slice(0, maxDiffChars) + '\n\n... (diff truncated)'
    : diff;

  // Get recent commit messages for style reference
  let recentCommits = '';
  try {
    recentCommits = cp.execSync('git log --oneline -5', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch { /* ignore */ }

  const cfg = getConfig();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Conduit: generating commit message...', cancellable: false },
    async () => {
      try {
        const result = await complete({
          messages: [
            {
              role: 'system',
              content: 'You are a git commit message generator. Write clear, concise commit messages following conventional commits style. Return ONLY the commit message, no explanation. Use imperative mood ("add" not "added"). First line should be under 72 characters.',
            },
            {
              role: 'user',
              content: `Generate a commit message for these staged changes:\n\n${truncatedDiff}${recentCommits ? `\n\nRecent commit style reference:\n${recentCommits}` : ''}`,
            },
          ],
          model: cfg.defaultModel,
          temperature: 0.3,
          max_tokens: 200,
        });

        if (!result) return;

        // Clean up the result
        const message = stripFences(result.replace(/^["']|["']$/g, ''));

        // Set it in the SCM input box
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
          const git = gitExtension.exports.getAPI(1);
          const repo = git.repositories[0];
          if (repo) {
            repo.inputBox.value = message;
            vscode.window.showInformationMessage('Conduit: commit message generated. Review and commit.');
            return;
          }
        }

        // Fallback: show in input box
        const action = await vscode.window.showInformationMessage(
          `Conduit commit message: ${message}`,
          'Copy',
          'Dismiss',
        );
        if (action === 'Copy') {
          await vscode.env.clipboard.writeText(message);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Conduit: ${(err as Error).message}`);
      }
    },
  );
}
