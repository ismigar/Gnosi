// @vitest-environment node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const frontend = fileURLToPath(new URL('../../..', import.meta.url));
const lint = new ESLint({ cwd: frontend });

// Resolve the actual plugin configuration once, outside each snippet's deadline.
beforeAll(async () => { await lint.calculateConfigForFile('src/ApiBoundaryFixture.jsx'); });

describe('domain-specific API imports', () => {
  it('does not retain a root aggregator that eagerly imports unrelated domains', () => {
    expect(existsSync(fileURLToPath(new URL('../../shared/api/index.ts', import.meta.url)))).toBe(false);
  });
  it.each(['../../shared/api', '../shared/api/index', '../shared/api/index.ts', '@/shared/api', '../../shared/api/', '../shared/api/index.js'])('rejects the root aggregator: %s', async path => {
    const result = await lint.lintText(`import { startResourceProcessing } from '${path}'; export { startResourceProcessing };`, { filePath: 'src/ApiBoundaryFixture.jsx' });
    expect(result.flatMap(item => item.messages).filter(item => item.ruleId === 'no-restricted-imports')).toHaveLength(1);
  });
  it('allows explicit domain adapters and the generated client composition', async () => {
    const result = await lint.lintText("import { startResourceProcessing } from './shared/api/resource-processing'; import { apiClient } from './shared/api/client'; export { startResourceProcessing, apiClient };", { filePath: 'src/ApiBoundaryFixture.jsx' });
    expect(result.flatMap(item => item.messages).filter(item => item.ruleId === 'no-restricted-imports')).toEqual([]);
  });
});
