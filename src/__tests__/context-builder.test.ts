import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildInlinePrompt, type EditorContext } from '../context-builder';

function makeContext(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    language: 'typescript',
    fileName: 'src/app.ts',
    prefix: 'const x = ',
    suffix: ';\nconsole.log(x);',
    selection: '',
    fullFile: 'const x = 42;\nconsole.log(x);',
    openFiles: [],
    diagnostics: '',
    workspaceName: 'test-project',
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('includes file name and language', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('typescript');
  });

  it('includes workspace name', () => {
    const prompt = buildSystemPrompt(makeContext({ workspaceName: 'my-project' }));
    expect(prompt).toContain('my-project');
  });

  it('includes diagnostics when present', () => {
    const prompt = buildSystemPrompt(makeContext({
      diagnostics: 'Line 5: [error] Type mismatch',
    }));
    expect(prompt).toContain('Type mismatch');
    expect(prompt).toContain('diagnostics');
  });

  it('does not include diagnostics section when empty', () => {
    const prompt = buildSystemPrompt(makeContext({ diagnostics: '' }));
    expect(prompt).not.toContain('Active diagnostics');
  });

  it('includes open files when present', () => {
    const prompt = buildSystemPrompt(makeContext({
      openFiles: [
        { fileName: 'utils.ts', language: 'typescript', content: 'export function add(a: number, b: number) {}' },
      ],
    }));
    expect(prompt).toContain('utils.ts');
    expect(prompt).toContain('export function add');
  });

  it('mentions Conduit identity', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('Conduit');
  });

  it('asks for concise responses', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('concisely');
  });
});

describe('buildInlinePrompt', () => {
  it('includes prefix code', () => {
    const prompt = buildInlinePrompt(makeContext({ prefix: 'function hello(' }));
    expect(prompt).toContain('function hello(');
  });

  it('includes suffix code', () => {
    const prompt = buildInlinePrompt(makeContext({ suffix: '}\nreturn result;' }));
    expect(prompt).toContain('return result;');
  });

  it('instructs to return only completion text', () => {
    const prompt = buildInlinePrompt(makeContext());
    expect(prompt).toContain('ONLY the completion text');
  });

  it('instructs no markdown fences', () => {
    const prompt = buildInlinePrompt(makeContext());
    expect(prompt).toContain('No markdown fences');
  });

  it('uses TypeScript-specific hint for .ts files', () => {
    const prompt = buildInlinePrompt(makeContext({ language: 'typescript' }));
    expect(prompt).toContain('TypeScript');
  });

  it('uses Python-specific hint for .py files', () => {
    const prompt = buildInlinePrompt(makeContext({ language: 'python' }));
    expect(prompt).toContain('Python');
  });

  it('uses Markdown-specific hint for .md files', () => {
    const prompt = buildInlinePrompt(makeContext({ language: 'markdown' }));
    expect(prompt).toContain('sentence or paragraph');
  });

  it('uses default hint for unknown language', () => {
    const prompt = buildInlinePrompt(makeContext({ language: 'brainfuck' }));
    expect(prompt).toContain('Match the existing style');
  });

  it('handles empty suffix gracefully', () => {
    const prompt = buildInlinePrompt(makeContext({ suffix: '' }));
    expect(prompt).not.toContain('Code after cursor');
  });
});
