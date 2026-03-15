import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { loadCustomInstructions } from '../custom-instructions';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}));

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOME = '/home/testuser';
  process.env.USERPROFILE = '/home/testuser';
});

// Normalize path separators for cross-platform matching
function pathContains(p: any, fragment: string): boolean {
  return String(p).replace(/\\/g, '/').includes(fragment);
}

describe('loadCustomInstructions', () => {
  it('returns empty string when no instruction files exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadCustomInstructions()).toBe('');
  });

  it('loads global instructions from ~/.conduit/instructions.md', () => {
    mockExistsSync.mockImplementation((p: any) =>
      pathContains(p, 'testuser') && pathContains(p, '.conduit/instructions.md'),
    );
    mockReadFileSync.mockReturnValue('Global rules here');

    const result = loadCustomInstructions();
    expect(result).toContain('[Global instructions]');
    expect(result).toContain('Global rules here');
  });

  it('loads project instructions from .conduit/instructions.md', () => {
    mockExistsSync.mockImplementation((p: any) =>
      pathContains(p, '.conduit/instructions.md') && !pathContains(p, 'testuser'),
    );
    mockReadFileSync.mockReturnValue('Project rules');

    const result = loadCustomInstructions();
    expect(result).toContain('[Project instructions: test]');
    expect(result).toContain('Project rules');
  });

  it('falls back to .github/copilot-instructions.md', () => {
    mockExistsSync.mockImplementation((p: any) =>
      pathContains(p, 'copilot-instructions.md'),
    );
    mockReadFileSync.mockReturnValue('Copilot compat rules');

    const result = loadCustomInstructions();
    expect(result).toContain('Copilot compat rules');
  });

  it('falls back to CLAUDE.md', () => {
    mockExistsSync.mockImplementation((p: any) =>
      String(p).endsWith('CLAUDE.md'),
    );
    mockReadFileSync.mockReturnValue('Claude rules');

    const result = loadCustomInstructions();
    expect(result).toContain('Claude rules');
  });

  it('truncates files longer than 4000 chars', () => {
    const longContent = 'X'.repeat(5000);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(longContent);

    const result = loadCustomInstructions();
    expect(result).toContain('(truncated)');
    expect(result).not.toContain('X'.repeat(4001));
  });

  it('combines global and project instructions', () => {
    mockExistsSync.mockImplementation((p: any) =>
      pathContains(p, '.conduit/instructions.md'),
    );
    mockReadFileSync.mockImplementation((p: any) => {
      if (pathContains(p, 'testuser')) return 'GLOBAL';
      return 'PROJECT';
    });

    const result = loadCustomInstructions();
    expect(result).toContain('[Global instructions]');
    expect(result).toContain('GLOBAL');
    expect(result).toContain('[Project instructions:');
    expect(result).toContain('PROJECT');
  });

  it('prefers .conduit/instructions.md over copilot/CLAUDE fallbacks', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('conduit-specific');

    const result = loadCustomInstructions();
    // Should only include one project instruction entry (the first match)
    const projectMatches = result.match(/\[Project instructions:/g);
    expect(projectMatches?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
