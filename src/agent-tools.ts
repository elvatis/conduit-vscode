import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import type { ToolCall, ToolResult, ToolDefinition } from './agent-types';

// ── Tool catalog ──────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'readFile',
    description: 'Read a file from the workspace',
    permission: 'safe',
    args: {
      path: { type: 'string', description: 'Relative path from workspace root', required: true },
      startLine: { type: 'number', description: 'Start line (1-based, optional)' },
      endLine: { type: 'number', description: 'End line (1-based, optional)' },
    },
  },
  {
    name: 'writeFile',
    description: 'Create or overwrite a file (requires user approval)',
    permission: 'destructive',
    args: {
      path: { type: 'string', description: 'Relative path from workspace root', required: true },
      content: { type: 'string', description: 'File content to write', required: true },
    },
  },
  {
    name: 'listFiles',
    description: 'List files matching a glob pattern',
    permission: 'safe',
    args: {
      directory: { type: 'string', description: 'Directory to search in (default: workspace root)' },
      pattern: { type: 'string', description: 'Glob pattern (default: **/*.*)' },
    },
  },
  {
    name: 'searchCode',
    description: 'Search for a regex pattern across workspace files',
    permission: 'safe',
    args: {
      pattern: { type: 'string', description: 'Regex pattern to search for', required: true },
      filePattern: { type: 'string', description: 'Glob to filter files (default: **/*.*)' },
      maxResults: { type: 'number', description: 'Max results (default: 20)' },
    },
  },
  {
    name: 'runCommand',
    description: 'Execute a shell command (requires user approval)',
    permission: 'destructive',
    args: {
      command: { type: 'string', description: 'Shell command to execute', required: true },
      cwd: { type: 'string', description: 'Working directory (relative, default: workspace root)' },
    },
  },
  {
    name: 'readDiagnostics',
    description: 'Read VS Code errors and warnings',
    permission: 'safe',
    args: {
      path: { type: 'string', description: 'File path (optional - all files if omitted)' },
    },
  },
  {
    name: 'applyDiff',
    description: 'Search-and-replace within a file (requires user approval)',
    permission: 'destructive',
    args: {
      path: { type: 'string', description: 'Relative path from workspace root', required: true },
      search: { type: 'string', description: 'Exact text to find', required: true },
      replace: { type: 'string', description: 'Text to replace with', required: true },
    },
  },
];

// ── Size limits ───────────────────────────────────────────────────────────────

const MAX_READ_CHARS = 12_000;
const MAX_SEARCH_CHARS = 5_000;
const MAX_COMMAND_CHARS = 3_000;
const MAX_LIST_CHARS = 2_000;
const COMMAND_TIMEOUT_MS = 30_000;

// ── Workspace root ────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath ?? null;
}

function resolveSafe(root: string, relativePath: string): string | null {
  const resolved = path.resolve(root, relativePath);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(path.normalize(root))) {
    return null; // path escape attempt
  }
  return normalized;
}

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const base = { id: call.id, name: call.name };

  try {
    switch (call.name) {
      case 'readFile':     return { ...base, ...(await toolReadFile(call.args)) };
      case 'writeFile':    return { ...base, ...(await toolWriteFile(call.args)) };
      case 'listFiles':    return { ...base, ...(await toolListFiles(call.args)) };
      case 'searchCode':   return { ...base, ...(await toolSearchCode(call.args)) };
      case 'runCommand':   return { ...base, ...(await toolRunCommand(call.args)) };
      case 'readDiagnostics': return { ...base, ...(await toolReadDiagnostics(call.args)) };
      case 'applyDiff':    return { ...base, ...(await toolApplyDiff(call.args)) };
      default:
        return { ...base, status: 'error', output: `Unknown tool: ${call.name}` };
    }
  } catch (err) {
    return { ...base, status: 'error', output: `Tool error: ${(err as Error).message}` };
  }
}

// ── Individual tool implementations ───────────────────────────────────────────

async function toolReadFile(args: Record<string, unknown>): Promise<{ status: 'success' | 'error'; output: string }> {
  const root = getWorkspaceRoot();
  if (!root) return { status: 'error', output: 'No workspace folder open' };

  const filePath = args.path as string;
  if (!filePath) return { status: 'error', output: 'Missing required arg: path' };

  const fullPath = resolveSafe(root, filePath);
  if (!fullPath) return { status: 'error', output: 'Path escapes workspace root' };

  if (!fs.existsSync(fullPath)) return { status: 'error', output: `File not found: ${filePath}` };

  const content = fs.readFileSync(fullPath, 'utf-8');
  const startLine = args.startLine as number | undefined;
  const endLine = args.endLine as number | undefined;

  let result: string;
  if (startLine !== undefined && endLine !== undefined) {
    const lines = content.split('\n');
    result = lines.slice(startLine - 1, endLine).join('\n');
  } else {
    result = content;
  }

  if (result.length > MAX_READ_CHARS) {
    result = result.slice(0, MAX_READ_CHARS) + '\n// ... (truncated)';
  }

  return { status: 'success', output: result };
}

async function toolWriteFile(args: Record<string, unknown>): Promise<{ status: 'success' | 'error'; output: string }> {
  const root = getWorkspaceRoot();
  if (!root) return { status: 'error', output: 'No workspace folder open' };

  const filePath = args.path as string;
  const content = args.content as string;
  if (!filePath) return { status: 'error', output: 'Missing required arg: path' };
  if (content === undefined) return { status: 'error', output: 'Missing required arg: content' };

  const fullPath = resolveSafe(root, filePath);
  if (!fullPath) return { status: 'error', output: 'Path escapes workspace root' };

  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });

  const existed = fs.existsSync(fullPath);
  const oldLines = existed ? fs.readFileSync(fullPath, 'utf-8').split('\n').length : 0;
  fs.writeFileSync(fullPath, content, 'utf-8');
  const newLines = content.split('\n').length;

  const action = existed ? 'Updated' : 'Created';
  return {
    status: 'success',
    output: `${action} ${filePath} (${newLines} lines${existed ? `, was ${oldLines} lines` : ''})`,
  };
}

async function toolListFiles(args: Record<string, unknown>): Promise<{ status: 'success' | 'error'; output: string }> {
  const pattern = (args.pattern as string) || '**/*.*';
  const directory = (args.directory as string) || '';

  const fullPattern = directory ? `${directory}/${pattern}` : pattern;
  const excludes = '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/vendor/**,**/.next/**,**/out/**}';

  const files = await vscode.workspace.findFiles(fullPattern, excludes, 100);
  const paths = files.map(f => vscode.workspace.asRelativePath(f)).sort();

  let output = paths.join('\n');
  if (output.length > MAX_LIST_CHARS) {
    output = output.slice(0, MAX_LIST_CHARS) + '\n... (truncated)';
  }

  return { status: 'success', output: output || '(no files found)' };
}

async function toolSearchCode(args: Record<string, unknown>): Promise<{ status: 'success' | 'error'; output: string }> {
  const root = getWorkspaceRoot();
  if (!root) return { status: 'error', output: 'No workspace folder open' };

  const pattern = args.pattern as string;
  if (!pattern) return { status: 'error', output: 'Missing required arg: pattern' };

  const filePattern = (args.filePattern as string) || '**/*.{ts,tsx,js,jsx,py,go,rs,java,cs,cpp,c,h}';
  const maxResults = (args.maxResults as number) || 20;
  const excludes = '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}';

  const files = await vscode.workspace.findFiles(filePattern, excludes, 200);
  const regex = new RegExp(pattern, 'gm');

  const matches: string[] = [];
  for (const uri of files) {
    if (matches.length >= maxResults) break;
    try {
      const fullPath = uri.fsPath;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const rel = vscode.workspace.asRelativePath(uri);
          matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
          if (matches.length >= maxResults) break;
        }
        regex.lastIndex = 0; // reset for next line
      }
    } catch { /* skip unreadable files */ }
  }

  let output = matches.join('\n');
  if (output.length > MAX_SEARCH_CHARS) {
    output = output.slice(0, MAX_SEARCH_CHARS) + '\n... (truncated)';
  }

  return { status: 'success', output: output || `No matches for pattern: ${pattern}` };
}

async function toolRunCommand(args: Record<string, unknown>): Promise<{ status: 'success' | 'error'; output: string }> {
  const root = getWorkspaceRoot();
  if (!root) return { status: 'error', output: 'No workspace folder open' };

  const command = args.command as string;
  if (!command) return { status: 'error', output: 'Missing required arg: command' };

  const cwdRel = (args.cwd as string) || '';
  const cwd = cwdRel ? resolveSafe(root, cwdRel) : root;
  if (!cwd) return { status: 'error', output: 'Working directory escapes workspace root' };

  return new Promise((resolve) => {
    cp.exec(command, { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr;
      if (!output) output = err ? err.message : '(no output)';

      if (output.length > MAX_COMMAND_CHARS) {
        output = output.slice(0, MAX_COMMAND_CHARS) + '\n... (truncated)';
      }

      const exitCode = err && 'code' in err ? (err as { code: number }).code : 0;
      resolve({
        status: exitCode === 0 || !err ? 'success' : 'error',
        output: exitCode !== 0 ? `Exit code ${exitCode}\n${output}` : output,
      });
    });
  });
}

async function toolReadDiagnostics(args: Record<string, unknown>): Promise<{ status: 'success' | 'error'; output: string }> {
  const filePath = args.path as string | undefined;
  let diagnostics: [vscode.Uri, vscode.Diagnostic[]][];

  if (filePath) {
    const root = getWorkspaceRoot();
    if (!root) return { status: 'error', output: 'No workspace folder open' };

    const fullPath = resolveSafe(root, filePath);
    if (!fullPath) return { status: 'error', output: 'Path escapes workspace root' };

    const uri = vscode.Uri.file(fullPath);
    const diags = vscode.languages.getDiagnostics(uri);
    diagnostics = diags.length > 0 ? [[uri, diags]] : [];
  } else {
    diagnostics = vscode.languages.getDiagnostics()
      .filter(([, diags]) => diags.length > 0);
  }

  if (diagnostics.length === 0) {
    return { status: 'success', output: 'No diagnostics found' };
  }

  const lines: string[] = [];
  for (const [uri, diags] of diagnostics) {
    const rel = vscode.workspace.asRelativePath(uri);
    for (const d of diags.slice(0, 30)) {
      const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'error'
        : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info';
      lines.push(`${rel}:${d.range.start.line + 1}: [${severity}] ${d.message}`);
    }
  }

  return { status: 'success', output: lines.join('\n') };
}

async function toolApplyDiff(args: Record<string, unknown>): Promise<{ status: 'success' | 'error'; output: string }> {
  const root = getWorkspaceRoot();
  if (!root) return { status: 'error', output: 'No workspace folder open' };

  const filePath = args.path as string;
  const search = args.search as string;
  const replace = args.replace as string;
  if (!filePath) return { status: 'error', output: 'Missing required arg: path' };
  if (search === undefined) return { status: 'error', output: 'Missing required arg: search' };
  if (replace === undefined) return { status: 'error', output: 'Missing required arg: replace' };

  const fullPath = resolveSafe(root, filePath);
  if (!fullPath) return { status: 'error', output: 'Path escapes workspace root' };
  if (!fs.existsSync(fullPath)) return { status: 'error', output: `File not found: ${filePath}` };

  const content = fs.readFileSync(fullPath, 'utf-8');
  if (!content.includes(search)) {
    return { status: 'error', output: `Search string not found in ${filePath}. Make sure it matches exactly.` };
  }

  const updated = content.replace(search, replace);
  fs.writeFileSync(fullPath, updated, 'utf-8');

  const searchLines = search.split('\n').length;
  const replaceLines = replace.split('\n').length;
  return {
    status: 'success',
    output: `Applied diff to ${filePath}: replaced ${searchLines} lines with ${replaceLines} lines`,
  };
}

// ── Tool prompt builder ───────────────────────────────────────────────────────

export function buildToolCatalogPrompt(): string {
  const lines: string[] = [];
  for (const tool of TOOL_DEFINITIONS) {
    const argsDesc = Object.entries(tool.args)
      .map(([name, a]) => `  "${name}": ${a.type}${a.required ? ' (required)' : ''} - ${a.description}`)
      .join('\n');
    const approval = tool.permission === 'destructive' ? ' (requires user approval)' : '';
    lines.push(`- **${tool.name}**: ${tool.description}${approval}\n  Args:\n${argsDesc}`);
  }
  return lines.join('\n\n');
}
