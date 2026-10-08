import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { VaultMarkdown } from './VaultMarkdown';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

describe('VaultMarkdown', () => {
    it('hides other internal HTML comments while retaining literal comments in code', () => {
        const html = renderToStaticMarkup(<VaultMarkdown md={'<!-- gnosi-view:def hidden -->\nVisible text\n<!-- another hidden marker -->\n\n```html\n<!-- literal example -->\n```'} />);
        expect(html).toContain('Visible text');
        expect(html).toContain('literal example');
        expect(html).not.toContain('gnosi-view:def');
        expect(html).not.toContain('another hidden marker');
    });
    it('hides processing boundary comments while preserving the visible Markdown and links', () => {
        const md = '<!-- gnosi:llm-wiki:start resource:source:record -->\n1. [[note|A note]]\n<!-- gnosi:llm-wiki:end resource:source:record -->';
        const html = renderToStaticMarkup(<VaultMarkdown md={md} />);
        expect(html).toContain('A note');
        expect(html).not.toContain('gnosi:llm-wiki');
        expect(md).toContain('<!-- gnosi:llm-wiki:start');
    });
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
