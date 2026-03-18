/**
 * cost-tracker.test.ts — Tests for token parsing and cost estimation.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTokenUsage,
  calculateCost,
  formatCost,
  formatTokens,
  estimateCost,
  aggregateCosts,
  type TokenUsage,
  type CostEstimate,
} from '../cost-tracker';

describe('parseTokenUsage', () => {
  describe('Claude CLI patterns', () => {
    it('parses "Input tokens: N" / "Output tokens: N"', () => {
      const output = 'Some output\nInput tokens: 1234\nOutput tokens: 567\nDone.';
      const usage = parseTokenUsage(output);
      expect(usage).toEqual({ inputTokens: 1234, outputTokens: 567, totalTokens: 1801 });
    });

    it('parses tokens with commas', () => {
      const output = 'Input tokens: 12,345\nOutput tokens: 6,789';
      const usage = parseTokenUsage(output);
      expect(usage).toEqual({ inputTokens: 12345, outputTokens: 6789, totalTokens: 19134 });
    });

    it('parses "Tokens: N in, N out" (compact)', () => {
      const output = 'Result ready. Tokens: 500 in, 200 out';
      const usage = parseTokenUsage(output);
      expect(usage).toEqual({ inputTokens: 500, outputTokens: 200, totalTokens: 700 });
    });
  });

  describe('Gemini CLI patterns', () => {
    it('parses "Token count: N input, N output"', () => {
      const output = 'Token count: 800 input, 300 output';
      const usage = parseTokenUsage(output);
      expect(usage).toEqual({ inputTokens: 800, outputTokens: 300, totalTokens: 1100 });
    });
  });

  describe('OpenAI/Codex patterns', () => {
    it('parses prompt_tokens / completion_tokens (JSON-like)', () => {
      const output = '{"prompt_tokens": 1500, "completion_tokens": 400, "total_tokens": 1900}';
      const usage = parseTokenUsage(output);
      expect(usage).toEqual({ inputTokens: 1500, outputTokens: 400, totalTokens: 1900 });
    });

    it('parses arrow format "Tokens: N → N"', () => {
      const output = 'Tokens: 2000 → 800';
      const usage = parseTokenUsage(output);
      expect(usage).toEqual({ inputTokens: 2000, outputTokens: 800, totalTokens: 2800 });
    });

    it('parses arrow format "Tokens: N -> N"', () => {
      const output = 'Tokens: 1500 -> 600';
      const usage = parseTokenUsage(output);
      expect(usage).toEqual({ inputTokens: 1500, outputTokens: 600, totalTokens: 2100 });
    });
  });

  describe('single total patterns', () => {
    it('parses "Total tokens: N" with 70/30 split estimate', () => {
      const output = 'Total tokens: 1000';
      const usage = parseTokenUsage(output);
      expect(usage).not.toBeNull();
      expect(usage!.totalTokens).toBe(1000);
      expect(usage!.inputTokens).toBe(700);
      expect(usage!.outputTokens).toBe(300);
    });

    it('parses "Tokens used: N"', () => {
      const output = 'Processing complete. Tokens used: 5000';
      const usage = parseTokenUsage(output);
      expect(usage).not.toBeNull();
      expect(usage!.totalTokens).toBe(5000);
    });
  });

  describe('no match', () => {
    it('returns null when no token info found', () => {
      expect(parseTokenUsage('Hello world')).toBeNull();
      expect(parseTokenUsage('')).toBeNull();
      expect(parseTokenUsage('Some code output\nwithout any token info')).toBeNull();
    });
  });
});

describe('calculateCost', () => {
  it('calculates cost for Claude Sonnet', () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };
    const cost = calculateCost(usage, 'cli-claude/claude-sonnet-4-6');
    // $3/M input + $15/M output = $18
    expect(cost).toBeCloseTo(18.00, 2);
  });

  it('calculates cost for Claude Opus', () => {
    const usage: TokenUsage = { inputTokens: 100_000, outputTokens: 50_000, totalTokens: 150_000 };
    const cost = calculateCost(usage, 'cli-claude/claude-opus-4-6');
    // (0.1 * $15) + (0.05 * $75) = $1.5 + $3.75 = $5.25
    expect(cost).toBeCloseTo(5.25, 2);
  });

  it('calculates cost for Gemini Flash (cheap)', () => {
    const usage: TokenUsage = { inputTokens: 10_000, outputTokens: 5_000, totalTokens: 15_000 };
    const cost = calculateCost(usage, 'cli-gemini/gemini-2.5-flash');
    // (0.01 * $0.15) + (0.005 * $0.60) = $0.0015 + $0.003 = $0.0045
    expect(cost).toBeCloseTo(0.0045, 4);
  });

  it('uses default pricing for unknown models', () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    const cost = calculateCost(usage, 'unknown/model');
    expect(cost).toBeGreaterThan(0);
  });

  it('returns 0 for zero tokens', () => {
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    expect(calculateCost(usage, 'cli-claude/claude-sonnet-4-6')).toBe(0);
  });

  it('handles model ID with prefix', () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 };
    const cost1 = calculateCost(usage, 'cli-claude/claude-sonnet-4-6');
    const cost2 = calculateCost(usage, 'claude-sonnet-4-6');
    expect(cost1).toBe(cost2);
  });
});

describe('formatCost', () => {
  it('formats very small costs', () => {
    expect(formatCost(0.0001)).toBe('<$0.001');
  });

  it('formats small costs with 4 decimals', () => {
    expect(formatCost(0.0045)).toBe('$0.0045');
  });

  it('formats medium costs with 3 decimals', () => {
    expect(formatCost(0.125)).toBe('$0.125');
  });

  it('formats large costs with 2 decimals', () => {
    expect(formatCost(5.25)).toBe('$5.25');
  });
});

describe('formatTokens', () => {
  it('formats small numbers', () => {
    const usage: TokenUsage = { inputTokens: 500, outputTokens: 200, totalTokens: 700 };
    expect(formatTokens(usage)).toBe('500 in / 200 out (700 total)');
  });

  it('formats thousands with k suffix', () => {
    const usage: TokenUsage = { inputTokens: 12000, outputTokens: 5000, totalTokens: 17000 };
    expect(formatTokens(usage)).toBe('12.0k in / 5.0k out (17.0k total)');
  });

  it('formats millions with M suffix', () => {
    const usage: TokenUsage = { inputTokens: 1500000, outputTokens: 500000, totalTokens: 2000000 };
    expect(formatTokens(usage)).toBe('1.5M in / 500.0k out (2.0M total)');
  });
});

describe('estimateCost', () => {
  it('returns CostEstimate when tokens are found', () => {
    const output = 'Input tokens: 1000\nOutput tokens: 500';
    const estimate = estimateCost(output, 'cli-claude/claude-sonnet-4-6');
    expect(estimate).not.toBeNull();
    expect(estimate!.usage.inputTokens).toBe(1000);
    expect(estimate!.usage.outputTokens).toBe(500);
    expect(estimate!.costUsd).toBeGreaterThan(0);
    expect(estimate!.model).toBe('cli-claude/claude-sonnet-4-6');
    expect(estimate!.timestamp).toBeGreaterThan(0);
  });

  it('returns null when no tokens found', () => {
    expect(estimateCost('no tokens here', 'cli-claude/claude-sonnet-4-6')).toBeNull();
  });
});

describe('aggregateCosts', () => {
  it('aggregates multiple estimates', () => {
    const estimates: CostEstimate[] = [
      {
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        costUsd: 0.01,
        model: 'cli-claude/claude-sonnet-4-6',
        timestamp: Date.now(),
      },
      {
        usage: { inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 },
        costUsd: 0.02,
        model: 'cli-claude/claude-sonnet-4-6',
        timestamp: Date.now(),
      },
      {
        usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
        costUsd: 0.005,
        model: 'cli-gemini/gemini-2.5-flash',
        timestamp: Date.now(),
      },
    ];

    const agg = aggregateCosts(estimates);
    expect(agg.totalCostUsd).toBeCloseTo(0.035, 4);
    expect(agg.totalUsage.inputTokens).toBe(3500);
    expect(agg.totalUsage.outputTokens).toBe(1700);
    expect(agg.totalUsage.totalTokens).toBe(5200);
    expect(agg.byModel.size).toBe(2);
    expect(agg.byModel.get('cli-claude/claude-sonnet-4-6')!.costUsd).toBeCloseTo(0.03, 4);
    expect(agg.byModel.get('cli-gemini/gemini-2.5-flash')!.costUsd).toBeCloseTo(0.005, 4);
  });

  it('handles empty array', () => {
    const agg = aggregateCosts([]);
    expect(agg.totalCostUsd).toBe(0);
    expect(agg.totalUsage.totalTokens).toBe(0);
    expect(agg.byModel.size).toBe(0);
  });
});
