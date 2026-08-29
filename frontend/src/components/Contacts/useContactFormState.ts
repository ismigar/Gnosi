import { useCallback, useState } from 'react';

import type { Contact, ContactWriteInput } from '../../shared/api/contacts';
import {
    createContactFormData,
    toContactWriteInput,
    type ContactAccount,
    type ContactFieldKey,
    type ContactFormData,
    type ContactMultiField,
    type ContactNamedField,
} from './contactFormModel';

interface ContactFormSnapshot {
    readonly accounts: readonly ContactAccount[];
    readonly contact: Contact | null;
    readonly data: ContactFormData;
}

export interface ContactFormController {
    readonly addField: (field: ContactMultiField) => void;
    readonly addTag: (tag: string) => void;
    readonly formData: ContactFormData;
    readonly removeField: (field: ContactMultiField, index: number) => void;
    readonly removeTag: (tag: string) => void;
    readonly setField: (field: ContactNamedField, value: string) => void;
    readonly setPhotoUrl: (photoUrl: string) => void;
    readonly setType: (type: string) => void;
    readonly toWriteInput: () => ContactWriteInput;
    readonly updateFieldItem: (
        field: ContactMultiField,
        index: number,
        key: ContactFieldKey,
        value: string,
    ) => void;
}

export function useContactFormState(
    contact: Contact | null,
    accounts: readonly ContactAccount[],
): ContactFormController {
    const [snapshot, setSnapshot] = useState<ContactFormSnapshot>(() => ({
        accounts,
        contact,
        data: createContactFormData(contact, accounts),
    }));
    const formData = snapshot.contact === contact && snapshot.accounts === accounts
        ? snapshot.data
        : createContactFormData(contact, accounts);

    const updateData = useCallback((
        update: (current: ContactFormData) => ContactFormData,
    ): void => {
        setSnapshot((previous) => {
            const current = previous.contact === contact && previous.accounts === accounts
                ? previous.data
                : createContactFormData(contact, accounts);
            return { accounts, contact, data: update(current) };
        });
    }, [accounts, contact]);

    const setField = useCallback((field: ContactNamedField, value: string): void => {
        updateData((current) => ({ ...current, [field]: value }));
    }, [updateData]);

    const setType = useCallback((type: string): void => {
        updateData((current) => ({ ...current, type }));
    }, [updateData]);

    const addField = useCallback((field: ContactMultiField): void => {
        updateData((current) => ({
            ...current,
            [field]: [...current[field], { label: 'home', value: '' }],
        }));
    }, [updateData]);

    const removeField = useCallback((field: ContactMultiField, index: number): void => {
        updateData((current) => ({
            ...current,
            [field]: current[field].filter((_item, itemIndex) => itemIndex !== index),
        }));
    }, [updateData]);

    const updateFieldItem = useCallback((
        field: ContactMultiField,
        index: number,
        key: ContactFieldKey,
        value: string,
    ): void => {
        updateData((current) => {
            const nextItems = [...current[field]];
            const existing = nextItems[index] ?? { label: 'home', value: '' };
            nextItems[index] = { ...existing, [key]: value };
            return { ...current, [field]: nextItems };
        });
    }, [updateData]);

    const addTag = useCallback((tag: string): void => {
        updateData((current) => current.tags.includes(tag)
            ? current
            : { ...current, tags: [...current.tags, tag] });
    }, [updateData]);

    const removeTag = useCallback((tag: string): void => {
        updateData((current) => ({
            ...current,
            tags: current.tags.filter((candidate) => candidate !== tag),
        }));
    }, [updateData]);

    const setPhotoUrl = useCallback((photoUrl: string): void => {
        updateData((current) => ({ ...current, photo_url: photoUrl }));
    }, [updateData]);

    const toWriteInput = useCallback(
        (): ContactWriteInput => toContactWriteInput(formData),
        [formData],
    );

    return {
        addField,
        addTag,
        formData,
        removeField,
        removeTag,
        setField,
        setPhotoUrl,
        setType,
        toWriteInput,
        updateFieldItem,
    };
}
