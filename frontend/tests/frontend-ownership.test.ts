// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(frontend, 'src');

function stylesWithin(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${path}`);
    if (entry.isDirectory()) return stylesWithin(path);
    return entry.isFile() && entry.name.endsWith('.css') ? [path] : [];
  });
}

describe('final frontend ownership', () => {
  it('keeps every maintained stylesheet within 500 lines', () => {
    for (const path of stylesWithin(source)) {
      expect(readFileSync(path, 'utf8').trimEnd().split('\n').length, path).toBeLessThanOrEqual(500);
    }
  });
  it('keeps only application, feature, shared and generated roots', () => {
    const roots = readdirSync(source, { withFileTypes: true });
    expect(roots.map(entry => entry.name).sort()).toEqual(['app', 'features', 'generated', 'shared']);
    expect(roots.every(entry => entry.isDirectory() && !entry.isSymbolicLink())).toBe(true);
  });

  it('declares exact, existing feature entry points with a review reason', () => {
    const entries: unknown = JSON.parse(readFileSync(resolve(frontend, 'feature-public-entries.json'), 'utf8'));
    expect(entries).toBeTypeOf('object');
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new Error('Public feature entries must be an object');
    }
    for (const [path, reason] of Object.entries(entries)) {
      expect(path).toMatch(/^features\/[a-z][a-z-]*\/.+\.(?:ts|tsx|css)$/);
      expect(path).not.toMatch(/\.\.|[*?\\]/);
      expect(existsSync(resolve(source, path)), path).toBe(true);
      expect(typeof reason === 'string' && reason.trim().length > 15, path).toBe(true);
    }
  });

  it('starts from the maintained TypeScript application entry', () => {
    const html = readFileSync(resolve(frontend, 'index.html'), 'utf8');
    expect(html).toContain('src="/src/app/main.tsx"');
    expect(existsSync(resolve(source, 'app/main.tsx'))).toBe(true);
    expect(html).not.toContain('/src/main.jsx');
  });
});
