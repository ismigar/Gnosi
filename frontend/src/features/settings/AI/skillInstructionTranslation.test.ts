import { describe, expect, it, vi } from 'vitest';
import { generateAiContent } from '../../../shared/api/ai';
import { translateInstructions } from './skillInstructionTranslation';
vi.mock('../../../shared/api/ai', () => ({ generateAiContent: vi.fn() }));

describe('skill instruction translation', () => {
    it('caches by vault, text and target language', async () => {
        vi.mocked(generateAiContent).mockResolvedValue({ content: 'Només llegeix.', provider: 'local' });
        const before = vi.mocked(generateAiContent).mock.calls.length;
        expect(await translateInstructions('Read only.', 'ca', 'vault-one')).toBe('Només llegeix.');
        await translateInstructions('Read only.', 'ca', 'vault-one');
        expect(vi.mocked(generateAiContent).mock.calls.length).toBe(before + 1);
        await translateInstructions('Read only.', 'ca', 'vault-two');
        expect(vi.mocked(generateAiContent).mock.calls.length).toBe(before + 2);
    });
    it('rejects missing literals and retries failed translations', async () => {
        vi.mocked(generateAiContent).mockResolvedValueOnce({ content: 'Llegeix una pàgina.', provider: 'local' });
        await expect(translateInstructions('Read `core.page`.', 'ca', 'literal-vault')).rejects.toThrow();
        vi.mocked(generateAiContent).mockResolvedValueOnce({ content: 'Llegeix `core.page`.', provider: 'local' });
        expect(await translateInstructions('Read `core.page`.', 'ca', 'literal-vault')).toBe('Llegeix `core.page`.');
    });
});
