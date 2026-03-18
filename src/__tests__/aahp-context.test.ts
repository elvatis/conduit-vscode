/**
 * aahp-context.test.ts — Tests for AAHP v3 context detection and loading.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { detectAahpWorkspace, loadAahpContext, buildAahpContextBlock } from '../aahp-context';
import { workspace } from '../__mocks__/vscode';

const MOCK_ROOT = path.resolve('/test-workspace');
const MANIFEST_PATH = path.join(MOCK_ROOT, '.ai', 'handoff', 'MANIFEST.json');

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const SAMPLE_MANIFEST = {
  aahp_version: '3.0',
  project: 'TestProject',
  last_session: {
    agent: 'claude-code',
    phase: 'implementation',
    timestamp: '2026-03-18T10:00:00Z',
    commit: 'abc1234',
  },
  files: {
    'CONVENTIONS.md': { summary: 'TypeScript strict, English only', lines: 90 },
    'NEXT_ACTIONS.md': { summary: '3 tasks ready, 1 done', lines: 40 },
  },
  quick_context: 'Monorepo with 5 services, all green.',
  token_budget: { manifest_only: 100, manifest_plus_core: 1200, full_read: 5000 },
};

describe('aahp-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (workspace.workspaceFolders as any) = [{ uri: { fsPath: MOCK_ROOT }, name: 'test', index: 0 }];
  });

  describe('detectAahpWorkspace', () => {
    it('returns manifest path when .ai/handoff/MANIFEST.json exists', () => {
      (fs.existsSync as any).mockImplementation((p: string) => p === MANIFEST_PATH);
      const result = detectAahpWorkspace(MOCK_ROOT);
      expect(result).toBe(MANIFEST_PATH);
    });

    it('returns null when no MANIFEST.json', () => {
      (fs.existsSync as any).mockReturnValue(false);
      const result = detectAahpWorkspace(MOCK_ROOT);
      expect(result).toBeNull();
    });

    it('returns null when no workspace root provided and none open', () => {
      (workspace.workspaceFolders as any) = null;
      (fs.existsSync as any).mockReturnValue(false);
      const result = detectAahpWorkspace();
      expect(result).toBeNull();
    });
  });

  describe('loadAahpContext', () => {
    it('loads full AAHP context from MANIFEST.json', () => {
      (fs.existsSync as any).mockImplementation((p: string) => {
        return p === MANIFEST_PATH || p.endsWith('CONVENTIONS.md') || p.endsWith('NEXT_ACTIONS.md');
      });
      (fs.readFileSync as any).mockImplementation((p: string) => {
        if (p === MANIFEST_PATH) return JSON.stringify(SAMPLE_MANIFEST);
        if (p.endsWith('CONVENTIONS.md')) return '# Conventions\n- TypeScript strict\n- English only';
        if (p.endsWith('NEXT_ACTIONS.md')) return '# Tasks\n- [ ] T-010: Add auth\n- [x] T-009: Deploy';
        return '';
      });

      const ctx = loadAahpContext(MOCK_ROOT);
      expect(ctx).not.toBeNull();
      expect(ctx!.project).toBe('TestProject');
      expect(ctx!.phase).toBe('implementation');
      expect(ctx!.quickContext).toBe('Monorepo with 5 services, all green.');
      expect(ctx!.conventions).toContain('TypeScript strict');
      expect(ctx!.activeTasks).toContain('T-010');
      expect(ctx!.lastSession).toContain('claude-code');
      expect(ctx!.lastSession).toContain('abc1234');
      expect(ctx!.tokenEstimate).toBe(1200);
    });

    it('returns null when no MANIFEST.json', () => {
      (fs.existsSync as any).mockReturnValue(false);
      const ctx = loadAahpContext(MOCK_ROOT);
      expect(ctx).toBeNull();
    });

    it('handles missing optional files gracefully', () => {
      (fs.existsSync as any).mockImplementation((p: string) => p === MANIFEST_PATH);
      (fs.readFileSync as any).mockImplementation((p: string) => {
        if (p === MANIFEST_PATH) return JSON.stringify({
          aahp_version: '3.0',
          project: 'MinimalProject',
          quick_context: 'Just a test',
        });
        return '';
      });

      const ctx = loadAahpContext(MOCK_ROOT);
      expect(ctx).not.toBeNull();
      expect(ctx!.project).toBe('MinimalProject');
      expect(ctx!.phase).toBe('unknown');
      expect(ctx!.conventions).toBeNull();
      expect(ctx!.activeTasks).toBeNull();
      expect(ctx!.lastSession).toBeNull();
    });

    it('handles malformed JSON gracefully', () => {
      (fs.existsSync as any).mockImplementation((p: string) => p === MANIFEST_PATH);
      (fs.readFileSync as any).mockReturnValue('not json');

      const ctx = loadAahpContext(MOCK_ROOT);
      expect(ctx).toBeNull();
    });

    it('truncates large convention files', () => {
      (fs.existsSync as any).mockImplementation((p: string) => {
        return p === MANIFEST_PATH || p.endsWith('CONVENTIONS.md');
      });
      (fs.readFileSync as any).mockImplementation((p: string) => {
        if (p === MANIFEST_PATH) return JSON.stringify(SAMPLE_MANIFEST);
        if (p.endsWith('CONVENTIONS.md')) return 'x'.repeat(5000); // exceeds MAX_CONVENTIONS_CHARS
        return '';
      });

      const ctx = loadAahpContext(MOCK_ROOT);
      expect(ctx!.conventions!.length).toBeLessThan(4000);
      expect(ctx!.conventions).toContain('truncated');
    });
  });

  describe('buildAahpContextBlock', () => {
    it('builds a complete context block', () => {
      const ctx = loadAahpContext(MOCK_ROOT);
      // Mock for this test
      (fs.existsSync as any).mockImplementation((p: string) => p === MANIFEST_PATH);
      (fs.readFileSync as any).mockImplementation((p: string) => {
        if (p === MANIFEST_PATH) return JSON.stringify(SAMPLE_MANIFEST);
        return '';
      });

      const ctx2 = loadAahpContext(MOCK_ROOT)!;
      const block = buildAahpContextBlock(ctx2);

      expect(block).toContain('[AAHP v3 Context: TestProject]');
      expect(block).toContain('Phase: implementation');
      expect(block).toContain('Monorepo with 5 services');
      expect(block).toContain('claude-code');
    });

    it('handles minimal context (no conventions, no tasks)', () => {
      const block = buildAahpContextBlock({
        project: 'Minimal',
        phase: 'planning',
        quickContext: 'Just started',
        conventions: null,
        activeTasks: null,
        lastSession: null,
        tokenEstimate: 50,
      });

      expect(block).toContain('[AAHP v3 Context: Minimal]');
      expect(block).toContain('Phase: planning');
      expect(block).toContain('Just started');
      expect(block).not.toContain('Conventions');
      expect(block).not.toContain('Active Tasks');
    });
  });
});
