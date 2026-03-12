import * as vscode from 'vscode';
import { getConfig } from './config';

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

export function buildInlinePrompt(ctx: EditorContext): string {
  return [
    buildSystemPrompt(ctx),
    `\nComplete the code at the cursor position. Return ONLY the completion text, nothing else. No markdown fences.`,
    `\nCode before cursor:\n${ctx.prefix}`,
    ctx.suffix ? `\nCode after cursor:\n${ctx.suffix}` : '',
  ].filter(Boolean).join('\n');
}
