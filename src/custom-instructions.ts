import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Load custom instructions from .conduit/instructions.md (project-level)
 * and ~/.conduit/instructions.md (global), similar to CLAUDE.md / copilot-instructions.md.
 */
export function loadCustomInstructions(): string {
  const parts: string[] = [];

  // Global instructions
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    const globalPath = path.join(home, '.conduit', 'instructions.md');
    const content = readFileSafe(globalPath);
    if (content) parts.push(`[Global instructions]\n${content}`);
  }

  // Project-level instructions
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      // Check .conduit/instructions.md
      const conduitPath = path.join(folder.uri.fsPath, '.conduit', 'instructions.md');
      let content = readFileSafe(conduitPath);

      // Also check .github/copilot-instructions.md for compatibility
      if (!content) {
        const copilotPath = path.join(folder.uri.fsPath, '.github', 'copilot-instructions.md');
        content = readFileSafe(copilotPath);
      }

      // Also check CLAUDE.md for compatibility
      if (!content) {
        const claudePath = path.join(folder.uri.fsPath, 'CLAUDE.md');
        content = readFileSafe(claudePath);
      }

      if (content) {
        parts.push(`[Project instructions: ${folder.name}]\n${content}`);
      }
    }
  }

  return parts.join('\n\n');
}

function readFileSafe(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      // Limit to 4000 chars to avoid flooding context
      return content.length > 4000
        ? content.slice(0, 4000) + '\n\n(truncated)'
        : content;
    }
  } catch { /* ignore */ }
  return null;
}
