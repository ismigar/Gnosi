// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type ChildNode, type Root, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { cssContracts } from './css-modules.baseline';

const frontend = fileURLToPath(new URL('../..', import.meta.url));

// Positions and formatting are not CSS semantics. Preserve every selector,
// ordered declaration (including duplicates), value, priority and nested rule.
function semantic(node: Root | ChildNode): unknown[] {
  const children = 'nodes' in node
    ? node.nodes?.filter(child => child.type !== 'comment').map(semantic)
    : undefined;
  if (node.type === 'decl') return ['decl', node.prop, node.value, node.important || false];
  if (node.type === 'rule') return ['rule', node.selector, children];
  if (node.type === 'atrule') {
    // Preserve the original baseline spelling only when the relocated source
    // directive still resolves to the exact same directory. Other drift fails.
    const file = node.source?.input.file;
    const params = node.name === 'source' && file
      && resolve(dirname(file), importPath(node.params)) === resolve(frontend, 'src')
      ? '"../src"' : node.params;
    return ['atrule', node.name, params, children];
  }
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
    if (!target.startsWith('./') && !target.startsWith('../')) throw new Error(`Nonlocal CSS import: ${target}`);
    const resolved = resolve(dirname(path), target);
    const withinSource = relative(resolve(frontend, 'src'), resolved);
    if (isAbsolute(withinSource) || withinSource === '..' || withinSource.startsWith('../')) {
      throw new Error(`CSS import escapes maintained source: ${target}`);
    }
    if (rule.parent !== root) throw new Error(`Nested CSS import: ${target}`);
    rule.replaceWith(...expand(resolve(dirname(path), target), visited).nodes);
  });
  return root;
}

function removeVerifiedMobileQuickAccessRule(root: Root): void {
  const matches: Rule[] = [];
  root.walkRules('.app-quick-access', rule => {
    const parent = rule.parent;
    if (parent?.type === 'atrule' && parent.name === 'media'
      && parent.params === '(max-width: 768px)') matches.push(rule);
  });
  expect(matches).toHaveLength(1);
  const actual = matches[0];
  if (!actual) throw new Error('Missing mobile quick-access rule');
  const expected = postcss.parse(`
.app-quick-access {
  inset-inline-start: calc(68px + 0.55rem);
  z-index: calc(var(--z-overlay) + 2);
}`).nodes[0];
  if (!expected) throw new Error('Missing expected quick-access rule');
  expect(semantic(actual)).toEqual(semantic(expected));
  expect(actual.prev()).toMatchObject({ type: 'rule', selector: '.app-sidebar--open' });
  expect(actual.next()).toMatchObject({ type: 'rule', selector: '.app-sidebar__item' });
  actual.remove();
}

function removeVerifiedHelpMenuRules(root: Root): void {
  // Check the intentional help menu addition without changing the original
  // extraction baseline or allowing unrelated sidebar styles to drift.
  const addedRules = postcss.parse(`
.app-help { position: relative; }
.app-help__menu {
  position: absolute;
  inset-inline-start: calc(100% + 0.75rem);
  bottom: 0;
  z-index: calc(var(--z-overlay) + 3);
  width: min(17rem, calc(100vw - 88px));
  max-height: 70dvh;
  overflow-y: auto;
  padding: 0.375rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: var(--shadow-raised);
}
.app-help__menu a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 44px;
  padding: 0.625rem 0.75rem;
  border-radius: var(--radius-sm);
  color: inherit;
  font-size: 0.8125rem;
  text-decoration: none;
}
.app-help__menu a svg { flex-shrink: 0; }
.app-help__menu a:hover, .app-help__menu a:focus-visible {
  background: var(--bg-secondary);
  outline: 2px solid var(--accent-primary, #2563eb);
  outline-offset: -2px;
}`);
  for (const expected of addedRules.nodes) {
    if (expected.type !== 'rule') throw new Error('Expected help menu rule');
    const matches = root.nodes.filter(node => node.type === 'rule' && node.selector === expected.selector);
    expect(matches).toHaveLength(1);
    const actual = matches[0];
    if (!actual) throw new Error('Missing help menu rule');
    expect(semantic(actual)).toEqual(semantic(expected));
    actual.remove();
  }
}

function removeVerifiedResponsiveToolbarRules(root: Root): void {
  const toolbar = root.nodes.filter(node => node.type === 'rule' && node.selector === '.vault-view-toolbar');
  expect(toolbar).toHaveLength(1);
  const rule = toolbar[0];
  if (rule?.type !== 'rule') throw new Error('Missing toolbar rule');
  const layer = rule.nodes.filter(node => node.type === 'decl' && node.prop === 'z-index');
  expect(layer).toHaveLength(1);
  const declaration = layer[0];
  if (declaration?.type !== 'decl') throw new Error('Missing toolbar layer');
  expect(semantic(declaration)).toEqual(['decl', 'z-index', 'var(--z-popover)', false]);
  declaration.value = '25';
  const alignment = root.nodes.filter(node => node.type === 'rule'
    && node.selector === '.vault-view-toolbar > div:last-child,\n.vault-view-actions');
  expect(alignment).toHaveLength(1);
  const alignmentRule = alignment[0];
  if (!alignmentRule) throw new Error('Missing right-aligned actions');
  const expectedAlignment = postcss.parse(`
.vault-view-toolbar > div:last-child,
.vault-view-actions { margin-inline-start: auto; justify-content: flex-end; }
`).nodes[0];
  if (!expectedAlignment) throw new Error('Missing expected right-aligned actions');
  expect(semantic(alignmentRule)).toEqual(semantic(expectedAlignment));
  if (alignmentRule.prev()?.type === 'comment') alignmentRule.prev()?.remove();
  alignmentRule.remove();
  for (const [prop, value] of [['flex-wrap', 'wrap'], ['min-width', '0']] as const) {
    const declarations = rule.nodes.filter(node => node.type === 'decl' && node.prop === prop);
    expect(declarations).toHaveLength(1);
    const declaration = declarations[0];
    if (!declaration) throw new Error(`Missing toolbar declaration: ${prop}`);
    expect(semantic(declaration)).toEqual(['decl', prop, value, false]);
    declaration.remove();
  }
  const additions = postcss.parse(`
.vault-view-toolbar > div,
.vault-view-actions,
.vault-view-filter-status,
.vault-view-secondary-items {
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}
.vault-view-actions { justify-content: flex-end; }
.vault-view-secondary-items { display: flex; align-items: center; gap: 0.25rem; }
.vault-view-secondary summary { cursor: pointer; padding: 0.375rem; font-size: 0.75rem; }
.vault-view-secondary summary[hidden] { display: none; }
.vault-view-secondary:has(summary:not([hidden]))[open] {
  flex-basis: 100%;
  padding: 0.25rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
}`);
  for (const expected of additions.nodes) {
    if (expected.type !== 'rule') throw new Error('Expected responsive toolbar rule');
    const matches = root.nodes.filter(node => node.type === 'rule' && node.selector === expected.selector);
    expect(matches).toHaveLength(1);
    const actual = matches[0];
    if (!actual) throw new Error('Missing responsive toolbar rule');
    expect(semantic(actual)).toEqual(semantic(expected));
    expect(actual.prev()).toBe(rule);
    actual.remove();
  }
}

// Verify the intentional skill-switch changes before restoring the extraction
// snapshot. The immutable baseline continues to detect unrelated CSS drift.
function verifySkillSwitchRules(root: Root, global: boolean): void {
  const expected = postcss.parse(global ? `
.gnosi-toggle[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
` : `
.ai-agent-skill { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--settings-border); border-radius: 12px; }
.ai-agent-skill > .gnosi-toggle { flex-shrink: 0; margin-top: 2px; }
`);
  for (const rule of expected.nodes) {
    if (rule.type !== 'rule') throw new Error('Expected skill switch rule');
    const matches = root.nodes.filter(node => node.type === 'rule' && node.selector === rule.selector);
    expect(matches).toHaveLength(1);
    const actual = matches[0];
    if (actual?.type !== 'rule') throw new Error('Missing skill switch rule');
    expect(semantic(actual)).toEqual(semantic(rule));
    if (global) actual.remove();
    else if (rule.selector === '.ai-agent-skill') actual.append({ prop: 'cursor', value: 'pointer' });
    else {
      actual.selector = '.ai-agent-skill > input';
      actual.removeAll();
      actual.append({ prop: 'margin-top', value: '4px' }, { prop: 'accent-color', value: 'var(--gnosi-blue)' });
    }
  }
}

function removeVerifiedActivityRules(root: Root): void {
  const expected = postcss.parse(`
.ai-activity-panel {
    --settings-bg: var(--bg-primary);
    --settings-input-bg: var(--bg-primary);
    --settings-sidebar-bg: var(--bg-secondary);
    --settings-border: var(--border-primary);
}

.ai-resource-details pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.ai-resource-tool-option__copy > span {
    overflow-wrap: anywhere;
}

.ai-activity-panel .ai-resources-toolbar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.ai-activity-panel .ai-resource-card__actions {
    flex-wrap: wrap;
    align-items: center;
}

.ai-automation-editor .ai-resource-editor__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}
.ai-schedule-fields__help,
.ai-schedule-fields > fieldset {
    grid-column: 1 / -1;
}
.ai-schedule-fields__help {
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin: 0;
}
.ai-schedule-fields > fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}
@media (max-width: 760px) {
    .ai-activity-panel .ai-resources-toolbar,
    .ai-automation-editor .ai-resource-editor__grid {
        grid-template-columns: minmax(0, 1fr);
    }
}

.ai-history-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
}
`);
  for (const node of expected.nodes) {
    const matches = root.nodes.filter(actual => JSON.stringify(semantic(actual)) === JSON.stringify(semantic(node)));
    expect(matches).toHaveLength(1);
    matches[0]?.remove();
  }
}

function extractionTree(entry: string): Root {
  const root = expand(resolve(frontend, entry));
  if (entry === 'src/app/styles/index.css') {
    verifySkillSwitchRules(root, true);
    // Verify the mobile control's exact scope, declarations and cascade position
    // before removing this reviewed addition from the immutable baseline check.
    removeVerifiedMobileQuickAccessRule(root);
    removeVerifiedHelpMenuRules(root);
    removeVerifiedResponsiveToolbarRules(root);
    for (const selector of ['.vault-views-header', '.vault-new-record-menu']) {
      const rules = root.nodes.filter(node => node.type === 'rule' && node.selector === selector);
      expect(rules).toHaveLength(1);
      const rule = rules[0];
      if (rule?.type !== 'rule') throw new Error(`Missing ${selector}`);
      const layers = rule.nodes.filter(node => node.type === 'decl' && node.prop === 'z-index');
      expect(layers).toHaveLength(1);
      const layer = layers[0];
      if (layer?.type !== 'decl') throw new Error(`Missing ${selector} layer`);
      expect(semantic(layer)).toEqual(['decl', 'z-index', 'var(--z-modal-dropdown)', false]);
      layer.value = 'var(--z-popover)';
    }
    // Assert the reviewed keyboard-focus changes before restoring only those
    // rules for comparison with the immutable extraction baseline.
    const addedRules = postcss.parse(`
.bn-editor .bn-block-content[data-content-type="gnosi_view"] .gnosi-view-embed-container:focus {
  outline: 2px solid var(--gnosi-primary) !important;
  outline-offset: 2px;
  border-radius: 8px !important;
}
.bn-editor .bn-block-content[data-content-type="gnosi_view"].ProseMirror-selectednode > *::after,
.bn-editor .ProseMirror-selectednode > .bn-block-content[data-content-type="gnosi_view"] > *::after,
.bn-editor .node-gnosi_view.ProseMirror-selectednode::after {
  content: none !important;
  display: none !important;
}`);
    for (const expected of addedRules.nodes) {
      if (expected.type !== 'rule') throw new Error('Expected focus rule');
      const matches = root.nodes.filter(node => node.type === 'rule' && node.selector === expected.selector);
      expect(matches).toHaveLength(1);
      const actual = matches[0];
      if (!actual) throw new Error('Missing focus rule');
      expect(semantic(actual)).toEqual(semantic(expected));
      actual.remove();
    }
    const currentSelector = '.bn-editor:focus .bn-block-outer:has(> .bn-block > .bn-block-content.ProseMirror-selectednode):not(:has(.gnosi-view-embed-container :focus)),\n.bn-editor:focus .bn-block-outer:has(> .bn-block-content.ProseMirror-selectednode):not(:has(.gnosi-view-embed-container :focus))';
    let restored = 0;
    root.walkRules(currentSelector, rule => {
      rule.selector = '.bn-editor .bn-block-outer:has(> .bn-block > .bn-block-content.ProseMirror-selectednode),\n.bn-editor .bn-block-outer:has(> .bn-block-content.ProseMirror-selectednode)';
      restored += 1;
    });
    expect(restored).toBe(1);
  }
  if (entry === 'src/features/settings/AI/AIResourcesSettings.css') {
    verifySkillSwitchRules(root, false);
    removeVerifiedActivityRules(root);
    // Another reviewed change: axe found 3.67:1 active-tab text.
    // Assert the exact accessible replacement before comparing everything else
    // against the immutable original hash; never regenerate that baseline.
    let replacements = 0;
    root.walkRules('.ai-settings-sections button.is-active', rule => {
      rule.walkDecls('color', declaration => {
        expect(declaration.value).toBe('var(--sidebar-item-active-text)');
        declaration.value = 'var(--gnosi-blue)';
        replacements += 1;
      });
    });
    expect(replacements).toBe(1);
  }
  return root;
}

describe('semantic CSS extraction contracts', () => {
  for (const contract of cssContracts) {
    describe(contract.entry, () => {
      it('preserves the ordered AST apart from explicitly asserted UI changes', () => {
        const expanded = extractionTree(contract.entry);
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
            expect(module).toBe('src/app/styles/index.tailwind.css');
            expect(importPath(rule.params)).toBe('tailwindcss');
          });
        }
      });

      it('detects cascade-order, token and priority drift', () => {
        const root = extractionTree(contract.entry);
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
    const path = resolve(frontend, 'src/app/styles/index.tailwind.css');
    const root = parseFile(path);
    const directives = root.nodes.filter(node => node.type === 'atrule');
    expect(directives.map(node => [node.name, node.params])).toEqual([
      ['import', '"tailwindcss"'], ['source', '"../.."'],
      ['theme', ''], ['custom-variant', 'dark (&:where(.dark, .dark *))'],
    ]);
    expect(resolve(dirname(path), '../..')).toBe(resolve(frontend, 'src'));
  });

  it('retains responsive groups intact and after their original base rules', () => {
    const global = expand(resolve(frontend, 'src/app/styles/index.css'));
    const mobile = global.nodes.filter(node => node.type === 'atrule'
      && node.name === 'media' && node.params === '(max-width: 768px)');
    expect(mobile).toHaveLength(2);
    const literature = expand(resolve(frontend, 'src/features/literature/LiteraturePage.css'));
    const media: string[] = [];
    literature.walkAtRules('media', rule => { media.push(rule.params); });
    expect(media).toEqual(['(max-width: 900px)', '(max-width: 560px)']);
    expect(literature.nodes.at(-1)).toMatchObject({
      type: 'rule', selector: '.literature-review-schedule small',
    });
  });
});
