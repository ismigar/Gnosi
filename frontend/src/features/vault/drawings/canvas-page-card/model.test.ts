import { describe, expect, it } from 'vitest';

import { pageCardPreview } from './model';


describe('pageCardPreview', () => {
    it('removes frontmatter and limits the live preview', () => {
        expect(pageCardPreview('---\ntitle: Page\n---\nVisible body')).toBe('Visible body');
        expect(pageCardPreview('x'.repeat(400))).toHaveLength(320);
    });
});
