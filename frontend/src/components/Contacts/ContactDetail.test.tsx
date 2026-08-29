import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '../../shared/api/contacts';
import ContactDetail, { type ContactDetailProps } from './ContactDetail';

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
    address: null,
    addresses: [
        { customLabel: 'Studio', label: 'other', value: '42 Engine Way' },
    ],
    apple_resource_id: null,
    company: 'Analytical Engines',
    created_at: null,
    email: 'ada@gmail.com',
    emails: [
        { label: 'work', value: 'ada@engine.test' },
        { label: 'home', value: 'ada@gmail.com' },
    ],
    google_resource_name: 'people/ada',
    id: 'contact-1',
    job_title: 'Programmer',
    last_synced_at: '2026-08-29T10:00:00Z',
    name: 'Ada Lovelace',
    notes: 'First algorithm',
    phone: null,
    phones: [{ label: 'mobile', value: '+34 600 000 001' }],
    photo_url: 'https://example.test/ada.jpg',
    source: 'google',
    tags: ['history', 'computing'],
    type: 'b2b',
    updated_at: null,
    workspace_id: 'personal',
};

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}

describe('ContactDetail', () => {
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

    it('renders provider data, multiple fields, tags, and detail actions', () => {
        const onBack = vi.fn<ContactDetailProps['onBack']>();
        const onDelete = vi.fn<ContactDetailProps['onDelete']>();
        const onEdit = vi.fn<ContactDetailProps['onEdit']>();
        act(() => {
            root.render(
                <ContactDetail
                    contact={contact}
                    onBack={onBack}
                    onDelete={onDelete}
                    onEdit={onEdit}
                />,
            );
        });

        expect(container.textContent).toContain('Ada Lovelace');
        expect(container.textContent).toContain('Analytical Engines');
        expect(container.textContent).toContain('Studio');
        expect(container.textContent).toContain('First algorithm');
        expect(container.textContent).toContain('history');
        expect(container.querySelector('a[href="mailto:ada@engine.test"]')).not.toBeNull();
        expect(container.querySelector('a[href="tel:+34 600 000 001"]')).not.toBeNull();
        expect(container.querySelector('img')?.getAttribute('src')).toBe(contact.photo_url);

        act(() => {
            findButton(container, 'Back').click();
            findButton(container, 'Edit').click();
            findButton(container, 'Delete').click();
        });

        expect(onBack).toHaveBeenCalledOnce();
        expect(onEdit).toHaveBeenCalledOnce();
        expect(onDelete).toHaveBeenCalledWith(contact.id);
    });

    it('renders nothing without a selected contact', () => {
        act(() => {
            root.render(
                <ContactDetail
                    contact={null}
                    onBack={() => undefined}
                    onDelete={() => undefined}
                    onEdit={() => undefined}
                />,
            );
        });

        expect(container.innerHTML).toBe('');
    });
});
