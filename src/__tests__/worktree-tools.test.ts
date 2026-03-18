/**
 * worktree-tools.test.ts — Tests for worktree lock serialization + safe cleanup.
 *
 * Covers:
 * 1. Lock acquisition and release (file-based mutex)
 * 2. Stale lock detection and cleanup
 * 3. Merge-status checking before worktree removal
 * 4. Force override for unmerged branches
 * 5. Tool definition schema correctness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { executeTool, TOOL_DEFINITIONS } from '../agent-tools';
import type { ToolCall } from '../agent-types';
import { workspace } from '../__mocks__/vscode';

const MOCK_ROOT = path.resolve('/test-workspace');
const MOCK_GIT_DIR = path.join(MOCK_ROOT, '.git');
const LOCK_PATH = path.join(MOCK_GIT_DIR, 'worktree-create.lock');

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    openSync: vi.fn(),
    closeSync: vi.fn(),
    unlinkSync: vi.fn(),
    statSync: vi.fn(),
    constants: actual.constants,
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
    execSync: vi.fn(),
  };
});

function makeCall(name: string, args: Record<string, unknown>, id = 'tc_test'): ToolCall {
  return { id, name, args, permission: 'destructive' };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('worktree tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (workspace.workspaceFolders as any) = [{ uri: { fsPath: MOCK_ROOT }, name: 'test', index: 0 }];
  });

  // ── Tool definitions ──────────────────────────────────────────────────

  describe('tool definitions', () => {
    it('createWorktree is defined as destructive', () => {
      const tool = TOOL_DEFINITIONS.find(t => t.name === 'createWorktree');
      expect(tool).toBeDefined();
      expect(tool!.permission).toBe('destructive');
      expect(tool!.args.branch.required).toBe(true);
    });

    it('removeWorktree has force arg', () => {
      const tool = TOOL_DEFINITIONS.find(t => t.name === 'removeWorktree');
      expect(tool).toBeDefined();
      expect(tool!.args.force).toBeDefined();
      expect(tool!.args.force.type).toBe('boolean');
      expect(tool!.args.deleteBranch).toBeDefined();
    });

    it('removeWorktree description mentions merge check', () => {
      const tool = TOOL_DEFINITIONS.find(t => t.name === 'removeWorktree');
      expect(tool!.description).toContain('unmerged');
    });
  });

  // ── createWorktree ────────────────────────────────────────────────────

  describe('createWorktree', () => {
    it('requires branch arg', async () => {
      const result = await executeTool(makeCall('createWorktree', {}));
      expect(result.status).toBe('error');
      expect(result.output).toContain('Missing required arg: branch');
    });

    it('requires workspace folder', async () => {
      (workspace.workspaceFolders as any) = null;
      const result = await executeTool(makeCall('createWorktree', { branch: 'fix/test' }));
      expect(result.status).toBe('error');
      expect(result.output).toContain('No workspace folder');
    });

    it('acquires lock, creates worktree, releases lock', async () => {
      // Lock acquisition succeeds
      (fs.openSync as any).mockReturnValue(42);

      // git worktree add succeeds
      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'Preparing worktree', '');
      });

      const result = await executeTool(makeCall('createWorktree', { branch: 'fix/issue-99' }));

      expect(result.status).toBe('success');
      expect(result.output).toContain('Created worktree');
      expect(result.output).toContain('fix/issue-99');

      // Lock should have been acquired
      expect(fs.openSync).toHaveBeenCalledWith(
        LOCK_PATH,
        expect.any(Number), // O_CREAT | O_EXCL | O_WRONLY
      );

      // Lock should have been released
      expect(fs.closeSync).toHaveBeenCalledWith(42);
      expect(fs.unlinkSync).toHaveBeenCalledWith(LOCK_PATH);
    });

    it('returns error when git worktree add fails', async () => {
      (fs.openSync as any).mockReturnValue(42);

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(new Error('branch already exists'), '', 'fatal: branch already exists');
      });

      const result = await executeTool(makeCall('createWorktree', { branch: 'fix/existing' }));

      expect(result.status).toBe('error');
      expect(result.output).toContain('Failed to create worktree');

      // Lock must still be released even on failure
      expect(fs.closeSync).toHaveBeenCalledWith(42);
    });

    it('detects and removes stale locks', async () => {
      let callCount = 0;
      // First call: lock exists (EEXIST). Second call: succeeds (stale lock removed)
      (fs.openSync as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const err: any = new Error('EEXIST');
          err.code = 'EEXIST';
          throw err;
        }
        return 42;
      });

      // Stale lock: older than 30s
      (fs.statSync as any).mockReturnValue({
        mtimeMs: Date.now() - 60_000, // 60s ago = stale
      });

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, 'ok', '');
      });

      const result = await executeTool(makeCall('createWorktree', { branch: 'fix/stale-test' }));

      expect(result.status).toBe('success');
      // Stale lock should have been unlinked before retry
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('times out when lock cannot be acquired', async () => {
      // Lock always exists and is fresh
      (fs.openSync as any).mockImplementation(() => {
        const err: any = new Error('EEXIST');
        err.code = 'EEXIST';
        throw err;
      });

      (fs.statSync as any).mockReturnValue({
        mtimeMs: Date.now() - 1_000, // 1s ago = fresh, not stale
      });

      const result = await executeTool(makeCall('createWorktree', { branch: 'fix/blocked' }));

      expect(result.status).toBe('error');
      expect(result.output).toContain('Timed out');
      expect(result.output).toContain('lock');
    }, 35_000); // Allow for lock timeout
  });

  // ── removeWorktree ────────────────────────────────────────────────────

  describe('removeWorktree', () => {
    it('requires path arg', async () => {
      const result = await executeTool(makeCall('removeWorktree', {}));
      expect(result.status).toBe('error');
      expect(result.output).toContain('Missing required arg: path');
    });

    it('refuses to remove worktree with unmerged, recently active branch', async () => {
      // The branch name extracted from path "worktree-fix-issue-42" becomes "fix/issue/42"
      // (dashes converted to slashes after stripping "worktree-" prefix)
      (cp.execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('branch --merged')) return '  main\n  develop\n';
        if (cmd.includes('git log -1')) return `2 hours ago|${Math.floor(Date.now() / 1000) - 7200}`;
        return '';
      });

      const result = await executeTool(makeCall('removeWorktree', {
        path: '../worktree-fix-issue-42',
      }));

      expect(result.status).toBe('error');
      expect(result.output).toContain('Refusing to remove');
      expect(result.output).toContain('not merged');
      expect(result.output).toContain('recent activity');
    });

    it('allows removal of worktree with merged branch', async () => {
      // Path "worktree-fix-issue-42" => branch "fix/issue/42" after name extraction
      const extractedBranch = 'fix/issue/42';
      (cp.execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('branch --merged')) return `  main\n  ${extractedBranch}\n`;
        if (cmd.includes('git log -1')) return `1 hour ago|${Math.floor(Date.now() / 1000) - 3600}`;
        return '';
      });

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '', '');
      });

      const result = await executeTool(makeCall('removeWorktree', {
        path: '../worktree-fix-issue-42',
      }));

      expect(result.status).toBe('success');
      expect(result.output).toContain('Removed worktree');
    });

    it('allows removal of worktree with old unmerged branch (abandoned)', async () => {
      // Branch NOT merged, but inactive for >24h
      (cp.execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('branch --merged')) return '  main\n';
        if (cmd.includes('git log -1')) return `3 days ago|${Math.floor(Date.now() / 1000) - 259200}`;
        return '';
      });

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '', '');
      });

      const result = await executeTool(makeCall('removeWorktree', {
        path: '../worktree-fix-issue-99',
      }));

      expect(result.status).toBe('success');
    });

    it('force overrides merge check', async () => {
      // Branch NOT merged, recent activity, but force=true
      (cp.execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('branch --merged')) return '  main\n';
        if (cmd.includes('git log -1')) return `1 hour ago|${Math.floor(Date.now() / 1000) - 3600}`;
        return '';
      });

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '', '');
      });

      const result = await executeTool(makeCall('removeWorktree', {
        path: '../worktree-fix-issue-7',
        force: true,
      }));

      expect(result.status).toBe('success');
      expect(result.output).toContain('Removed worktree');
    });

    it('deletes merged branch when deleteBranch=true', async () => {
      // Path "worktree-fix-issue-55" => extracted branch "fix/issue/55"
      const extractedBranch = 'fix/issue/55';
      (cp.execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('branch --merged')) return `  main\n  ${extractedBranch}\n`;
        if (cmd.includes('git log -1')) return `2 days ago|${Math.floor(Date.now() / 1000) - 172800}`;
        if (cmd.includes('branch -d')) return `Deleted branch ${extractedBranch}`;
        return '';
      });

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '', '');
      });

      const result = await executeTool(makeCall('removeWorktree', {
        path: '../worktree-fix-issue-55',
        deleteBranch: true,
      }));

      expect(result.status).toBe('success');
      expect(result.output).toContain('Deleted merged branch');
    });

    it('preserves unmerged branch when deleteBranch=true but no force', async () => {
      // Branch NOT merged
      (cp.execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('branch --merged')) return '  main\n';
        if (cmd.includes('git log -1')) return `3 days ago|${Math.floor(Date.now() / 1000) - 259200}`;
        return '';
      });

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '', '');
      });

      const result = await executeTool(makeCall('removeWorktree', {
        path: '../worktree-fix-issue-77',
        deleteBranch: true,
      }));

      expect(result.status).toBe('success');
      expect(result.output).toContain('preserved');
      expect(result.output).toContain('not merged');
    });

    it('force-deletes unmerged branch when both deleteBranch=true and force=true', async () => {
      (cp.execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes('branch --merged')) return '  main\n';
        if (cmd.includes('git log -1')) return `1 hour ago|${Math.floor(Date.now() / 1000) - 3600}`;
        if (cmd.includes('branch -D')) return 'Deleted branch';
        return '';
      });

      (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) => {
        cb(null, '', '');
      });

      const result = await executeTool(makeCall('removeWorktree', {
        path: '../worktree-fix-issue-88',
        deleteBranch: true,
        force: true,
      }));

      expect(result.status).toBe('success');
      expect(result.output).toContain('Force-deleted unmerged branch');
    });
  });
});
