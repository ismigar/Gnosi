import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emitAppEvent } from '../../shared/platform/app-events';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import { VaultDocumentTabs } from './VaultDocumentTabs';


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView',
);


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));


describe('VaultDocumentTabs', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        if (originalScrollIntoViewDescriptor) {
            Object.defineProperty(
                Element.prototype,
                'scrollIntoView',
                originalScrollIntoViewDescriptor,
            );
        } else {
            Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
        }
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('selects, splits, and closes tabs independently', () => {
        const onTabSelect = vi.fn();
        const onTabClose = vi.fn();
        const onToggleSplit = vi.fn();
        act(() => {
            root.render(<VaultDocumentTabs
                activeTabId="one"
                onTabClose={onTabClose}
                onTabSelect={onTabSelect}
                onToggleSplit={onToggleSplit}
                tabs={[
                    { id: 'one', title: 'First' },
                    { id: 'two', title: 'Second' },
                ]}
            />);
        });

        const secondLabel = Array.from(container.querySelectorAll('span'))
            .find((element) => element.textContent === 'Second');
        const secondTab = secondLabel?.closest<HTMLDivElement>('div[role="button"]');
        if (!secondTab) throw new Error('Second sortable tab missing');
        act(() => { secondTab.click(); });
        expect(onTabSelect).toHaveBeenCalledWith('two');

        const splitButton = Array.from(secondTab.querySelectorAll('button'))
            .find((button) => button.title === 'Open in parallel');
        const closeButton = Array.from(secondTab.querySelectorAll('button'))
            .find((button) => button.title === 'Close tab');
        if (!splitButton || !closeButton) throw new Error('Tab actions missing');
        act(() => { splitButton.click(); });
        act(() => { closeButton.click(); });
        expect(onToggleSplit).toHaveBeenCalledWith('two');
        expect(onTabClose).toHaveBeenCalledWith('two');
    });

    it('opens quick search through the typed app event and selects an item', () => {
        const onQuickOpenItem = vi.fn();
        act(() => {
            root.render(<VaultDocumentTabs
                onQuickOpenItem={onQuickOpenItem}
                onTabClose={vi.fn()}
                onTabSelect={vi.fn()}
                onToggleSplit={vi.fn()}
                quickOpenItems={[
                    { id: 'history', subtitle: 'Page', title: 'Història', type: 'page' },
                    { id: 'notes', subtitle: 'Research', title: 'Notes', type: 'table' },
                ]}
                tabs={[{ id: 'one', title: 'First' }, { id: 'two', title: 'Second' }]}
            />);
        });
        act(() => { emitAppEvent('gnosi:quick-open-document'); });

        const input = document.body.querySelector<HTMLInputElement>(
            'input[placeholder="Search pages and tables..."]',
        );
        if (!input) throw new Error('Quick-open input missing');
        expect(document.body.textContent).toContain('Història');
        expect(document.body.textContent).toContain('Research');
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Enter',
            }));
        });
        expect(onQuickOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'history' }));
    });

    it('uses Ctrl+9 to select the last tab', () => {
        const onTabSelect = vi.fn();
        act(() => {
            root.render(<VaultDocumentTabs
                onTabClose={vi.fn()}
                onTabSelect={onTabSelect}
                onToggleSplit={vi.fn()}
                tabs={[
                    { id: 'one', title: 'First' },
                    { id: 'two', title: 'Second' },
                    { id: 'three', title: 'Third' },
                ]}
            />);
        });
        act(() => {
            dispatchWindowEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                ctrlKey: true,
                key: '9',
            }));
        });
        expect(onTabSelect).toHaveBeenCalledWith('three');
    });
});
