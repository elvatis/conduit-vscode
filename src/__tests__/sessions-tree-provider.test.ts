import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SessionsTreeProvider,
  timeAgo,
  addBackgroundSession,
  killBackgroundSession,
  getBackgroundSessions,
  removeBackgroundSession,
  clearFinishedSessions,
  restorePersistedSessions,
  type BackgroundSessionStatus,
} from '../sessions-tree-provider';

// ── timeAgo ──────────────────────────────────────────────────────────────────

describe('timeAgo', () => {
  it('returns "just now" for < 60 seconds', () => {
    expect(timeAgo(Date.now() - 30_000)).toBe('just now');
  });

  it('returns minutes for < 1 hour', () => {
    expect(timeAgo(Date.now() - 120_000)).toBe('2m ago');
  });

  it('returns hours for < 1 day', () => {
    expect(timeAgo(Date.now() - 7_200_000)).toBe('2h ago');
  });

  it('returns "yesterday" for 1 day ago', () => {
    expect(timeAgo(Date.now() - 86_400_000)).toBe('yesterday');
  });

  it('returns days for < 7 days', () => {
    expect(timeAgo(Date.now() - 3 * 86_400_000)).toBe('3d ago');
  });

  it('returns date string for >= 7 days', () => {
    const old = Date.now() - 10 * 86_400_000;
    const result = timeAgo(old);
    // Should be a locale date string, not a relative time
    expect(result).not.toContain('ago');
    expect(result).not.toBe('yesterday');
  });

  it('boundary: exactly 60 seconds returns 1m ago', () => {
    expect(timeAgo(Date.now() - 60_000)).toBe('1m ago');
  });
});

// ── SessionsTreeProvider ─────────────────────────────────────────────────────

function makeMockContext(sessions: any[] = []) {
  return {
    globalState: {
      get: vi.fn((_key: string, defaultValue: any) => sessions.length > 0 ? sessions : defaultValue),
      update: vi.fn(),
    },
  } as any;
}

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'chat-1',
    title: 'Test Chat',
    model: 'web-claude/claude-opus',
    mode: 'ask',
    modelsUsed: ['web-claude/claude-opus'],
    messageCount: 5,
    createdAt: Date.now() - 3600_000,
    updatedAt: Date.now() - 60_000,
    ...overrides,
  };
}

describe('SessionsTreeProvider', () => {
  describe('getChildren (root)', () => {
    it('returns empty array when no sessions', async () => {
      const provider = new SessionsTreeProvider(makeMockContext([]));
      const children = await provider.getChildren();
      expect(children).toEqual([]);
    });

    it('returns flat SessionItems when only one provider', async () => {
      const sessions = [
        makeSession({ id: 'chat-1', model: 'web-claude/claude-opus' }),
        makeSession({ id: 'chat-2', model: 'web-claude/claude-sonnet' }),
      ];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const children = await provider.getChildren();

      // Single provider = flat list, no grouping
      expect(children).toHaveLength(2);
      expect((children[0] as any).session).toBeDefined(); // SessionItem
    });

    it('returns ProviderGroupItems when multiple providers', async () => {
      const sessions = [
        makeSession({ id: 'chat-1', model: 'web-claude/claude-opus' }),
        makeSession({ id: 'chat-2', model: 'web-grok/grok-fast' }),
      ];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const children = await provider.getChildren();

      // Multiple providers = grouped
      expect(children).toHaveLength(2);
      // Should be ProviderGroupItems (have sessions property)
      expect((children[0] as any).sessions).toBeDefined();
      expect((children[1] as any).sessions).toBeDefined();
    });

    it('sorts provider with active session first', async () => {
      const sessions = [
        makeSession({ id: 'chat-1', model: 'web-grok/grok-fast', updatedAt: Date.now() }),
        makeSession({ id: 'chat-2', model: 'web-claude/claude-opus', updatedAt: Date.now() - 1000 }),
      ];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      provider.refresh('chat-2'); // Make claude session active
      const children = await provider.getChildren();

      // Claude group should be first (has active session)
      expect((children[0] as any).providerId).toBe('web-claude');
    });
  });

  describe('getChildren (provider group)', () => {
    it('returns sorted SessionItems for a provider group', async () => {
      const sessions = [
        makeSession({ id: 'chat-1', model: 'web-claude/claude-opus', updatedAt: 1000 }),
        makeSession({ id: 'chat-2', model: 'web-claude/claude-sonnet', updatedAt: 2000 }),
        makeSession({ id: 'chat-3', model: 'web-grok/grok-fast' }),
      ];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const roots = await provider.getChildren();

      // Find the claude group
      const claudeGroup = roots.find((r: any) => r.providerId === 'web-claude');
      expect(claudeGroup).toBeDefined();

      const children = await provider.getChildren(claudeGroup);
      expect(children).toHaveLength(2);
      // Most recent first
      expect((children[0] as any).session.id).toBe('chat-2');
      expect((children[1] as any).session.id).toBe('chat-1');
    });
  });

  describe('SessionItem properties', () => {
    it('uses customTitle when set', async () => {
      const sessions = [makeSession({ customTitle: 'My Custom Title' })];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const children = await provider.getChildren();
      expect((children[0] as any).label).toBe('My Custom Title');
    });

    it('shows short model name in description', async () => {
      const sessions = [makeSession({ model: 'web-claude/claude-opus', modelsUsed: ['web-claude/claude-opus'] })];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const children = await provider.getChildren();
      expect((children[0] as any).description).toContain('claude-opus');
    });

    it('shows Multi-model for sessions with multiple models', async () => {
      const sessions = [makeSession({
        modelsUsed: ['web-claude/claude-opus', 'web-grok/grok-fast'],
      })];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const children = await provider.getChildren();
      expect((children[0] as any).description).toContain('Multi-model');
    });

    it('sets activeSession contextValue for active session', async () => {
      const sessions = [makeSession({ id: 'chat-active' })];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      provider.refresh('chat-active');
      const children = await provider.getChildren();
      expect((children[0] as any).contextValue).toBe('activeSession');
    });

    it('sets session contextValue for inactive session', async () => {
      const sessions = [makeSession({ id: 'chat-1' })];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      provider.refresh('other-id');
      const children = await provider.getChildren();
      expect((children[0] as any).contextValue).toBe('session');
    });
  });

  describe('ProviderGroupItem properties', () => {
    it('shows friendly label for known providers', async () => {
      const sessions = [
        makeSession({ model: 'web-claude/claude-opus' }),
        makeSession({ id: 'chat-2', model: 'web-grok/grok-fast' }),
      ];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const children = await provider.getChildren();
      const labels = children.map((c: any) => c.label);
      expect(labels).toContain('Claude');
      expect(labels).toContain('Grok');
    });

    it('shows session count in description', async () => {
      const sessions = [
        makeSession({ id: 'chat-1', model: 'web-claude/claude-opus' }),
        makeSession({ id: 'chat-2', model: 'web-claude/claude-sonnet' }),
        makeSession({ id: 'chat-3', model: 'web-grok/grok-fast' }),
      ];
      const provider = new SessionsTreeProvider(makeMockContext(sessions));
      const children = await provider.getChildren();
      const claudeGroup = children.find((c: any) => c.label === 'Claude');
      expect((claudeGroup as any).description).toBe('2 sessions');
      const grokGroup = children.find((c: any) => c.label === 'Grok');
      expect((grokGroup as any).description).toBe('1 session');
    });
  });
});

// ── Session Persistence ────────────────────────────────────────────────────

describe('session persistence', () => {
  function makeMockHandle(exitCode = 0) {
    return {
      pid: 12345,
      output: ['line 1\n', 'line 2\n'],
      kill: vi.fn(),
      result: Promise.resolve({ stdout: 'done', stderr: '', exitCode }),
    };
  }

  describe('restorePersistedSessions', () => {
    it('restores completed sessions from globalState', () => {
      const persisted = [
        {
          id: 'bg-1-1000',
          title: 'Fix #42',
          model: 'cli-claude/claude-sonnet-4-6',
          status: 'completed' as BackgroundSessionStatus,
          startedAt: 1000,
          finishedAt: 2000,
          lastOutputLine: 'done',
        },
      ];
      const ctx = makeMockContext();
      ctx.globalState.get = vi.fn((_key: string, defaultValue: any) => {
        if (_key === 'conduit.backgroundSessions') return persisted;
        return defaultValue;
      });
      restorePersistedSessions(ctx);

      const sessions = getBackgroundSessions();
      const restored = sessions.find(s => s.id === 'bg-1-1000');
      expect(restored).toBeDefined();
      expect(restored!.status).toBe('completed');
      expect(restored!.title).toBe('Fix #42');
    });

    it('marks previously running sessions as interrupted', () => {
      const persisted = [
        {
          id: 'bg-2-2000',
          title: 'Running task',
          model: 'cli-gemini/gemini-2.5-flash',
          status: 'running' as BackgroundSessionStatus,
          startedAt: 2000,
          lastOutputLine: 'processing...',
        },
      ];
      const ctx = makeMockContext();
      ctx.globalState.get = vi.fn((_key: string, defaultValue: any) => {
        if (_key === 'conduit.backgroundSessions') return persisted;
        return defaultValue;
      });
      restorePersistedSessions(ctx);

      const sessions = getBackgroundSessions();
      const restored = sessions.find(s => s.id === 'bg-2-2000');
      expect(restored).toBeDefined();
      expect(restored!.status).toBe('interrupted');
      expect(restored!.lastOutputLine).toContain('interrupted');
    });

    it('handles empty persisted state', () => {
      const ctx = makeMockContext();
      ctx.globalState.get = vi.fn(() => []);
      // Should not throw
      restorePersistedSessions(ctx);
    });
  });

  describe('removeBackgroundSession', () => {
    it('removes a completed session', () => {
      const ctx = makeMockContext();
      const provider = new SessionsTreeProvider(ctx);

      const handle = makeMockHandle(0);
      const session = addBackgroundSession('test-remove', 'cli-claude/claude-sonnet-4-6', handle);

      // Wait for it to complete
      return handle.result.then(() => {
        // Give the handler time to update status
        return new Promise(resolve => setTimeout(resolve, 50));
      }).then(() => {
        const removed = removeBackgroundSession(session.id);
        expect(removed).toBe(true);
        expect(getBackgroundSessions().find(s => s.id === session.id)).toBeUndefined();
      });
    });

    it('refuses to remove a running session', () => {
      const ctx = makeMockContext();
      const provider = new SessionsTreeProvider(ctx);

      const neverResolves = new Promise<any>(() => {}); // never resolves
      const handle = {
        pid: 999,
        output: [],
        kill: vi.fn(),
        result: neverResolves,
      };
      const session = addBackgroundSession('test-running', 'cli-claude/claude-sonnet-4-6', handle);
      const removed = removeBackgroundSession(session.id);
      expect(removed).toBe(false);

      // Cleanup
      killBackgroundSession(session.id);
    });
  });

  describe('clearFinishedSessions', () => {
    it('clears completed and failed sessions', () => {
      const ctx = makeMockContext();
      const provider = new SessionsTreeProvider(ctx);

      const h1 = makeMockHandle(0);
      const h2 = makeMockHandle(1);
      addBackgroundSession('task-1', 'cli-claude/claude-sonnet-4-6', h1);
      addBackgroundSession('task-2', 'cli-claude/claude-sonnet-4-6', h2);

      return Promise.all([h1.result, h2.result]).then(() => {
        return new Promise(resolve => setTimeout(resolve, 50));
      }).then(() => {
        const cleared = clearFinishedSessions();
        expect(cleared).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
