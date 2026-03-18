/**
 * llm-tool-validation.test.ts — LLM tool-call schema validation.
 *
 * Validates that the tool catalog prompt produces correct tool-call JSON
 * when parsed by an LLM. This test can be run against different models
 * by setting LLM_MODEL env var.
 *
 * Usage:
 *   npx vitest run src/__tests__/llm-tool-validation.test.ts
 *   LLM_MODEL=cli-claude/claude-sonnet-4-6 npx vitest run src/__tests__/llm-tool-validation.test.ts
 *
 * Without LLM_MODEL set, only the schema validation tests run (no API calls).
 * With LLM_MODEL set, it sends the sample prompt to the model and validates
 * the response contains correct tool calls.
 */

import { describe, it, expect } from 'vitest';
import { buildToolCatalogPrompt, TOOL_DEFINITIONS } from '../agent-tools';

// ── Sample prompt for LLM validation ─────────────────────────────────────────

export const SAMPLE_PROMPT = `You have access to these tools:

{{TOOL_CATALOG}}

The user wants to fix GitHub issue #42 using a parallel worktree workflow.

Respond with a JSON array of tool calls you would make, in order. Each tool call should have:
- "name": the tool name
- "args": the arguments object

Here is what needs to happen:
1. Create a worktree on branch "fix/issue-42"
2. Read the file "src/auth.ts" to understand the current code
3. Apply a diff to fix a bug: replace "if (token === null)" with "if (!token)"
4. Remove the worktree after the fix (but keep the branch since it is not merged yet)

Return ONLY the JSON array, no prose.`;

// ── Schema validation (always runs, no API needed) ──────────────────────────

describe('tool catalog schema', () => {
  it('all tools have unique names', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all tools have descriptions', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('all required args are marked', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const requiredArgs = Object.entries(tool.args).filter(([, a]) => a.required);
      // Every tool with required args should have at least one
      // (tools like listFiles have all optional, which is fine)
      if (tool.name === 'readFile' || tool.name === 'writeFile' || tool.name === 'runCommand' ||
          tool.name === 'searchCode' || tool.name === 'applyDiff' || tool.name === 'createWorktree' ||
          tool.name === 'removeWorktree') {
        expect(requiredArgs.length).toBeGreaterThan(0);
      }
    }
  });

  it('arg types are valid', () => {
    const validTypes = new Set(['string', 'number', 'boolean']);
    for (const tool of TOOL_DEFINITIONS) {
      for (const [name, arg] of Object.entries(tool.args)) {
        expect(validTypes.has(arg.type), `${tool.name}.${name} has invalid type "${arg.type}"`).toBe(true);
      }
    }
  });

  it('worktree tools have correct arg schemas', () => {
    const create = TOOL_DEFINITIONS.find(t => t.name === 'createWorktree')!;
    expect(create.args.branch.type).toBe('string');
    expect(create.args.branch.required).toBe(true);
    expect(create.args.path.type).toBe('string');
    expect(create.args.path.required).toBeUndefined();

    const remove = TOOL_DEFINITIONS.find(t => t.name === 'removeWorktree')!;
    expect(remove.args.path.type).toBe('string');
    expect(remove.args.path.required).toBe(true);
    expect(remove.args.deleteBranch.type).toBe('boolean');
    expect(remove.args.force.type).toBe('boolean');
  });

  it('tool catalog prompt is well-formed', () => {
    const prompt = buildToolCatalogPrompt();
    // Should contain all tool names
    for (const tool of TOOL_DEFINITIONS) {
      expect(prompt).toContain(`**${tool.name}**`);
    }
    // Should mark destructive tools
    const destructive = TOOL_DEFINITIONS.filter(t => t.permission === 'destructive');
    for (const tool of destructive) {
      // The prompt should mention approval for destructive tools
      const toolSection = prompt.slice(prompt.indexOf(`**${tool.name}**`));
      expect(toolSection).toContain('approval');
    }
  });

  it('sample prompt renders correctly with tool catalog', () => {
    const catalog = buildToolCatalogPrompt();
    const rendered = SAMPLE_PROMPT.replace('{{TOOL_CATALOG}}', catalog);

    expect(rendered).toContain('createWorktree');
    expect(rendered).toContain('removeWorktree');
    expect(rendered).toContain('readFile');
    expect(rendered).toContain('applyDiff');
    expect(rendered).not.toContain('{{TOOL_CATALOG}}');
  });
});

// ── Expected tool-call structure ────────────────────────────────────────────

interface ExpectedToolCall {
  name: string;
  requiredArgs: string[];
  optionalArgs?: string[];
  argValues?: Record<string, unknown>;
}

const EXPECTED_CALLS: ExpectedToolCall[] = [
  {
    name: 'createWorktree',
    requiredArgs: ['branch'],
    argValues: { branch: 'fix/issue-42' },
  },
  {
    name: 'readFile',
    requiredArgs: ['path'],
    argValues: { path: 'src/auth.ts' },
  },
  {
    name: 'applyDiff',
    requiredArgs: ['path', 'search', 'replace'],
    argValues: {
      path: 'src/auth.ts',
      search: 'if (token === null)',
      replace: 'if (!token)',
    },
  },
  {
    name: 'removeWorktree',
    requiredArgs: ['path'],
    // Should NOT have deleteBranch=true since the prompt says "keep the branch"
  },
];

/**
 * Validate a parsed LLM response against expected tool calls.
 * Returns an array of error messages (empty = all good).
 */
export function validateToolCalls(parsed: any[]): string[] {
  const errors: string[] = [];

  if (!Array.isArray(parsed)) {
    errors.push('Response is not an array');
    return errors;
  }

  if (parsed.length < EXPECTED_CALLS.length) {
    errors.push(`Expected at least ${EXPECTED_CALLS.length} tool calls, got ${parsed.length}`);
  }

  // Check each expected call appears in order
  let searchFrom = 0;
  for (const expected of EXPECTED_CALLS) {
    const idx = parsed.findIndex((call, i) => i >= searchFrom && call.name === expected.name);
    if (idx === -1) {
      errors.push(`Missing expected tool call: ${expected.name}`);
      continue;
    }

    const call = parsed[idx];
    searchFrom = idx + 1;

    // Validate required args exist
    for (const arg of expected.requiredArgs) {
      if (call.args?.[arg] === undefined && call[arg] === undefined) {
        errors.push(`${expected.name}: missing required arg "${arg}"`);
      }
    }

    // Validate specific arg values
    if (expected.argValues) {
      for (const [key, value] of Object.entries(expected.argValues)) {
        const actual = call.args?.[key] ?? call[key];
        if (actual !== value) {
          errors.push(`${expected.name}.${key}: expected "${value}", got "${actual}"`);
        }
      }
    }

    // Validate tool name exists in definitions
    const toolDef = TOOL_DEFINITIONS.find(t => t.name === call.name);
    if (!toolDef) {
      errors.push(`${call.name}: not a valid tool name`);
    }
  }

  // Check no hallucinated tool names
  for (const call of parsed) {
    if (call.name && !TOOL_DEFINITIONS.find(t => t.name === call.name)) {
      errors.push(`Hallucinated tool name: "${call.name}"`);
    }
  }

  return errors;
}

describe('tool-call validation logic', () => {
  it('accepts correct tool calls', () => {
    const correct = [
      { name: 'createWorktree', args: { branch: 'fix/issue-42' } },
      { name: 'readFile', args: { path: 'src/auth.ts' } },
      { name: 'applyDiff', args: { path: 'src/auth.ts', search: 'if (token === null)', replace: 'if (!token)' } },
      { name: 'removeWorktree', args: { path: '../worktree-fix-issue-42' } },
    ];
    const errors = validateToolCalls(correct);
    expect(errors).toEqual([]);
  });

  it('rejects missing tool calls', () => {
    const incomplete = [
      { name: 'createWorktree', args: { branch: 'fix/issue-42' } },
      { name: 'readFile', args: { path: 'src/auth.ts' } },
    ];
    const errors = validateToolCalls(incomplete);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('applyDiff'))).toBe(true);
  });

  it('rejects missing required args', () => {
    const missingArgs = [
      { name: 'createWorktree', args: {} }, // missing branch
      { name: 'readFile', args: { path: 'src/auth.ts' } },
      { name: 'applyDiff', args: { path: 'src/auth.ts', search: 'if (token === null)', replace: 'if (!token)' } },
      { name: 'removeWorktree', args: { path: '../worktree' } },
    ];
    const errors = validateToolCalls(missingArgs);
    expect(errors.some(e => e.includes('branch'))).toBe(true);
  });

  it('rejects wrong arg values', () => {
    const wrongValues = [
      { name: 'createWorktree', args: { branch: 'wrong-branch' } },
      { name: 'readFile', args: { path: 'src/auth.ts' } },
      { name: 'applyDiff', args: { path: 'src/auth.ts', search: 'if (token === null)', replace: 'if (!token)' } },
      { name: 'removeWorktree', args: { path: '../worktree' } },
    ];
    const errors = validateToolCalls(wrongValues);
    expect(errors.some(e => e.includes('fix/issue-42'))).toBe(true);
  });

  it('detects hallucinated tool names', () => {
    const hallucinated = [
      { name: 'createWorktree', args: { branch: 'fix/issue-42' } },
      { name: 'readFile', args: { path: 'src/auth.ts' } },
      { name: 'hackDatabase', args: { target: 'prod' } }, // hallucinated
      { name: 'applyDiff', args: { path: 'src/auth.ts', search: 'if (token === null)', replace: 'if (!token)' } },
      { name: 'removeWorktree', args: { path: '../worktree' } },
    ];
    const errors = validateToolCalls(hallucinated);
    expect(errors.some(e => e.includes('Hallucinated'))).toBe(true);
  });

  it('rejects non-array response', () => {
    const errors = validateToolCalls('not an array' as any);
    expect(errors).toContain('Response is not an array');
  });
});

// ── Live LLM test (only runs with LLM_MODEL env var) ────────────────────────

const LLM_MODEL = process.env.LLM_MODEL;

describe.skipIf(!LLM_MODEL)('live LLM tool-call generation', () => {
  it(`generates correct tool calls with ${LLM_MODEL}`, async () => {
    // Dynamic import to avoid pulling in cli-runner when not needed
    const { routeToCliRunner } = await import('../cli-runner');
    const catalog = buildToolCatalogPrompt();
    const rendered = SAMPLE_PROMPT.replace('{{TOOL_CATALOG}}', catalog);

    const response = await routeToCliRunner(
      LLM_MODEL!,
      [{ role: 'user', content: rendered }],
      120_000,
    );

    // Try to parse JSON from the response
    let parsed: any[];
    try {
      // Handle responses that wrap JSON in markdown fences
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      throw new Error(`Failed to parse LLM response as JSON:\n${response}\n\nError: ${(err as Error).message}`);
    }

    const errors = validateToolCalls(parsed);
    if (errors.length > 0) {
      throw new Error(
        `Tool call validation failed for ${LLM_MODEL}:\n` +
        errors.map(e => `  - ${e}`).join('\n') +
        `\n\nRaw response:\n${response}`,
      );
    }
  }, 180_000); // 3min timeout for slow models
});
