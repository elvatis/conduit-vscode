/**
 * Shared utilities used across the extension.
 * Keep this module free of vscode imports so it can be used in tests without mocking.
 */

/**
 * Extract the provider prefix from a model ID.
 * e.g. "cli-claude/claude-opus-5" -> "cli-claude"
 */
export function extractProvider(modelId: string): string {
  if (!modelId) return 'unknown';
  const idx = modelId.indexOf('/');
  return idx > 0 ? modelId.slice(0, idx) : 'unknown';
}

/**
 * Extract the short model name (after the slash) from a model ID.
 * e.g. "cli-claude/claude-opus-5" -> "claude-opus-5"
 */
export function shortModelName(modelId: string): string {
  if (!modelId) return 'unknown';
  const idx = modelId.indexOf('/');
  return idx > 0 ? modelId.slice(idx + 1) : modelId;
}

/**
 * Strip markdown fenced code block wrappers from a string.
 * Handles any language hint format (```typescript, ```js, etc.)
 */
export function stripFences(text: string): string {
  return text
    .replace(/^```[^\n]*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trimEnd();
}
