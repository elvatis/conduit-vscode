import { stream } from './proxy-client';
import { AgentParser } from './agent-parser';
import { executeTool } from './agent-tools';
import { trimHistoryForModel } from './model-registry';
import type { ToolCall, ToolResult, AgentLoopOptions } from './agent-types';

/**
 * Multi-turn agent loop controller.
 *
 * Orchestrates the cycle: prompt model -> stream response -> detect tool calls
 * -> execute tools -> feed results back -> re-prompt until task is complete.
 *
 * The loop terminates when:
 * 1. The model produces a response with no <tool_call> tags (task complete)
 * 2. maxIterations is reached
 * 3. The user aborts via abort()
 * 4. An unrecoverable error occurs
 */
export class AgentLoop {
  private _opts: AgentLoopOptions;
  private _aborted = false;
  private _messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  private _iteration = 0;
  private _consecutiveErrors = 0;
  private _recentToolCalls: string[] = []; // track for duplicate detection

  constructor(opts: AgentLoopOptions) {
    this._opts = opts;
    this._messages = [
      { role: 'system', content: opts.systemPrompt },
      ...opts.history,
      { role: 'user', content: opts.userMessage },
    ];
  }

  /** Abort the loop after the current stream finishes */
  abort(): void {
    this._aborted = true;
  }

  /** Run the agent loop to completion */
  async run(): Promise<void> {
    let fullResponse = '';

    while (true) {
      this._iteration++;

      // ── Check termination conditions ──────────────────────────────────
      if (this._aborted) {
        this._opts.onComplete(fullResponse, this._iteration - 1);
        return;
      }

      if (this._iteration > this._opts.maxIterations) {
        this._opts.onError(
          `Agent reached maximum iterations (${this._opts.maxIterations}). ` +
          'Use agent mode again to continue where you left off.',
        );
        return;
      }

      this._opts.onIteration(this._iteration, this._opts.maxIterations);

      // ── Trim history to fit context window ────────────────────────────
      const trimmed = trimHistoryForModel(
        this._messages as Array<{ role: string; content: string }>,
        this._opts.model,
        8192, // higher reserve for tool-heavy responses
      );

      // ── Stream model response ─────────────────────────────────────────
      let iterationText = '';
      const toolCalls: ToolCall[] = [];

      const parser = new AgentParser(
        (text) => {
          iterationText += text;
          this._opts.onChunk(text);
        },
        (call) => {
          toolCalls.push(call);
        },
      );

      try {
        for await (const chunk of stream({
          messages: trimmed as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
          model: this._opts.model,
        })) {
          if (chunk.done) break;
          if (this._aborted) break;
          parser.feed(chunk.delta);
        }
        parser.flush();
      } catch (err) {
        this._opts.onError(`Stream error: ${(err as Error).message}`);
        return;
      }

      // ── Handle abort during stream ────────────────────────────────────
      if (this._aborted) {
        fullResponse += iterationText;
        this._opts.onComplete(fullResponse, this._iteration);
        return;
      }

      // ── Handle empty response ─────────────────────────────────────────
      if (!iterationText.trim() && toolCalls.length === 0) {
        if (this._iteration === 1) {
          // First iteration empty - nudge the model
          this._messages.push({
            role: 'user',
            content: 'Your previous response was empty. Please continue with the task or explain what you need.',
          });
          continue;
        }
        // Later iteration empty - treat as completion
        this._opts.onComplete(fullResponse, this._iteration);
        return;
      }

      fullResponse += iterationText;

      // ── No tool calls = task complete ──────────────────────────────────
      if (toolCalls.length === 0) {
        this._opts.onComplete(fullResponse, this._iteration);
        return;
      }

      // ── Append assistant message with text + tool calls ────────────────
      this._messages.push({ role: 'assistant', content: iterationText });

      // ── Execute each tool call ────────────────────────────────────────
      let allDenied = true;
      for (const call of toolCalls) {
        // Check for duplicate tool calls (same name + args 3 times)
        const callKey = `${call.name}:${JSON.stringify(call.args)}`;
        this._recentToolCalls.push(callKey);
        if (this._recentToolCalls.length > 10) this._recentToolCalls.shift();

        const duplicateCount = this._recentToolCalls.filter(k => k === callKey).length;
        if (duplicateCount >= 3) {
          const warnResult: ToolResult = {
            id: call.id,
            name: call.name,
            status: 'error',
            output: 'You have called this tool with the same arguments multiple times. Please try a different approach.',
          };
          this._opts.onToolCall(call);
          this._opts.onToolResult(warnResult);
          this._appendToolResult(warnResult);
          continue;
        }

        this._opts.onToolCall(call);

        // Confirmation for destructive tools
        if (call.permission === 'destructive') {
          const approved = await this._opts.confirmDestructive(call);
          if (!approved) {
            const deniedResult: ToolResult = {
              id: call.id,
              name: call.name,
              status: 'denied',
              output: 'User denied this tool call. Try an alternative approach or ask the user for guidance.',
            };
            this._opts.onToolResult(deniedResult);
            this._appendToolResult(deniedResult);
            continue;
          }
        }

        allDenied = false;

        // Execute the tool
        const result = await executeTool(call);
        this._opts.onToolResult(result);
        this._appendToolResult(result);

        // Track consecutive errors
        if (result.status === 'error') {
          this._consecutiveErrors++;
          if (this._consecutiveErrors >= 3) {
            this._messages.push({
              role: 'user',
              content: 'Multiple tool calls have failed consecutively. Please reconsider your approach or explain what is going wrong.',
            });
            this._consecutiveErrors = 0;
          }
        } else {
          this._consecutiveErrors = 0;
        }
      }

      // If ALL tool calls were denied, let the model know
      if (allDenied && toolCalls.length > 0) {
        this._messages.push({
          role: 'user',
          content: 'All requested tool calls were denied by the user. Please provide an alternative approach or ask what the user would prefer.',
        });
      }

      // ── Compress old tool results to save context ─────────────────────
      this._compressOldToolResults();

      // Continue the loop - model will see tool results and continue
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _appendToolResult(result: ToolResult): void {
    const statusLabel = result.status === 'success' ? 'success'
      : result.status === 'denied' ? 'denied' : 'error';

    this._messages.push({
      role: 'user',
      content: `<tool_result>\n<name>${result.name}</name>\n<status>${statusLabel}</status>\n<output>${result.output}</output>\n</tool_result>`,
    });
  }

  /**
   * Compress tool results from older iterations to save context window.
   * Results from more than 2 iterations ago get summarized to a one-liner.
   */
  private _compressOldToolResults(): void {
    if (this._iteration < 3) return;

    // Find tool result messages (user messages containing <tool_result>)
    // Only compress early ones, keep the last 6 messages intact
    const keepRecent = 6;
    const compressibleEnd = this._messages.length - keepRecent;

    for (let i = 1; i < compressibleEnd; i++) {
      const msg = this._messages[i];
      if (msg.role !== 'user') continue;
      if (!msg.content.includes('<tool_result>')) continue;
      if (msg.content.length < 200) continue; // already compact

      // Extract name and status, compress output
      const nameMatch = msg.content.match(/<name>(.*?)<\/name>/);
      const statusMatch = msg.content.match(/<status>(.*?)<\/status>/);
      const name = nameMatch?.[1] ?? 'unknown';
      const status = statusMatch?.[1] ?? 'unknown';

      // Compress to summary
      const outputPreview = msg.content
        .match(/<output>([\s\S]*?)<\/output>/)?.[1]
        ?.slice(0, 80)
        ?.replace(/\n/g, ' ')
        ?? '';

      msg.content = `<tool_result>\n<name>${name}</name>\n<status>${status}</status>\n<output>[${name}: ${outputPreview}...]</output>\n</tool_result>`;
    }
  }
}
