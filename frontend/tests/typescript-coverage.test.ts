// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const tests = fileURLToPath(new URL('./', import.meta.url));
let testConfiguration: unknown;

beforeAll(async () => {
  // Cold plugin/configuration loading belongs to setup, not an assertion timeout.
  const lint = new ESLint({ cwd: frontend });
  testConfiguration = await lint.calculateConfigForFile('tests/helpers/network.ts');
});

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a configuration object');
  return value as Record<string, unknown>;
}

describe('maintained test TypeScript coverage', () => {
  it('includes every test and helper in the strict compiler project without legacy JavaScript', () => {
    const loaded = ts.readConfigFile(`${frontend}/tsconfig.json`, path => ts.sys.readFile(path));
    expect(loaded.error).toBeUndefined();
    const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, frontend);
    expect(config.errors).toEqual([]);
    expect(config.options.strict).toBe(true);
    expect(config.options.noUncheckedIndexedAccess).toBe(true);
    const maintained = ts.sys.readDirectory(tests, ['.ts', '.tsx', '.js', '.jsx']);
    expect(maintained.filter(path => /\.[cm]?jsx?$/.test(path))).toEqual([]);
    expect(maintained.length).toBeGreaterThan(3);
    expect(maintained.filter(path => !config.fileNames.includes(path))).toEqual([]);
  });

  it('applies semantic lint rules to test helpers outside src', () => {
    const config = record(testConfiguration);
    const parserOptions = record(record(config.languageOptions).parserOptions);
    expect(parserOptions.projectService).toBe(true);
    const rules = record(config.rules);
    for (const rule of ['no-unsafe-assignment', 'no-unsafe-call', 'no-unsafe-member-access', 'no-explicit-any']) {
      expect(rules[`@typescript-eslint/${rule}`]).toEqual(expect.arrayContaining([2]));
    }
  });
});
