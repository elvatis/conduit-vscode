import { describe, it, expect } from 'vitest';
import { guessLanguage } from '../mention-parser';

describe('guessLanguage', () => {
  it('maps TypeScript extensions', () => {
    expect(guessLanguage('file.ts')).toBe('typescript');
    expect(guessLanguage('component.tsx')).toBe('typescriptreact');
  });

  it('maps JavaScript extensions', () => {
    expect(guessLanguage('app.js')).toBe('javascript');
    expect(guessLanguage('app.jsx')).toBe('javascriptreact');
  });

  it('maps Python', () => {
    expect(guessLanguage('script.py')).toBe('python');
  });

  it('maps Go', () => {
    expect(guessLanguage('main.go')).toBe('go');
  });

  it('maps Rust', () => {
    expect(guessLanguage('lib.rs')).toBe('rust');
  });

  it('maps markup/data formats', () => {
    expect(guessLanguage('README.md')).toBe('markdown');
    expect(guessLanguage('config.json')).toBe('json');
    expect(guessLanguage('config.yaml')).toBe('yaml');
    expect(guessLanguage('config.yml')).toBe('yaml');
    expect(guessLanguage('index.html')).toBe('html');
    expect(guessLanguage('style.css')).toBe('css');
    expect(guessLanguage('style.scss')).toBe('scss');
  });

  it('maps C/C++ extensions', () => {
    expect(guessLanguage('main.c')).toBe('c');
    expect(guessLanguage('main.cpp')).toBe('cpp');
    expect(guessLanguage('header.h')).toBe('c');
  });

  it('maps framework-specific extensions', () => {
    expect(guessLanguage('App.vue')).toBe('vue');
    expect(guessLanguage('Page.svelte')).toBe('svelte');
  });

  it('returns empty string for unknown extensions', () => {
    expect(guessLanguage('file.xyz')).toBe('');
    expect(guessLanguage('Makefile')).toBe('');
  });

  it('handles paths with directories', () => {
    expect(guessLanguage('/src/components/Button.tsx')).toBe('typescriptreact');
  });

  it('is case insensitive', () => {
    expect(guessLanguage('FILE.TS')).toBe('typescript');
    expect(guessLanguage('README.MD')).toBe('markdown');
  });
});
