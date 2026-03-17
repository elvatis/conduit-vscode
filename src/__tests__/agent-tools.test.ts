import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { executeTool, buildToolCatalogPrompt, TOOL_DEFINITIONS } from '../agent-tools';
import type { ToolCall } from '../agent-types';
import { workspace } from '../__mocks__/vscode';

// Use an absolute path that works on any OS
const MOCK_ROOT = path.resolve('/test-workspace');

// Mock fs operations
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

function makeCall(name: string, args: Record<string, unknown>, id = 'tc_test'): ToolCall {
  return { id, name, args, permission: 'safe' };
}

describe('agent-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set mock workspace root to a proper absolute path
    (workspace.workspaceFolders as any) = [{ uri: { fsPath: MOCK_ROOT }, name: 'test', index: 0 }];
  });

  // ── readFile ────────────────────────────────────────────────────────────

  describe('readFile', () => {
    it('reads a file successfully', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('line1\nline2\nline3');

      const result = await executeTool(makeCall('readFile', { path: 'src/foo.ts' }));
      expect(result.status).toBe('success');
      expect(result.output).toBe('line1\nline2\nline3');
      expect(result.id).toBe('tc_test');
      expect(result.name).toBe('readFile');
    });

    it('reads a line range', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('line1\nline2\nline3\nline4');

      const result = await executeTool(makeCall('readFile', { path: 'x.ts', startLine: 2, endLine: 3 }));
      expect(result.status).toBe('success');
      expect(result.output).toBe('line2\nline3');
    });

    it('returns error for missing path arg', async () => {
      const result = await executeTool(makeCall('readFile', {}));
      expect(result.status).toBe('error');
      expect(result.output).toContain('Missing');
    });

    it('returns error for non-existent file', async () => {
      (fs.existsSync as any).mockReturnValue(false);
      const result = await executeTool(makeCall('readFile', { path: 'nope.ts' }));
      expect(result.status).toBe('error');
      expect(result.output).toContain('not found');
    });

    it('returns error for path traversal', async () => {
      const result = await executeTool(makeCall('readFile', { path: '../../etc/passwd' }));
      expect(result.status).toBe('error');
      expect(result.output).toContain('escapes');
    });

    it('truncates large files', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('x'.repeat(15_000));

      const result = await executeTool(makeCall('readFile', { path: 'big.ts' }));
      expect(result.status).toBe('success');
      expect(result.output.length).toBeLessThan(13_000);
      expect(result.output).toContain('truncated');
    });
  });

  // ── writeFile ───────────────────────────────────────────────────────────

  describe('writeFile', () => {
    it('creates a new file', async () => {
      (fs.existsSync as any).mockReturnValue(false);

      const result = await executeTool(makeCall('writeFile', { path: 'new.ts', content: 'hello' }));
      expect(result.status).toBe('success');
      expect(result.output).toContain('Created');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('updates an existing file', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('old content');

      const result = await executeTool(makeCall('writeFile', { path: 'exist.ts', content: 'new content' }));
      expect(result.status).toBe('success');
      expect(result.output).toContain('Updated');
    });

    it('returns error for missing content', async () => {
      const result = await executeTool(makeCall('writeFile', { path: 'x.ts' }));
      expect(result.status).toBe('error');
      expect(result.output).toContain('Missing');
    });

    it('rejects path traversal', async () => {
      const result = await executeTool(makeCall('writeFile', { path: '../escape.ts', content: 'bad' }));
      expect(result.status).toBe('error');
      expect(result.output).toContain('escapes');
    });
  });

  // ── applyDiff ───────────────────────────────────────────────────────────

  describe('applyDiff', () => {
    it('replaces text in a file', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('const x = 1;\nconst y = 2;');

      const result = await executeTool(makeCall('applyDiff', {
        path: 'x.ts',
        search: 'const x = 1;',
        replace: 'const x = 42;',
      }));

      expect(result.status).toBe('success');
      expect(result.output).toContain('Applied diff');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        'const x = 42;\nconst y = 2;',
        'utf-8',
      );
    });

    it('returns error when search string not found', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('nothing here');

      const result = await executeTool(makeCall('applyDiff', {
        path: 'x.ts',
        search: 'not found text',
        replace: 'new',
      }));

      expect(result.status).toBe('error');
      expect(result.output).toContain('not found');
    });
  });

  // ── Unknown tool ────────────────────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeTool(makeCall('hackTheWorld', {}));
      expect(result.status).toBe('error');
      expect(result.output).toContain('Unknown tool');
    });
  });

  // ── Tool catalog prompt ─────────────────────────────────────────────────

  describe('buildToolCatalogPrompt', () => {
    it('includes all tool names', () => {
      const prompt = buildToolCatalogPrompt();
      for (const tool of TOOL_DEFINITIONS) {
        expect(prompt).toContain(tool.name);
      }
    });

    it('marks destructive tools', () => {
      const prompt = buildToolCatalogPrompt();
      expect(prompt).toContain('writeFile');
      expect(prompt).toContain('user approval');
    });

    it('includes argument descriptions', () => {
      const prompt = buildToolCatalogPrompt();
      expect(prompt).toContain('path');
      expect(prompt).toContain('pattern');
      expect(prompt).toContain('command');
    });
  });

  // ── Tool definitions ────────────────────────────────────────────────────

  describe('TOOL_DEFINITIONS', () => {
    it('has 9 tools defined', () => {
      expect(TOOL_DEFINITIONS).toHaveLength(9);
    });

    it('classifies permissions correctly', () => {
      const safe = TOOL_DEFINITIONS.filter(t => t.permission === 'safe');
      const destructive = TOOL_DEFINITIONS.filter(t => t.permission === 'destructive');
      expect(safe.map(t => t.name).sort()).toEqual(['listFiles', 'readDiagnostics', 'readFile', 'searchCode']);
      expect(destructive.map(t => t.name).sort()).toEqual(['applyDiff', 'createWorktree', 'removeWorktree', 'runCommand', 'writeFile']);
    });
  });
});
