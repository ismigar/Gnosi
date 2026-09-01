import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IdentityProfile, { type IdentityProfileData } from './IdentityProfile';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));


vi.mock('../../../shared/ui/settings/SettingsPrimitives', () => ({
    FormGroup: ({ children, label }: {
        children: React.ReactNode;
        label: React.ReactNode;
    }) => <label>{label}{children}</label>,
    Section: ({ children, title }: {
        children: React.ReactNode;
        title: React.ReactNode;
    }) => <section><h2>{title}</h2>{children}</section>,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


function Harness() {
    const [userName, setUserName] = useState('Ismael');
    const [profile, setProfile] = useState<IdentityProfileData>({
        email: 'old@example.com',
        full_name: 'Ismael García',
    });
    return (
        <IdentityProfile
            profile={profile}
            setProfile={setProfile}
            setUserName={setUserName}
            userName={userName}
        />
    );
}


function setInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    );
    if (!descriptor?.set) throw new Error('Native input setter is unavailable');
    const setValue = descriptor.set.bind(input) as (nextValue: string) => void;
    setValue(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}


beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});


describe('IdentityProfile', () => {
    it('keeps assistant and contact state updates controlled and functional', () => {
        act(() => {
            root.render(<Harness />);
        });
        const assistantInput = container.querySelector('input[value="Ismael"]');
        if (!(assistantInput instanceof HTMLInputElement)) {
            throw new Error('Assistant name input was not rendered');
        }
        act(() => {
            setInputValue(assistantInput, 'Ismael G.');
        });
        expect(assistantInput.value).toBe('Ismael G.');

        const contactTab = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes(
                'settings.profile.contact_section',
            ));
        if (!contactTab) throw new Error('Contact profile tab was not rendered');
        act(() => {
            contactTab.click();
        });
        const email = container.querySelector('input[type="email"]');
        if (!(email instanceof HTMLInputElement)) {
            throw new Error('Contact email input was not rendered');
        }
        act(() => {
            setInputValue(email, 'new@example.com');
        });
        expect(email.value).toBe('new@example.com');
        const fullName = container.querySelector('input[value="Ismael García"]');
        expect(fullName).toBeInstanceOf(HTMLInputElement);
    });
});
