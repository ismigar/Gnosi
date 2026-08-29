import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '../../shared/api/contacts';
import ContactForm, { type ContactFormProps } from './ContactForm';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string): string => fallback ?? key,
    }),
}));

const contact: Contact = {
    address: 'Old address',
    addresses: [{ label: 'home', value: 'Old address' }],
    apple_resource_id: null,
    company: null,
    created_at: null,
    email: 'ada@gmail.com',
    emails: [{ label: 'home', value: 'ada@gmail.com' }],
    google_resource_name: null,
    id: 'contact-1',
    job_title: null,
    last_synced_at: null,
    name: 'Ada Lovelace',
    notes: 'Original note',
    phone: '+34 600 000 001',
    phones: [{ label: 'mobile', value: '+34 600 000 001' }],
    photo_url: 'https://example.test/ada.jpg',
    source: 'google',
    tags: ['history'],
    type: 'personal',
    updated_at: null,
    workspace_id: 'personal',
};

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function setControlValue(control: FormControl, value: string): void {
    const prototype = control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : control instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.bind(control);
    if (!setter) throw new Error('Missing native control value setter');
    act(() => {
        setter(value);
        control.dispatchEvent(new Event(
            control instanceof HTMLSelectElement ? 'change' : 'input',
            { bubbles: true },
        ));
    });
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}

describe('ContactForm', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('preserves providers, repeated fields, tags, photo, and write payloads', () => {
        const onBack = vi.fn<NonNullable<ContactFormProps['onBack']>>();
        const onCancel = vi.fn<ContactFormProps['onCancel']>();
        const onSave = vi.fn<ContactFormProps['onSave']>();
        act(() => {
            root.render(
                <ContactForm
                    contact={contact}
                    contactAccounts={[{
                        email: 'sync@gmail.test',
                        id: 'google-1',
                        name: 'Google',
                        provider: 'google',
                    }]}
                    onBack={onBack}
                    onCancel={onCancel}
                    onSave={onSave}
                />,
            );
        });

        const source = container.querySelector('select[name="source"]');
        if (!(source instanceof HTMLSelectElement)) throw new Error('Missing source selector');
        expect(source.value).toBe('sync@gmail.test');

        const addButtons = [...container.querySelectorAll('button')]
            .filter((button) => button.textContent.trim() === 'Add');
        const addEmail = addButtons[0];
        if (!(addEmail instanceof HTMLButtonElement)) throw new Error('Missing email add button');
        act(() => {
            addEmail.click();
        });

        const emailInputs = container.querySelectorAll('input[type="email"]');
        const secondEmail = emailInputs[1];
        if (!(secondEmail instanceof HTMLInputElement)) throw new Error('Missing repeated email field');
        setControlValue(secondEmail, 'ada@engine.test');

        const tagInput = container.querySelector('input[placeholder="Add a tag..."]');
        if (!(tagInput instanceof HTMLInputElement)) throw new Error('Missing tag input');
        setControlValue(tagInput, 'computing');
        const refreshedAddButtons = [...container.querySelectorAll('button')]
            .filter((button) => button.textContent.trim() === 'Add');
        const addTag = refreshedAddButtons.at(-1);
        if (!(addTag instanceof HTMLButtonElement)) throw new Error('Missing tag add button');
        const backButton = container.querySelector('button[title="Back"]');
        if (!(backButton instanceof HTMLButtonElement)) throw new Error('Missing back button');

        act(() => {
            addTag.click();
            findButton(container, 'Gmail').click();
            findButton(container, 'Business').click();
            backButton.click();
            findButton(container, 'Cancel').click();
        });

        const form = container.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('Missing contact form');
        act(() => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        expect(onBack).toHaveBeenCalledOnce();
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onSave).toHaveBeenCalledOnce();
        const payload = onSave.mock.calls[0]?.[0];
        if (!payload) throw new Error('Missing contact write payload');
        expect(payload.email).toBe('ada@gmail.com');
        expect(payload.emails).toEqual([
            { label: 'home', value: 'ada@gmail.com' },
            { label: 'home', value: 'ada@engine.test' },
        ]);
        expect(payload.photo_url).toBe('');
        expect(payload.source).toBe('sync@gmail.test');
        expect(payload.tags).toEqual(['history', 'computing']);
        expect(payload.type).toBe('b2b');
    });

    it('reinitializes synchronously when the edited contact changes', () => {
        const props = {
            onCancel: (): void => undefined,
            onSave: (): void => undefined,
        };
        act(() => {
            root.render(<ContactForm contact={contact} {...props} />);
        });
        const renamed = { ...contact, id: 'contact-2', name: 'Grace Hopper' };
        act(() => {
            root.render(<ContactForm contact={renamed} {...props} />);
        });

        const name = container.querySelector('input[name="name"]');
        if (!(name instanceof HTMLInputElement)) throw new Error('Missing name input');
        expect(name.value).toBe('Grace Hopper');
    });
});
