// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const frontend = fileURLToPath(new URL('../..', import.meta.url));
const lint = new ESLint({ cwd: frontend });
// This rule needs the TypeScript AST, not a whole-program semantic compilation.
// Keep the real parser/plugin/rule configuration and disable type-aware rules only
// for these synthetic snippets; production ESLint remains strictTypeChecked.
const syntaxLint = new ESLint({ cwd: frontend, overrideConfig: tseslint.configs.disableTypeChecked });
const rule = 'gnosi/feature-boundaries';

// Configuration/plugin startup belongs to suite setup, not the first rule case.
beforeAll(async () => {
  await lint.calculateConfigForFile('src/features/alpha/View.jsx');
  await syntaxLint.calculateConfigForFile('tests/contracts/feature-boundaries.test.ts');
});

async function messages(code: string, filePath = 'src/features/alpha/View.jsx', runner = lint) {
  const result = await runner.lintText(code, { filePath });
  expect(result.flatMap(item => item.messages).filter(item => item.fatal)).toEqual([]);
  return result.flatMap(item => item.messages).filter(item => item.ruleId === rule);
}

describe('feature architecture enforced by actual ESLint configuration', () => {
  it.each([
    "import '@/features/beta/private';",
    "export { value } from '../beta/private';",
    "export * from '@/features/beta/internal/index';",
    "const page = import('../beta/Page');",
    'const page = import(`@/features/beta/Page`);',
    "const page = require('../beta/Page');",
    "import '../alpha/../beta/private.ts?raw';",
  ])('rejects cross-feature internals: %s', async code => {
    expect(await messages(code)).toEqual([expect.objectContaining({ messageId: 'privateFeature' })]);
  });

  it.each([
    "import '@/features/beta';",
    "import '../beta';",
    "import '../beta/';",
    "export * from '../beta/index';",
    "export * from '@/features/beta/index.ts';",
    "const page = import('../beta/index.tsx');",
    "import './internal';",
    "import '@/features/alpha/nested/private';",
    "import '../../shared/api/vaults';",
    "import '@external/features/beta/private';",
  ])('allows public entries, own internals and shared adapters: %s', async code => {
    expect(await messages(code)).toEqual([]);
  });

  it.each(['src/app/App.jsx', 'src/components/Legacy.jsx'])('protects feature internals from %s', async file => {
    expect(await messages("import '@/features/beta/private';", file)).toHaveLength(1);
    expect(await messages("import '@/features/beta';", file)).toEqual([]);
  });

  it.each(['@/features/beta', '../../features/beta/index.ts', '@/app/providers'])('rejects upward shared dependencies: %s', async path => {
    expect(await messages(`import '${path}';`, 'src/shared/ui/Widget.jsx'))
      .toEqual([expect.objectContaining({ messageId: 'sharedDependency' })]);
  });

  it('rejects app composition in features but allows app to compose shared code', async () => {
    expect(await messages("import '../../app/providers';"))
      .toEqual([expect.objectContaining({ messageId: 'appDependency' })]);
    expect(await messages("import '../shared/platform/browser-events';", 'src/app/App.jsx')).toEqual([]);
  });

  it('checks type-only imports and import types with the installed TypeScript parser', async () => {
    // Use this existing TS file as a parser-service identity; lintText does not write it.
    const file = 'tests/contracts/feature-boundaries.test.ts';
    const result = await messages("import type { Hidden } from '@/features/beta/private'; export type Other = import('@/features/gamma/private').Other;", file, syntaxLint);
    expect(result.map(item => item.messageId)).toEqual(['privateFeature', 'privateFeature']);
  });
});
