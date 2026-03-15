import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ParsedMention {
  type: 'file' | 'selection' | 'codebase' | 'terminal' | 'problems' | 'workspace';
  raw: string;         // the original #mention text
  content: string;     // resolved content
  label: string;       // display label
}

/**
 * Parse #-mentions in user input and resolve them to content.
 * Supported: #file:path, #selection, #codebase, #terminal, #problems
 */
export async function parseMentions(text: string): Promise<{
  cleanText: string;
  mentions: ParsedMention[];
}> {
  const mentions: ParsedMention[] = [];
  let cleanText = text;

  // #file:path/to/file or #file:path/to/file:10-20 (line range)
  const filePattern = /#file:([^\s]+)/g;
  let match;
  while ((match = filePattern.exec(text)) !== null) {
    const raw = match[0];
    const filePart = match[1];
    const resolved = await resolveFileMention(filePart);
    if (resolved) {
      mentions.push({ type: 'file', raw, content: resolved.content, label: resolved.label });
    }
    cleanText = cleanText.replace(raw, '');
  }

  // #selection - current editor selection
  if (/#selection\b/.test(text)) {
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      const sel = editor.document.getText(editor.selection);
      const fname = vscode.workspace.asRelativePath(editor.document.uri);
      const startLine = editor.selection.start.line + 1;
      const endLine = editor.selection.end.line + 1;
      mentions.push({
        type: 'selection',
        raw: '#selection',
        content: `Selected code from ${fname} (lines ${startLine}-${endLine}):\n\`\`\`${editor.document.languageId}\n${sel}\n\`\`\``,
        label: `${fname}:${startLine}-${endLine}`,
      });
    }
    cleanText = cleanText.replace(/#selection\b/g, '');
  }

  // #problems - current file diagnostics
  if (/#problems\b/.test(text)) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const diags = vscode.languages.getDiagnostics(editor.document.uri)
        .filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
        .slice(0, 20)
        .map(d => `Line ${d.range.start.line + 1}: [${d.severity === 0 ? 'error' : 'warning'}] ${d.message}`)
        .join('\n');
      if (diags) {
        const fname = vscode.workspace.asRelativePath(editor.document.uri);
        mentions.push({
          type: 'problems',
          raw: '#problems',
          content: `Diagnostics in ${fname}:\n${diags}`,
          label: `Problems in ${fname}`,
        });
      }
    }
    cleanText = cleanText.replace(/#problems\b/g, '');
  }

  // #terminal - last terminal output
  if (/#terminal\b/.test(text)) {
    // VS Code doesn't expose terminal output directly via API,
    // but we can prompt the user to copy terminal content
    mentions.push({
      type: 'terminal',
      raw: '#terminal',
      content: '[Terminal output: select text in terminal and use "Attach Selection" to include it]',
      label: 'Terminal',
    });
    cleanText = cleanText.replace(/#terminal\b/g, '');
  }

  // #codebase - workspace file listing for broad context
  if (/#codebase\b/.test(text)) {
    const summary = await buildCodebaseSummary();
    if (summary) {
      mentions.push({
        type: 'codebase',
        raw: '#codebase',
        content: summary,
        label: 'Codebase',
      });
    }
    cleanText = cleanText.replace(/#codebase\b/g, '');
  }

  // #workspace - deep workspace context with file contents
  if (/#workspace\b/.test(text)) {
    const wsContext = await buildWorkspaceContext();
    if (wsContext) {
      mentions.push({
        type: 'workspace',
        raw: '#workspace',
        content: wsContext,
        label: 'Workspace',
      });
    }
    cleanText = cleanText.replace(/#workspace\b/g, '');
  }

  return { cleanText: cleanText.trim(), mentions };
}

async function resolveFileMention(filePart: string): Promise<{ content: string; label: string } | null> {
  // Parse optional line range: file.ts:10-20
  const lineMatch = filePart.match(/^(.+?):(\d+)(?:-(\d+))?$/);
  const filePath = lineMatch ? lineMatch[1] : filePart;
  const startLine = lineMatch ? parseInt(lineMatch[2]) : undefined;
  const endLine = lineMatch ? (lineMatch[3] ? parseInt(lineMatch[3]) : startLine) : undefined;

  // Try to find the file
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;

  for (const folder of workspaceFolders) {
    const fullPath = path.join(folder.uri.fsPath, filePath);
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lang = guessLanguage(filePath);

        if (startLine !== undefined && endLine !== undefined) {
          const lines = content.split('\n');
          const slice = lines.slice(startLine - 1, endLine).join('\n');
          const label = `${filePath}:${startLine}-${endLine}`;
          return {
            content: `File ${label}:\n\`\`\`${lang}\n${slice}\n\`\`\``,
            label,
          };
        }

        // Full file (truncated at 8000 chars)
        const truncated = content.length > 8000
          ? content.slice(0, 8000) + '\n// ... (truncated)'
          : content;
        return {
          content: `File ${filePath}:\n\`\`\`${lang}\n${truncated}\n\`\`\``,
          label: filePath,
        };
      }
    } catch { /* skip */ }
  }

  // Try glob search
  const found = await vscode.workspace.findFiles(`**/${filePath}`, '**/node_modules/**', 1);
  if (found.length > 0) {
    const doc = await vscode.workspace.openTextDocument(found[0]);
    const content = doc.getText();
    const truncated = content.length > 8000
      ? content.slice(0, 8000) + '\n// ... (truncated)'
      : content;
    return {
      content: `File ${filePath}:\n\`\`\`${doc.languageId}\n${truncated}\n\`\`\``,
      label: vscode.workspace.asRelativePath(found[0]),
    };
  }

  return null;
}

async function buildCodebaseSummary(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;

  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx,js,jsx,py,go,rs,java,cs,cpp,c,h,vue,svelte,rb,php}',
    '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/vendor/**}',
    200,
  );

  if (files.length === 0) return null;

  const tree: Record<string, string[]> = {};
  for (const f of files) {
    const rel = vscode.workspace.asRelativePath(f);
    const dir = path.dirname(rel);
    (tree[dir] ??= []).push(path.basename(rel));
  }

  const lines = ['Workspace file structure:'];
  const sortedDirs = Object.keys(tree).sort();
  for (const dir of sortedDirs.slice(0, 50)) {
    lines.push(`  ${dir}/`);
    for (const file of tree[dir].slice(0, 10)) {
      lines.push(`    ${file}`);
    }
    if (tree[dir].length > 10) {
      lines.push(`    ... and ${tree[dir].length - 10} more`);
    }
  }
  if (sortedDirs.length > 50) {
    lines.push(`  ... and ${sortedDirs.length - 50} more directories`);
  }

  return lines.join('\n');
}

/**
 * Build deep workspace context: file tree + contents of key files.
 * Reads up to 30 source files, each truncated at 3000 chars, capped at ~80K total chars.
 */
async function buildWorkspaceContext(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;

  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx,js,jsx,py,go,rs,java,cs,cpp,c,h,vue,svelte,rb,php,md,json,yaml,yml,toml}',
    '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/vendor/**,**/.next/**,**/out/**,**/__pycache__/**,**/target/**}',
    200,
  );

  if (files.length === 0) return null;

  // Build file tree first
  const tree: Record<string, string[]> = {};
  for (const f of files) {
    const rel = vscode.workspace.asRelativePath(f);
    const dir = path.dirname(rel);
    (tree[dir] ??= []).push(path.basename(rel));
  }

  const parts: string[] = ['# Workspace Context\n'];

  // File structure
  parts.push('## File Structure\n```');
  const sortedDirs = Object.keys(tree).sort();
  for (const dir of sortedDirs.slice(0, 50)) {
    parts.push(`  ${dir}/`);
    for (const file of tree[dir].slice(0, 15)) {
      parts.push(`    ${file}`);
    }
    if (tree[dir].length > 15) {
      parts.push(`    ... and ${tree[dir].length - 15} more`);
    }
  }
  parts.push('```\n');

  // Prioritize key files: config, entry points, README, then source files by size
  const priorityPatterns = [
    /package\.json$/i, /tsconfig\.json$/i, /cargo\.toml$/i, /go\.mod$/i,
    /readme\.md$/i, /claude\.md$/i,
    /^src\/(index|main|app|extension)\./i,
  ];

  const scored = files.map(f => {
    const rel = vscode.workspace.asRelativePath(f);
    let score = 0;
    for (let p = 0; p < priorityPatterns.length; p++) {
      if (priorityPatterns[p].test(rel)) { score = 100 - p; break; }
    }
    // Prefer src/ files over nested/deep files
    const depth = rel.split(/[/\\]/).length;
    score += Math.max(0, 10 - depth);
    return { uri: f, rel, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Read up to 30 files, max ~80K total chars
  const MAX_FILES = 30;
  const MAX_FILE_CHARS = 3000;
  const MAX_TOTAL_CHARS = 80_000;
  let totalChars = parts.join('\n').length;

  parts.push('## File Contents\n');

  let filesRead = 0;
  for (const { uri, rel } of scored) {
    if (filesRead >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) break;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const content = doc.getText();
      if (!content.trim()) continue;
      const lang = doc.languageId;
      const truncated = content.length > MAX_FILE_CHARS
        ? content.slice(0, MAX_FILE_CHARS) + '\n// ... (truncated)'
        : content;
      const block = `### ${rel}\n\`\`\`${lang}\n${truncated}\n\`\`\`\n`;
      totalChars += block.length;
      parts.push(block);
      filesRead++;
    } catch { /* skip unreadable files */ }
  }

  if (filesRead === 0) return null;

  parts.push(`\n(${filesRead} of ${files.length} files included)`);
  return parts.join('\n');
}

function guessLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescriptreact',
    '.js': 'javascript', '.jsx': 'javascriptreact',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.cs': 'csharp',
    '.cpp': 'cpp', '.c': 'c', '.h': 'c',
    '.vue': 'vue', '.svelte': 'svelte',
    '.rb': 'ruby', '.php': 'php',
    '.md': 'markdown', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.html': 'html', '.css': 'css', '.scss': 'scss',
  };
  return map[ext] ?? '';
}
