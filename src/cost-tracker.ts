/**
 * cost-tracker.ts — Token usage and cost tracking for agent sessions.
 *
 * Parses token usage from CLI output (Claude, Gemini, Codex) and
 * estimates cost based on known pricing. Provides per-session and
 * aggregate cost tracking.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostEstimate {
  usage: TokenUsage;
  costUsd: number;
  model: string;
  timestamp: number;
}

// ── Pricing (USD per 1M tokens, as of March 2026) ─────────────────────────

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude models
  'claude-opus-4-6':     { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-sonnet-4-6':   { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-haiku-4-5':    { inputPer1M: 0.80,  outputPer1M: 4.00 },
  // Gemini models
  'gemini-2.5-pro':           { inputPer1M: 1.25,  outputPer1M: 10.00 },
  'gemini-2.5-flash':         { inputPer1M: 0.15,  outputPer1M: 0.60 },
  'gemini-3-pro-preview':     { inputPer1M: 1.25,  outputPer1M: 10.00 },
  'gemini-3-flash-preview':   { inputPer1M: 0.15,  outputPer1M: 0.60 },
  // OpenAI Codex models (estimated)
  'gpt-5.3-codex':       { inputPer1M: 2.00,  outputPer1M: 8.00 },
  'gpt-5.3-codex-spark': { inputPer1M: 1.00,  outputPer1M: 4.00 },
  'gpt-5.2-codex':       { inputPer1M: 2.00,  outputPer1M: 8.00 },
  'gpt-5.4':             { inputPer1M: 3.00,  outputPer1M: 12.00 },
  'gpt-5.1-codex-mini':  { inputPer1M: 0.50,  outputPer1M: 2.00 },
};

// Default pricing for unknown models
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 2.00, outputPer1M: 8.00 };

// ── Token parsing patterns ───────────────────────────────────────────────────

/**
 * Parse token usage from CLI output text.
 * Matches patterns from various CLI tools:
 *
 * Claude CLI:
 *   "Input tokens: 1234"
 *   "Output tokens: 567"
 *   "Total tokens: 1801"
 *   "Tokens: 1234 in, 567 out"
 *
 * Gemini CLI:
 *   "Token count: 1234 input, 567 output"
 *   "Tokens used: 1801"
 *
 * Codex CLI:
 *   "usage: {prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801}"
 *   "Tokens: 1234 → 567"
 */
export function parseTokenUsage(output: string): TokenUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;

  // Pattern 1: "Input tokens: N" / "Output tokens: N" (Claude)
  const inputMatch = output.match(/[Ii]nput\s*tokens?:\s*(\d[\d,]*)/);
  const outputMatch = output.match(/[Oo]utput\s*tokens?:\s*(\d[\d,]*)/);
  if (inputMatch && outputMatch) {
    inputTokens = parseInt(inputMatch[1].replace(/,/g, ''), 10);
    outputTokens = parseInt(outputMatch[1].replace(/,/g, ''), 10);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  // Pattern 2: "Tokens: N in, N out" (Claude compact)
  const compactMatch = output.match(/[Tt]okens?:\s*(\d[\d,]*)\s*in,?\s*(\d[\d,]*)\s*out/);
  if (compactMatch) {
    inputTokens = parseInt(compactMatch[1].replace(/,/g, ''), 10);
    outputTokens = parseInt(compactMatch[2].replace(/,/g, ''), 10);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  // Pattern 3: "Token count: N input, N output" (Gemini)
  const geminiMatch = output.match(/[Tt]oken\s*count:\s*(\d[\d,]*)\s*input,?\s*(\d[\d,]*)\s*output/);
  if (geminiMatch) {
    inputTokens = parseInt(geminiMatch[1].replace(/,/g, ''), 10);
    outputTokens = parseInt(geminiMatch[2].replace(/,/g, ''), 10);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  // Pattern 4: "prompt_tokens: N, completion_tokens: N" (OpenAI/Codex JSON)
  const promptMatch = output.match(/prompt_tokens['":\s]+(\d[\d,]*)/);
  const completionMatch = output.match(/completion_tokens['":\s]+(\d[\d,]*)/);
  if (promptMatch && completionMatch) {
    inputTokens = parseInt(promptMatch[1].replace(/,/g, ''), 10);
    outputTokens = parseInt(completionMatch[1].replace(/,/g, ''), 10);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  // Pattern 5: "Tokens: N → N" or "Tokens: N -> N" (Codex arrow format)
  const arrowMatch = output.match(/[Tt]okens?:\s*(\d[\d,]*)\s*(?:→|->)\s*(\d[\d,]*)/);
  if (arrowMatch) {
    inputTokens = parseInt(arrowMatch[1].replace(/,/g, ''), 10);
    outputTokens = parseInt(arrowMatch[2].replace(/,/g, ''), 10);
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  // Pattern 6: "Total tokens: N" or "Tokens used: N" (single total, split estimate)
  const totalMatch = output.match(/(?:[Tt]otal\s*tokens?|[Tt]okens?\s*used):\s*(\d[\d,]*)/);
  if (totalMatch) {
    const total = parseInt(totalMatch[1].replace(/,/g, ''), 10);
    // Without split info, estimate 70% input / 30% output
    inputTokens = Math.round(total * 0.7);
    outputTokens = total - inputTokens;
    return { inputTokens, outputTokens, totalTokens: total };
  }

  return null;
}

// ── Cost calculation ─────────────────────────────────────────────────────────

/**
 * Extract the model-specific name from a full model ID.
 * e.g. "cli-claude/claude-sonnet-4-6" → "claude-sonnet-4-6"
 */
function extractModelName(modelId: string): string {
  const slashIndex = modelId.indexOf('/');
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

/**
 * Calculate cost estimate for token usage with a given model.
 */
export function calculateCost(usage: TokenUsage, modelId: string): number {
  const modelName = extractModelName(modelId);
  const pricing = MODEL_PRICING[modelName] ?? DEFAULT_PRICING;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;

  return inputCost + outputCost;
}

/**
 * Format a cost value as a human-readable string.
 */
export function formatCost(costUsd: number): string {
  if (costUsd < 0.001) return '<$0.001';
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  if (costUsd < 1.00) return `$${costUsd.toFixed(3)}`;
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Format token usage as a compact string.
 */
export function formatTokens(usage: TokenUsage): string {
  const fmt = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };
  return `${fmt(usage.inputTokens)} in / ${fmt(usage.outputTokens)} out (${fmt(usage.totalTokens)} total)`;
}

/**
 * Build a cost estimate from CLI output and model ID.
 */
export function estimateCost(output: string, modelId: string): CostEstimate | null {
  const usage = parseTokenUsage(output);
  if (!usage) return null;

  return {
    usage,
    costUsd: calculateCost(usage, modelId),
    model: modelId,
    timestamp: Date.now(),
  };
}

/**
 * Get the pricing info for a model (for display purposes).
 */
export function getModelPricing(modelId: string): ModelPricing {
  const modelName = extractModelName(modelId);
  return MODEL_PRICING[modelName] ?? DEFAULT_PRICING;
}

/**
 * Aggregate cost estimates from multiple sessions.
 */
export function aggregateCosts(estimates: CostEstimate[]): {
  totalCostUsd: number;
  totalUsage: TokenUsage;
  byModel: Map<string, { costUsd: number; usage: TokenUsage }>;
} {
  const byModel = new Map<string, { costUsd: number; usage: TokenUsage }>();
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (const est of estimates) {
    totalInput += est.usage.inputTokens;
    totalOutput += est.usage.outputTokens;
    totalCost += est.costUsd;

    const existing = byModel.get(est.model);
    if (existing) {
      existing.costUsd += est.costUsd;
      existing.usage.inputTokens += est.usage.inputTokens;
      existing.usage.outputTokens += est.usage.outputTokens;
      existing.usage.totalTokens += est.usage.totalTokens;
    } else {
      byModel.set(est.model, {
        costUsd: est.costUsd,
        usage: { ...est.usage },
      });
    }
  }

  return {
    totalCostUsd: totalCost,
    totalUsage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
    },
    byModel,
  };
}
