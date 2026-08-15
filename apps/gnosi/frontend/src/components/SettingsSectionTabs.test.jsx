import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, Radio } from 'lucide-react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SettingsSectionTabs } from './SettingsSectionTabs';

const mountedRoots = [];

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('SettingsSectionTabs', () => {
    it('marks the active section and reports section changes', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });
        const onChange = vi.fn();

        await act(async () => {
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
        expect(navigation.getAttribute('aria-label')).toBe('Reader sections');
        expect(buttons[0].getAttribute('aria-current')).toBe('page');
        expect(buttons[1].hasAttribute('aria-current')).toBe(false);

        await act(async () => {
            buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onChange).toHaveBeenCalledWith('subscriptions');
    });
});
