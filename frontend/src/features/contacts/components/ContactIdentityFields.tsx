import { useTranslation } from 'react-i18next';
import {
    Briefcase,
    Building2,
    Globe,
    Tag,
    User,
} from 'lucide-react';

import { ContactAvatar } from '../../../shared/ui/avatars/ContactAvatar';
import type {
    ContactAccount,
    ContactFormData,
    ContactNamedField,
} from './contactFormModel';
import { inputStyle, labelStyle } from './contactFormStyles';

export interface ContactIdentityFieldsProps {
    readonly accounts: readonly ContactAccount[];
    readonly formData: ContactFormData;
    readonly onFieldChange: (field: ContactNamedField, value: string) => void;
    readonly onTypeChange: (type: string) => void;
}

export function ContactIdentityFields({
    accounts,
    formData,
    onFieldChange,
    onTypeChange,
}: ContactIdentityFieldsProps) {
    const { t } = useTranslation();
    const primaryEmail = formData.emails[0]?.value || formData.email;
    const handleNamedInput = (
        event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ): void => {
        const field = event.target.name;
        if (
            field === 'name'
            || field === 'photo_url'
            || field === 'company'
            || field === 'job_title'
            || field === 'source'
        ) {
            onFieldChange(field, event.target.value);
        }
    };

    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                    <label style={labelStyle}><User size={14} /> {t('contacts.name_label', "Name")} *</label>
                    <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleNamedInput}
                        required
                        placeholder={t('contacts.name_placeholder', "E.g.: Joan Sala")}
                        style={inputStyle}
                    />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                    <label style={labelStyle}><Globe size={14} /> {t('contacts.photo_url_label', "Photo URL")}</label>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '10px' }}>
                        <ContactAvatar
                            name={formData.name}
                            email={primaryEmail}
                            photoUrl={formData.photo_url}
                            size={64}
                            borderRadius={12}
                            fallback={<User size={32} />}
                            style={{ border: '1px solid var(--border-primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    name="photo_url"
                                    value={formData.photo_url}
                                    onChange={handleNamedInput}
                                    placeholder={t('contacts.photo_url_placeholder', "https://example.com/photo.jpg")}
                                    style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                                />
                            </div>
                            <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-tertiary)', opacity: 0.7 }}>
                                {t('contacts.photo_url_hint', "Enter an image URL. Available Google photos are imported when you sync Google Contacts.")}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <label style={labelStyle}><Tag size={14} /> {t('contacts.type_label', "Contact type")}</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                    {(['personal', 'b2b'] as const).map((type) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => {
                                onTypeChange(type);
                            }}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                background: formData.type === type
                                    ? (type === 'personal' ? 'rgba(16,185,129,0.08)' : 'rgba(59,130,246,0.08)')
                                    : 'var(--bg-secondary)',
                                color: formData.type === type
                                    ? (type === 'personal' ? '#10b981' : 'var(--gnosi-blue)')
                                    : 'var(--text-tertiary)',
                                border: '1px solid',
                                borderColor: formData.type === type
                                    ? (type === 'personal' ? '#10b981' : 'var(--gnosi-blue)')
                                    : 'var(--border-primary)',
                                fontWeight: '600',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            {type === 'personal'
                                ? t('contacts.type_personal', 'Personal')
                                : t('contacts.type_business', "Business")}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div>
                    <label style={labelStyle}><Building2 size={14} /> {t('contacts.company_label', "Company")}</label>
                    <input type="text" name="company" value={formData.company} onChange={handleNamedInput} placeholder={t('contacts.company_placeholder', "Optional")} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}><Briefcase size={14} /> {t('contacts.job_label', "Job Title")}</label>
                    <input type="text" name="job_title" value={formData.job_title} onChange={handleNamedInput} placeholder={t('contacts.job_placeholder', "E.g.: IT Director")} style={inputStyle} disabled={formData.type !== 'b2b'} />
                </div>
            </div>
            <div>
                <label style={labelStyle}><Globe size={14} /> {t('contacts.sync_with_account', "Sync with account")}</label>
                <select name="source" value={formData.source} onChange={handleNamedInput} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="local">{t('contacts.source_local', "Gnosi (Local)")}</option>
                    {accounts.map((account, index) => {
                        const provider = account.provider || '';
                        const displayName = account.name || (provider === 'google' ? 'Google' : provider.toUpperCase());
                        return (
                            <option key={account.id || account.email || `${provider}-${String(index)}`} value={account.email || provider}>
                                {displayName} ({account.email})
                            </option>
                        );
                    })}
                </select>
            </div>
        </>
    );
}
