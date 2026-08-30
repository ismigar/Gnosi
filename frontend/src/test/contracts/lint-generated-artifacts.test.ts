import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lint = new ESLint({ cwd: frontend });

describe('lint source coverage', () => {
    it('excludes temporary browser builds without excluding maintained source or tests', async () => {
        expect(await lint.isPathIgnored('.tmp/settings-schema-browser/dist/assets/generated.js')).toBe(true);
        expect(await lint.isPathIgnored('.tmp/editor-browser/main.tsx')).toBe(true);
        expect(await lint.isPathIgnored('src/components/Vault/BlockEditor.tsx')).toBe(false);
        expect(await lint.isPathIgnored('src/components/Vault/block-editor/insertResult.test.ts')).toBe(false);
    });
});
