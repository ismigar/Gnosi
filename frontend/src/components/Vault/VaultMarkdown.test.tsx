import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VaultMarkdown } from './VaultMarkdown';

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
