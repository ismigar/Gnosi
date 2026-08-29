import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft,
    ChevronLeft,
    Mail,
    MapPin,
    Phone,
    Save,
    Tag,
} from 'lucide-react';

import type { Contact, ContactWriteInput } from '../../shared/api/contacts';
import { ContactIdentityFields } from './ContactIdentityFields';
import { ContactMultiFieldSection } from './ContactMultiFieldSection';
import { ContactTagsSection } from './ContactTagsSection';
import type { ContactAccount } from './contactFormModel';
import { inputStyle, labelStyle } from './contactFormStyles';
import { useContactFormState } from './useContactFormState';

const EMPTY_ACCOUNTS: readonly ContactAccount[] = [];

export interface ContactFormProps {
    readonly contact?: Contact | null;
    readonly contactAccounts?: readonly ContactAccount[];
    readonly onBack?: () => void;
    readonly onCancel: () => void;
    readonly onSave: (formData: ContactWriteInput) => unknown;
}

export default function ContactForm({
    contact = null,
    onSave,
    onCancel,
    onBack,
    contactAccounts = EMPTY_ACCOUNTS,
}: ContactFormProps) {
    const { t } = useTranslation();
    const controller = useContactFormState(contact, contactAccounts);
    const { formData } = controller;
    const handleSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void => {
        event.preventDefault();
        if (!formData.name) return;
        onSave(controller.toWriteInput());
    };
    const emailLabels = [
        { value: 'home', label: t('contacts.label_home', "Home") },
        { value: 'work', label: t('contacts.label_work', "Work") },
        { value: 'other', label: t('contacts.label_other', "Other") },
    ];
    const phoneLabels = [
        { value: 'mobile', label: t('contacts.label_mobile', "Mobile") },
        ...emailLabels,
    ];

    return (
        <div className="contact-form" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', color: 'var(--text-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '40px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {onBack && (
                        <button
                            onClick={onBack}
                            style={{
                                padding: '8px',
                                background: 'transparent',
                                color: 'var(--text-secondary)',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s',
                            }}
                            title={t('common.back', "Back")}
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                        {contact ? t('contacts.edit_title', "Edit Contact") : t('contacts.new_title', "New Contact")}
                    </h2>
                </div>
                <button
                    onClick={onCancel}
                    style={{
                        padding: '8px 16px',
                        background: 'transparent',
                        color: 'var(--text-tertiary)',
                        border: '1px solid var(--border-primary)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.2s',
                    }}
                >
                    <ArrowLeft size={16} /> {t('common.btn.cancel', "Cancel")}
                </button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                <ContactIdentityFields
                    accounts={contactAccounts}
                    formData={formData}
                    onFieldChange={controller.setField}
                    onPhotoUrlChange={controller.setPhotoUrl}
                    onTypeChange={controller.setType}
                />
                <ContactMultiFieldSection
                    title={t('contacts.email_label', "Email")}
                    field="emails"
                    icon={<Mail size={14} />}
                    placeholder={t('contacts.email_field_placeholder', "email@example.com")}
                    labels={emailLabels}
                    inputType="email"
                    items={formData.emails}
                    onAdd={controller.addField}
                    onChange={controller.updateFieldItem}
                    onRemove={controller.removeField}
                />
                <ContactMultiFieldSection
                    title={t('contacts.phone_label', "Phone")}
                    field="phones"
                    icon={<Phone size={14} />}
                    placeholder="+34 600 000 000"
                    labels={phoneLabels}
                    inputType="tel"
                    items={formData.phones}
                    onAdd={controller.addField}
                    onChange={controller.updateFieldItem}
                    onRemove={controller.removeField}
                />
                <ContactMultiFieldSection
                    title={t('contacts.address_label', "Address")}
                    field="addresses"
                    icon={<MapPin size={14} />}
                    placeholder={t('contacts.address_field_placeholder', "Street, Number, City...")}
                    labels={emailLabels}
                    items={formData.addresses}
                    onAdd={controller.addField}
                    onChange={controller.updateFieldItem}
                    onRemove={controller.removeField}
                />
                <div>
                    <label style={labelStyle}><Tag size={14} /> {t('contacts.notes_label', "Notes / Comments")}</label>
                    <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={(event) => {
                            controller.setField('notes', event.target.value);
                        }}
                        rows={4}
                        placeholder={t('contacts.notes_placeholder', "Additional notes about the contact...")}
                        style={{ ...inputStyle, resize: 'vertical', minHeight: '120px' }}
                    />
                </div>
                <ContactTagsSection
                    tags={formData.tags}
                    onAdd={controller.addTag}
                    onRemove={controller.removeTag}
                />
                <div style={{ display: 'flex', gap: '16px', marginTop: '24px', paddingTop: '32px', borderTop: '1px solid var(--border-primary)' }}>
                    <button
                        type="submit"
                        style={{
                            flex: 1,
                            padding: '14px',
                            background: 'var(--gnosi-blue)',
                            color: 'white',
                            borderRadius: '10px',
                            border: 'none',
                            fontWeight: '700',
                            fontSize: '15px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            boxShadow: '0 4px 20px rgba(59, 130, 246, 0.25)',
                            transition: 'all 0.2s',
                        }}
                    >
                        <Save size={18} />
                        {contact ? t('common.btn.save_changes', "Save Changes") : t('contacts.btn_create', "Create Contact")}
                    </button>
                </div>
            </form>
        </div>
    );
}
