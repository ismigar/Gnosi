import type { Contact, ContactWriteInput } from '../../../shared/api/contacts';

export interface ContactAccount {
    readonly [key: string]: unknown;
    readonly email?: string;
    readonly id?: string;
    readonly name?: string;
    readonly provider?: string;
}

export interface ContactFieldItem {
    [key: string]: unknown;
    customLabel?: string;
    label: string;
    value: string;
}

export type ContactMultiField = 'addresses' | 'emails' | 'phones';
export type ContactFieldKey = 'customLabel' | 'label' | 'value';
export type ContactNamedField =
    | 'address'
    | 'company'
    | 'email'
    | 'job_title'
    | 'name'
    | 'notes'
    | 'phone'
    | 'photo_url'
    | 'source';

export interface ContactFormData {
    address: string;
    addresses: ContactFieldItem[];
    company: string;
    email: string;
    emails: ContactFieldItem[];
    job_title: string;
    name: string;
    notes: string;
    phone: string;
    phones: ContactFieldItem[];
    photo_url: string;
    source: string;
    tags: string[];
    type: string;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}

export function contactFieldItems(value: unknown): ContactFieldItem[] {
    if (!isUnknownArray(value)) return [];
    return value.flatMap((item) => {
        if (!isUnknownRecord(item)) return [];
        const field: ContactFieldItem = {
            label: scalarText(item.label) || 'home',
            value: scalarText(item.value),
        };
        const customLabel = scalarText(item.customLabel);
        if (customLabel) field.customLabel = customLabel;
        return [field];
    });
}

export function contactTags(value: unknown): string[] {
    if (!isUnknownArray(value)) return [];
    return value.flatMap((tag) => {
        const text = scalarText(tag);
        return text ? [text] : [];
    });
}

function fallbackField(
    items: ContactFieldItem[],
    label: string,
    value: string | null,
): ContactFieldItem[] {
    return items.length > 0 ? items : [{ label, value: value || '' }];
}

function accountSource(
    source: string,
    accounts: readonly ContactAccount[],
): string {
    if (source === 'local' || source.includes('@')) return source;
    const matchingAccount = accounts.find((account) => account.provider === source);
    return matchingAccount?.email || matchingAccount?.provider || source;
}

export function createContactFormData(
    contact: Contact | null,
    accounts: readonly ContactAccount[],
): ContactFormData {
    if (!contact) {
        return {
            name: '',
            email: '',
            type: 'personal',
            phone: '',
            company: '',
            job_title: '',
            address: '',
            notes: '',
            tags: [],
            emails: [{ label: 'home', value: '' }],
            phones: [{ label: 'mobile', value: '' }],
            addresses: [{ label: 'home', value: '' }],
            source: 'local',
            photo_url: '',
        };
    }
    return {
        name: contact.name || '',
        email: contact.email || '',
        type: contact.type || 'personal',
        phone: contact.phone || '',
        company: contact.company || '',
        job_title: contact.job_title || '',
        address: contact.address || '',
        notes: contact.notes || '',
        tags: contactTags(contact.tags),
        emails: fallbackField(contactFieldItems(contact.emails), 'home', contact.email),
        phones: fallbackField(contactFieldItems(contact.phones), 'mobile', contact.phone),
        addresses: fallbackField(contactFieldItems(contact.addresses), 'home', contact.address),
        source: accountSource(contact.source || 'local', accounts),
        photo_url: contact.photo_url || '',
    };
}

export function toContactWriteInput(formData: ContactFormData): ContactWriteInput {
    return {
        ...formData,
        email: formData.emails[0]?.value || formData.email,
        phone: formData.phones[0]?.value || formData.phone,
        address: formData.addresses[0]?.value || formData.address,
    };
}
