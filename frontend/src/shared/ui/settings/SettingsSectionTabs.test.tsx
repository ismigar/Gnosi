import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BookOpen, Radio } from 'lucide-react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SettingsSectionTabs } from './SettingsSectionTabs';

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

beforeAll(() => {
    const reactTestGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) break;
        const { root, container } = mounted;
        act(() => {
            root.unmount();
        });
        container.remove();
    }
});

describe('SettingsSectionTabs', () => {
    it('marks the active section and reports section changes', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });
        const onChange = vi.fn();

        act(() => {
            root.render(
                <SettingsSectionTabs
                    ariaLabel="Reader sections"
                    activeId="podcast"
                    onChange={onChange}
                    items={[
                        { id: 'podcast', icon: Radio, label: 'Daily podcast' },
                        { id: 'subscriptions', icon: BookOpen, label: 'Subscriptions' },
                    ]}
                />,
            );
        });

        const navigation = container.querySelector('nav');
        const buttons = [...container.querySelectorAll('button')];
        const activeButton = buttons.at(0);
        const nextButton = buttons.at(1);
        if (!navigation || !activeButton || !nextButton) {
            throw new Error('Expected settings navigation and two buttons');
        }
        expect(navigation.getAttribute('aria-label')).toBe('Reader sections');
        expect(activeButton.getAttribute('aria-current')).toBe('page');
        expect(nextButton.hasAttribute('aria-current')).toBe(false);

        act(() => {
            nextButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onChange).toHaveBeenCalledWith('subscriptions');
    });
});
