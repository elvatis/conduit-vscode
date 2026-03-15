import { describe, it, expect } from 'vitest';
import { buildHandoffSummary, generateWorkingSummary } from '../chat-view-provider';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  timestamp?: number;
  tokenEstimate?: number;
}

// ── buildHandoffSummary ──────────────────────────────────────────────────────

describe('buildHandoffSummary', () => {
  it('returns empty string for < 2 messages', () => {
    expect(buildHandoffSummary([], 'web-claude/opus', 'web-grok/fast')).toBe('');
    expect(buildHandoffSummary([{ role: 'user', content: 'hi' }], 'a', 'b')).toBe('');
  });

  it('includes model handoff header with short names', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    const result = buildHandoffSummary(msgs, 'web-claude/claude-opus', 'web-grok/grok-fast');
    expect(result).toContain('switching from claude-opus to grok-fast');
  });

  it('includes message count', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ];
    const result = buildHandoffSummary(msgs, 'a/b', 'c/d');
    expect(result).toContain('4 messages');
  });

  it('truncates long assistant responses to 200 chars', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'A'.repeat(300) },
    ];
    const result = buildHandoffSummary(msgs, 'a/b', 'c/d');
    expect(result).toContain('A'.repeat(200) + '...');
    expect(result).not.toContain('A'.repeat(201));
  });

  it('truncates long user messages to 150 chars', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'U'.repeat(200) },
      { role: 'assistant', content: 'answer' },
    ];
    const result = buildHandoffSummary(msgs, 'a/b', 'c/d');
    expect(result).toContain('U'.repeat(150));
    expect(result).not.toContain('U'.repeat(151));
  });

  it('collects at most 3 conversation pairs', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'user', content: `question ${i}` });
      msgs.push({ role: 'assistant', content: `answer ${i}` });
    }
    const result = buildHandoffSummary(msgs, 'a/b', 'c/d');
    // Should have 3 User: lines (from the last 3 pairs)
    const userLines = result.split('\n').filter(l => l.startsWith('User:'));
    expect(userLines.length).toBeLessThanOrEqual(3);
  });

  it('caps total output at 2000 chars', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'X'.repeat(500) },
      { role: 'assistant', content: 'Y'.repeat(500) },
      { role: 'user', content: 'X'.repeat(500) },
      { role: 'assistant', content: 'Y'.repeat(500) },
    ];
    const result = buildHandoffSummary(msgs, 'a/b', 'c/d');
    expect(result.length).toBeLessThanOrEqual(2000);
  });

  it('includes continue instruction', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const result = buildHandoffSummary(msgs, 'a/b', 'c/d');
    expect(result).toContain('Continue the conversation naturally');
  });

  it('handles messages with only user messages (no assistant)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
    ];
    const result = buildHandoffSummary(msgs, 'a/b', 'c/d');
    // No assistant message means no pairs collected
    expect(result).toBe('');
  });
});

// ── generateWorkingSummary ───────────────────────────────────────────────────

describe('generateWorkingSummary', () => {
  it('returns empty string for empty array', () => {
    expect(generateWorkingSummary([])).toBe('');
  });

  it('returns empty string when no user messages', () => {
    const msgs: ChatMessage[] = [{ role: 'assistant', content: 'hello' }];
    expect(generateWorkingSummary(msgs)).toBe('');
  });

  it('includes "Recent topics:" header', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'help with tests' }];
    const result = generateWorkingSummary(msgs);
    expect(result).toContain('Recent topics:');
  });

  it('truncates each user message to 120 chars', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'X'.repeat(200) }];
    const result = generateWorkingSummary(msgs);
    expect(result).toContain('X'.repeat(120));
    expect(result).not.toContain('X'.repeat(121));
  });

  it('takes last 5 user messages only', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 8; i++) {
      msgs.push({ role: 'user', content: `topic ${i}` });
    }
    const result = generateWorkingSummary(msgs);
    expect(result).toContain('topic 3');
    expect(result).toContain('topic 7');
    expect(result).not.toContain('topic 2');
  });

  it('separates topics with pipe', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'topic A' },
      { role: 'user', content: 'topic B' },
    ];
    const result = generateWorkingSummary(msgs);
    expect(result).toContain('topic A | topic B');
  });

  it('includes last assistant response preview', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'here is my detailed answer' },
    ];
    const result = generateWorkingSummary(msgs);
    expect(result).toContain('Last response preview:');
    expect(result).toContain('here is my detailed answer');
  });

  it('truncates assistant response preview to 200 chars', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'R'.repeat(300) },
    ];
    const result = generateWorkingSummary(msgs);
    expect(result).toContain('R'.repeat(200));
    expect(result).not.toContain('R'.repeat(201));
  });
});
