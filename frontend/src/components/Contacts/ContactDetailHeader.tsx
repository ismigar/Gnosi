import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft,
    Briefcase,
    Building2,
    CheckCircle2,
    Edit3,
    Tag,
    Trash2,
} from 'lucide-react';

import type { Contact } from '../../shared/api/contacts';
import { getGoogleAvatarUrl, isGmail } from '../../utils/avatar-utils';

export interface ContactDetailHeaderProps {
    readonly contact: Contact;
    readonly onBack: () => void;
    readonly onDelete: (contactId: string) => unknown;
    readonly onEdit: () => void;
}

function contactInitials(name: string): string {
    return (name || '?')
        .split(' ')
        .map((part) => part[0] || '')
        .join('')
        .toUpperCase()
        .substring(0, 2) || '?';
}

function hideBrokenPhoto(event: SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;
    image.style.display = 'none';
    const fallback = image.nextElementSibling;
    if (fallback instanceof HTMLElement) fallback.style.display = 'block';
    const parent = image.parentElement;
    if (parent) {
        parent.style.background = 'var(--gnosi-blue)';
        parent.style.color = 'white';
    }
}

export function ContactDetailHeader({
    contact,
    onBack,
    onDelete,
    onEdit,
}: ContactDetailHeaderProps) {
    const { t } = useTranslation();
    const initials = contactInitials(contact.name);
    const effectivePhotoUrl = contact.photo_url
        || (isGmail(contact.email) ? getGoogleAvatarUrl(contact.email) : '');
    return (
        <>
            <button
                type="button"
                className="contact-detail__back gnosi-button gnosi-button--secondary"
                onClick={onBack}
            >
                <ArrowLeft size={16} /> {t('common.back', 'Back')}
            </button>
            <div className="contact-detail__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '48px' }}>
                <div className="contact-detail__identity" style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
                    <div style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '16px',
                        background: effectivePhotoUrl ? 'transparent' : 'var(--gnosi-blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: effectivePhotoUrl ? 'inherit' : 'white',
                        fontSize: '28px',
                        fontWeight: '700',
                        border: '1px solid var(--border-primary)',
                        textShadow: effectivePhotoUrl ? 'none' : '0 2px 4px rgba(0,0,0,0.2)',
                        overflow: 'hidden',
                    }}>
                        {effectivePhotoUrl ? (
                            <img
                                src={effectivePhotoUrl}
                                alt={contact.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={hideBrokenPhoto}
                            />
                        ) : null}
                        <div style={{ width: '100%', textAlign: 'center', display: effectivePhotoUrl ? 'none' : 'block' }}>
                            {initials}
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                                {contact.name}
                            </h2>
                            {contact.google_resource_name && <CheckCircle2 size={18} style={{ color: '#4285f4' }} />}
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '14px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                {contact.type === 'b2b' ? <Briefcase size={14} /> : <Tag size={14} />}
                                {contact.type === 'b2b'
                                    ? (contact.job_title || t('contacts.type_business', "Business"))
                                    : t('contacts.type_personal', 'Personal')}
                            </span>
                            {contact.company && (
                                <>
                                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'currentColor', opacity: 0.3 }} />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <Building2 size={14} /> {contact.company}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <div className="contact-detail__actions" style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={onEdit} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', borderRadius: '10px', border: '1px solid var(--border-primary)', fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s' }}>
                        <Edit3 size={16} /> {t('common.btn.edit', "Edit")}
                    </button>
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                            onDelete(contact.id);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.2)', fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s' }}
                    >
                        <Trash2 size={16} /> {t('common.btn.delete', "Delete")}
                    </button>
                </div>
            </div>
        </>
    );
}
