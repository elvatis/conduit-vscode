import { describe, it, expect } from 'vitest';
import { extractProvider, shortModelName, stripFences } from '../utils';

describe('extractProvider', () => {
  it('extracts provider prefix before slash', () => {
    expect(extractProvider('web-claude/claude-opus-4-6')).toBe('web-claude');
    expect(extractProvider('cli-gemini/gemini-2.5-pro')).toBe('cli-gemini');
    expect(extractProvider('openai-codex/gpt-5.4')).toBe('openai-codex');
  });

  it('returns unknown for empty string', () => {
    expect(extractProvider('')).toBe('unknown');
  });

  it('returns unknown for no slash', () => {
    expect(extractProvider('grok-fast')).toBe('unknown');
  });

  it('returns unknown for slash at position 0', () => {
    expect(extractProvider('/model')).toBe('unknown');
  });

  it('uses only first slash for multi-slash IDs', () => {
    expect(extractProvider('web-claude/claude/variant')).toBe('web-claude');
  });
});

describe('shortModelName', () => {
  it('extracts model name after slash', () => {
    expect(shortModelName('web-claude/claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(shortModelName('web-grok/grok-fast')).toBe('grok-fast');
  });

  it('returns unknown for empty string', () => {
    expect(shortModelName('')).toBe('unknown');
  });

  it('returns full string for no slash', () => {
    expect(shortModelName('grok-fast')).toBe('grok-fast');
  });

  it('returns everything after first slash', () => {
    expect(shortModelName('web-claude/claude/variant')).toBe('claude/variant');
  });

  it('returns full string including slash when slash at position 0', () => {
    // slash at idx 0 means no provider prefix, so indexOf returns 0 which is not > 0
    expect(shortModelName('/model-name')).toBe('/model-name');
  });
});

describe('stripFences', () => {
  it('strips fences with language hint', () => {
    expect(stripFences('```typescript\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('strips bare fences without language', () => {
    expect(stripFences('```\nhello world\n```')).toBe('hello world');
  });

  it('returns plain text unchanged', () => {
    expect(stripFences('just plain text')).toBe('just plain text');
  });

  it('handles language hints with special characters', () => {
    expect(stripFences('```c++\nint main() {}\n```')).toBe('int main() {}');
    expect(stripFences('```objective-c\n@interface\n```')).toBe('@interface');
  });

  it('handles trailing whitespace after closing fence', () => {
    expect(stripFences('```js\ncode\n```   ')).toBe('code');
  });

  it('strips opening fence greedily (no newline between fence and code)', () => {
    // opening regex matches ```[^\n]* which consumes "code" as the language hint
    expect(stripFences('```code\nactual\n```')).toBe('actual');
  });

  it('handles empty content between fences', () => {
    expect(stripFences('```\n```')).toBe('');
  });
});
