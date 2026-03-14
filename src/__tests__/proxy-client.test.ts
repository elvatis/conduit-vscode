import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import * as http from 'http';
import { checkHealth, listModels, complete } from '../proxy-client';
import * as vscode from 'vscode';

// Create a real HTTP server for testing
let server: http.Server;
let port: number;

function startMockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      port = addr.port;

      // Override config to point to our test server
      const mockGet = vi.fn((key: string, defaultValue?: any) => {
        if (key === 'proxyUrl') return `http://127.0.0.1:${port}`;
        if (key === 'apiKey') return 'test-key';
        if (key === 'defaultModel') return 'test-model';
        return defaultValue;
      });

      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: mockGet,
        update: vi.fn(),
      } as any);

      resolve();
    });
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

afterEach(async () => {
  await stopMockServer();
  vi.restoreAllMocks();
});

describe('checkHealth', () => {
  it('returns true when health endpoint returns ok', async () => {
    await startMockServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }
    });
    const result = await checkHealth();
    expect(result).toBe(true);
  });

  it('returns false when health endpoint returns error', async () => {
    await startMockServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error' }));
      }
    });
    const result = await checkHealth();
    expect(result).toBe(false);
  });

  it('returns false when server is unreachable', async () => {
    // Point to a port nothing listens on
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'proxyUrl') return 'http://127.0.0.1:19999';
        if (key === 'apiKey') return 'test-key';
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);
    const result = await checkHealth();
    expect(result).toBe(false);
  });
});

describe('listModels', () => {
  it('returns model list from /v1/models', async () => {
    await startMockServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'gpt-4', object: 'model', created: 1000, owned_by: 'openai' },
            { id: 'claude-3', object: 'model', created: 1001, owned_by: 'anthropic' },
          ],
        }));
      }
    });
    const models = await listModels();
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('gpt-4');
    expect(models[1].id).toBe('claude-3');
  });

  it('returns empty array on error', async () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'proxyUrl') return 'http://127.0.0.1:19999';
        if (key === 'apiKey') return 'test-key';
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);
    const models = await listModels();
    expect(models).toEqual([]);
  });

  it('returns empty array when data is missing', async () => {
    await startMockServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
      }
    });
    const models = await listModels();
    expect(models).toEqual([]);
  });
});

describe('complete', () => {
  it('sends messages and returns completion text', async () => {
    await startMockServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          expect(parsed.model).toBe('test-model');
          expect(parsed.stream).toBe(false);
          expect(parsed.messages).toHaveLength(1);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            choices: [{ message: { content: 'Hello, world!' } }],
          }));
        });
      }
    });

    const result = await complete({
      messages: [{ role: 'user', content: 'Say hello' }],
    });
    expect(result).toBe('Hello, world!');
  });

  it('returns empty string when choices are missing', async () => {
    await startMockServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', () => { body += ''; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        });
      }
    });

    const result = await complete({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toBe('');
  });

  it('uses specified model override', async () => {
    let receivedModel = '';
    await startMockServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          receivedModel = JSON.parse(body).model;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
        });
      }
    });

    await complete({
      messages: [{ role: 'user', content: 'test' }],
      model: 'custom-model',
    });
    expect(receivedModel).toBe('custom-model');
  });

  it('sends authorization header', async () => {
    let authHeader = '';
    await startMockServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        authHeader = req.headers.authorization ?? '';
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
        });
      }
    });

    await complete({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(authHeader).toBe('Bearer test-key');
  });
});
