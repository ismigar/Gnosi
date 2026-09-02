import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lint = new ESLint({ cwd: frontend });

describe('lint source coverage', () => {
    it('excludes temporary browser builds without excluding maintained source or tests', async () => {
        const [settingsBuild, editorBuild, maintainedSource, maintainedTest] = await Promise.all([
            lint.isPathIgnored('.tmp/settings-schema-browser/dist/assets/generated.js'),
            lint.isPathIgnored('.tmp/editor-browser/main.tsx'),
            lint.isPathIgnored('src/features/vault/editor/BlockEditor.tsx'),
            lint.isPathIgnored('src/features/vault/editor/block-editor/insertResult.test.ts'),
        ]);

        expect(settingsBuild).toBe(true);
        expect(editorBuild).toBe(true);
        expect(maintainedSource).toBe(false);
        expect(maintainedTest).toBe(false);
    }, 30_000);
});
