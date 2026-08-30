import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { VaultMarkdown } from './VaultMarkdown';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

describe('VaultMarkdown', () => {
    it('renders custom toggle fences as interactive disclosure sections', () => {
        const html = renderToStaticMarkup(
            <VaultMarkdown
                md={':::toggle-heading{level=1} Planificació\n## Tasques\n:::'}
            />,
        );

        expect(html).toContain('<details');
        expect(html).toContain('Planificació');
        expect(html).toContain('<h2');
        expect(html).toContain('Tasques');
        expect(html).not.toContain('toggle-heading');
    });
});
