import { describe, it, expect } from 'vitest';
import { getInlineMaxTokens } from '../inline-provider';

describe('getInlineMaxTokens', () => {
  it('returns 1024 for tier 1 (Opus)', () => {
    expect(getInlineMaxTokens(1)).toBe(1024);
  });

  it('returns 512 for tier 2 (Sonnet)', () => {
    expect(getInlineMaxTokens(2)).toBe(512);
  });

  it('returns 256 for tier 3 (Haiku)', () => {
    expect(getInlineMaxTokens(3)).toBe(256);
  });

  it('defaults to 512 when tier is undefined', () => {
    expect(getInlineMaxTokens(undefined)).toBe(512);
  });

  it('caps at modelMax when lower than budget', () => {
    expect(getInlineMaxTokens(1, 500)).toBe(500);
    expect(getInlineMaxTokens(2, 200)).toBe(200);
  });

  it('uses budget when modelMax is higher', () => {
    expect(getInlineMaxTokens(1, 128_000)).toBe(1024);
    expect(getInlineMaxTokens(3, 65_536)).toBe(256);
  });

  it('uses budget when modelMax is undefined', () => {
    expect(getInlineMaxTokens(1, undefined)).toBe(1024);
  });
});
