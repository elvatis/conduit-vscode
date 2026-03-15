import { describe, it, expect, beforeEach } from 'vitest';
import { AgentParser, resetParserId } from '../agent-parser';
import type { ToolCall } from '../agent-types';

describe('AgentParser', () => {
  let textChunks: string[];
  let toolCalls: ToolCall[];
  let parser: AgentParser;

  beforeEach(() => {
    resetParserId();
    textChunks = [];
    toolCalls = [];
    parser = new AgentParser(
      (text) => textChunks.push(text),
      (call) => toolCalls.push(call),
    );
  });

  function fullText(): string {
    return textChunks.join('');
  }

  // ── Basic text passthrough ──────────────────────────────────────────────

  it('passes plain text through unchanged', () => {
    parser.feed('Hello world');
    parser.flush();
    expect(fullText()).toBe('Hello world');
    expect(toolCalls).toHaveLength(0);
  });

  it('passes multi-chunk text through', () => {
    parser.feed('Hello ');
    parser.feed('world');
    parser.flush();
    expect(fullText()).toBe('Hello world');
  });

  // ── Single tool call ────────────────────────────────────────────────────

  it('detects a single tool call', () => {
    parser.feed('<tool_call><name>readFile</name><args>{"path": "src/foo.ts"}</args></tool_call>');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('readFile');
    expect(toolCalls[0].args).toEqual({ path: 'src/foo.ts' });
    expect(toolCalls[0].permission).toBe('safe');
    expect(toolCalls[0].id).toBe('tc_1');
    expect(fullText()).toBe('');
  });

  it('extracts text before and after a tool call', () => {
    parser.feed('Let me read that file.\n<tool_call><name>readFile</name><args>{"path": "x.ts"}</args></tool_call>\nDone.');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(fullText()).toBe('Let me read that file.\n\nDone.');
  });

  // ── Destructive permission ──────────────────────────────────────────────

  it('marks writeFile as destructive', () => {
    parser.feed('<tool_call><name>writeFile</name><args>{"path": "x.ts", "content": "hi"}</args></tool_call>');
    parser.flush();
    expect(toolCalls[0].permission).toBe('destructive');
  });

  it('marks runCommand as destructive', () => {
    parser.feed('<tool_call><name>runCommand</name><args>{"command": "npm test"}</args></tool_call>');
    parser.flush();
    expect(toolCalls[0].permission).toBe('destructive');
  });

  it('marks applyDiff as destructive', () => {
    parser.feed('<tool_call><name>applyDiff</name><args>{"path": "x", "search": "a", "replace": "b"}</args></tool_call>');
    parser.flush();
    expect(toolCalls[0].permission).toBe('destructive');
  });

  it('marks readFile as safe', () => {
    parser.feed('<tool_call><name>readFile</name><args>{}</args></tool_call>');
    parser.flush();
    expect(toolCalls[0].permission).toBe('safe');
  });

  it('marks listFiles as safe', () => {
    parser.feed('<tool_call><name>listFiles</name><args>{}</args></tool_call>');
    parser.flush();
    expect(toolCalls[0].permission).toBe('safe');
  });

  it('marks searchCode as safe', () => {
    parser.feed('<tool_call><name>searchCode</name><args>{}</args></tool_call>');
    parser.flush();
    expect(toolCalls[0].permission).toBe('safe');
  });

  // ── Multiple tool calls ─────────────────────────────────────────────────

  it('detects multiple tool calls in one chunk', () => {
    parser.feed(
      'Step 1:\n<tool_call><name>readFile</name><args>{"path": "a.ts"}</args></tool_call>' +
      '\nStep 2:\n<tool_call><name>writeFile</name><args>{"path": "b.ts", "content": "x"}</args></tool_call>',
    );
    parser.flush();
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].name).toBe('readFile');
    expect(toolCalls[0].id).toBe('tc_1');
    expect(toolCalls[1].name).toBe('writeFile');
    expect(toolCalls[1].id).toBe('tc_2');
    expect(fullText()).toBe('Step 1:\n\nStep 2:\n');
  });

  // ── Streaming across chunk boundaries ───────────────────────────────────

  it('handles open tag split across chunks', () => {
    parser.feed('Text before <tool');
    parser.feed('_call><name>readFile</name><args>{}</args></tool_call> after');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('readFile');
    expect(fullText()).toBe('Text before  after');
  });

  it('handles close tag split across chunks', () => {
    parser.feed('<tool_call><name>readFile</name><args>{}</args></tool');
    parser.feed('_call>done');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(fullText()).toBe('done');
  });

  it('handles args split across multiple chunks', () => {
    parser.feed('<tool_call><name>read');
    parser.feed('File</name><args>{"pa');
    parser.feed('th": "src/index.ts"}</ar');
    parser.feed('gs></tool_call>');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('readFile');
    expect(toolCalls[0].args).toEqual({ path: 'src/index.ts' });
  });

  // ── Fenced code blocks ─────────────────────────────────────────────────

  it('ignores tool_call inside fenced code blocks', () => {
    parser.feed('```\n<tool_call><name>readFile</name><args>{}</args></tool_call>\n```');
    parser.flush();
    expect(toolCalls).toHaveLength(0);
    expect(fullText()).toContain('<tool_call>');
  });

  it('detects tool_call after fenced code block ends', () => {
    parser.feed('```\nsome code\n```\n<tool_call><name>readFile</name><args>{}</args></tool_call>');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
  });

  // ── Malformed input ─────────────────────────────────────────────────────

  it('flushes unclosed tool_call as text', () => {
    parser.feed('<tool_call><name>readFile</name><args>{}</args>');
    // No closing tag
    parser.flush();
    expect(toolCalls).toHaveLength(0);
    expect(fullText()).toContain('<tool_call>');
    expect(fullText()).toContain('readFile');
  });

  it('flushes tool_call without name as text', () => {
    parser.feed('<tool_call><args>{}</args></tool_call>');
    parser.flush();
    expect(toolCalls).toHaveLength(0);
    expect(fullText()).toContain('<tool_call>');
  });

  it('handles invalid JSON in args gracefully', () => {
    parser.feed('<tool_call><name>readFile</name><args>not json</args></tool_call>');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('readFile');
    expect(toolCalls[0].args).toEqual({ _raw: 'not json' });
  });

  it('handles tool_call with no args', () => {
    parser.feed('<tool_call><name>readDiagnostics</name></tool_call>');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('readDiagnostics');
    expect(toolCalls[0].args).toEqual({});
  });

  // ── Safety limit ────────────────────────────────────────────────────────

  it('flushes buffer when safety limit is exceeded', () => {
    const longContent = 'x'.repeat(11_000);
    parser.feed(`<tool_call>${longContent}`);
    parser.flush();
    expect(toolCalls).toHaveLength(0);
    expect(fullText()).toContain(longContent);
  });

  // ── Reset ───────────────────────────────────────────────────────────────

  it('reset clears state for new iteration', () => {
    parser.feed('<tool_call><name>readFile</name><args>{}</args></tool_call>');
    expect(toolCalls).toHaveLength(1);

    parser.reset();
    expect(parser.toolCalls).toHaveLength(0);

    parser.feed('<tool_call><name>writeFile</name><args>{}</args></tool_call>');
    parser.flush();
    expect(parser.toolCalls).toHaveLength(1);
    expect(parser.toolCalls[0].name).toBe('writeFile');
  });

  // ── Angle brackets that are not tool calls ──────────────────────────────

  it('passes through non-tool XML tags as text', () => {
    parser.feed('Use <div> for containers and <span> for inline.');
    parser.flush();
    expect(toolCalls).toHaveLength(0);
    expect(fullText()).toBe('Use <div> for containers and <span> for inline.');
  });

  it('passes through partial < at end of chunk', () => {
    parser.feed('value <');
    parser.feed('5 is true');
    parser.flush();
    expect(fullText()).toBe('value <5 is true');
  });

  // ── Whitespace handling ─────────────────────────────────────────────────

  it('handles whitespace inside tool_call tags', () => {
    parser.feed('<tool_call>\n  <name> readFile </name>\n  <args>{"path": "x"}</args>\n</tool_call>');
    parser.flush();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('readFile');
    expect(toolCalls[0].args).toEqual({ path: 'x' });
  });
});
