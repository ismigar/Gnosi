import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from '../../shared/api/legacy-http';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { WikilinkHoverPreview } from './WikilinkHoverPreview';

vi.mock('../../shared/api/legacy-http', () => ({
    default: { get: vi.fn() },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key, fallback) => fallback }),
}));

vi.mock('./VaultMarkdown', () => ({
    VaultMarkdown: ({ md }) => <div data-testid="rendered-preview-markdown">{md}</div>,
}));

const mountedRoots = [];

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    vi.clearAllMocks();
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

async function render(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => root.render(element));
}

describe('WikilinkHoverPreview', () => {
    it('requests and renders the full record body instead of its excerpt', async () => {
        axios.get.mockResolvedValueOnce({
            data: {
                title: 'Target record',
                excerpt: 'Short excerpt',
                body_md: 'Complete body\n\nwith additional sections',
            },
        });

        await render(
            <WikilinkHoverPreview
                pageId="target/page"
                anchorRect={{ top: 20, bottom: 40, left: 30 }}
            />,
        );
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(axios.get).toHaveBeenCalledWith('/api/vault/pages/target%2Fpage/preview?full=true');
        expect(document.body.querySelector('[data-testid="rendered-preview-markdown"]').textContent)
            .toBe('Complete body\n\nwith additional sections');
        expect(document.body.textContent).not.toContain('Short excerpt');
    });
});
