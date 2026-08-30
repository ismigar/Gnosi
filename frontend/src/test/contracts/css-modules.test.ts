// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type ChildNode, type Root } from 'postcss';
import { describe, expect, it } from 'vitest';
import { cssContracts } from './css-modules.baseline';

const frontend = fileURLToPath(new URL('../../..', import.meta.url));

// Positions and formatting are not CSS semantics. Preserve every selector,
// ordered declaration (including duplicates), value, priority and nested rule.
function semantic(node: Root | ChildNode): unknown[] {
  const children = 'nodes' in node
    ? node.nodes?.filter(child => child.type !== 'comment').map(semantic)
    : undefined;
  if (node.type === 'decl') return ['decl', node.prop, node.value, node.important || false];
  if (node.type === 'rule') return ['rule', node.selector, children];
  if (node.type === 'atrule') return ['atrule', node.name, node.params, children];
  return ['root', children];
}

function digest(root: Root): string {
  return createHash('sha256').update(JSON.stringify(semantic(root))).digest('hex');
}

function parseFile(path: string): Root {
  return postcss.parse(readFileSync(path, 'utf8'), { from: path });
}

function importPath(params: string): string {
  const path = /^["']([^"']+)["']$/.exec(params)?.[1];
  if (!path) throw new Error(`Unsupported CSS import: ${params}`);
  return path;
}

function expand(path: string, visited = new Set<string>()): Root {
  if (visited.has(path)) throw new Error(`Duplicate or cyclic CSS import: ${path}`);
  visited.add(path);
  const root = parseFile(path);
  root.walkAtRules('import', rule => {
    const target = importPath(rule.params);
    if (target === 'tailwindcss') return;
    if (!target.startsWith('./')) throw new Error(`Nonlocal CSS import: ${target}`);
    if (rule.parent !== root) throw new Error(`Nested CSS import: ${target}`);
    rule.replaceWith(...expand(resolve(dirname(path), target), visited).nodes);
  });
  return root;
}

describe('semantic CSS extraction contracts', () => {
  for (const contract of cssContracts) {
    describe(contract.entry, () => {
      it('preserves the complete ordered AST from the authorized base', () => {
        const expanded = expand(resolve(frontend, contract.entry));
        expect(digest(expanded)).toBe(contract.astSha256);
        expect(expanded.nodes.filter(node => node.type !== 'comment'))
          .toHaveLength(contract.topLevelNodes);
      });

      it('keeps one explicit, valid import-only entrypoint in the original order', () => {
        const path = resolve(frontend, contract.entry);
        const root = parseFile(path);
        const targets = root.nodes.filter(node => node.type !== 'comment').map(node => {
          if (node.type !== 'atrule' || node.name !== 'import') {
            throw new Error('Entrypoints must contain only ordered imports');
          }
          return resolve(dirname(path), importPath(node.params));
        });
        expect(targets).toEqual(contract.modules.map(path => resolve(frontend, path)));
        expect(new Set(targets).size).toBe(targets.length);
      });

      it('keeps complete semantic modules within 500 physical lines', () => {
        for (const module of contract.modules) {
          const path = resolve(frontend, module);
          const content = readFileSync(path, 'utf8');
          expect(content.trimEnd().split('\n').length, module).toBeLessThanOrEqual(500);
          const root = parseFile(path);
          expect(root.nodes.length, module).toBeGreaterThan(0);
          // There were no asset URLs in either original; forbid an untested rebase.
          expect(content, module).not.toMatch(/url\(/i);
          root.walkAtRules('import', rule => {
            expect(module).toBe('src/index.tailwind.css');
            expect(importPath(rule.params)).toBe('tailwindcss');
          });
        }
      });

      it('detects cascade-order, token and priority drift', () => {
        const root = expand(resolve(frontend, contract.entry));
        const reordered = root.clone();
        reordered.nodes.reverse();
        expect(digest(reordered)).not.toBe(contract.astSha256);
        const valueDrift = root.clone();
        valueDrift.walkDecls(declaration => { declaration.value += ' changed'; });
        expect(digest(valueDrift)).not.toBe(contract.astSha256);
        const priorityDrift = root.clone();
        priorityDrift.walkDecls(declaration => { declaration.important = !declaration.important; });
        expect(digest(priorityDrift)).not.toBe(contract.astSha256);
      });
    });
  }

  it('preserves Tailwind directives and the exact source-directory resolution', () => {
    const path = resolve(frontend, 'src/index.tailwind.css');
    const root = parseFile(path);
    const directives = root.nodes.filter(node => node.type === 'atrule');
    expect(directives.map(node => [node.name, node.params])).toEqual([
      ['import', '"tailwindcss"'], ['source', '"../src"'],
      ['theme', ''], ['custom-variant', 'dark (&:where(.dark, .dark *))'],
    ]);
    expect(resolve(dirname(path), '../src')).toBe(resolve(frontend, 'src'));
  });

  it('retains responsive groups intact and after their original base rules', () => {
    const global = expand(resolve(frontend, 'src/index.css'));
    const mobile = global.nodes.filter(node => node.type === 'atrule'
      && node.name === 'media' && node.params === '(max-width: 768px)');
    expect(mobile).toHaveLength(2);
    const literature = expand(resolve(frontend, 'src/pages/LiteraturePage.css'));
    const media: string[] = [];
    literature.walkAtRules('media', rule => { media.push(rule.params); });
    expect(media).toEqual(['(max-width: 900px)', '(max-width: 560px)']);
    expect(literature.nodes.at(-1)).toMatchObject({
      type: 'rule', selector: '.literature-review-schedule small',
    });
  });
});
