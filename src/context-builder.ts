import * as vscode from 'vscode';
import { getConfig } from './config';
import { buildToolCatalogPrompt } from './agent-tools';

export interface EditorContext {
  language: string;
  fileName: string;
  prefix: string;       // code before cursor
  suffix: string;       // code after cursor
  selection: string;    // currently selected text (may be empty)
  fullFile: string;     // full file content (truncated if large)
  openFiles: Array<{ fileName: string; language: string; content: string }>;
  diagnostics: string;  // active errors/warnings in current file
  workspaceName: string;
}

const MAX_FILE_CHARS = 12000;
const MAX_OPEN_FILE_CHARS = 4000;

export function buildEditorContext(editor?: vscode.TextEditor): EditorContext | null {
  const cfg = getConfig();
  const activeEditor = editor ?? vscode.window.activeTextEditor;
  if (!activeEditor) return null;

  const doc = activeEditor.document;
  const cursor = activeEditor.selection.active;
  const selection = activeEditor.selection;

  // Prefix/suffix around cursor (contextLines above + below)
  const startLine = Math.max(0, cursor.line - cfg.contextLines);
  const endLine = Math.min(doc.lineCount - 1, cursor.line + cfg.contextLines);
  const prefix = doc.getText(new vscode.Range(startLine, 0, cursor.line, cursor.character));
  const suffix = doc.getText(new vscode.Range(cursor.line, cursor.character, endLine, doc.lineAt(endLine).text.length));

  // Full file (truncated)
  const fullText = doc.getText();
  const fullFile = fullText.length > MAX_FILE_CHARS
    ? fullText.slice(0, MAX_FILE_CHARS) + '\n// ... (truncated)'
    : fullText;

  // Selected text
  const selectedText = selection.isEmpty ? '' : doc.getText(selection);

  // Diagnostics in current file
  const diags = vscode.languages.getDiagnostics(doc.uri)
    .filter(d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning)
    .slice(0, 10)
    .map(d => `Line ${d.range.start.line + 1}: [${d.severity === 0 ? 'error' : 'warning'}] ${d.message}`)
    .join('\n');

  // Open files as context
  const openFiles: EditorContext['openFiles'] = [];
  if (cfg.includeOpenFiles) {
    const tabs = vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .filter(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() !== doc.uri.toString())
      .slice(0, cfg.maxOpenFilesContext);

    for (const tab of tabs) {
      if (!(tab.input instanceof vscode.TabInputText)) continue;
      const uri = tab.input.uri;
      const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (!openDoc) continue;
      const content = openDoc.getText();
      openFiles.push({
        fileName: vscode.workspace.asRelativePath(uri),
        language: openDoc.languageId,
        content: content.length > MAX_OPEN_FILE_CHARS
          ? content.slice(0, MAX_OPEN_FILE_CHARS) + '\n// ... (truncated)'
          : content,
      });
    }
  }

  return {
    language: doc.languageId,
    fileName: vscode.workspace.asRelativePath(doc.uri),
    prefix,
    suffix,
    selection: selectedText,
    fullFile,
    openFiles,
    diagnostics: diags,
    workspaceName: vscode.workspace.name ?? 'workspace',
  };
}

export function buildSystemPrompt(ctx: EditorContext): string {
  const parts: string[] = [
    `You are Conduit, an expert AI coding assistant integrated into VS Code.`,
    `Current file: ${ctx.fileName} (${ctx.language})`,
    `Workspace: ${ctx.workspaceName}`,
  ];

  if (ctx.diagnostics) {
    parts.push(`\nActive diagnostics:\n${ctx.diagnostics}`);
  }

  if (ctx.openFiles.length > 0) {
    parts.push(`\nOther open files for context:`);
    for (const f of ctx.openFiles) {
      parts.push(`--- ${f.fileName} (${f.language}) ---\n${f.content}`);
    }
  }

  parts.push(`\nRespond concisely. For code changes, return only the changed code block, no extra prose unless asked.`);
  return parts.join('\n');
}

export function buildAgentSystemPrompt(ctx: EditorContext | null): string {
  const toolCatalog = buildToolCatalogPrompt();

  const parts: string[] = [
    `You are Conduit, an autonomous AI coding agent integrated into VS Code.`,
    `You can read files, write files, search code, run commands, and apply diffs to complete tasks.`,
  ];

  if (ctx) {
    parts.push(`\nCurrent file: ${ctx.fileName} (${ctx.language})`);
    parts.push(`Workspace: ${ctx.workspaceName}`);
    if (ctx.diagnostics) {
      parts.push(`\nActive diagnostics:\n${ctx.diagnostics}`);
    }
  }

  parts.push(`
## Tool Usage

To use a tool, output a tool call in this exact XML format:

<tool_call>
<name>TOOL_NAME</name>
<args>{"key": "value"}</args>
</tool_call>

## Available Tools

${toolCatalog}

## Rules

1. Think step by step. Explain your reasoning before each tool call.
2. After receiving a tool result, analyze it and decide the next action.
3. You can make multiple tool calls in sequence within a single response.
4. When your task is complete, provide a summary of what you did. Do NOT output a tool call in your final message.
5. If a tool call fails, read the error, adjust your approach, and retry.
6. Always read a file before modifying it.
7. Prefer applyDiff over writeFile for targeted changes to existing files.
8. Use searchCode to find relevant code before making changes.
9. Structure your response using ### Step N: Title headings for each major action.

## Example

### Step 1: Read the file

Let me first read the file to understand the current code.

<tool_call>
<name>readFile</name>
<args>{"path": "src/utils.ts"}</args>
</tool_call>

### Step 2: Apply the change

Now I will update the function to handle the edge case.

<tool_call>
<name>applyDiff</name>
<args>{"path": "src/utils.ts", "search": "function old() {", "replace": "function new() {"}</args>
</tool_call>
`);

  return parts.join('\n');
}

const INLINE_HINTS: Record<string, string> = {
  typescript: 'Complete the TypeScript code naturally. Infer types where possible. Follow existing naming conventions.',
  javascript: 'Complete the JavaScript code naturally. Match the existing style (const vs let, arrow vs function).',
  typescriptreact: 'Complete the TSX code naturally. Infer types and close JSX tags properly.',
  javascriptreact: 'Complete the JSX code naturally. Close JSX tags properly.',
  python: 'Complete the Python code naturally. Match indentation style. Use type hints if the surrounding code does.',
  go: 'Complete the Go code naturally. Follow Go idioms (short variable names, error handling patterns).',
  rust: 'Complete the Rust code naturally. Respect ownership and borrowing patterns from context.',
  java: 'Complete the Java code naturally. Match the existing class and method style.',
  csharp: 'Complete the C# code naturally. Follow existing conventions for async/await and LINQ usage.',
  cpp: 'Complete the C++ code naturally. Match the existing style for pointers, references, and templates.',
  c: 'Complete the C code naturally. Match existing patterns for memory management and error handling.',
  markdown: 'Complete the sentence or paragraph naturally. Do not add code fences or formatting unless continuing an existing block.',
  plaintext: 'Complete the sentence or paragraph naturally.',
  html: 'Complete the HTML tag or structure. Close opened tags properly.',
  css: 'Complete the CSS property or rule block. Match existing formatting.',
  scss: 'Complete the SCSS property, rule, or mixin. Match existing formatting.',
  json: 'Complete the JSON structure. Ensure valid JSON syntax with proper commas and brackets.',
  yaml: 'Complete the YAML entry. Match indentation level precisely.',
};

const DEFAULT_INLINE_HINT = 'Complete the code at the cursor position naturally. Match the existing style.';

export function buildInlinePrompt(ctx: EditorContext): string {
  const langHint = INLINE_HINTS[ctx.language] ?? DEFAULT_INLINE_HINT;
  return [
    buildSystemPrompt(ctx),
    `\n${langHint}`,
    `\nReturn ONLY the completion text, nothing else. No markdown fences. No explanations.`,
    `\nCode before cursor:\n${ctx.prefix}`,
    ctx.suffix ? `\nCode after cursor:\n${ctx.suffix}` : '',
  ].filter(Boolean).join('\n');
}
