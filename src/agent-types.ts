/**
 * Shared type definitions for the multi-turn agent loop system.
 */

export interface ToolCall {
  /** Unique ID for this tool call (e.g. "tc_1", "tc_2") */
  id: string;
  /** Tool name (e.g. "readFile", "writeFile") */
  name: string;
  /** Parsed JSON arguments */
  args: Record<string, unknown>;
  /** Whether this tool requires user confirmation */
  permission: 'safe' | 'destructive';
}

export interface ToolResult {
  /** Matches the ToolCall id */
  id: string;
  /** Tool name */
  name: string;
  /** Execution outcome */
  status: 'success' | 'error' | 'denied';
  /** Output text (file contents, command output, error message, etc.) */
  output: string;
}

export type AgentState =
  | 'idle'
  | 'streaming'
  | 'parsing-tool'
  | 'awaiting-confirmation'
  | 'executing-tool'
  | 'complete'
  | 'error'
  | 'aborted';

export interface ToolDefinition {
  name: string;
  description: string;
  permission: 'safe' | 'destructive';
  args: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface AgentLoopCallbacks {
  /** Called for each display text chunk (forwarded to webview) */
  onChunk: (delta: string) => void;
  /** Called when a tool call is detected in the stream */
  onToolCall: (call: ToolCall) => void;
  /** Called after a tool is executed */
  onToolResult: (result: ToolResult) => void;
  /** Called at the start of each iteration */
  onIteration: (current: number, max: number) => void;
  /** Called when the agent loop finishes successfully */
  onComplete: (fullResponse: string, iterations: number) => void;
  /** Called on unrecoverable error */
  onError: (error: string) => void;
  /** Called to get user confirmation for destructive tools. Resolves true=approved, false=denied */
  confirmDestructive: (call: ToolCall) => Promise<boolean>;
}

export interface AgentLoopOptions extends AgentLoopCallbacks {
  model: string;
  systemPrompt: string;
  userMessage: string;
  history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxIterations: number;
}
