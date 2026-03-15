import type { ToolCall } from './agent-types';

/**
 * Incremental streaming parser that separates display text from <tool_call> XML blocks.
 *
 * Processes chunks from the SSE stream character-by-character. Text outside <tool_call>
 * tags is forwarded immediately to the onText callback. Text inside <tool_call> tags is
 * buffered and parsed into ToolCall objects when the closing tag is found.
 *
 * Handles:
 * - Partial tag detection across chunk boundaries
 * - Nested content within tool call blocks
 * - Malformed/unclosed tags (safety limit flushes buffer as text)
 * - Ignores <tool_call> inside triple-backtick fenced code blocks
 */

const OPEN_TAG = '<tool_call>';
const CLOSE_TAG = '</tool_call>';
const BUFFER_SAFETY_LIMIT = 10_000;

let _nextId = 0;

/** Permission classification for tools */
const DESTRUCTIVE_TOOLS = new Set(['writeFile', 'applyDiff', 'runCommand']);

export class AgentParser {
  private _state: 'text' | 'buffering' = 'text';
  private _buffer = '';
  private _lookahead = '';
  private _inFence = false;
  private _toolCalls: ToolCall[] = [];
  private _onText: (text: string) => void;
  private _onToolCall: (call: ToolCall) => void;

  constructor(
    onText: (text: string) => void,
    onToolCall: (call: ToolCall) => void,
  ) {
    this._onText = onText;
    this._onToolCall = onToolCall;
  }

  /** Process a streaming chunk */
  feed(chunk: string): void {
    // Prepend any leftover lookahead from the previous chunk
    const input = this._lookahead + chunk;
    this._lookahead = '';

    let i = 0;
    while (i < input.length) {
      if (this._state === 'text') {
        i = this._processText(input, i);
      } else {
        i = this._processBuffering(input, i);
      }
    }
  }

  /** Finalize parsing - flush any remaining buffer */
  flush(): void {
    if (this._lookahead) {
      this._onText(this._lookahead);
      this._lookahead = '';
    }
    if (this._state === 'buffering' && this._buffer) {
      // Unclosed tool_call - flush as regular text
      this._onText(OPEN_TAG + this._buffer);
      this._buffer = '';
      this._state = 'text';
    }
  }

  /** Get all tool calls detected so far */
  get toolCalls(): ToolCall[] {
    return this._toolCalls;
  }

  /** Reset for a new iteration */
  reset(): void {
    this._state = 'text';
    this._buffer = '';
    this._lookahead = '';
    this._inFence = false;
    this._toolCalls = [];
  }

  // ── Text state ──────────────────────────────────────────────────────────

  private _processText(input: string, start: number): number {
    let i = start;
    let textStart = i;

    while (i < input.length) {
      const ch = input[i];

      // Track fenced code blocks
      if (ch === '`' && input.slice(i, i + 3) === '```') {
        this._inFence = !this._inFence;
        i += 3;
        continue;
      }

      // Only look for <tool_call> outside fenced blocks
      if (!this._inFence && ch === '<') {
        const remaining = input.length - i;

        // Check if we have enough chars to match the full open tag
        if (remaining >= OPEN_TAG.length) {
          if (input.slice(i, i + OPEN_TAG.length) === OPEN_TAG) {
            // Emit any text before the tag
            if (i > textStart) {
              this._onText(input.slice(textStart, i));
            }
            this._state = 'buffering';
            this._buffer = '';
            return i + OPEN_TAG.length;
          }
        } else {
          // Partial match possible - check if what we have matches the start of OPEN_TAG
          const partial = input.slice(i);
          if (OPEN_TAG.startsWith(partial)) {
            // Could be a partial tag - hold in lookahead
            if (i > textStart) {
              this._onText(input.slice(textStart, i));
            }
            this._lookahead = partial;
            return input.length;
          }
        }
      }

      i++;
    }

    // Emit remaining text
    if (i > textStart) {
      this._onText(input.slice(textStart, i));
    }
    return i;
  }

  // ── Buffering state (inside <tool_call>) ────────────────────────────────

  private _processBuffering(input: string, start: number): number {
    let i = start;

    while (i < input.length) {
      const ch = input[i];

      if (ch === '<') {
        const remaining = input.length - i;

        if (remaining >= CLOSE_TAG.length) {
          if (input.slice(i, i + CLOSE_TAG.length) === CLOSE_TAG) {
            // Found closing tag - parse the buffered tool call
            this._emitToolCall(this._buffer);
            this._buffer = '';
            this._state = 'text';
            return i + CLOSE_TAG.length;
          }
        } else {
          // Could be partial close tag
          const partial = input.slice(i);
          if (CLOSE_TAG.startsWith(partial)) {
            this._lookahead = partial;
            return input.length;
          }
        }
      }

      this._buffer += ch;
      i++;

      // Safety limit - prevent unbounded buffering on malformed output
      if (this._buffer.length > BUFFER_SAFETY_LIMIT) {
        this._onText(OPEN_TAG + this._buffer);
        this._buffer = '';
        this._state = 'text';
        return i;
      }
    }

    return i;
  }

  // ── Tool call extraction ────────────────────────────────────────────────

  private _emitToolCall(raw: string): void {
    const nameMatch = raw.match(/<name>(.*?)<\/name>/s);
    const argsMatch = raw.match(/<args>([\s\S]*?)<\/args>/s);

    if (!nameMatch) {
      // Malformed - flush as text
      this._onText(OPEN_TAG + raw + CLOSE_TAG);
      return;
    }

    const name = nameMatch[1].trim();
    let args: Record<string, unknown> = {};

    if (argsMatch) {
      try {
        args = JSON.parse(argsMatch[1].trim());
      } catch {
        // Args not valid JSON - still emit the tool call with empty args
        args = { _raw: argsMatch[1].trim() };
      }
    }

    const id = `tc_${++_nextId}`;
    const permission = DESTRUCTIVE_TOOLS.has(name) ? 'destructive' : 'safe';
    const call: ToolCall = { id, name, args, permission };

    this._toolCalls.push(call);
    this._onToolCall(call);
  }
}

/** Reset the global ID counter (useful for tests) */
export function resetParserId(): void {
  _nextId = 0;
}
