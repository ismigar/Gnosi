import { useTranslation } from 'react-i18next';
import { Globe, RefreshCw, Tag } from 'lucide-react';

import type { Contact } from '../../../shared/api/contacts';
import { contactTags } from './contactFormModel';

export interface ContactDetailAdditionalProps {
    readonly contact: Contact;
}

export function ContactDetailAdditional({ contact }: ContactDetailAdditionalProps) {
    const { t } = useTranslation();
    const tags = contactTags(contact.tags);
    const hasDetails = Boolean(contact.notes) || tags.length > 0;

    if (!hasDetails) return null;
    return (
        <div style={{ background: 'var(--bg-secondary)', padding: '28px', borderRadius: '20px', border: '1px solid var(--border-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                    <h3 style={{ margin: '0 0 24px 0', fontSize: '11px', fontWeight: '700', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
                        <Tag size={14} /> {t('contacts.details_section', "Additional details")}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {contact.notes && (
                            <div>
                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>
                                    {t('contacts.notes_label', "Notes / Comments")}
                                </span>
                                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.6', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
                                    {contact.notes}
                                </p>
                            </div>
                        )}
                        {tags.length > 0 && (
                            <div>
                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '10px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>
                                    {t('contacts.tags_label', "Tags")}
                                </span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {tags.map((tag, index) => (
                                        <span key={index} style={{ padding: '6px 14px', background: 'rgba(59,130,246,0.08)', color: 'var(--gnosi-blue)', borderRadius: '8px', fontSize: '11px', fontWeight: '800', border: '1px solid rgba(59,130,246,0.1)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
        </div>
    );
}

export function ContactDetailMetadata({ contact }: ContactDetailAdditionalProps) {
    const { t } = useTranslation();
    return (
        <div style={{ marginTop: '48px', padding: '24px', borderTop: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.6 }}>
                <div style={{ display: 'flex', gap: '32px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: '600' }}>
                        <Globe size={14} />
                        {t('contacts.source_label', "Source")}:{' '}
                        <span style={{ color: 'var(--text-primary)', textTransform: contact.source === 'local' ? 'capitalize' : 'none' }}>
                            {contact.source === 'local'
                                ? t('contacts.source_local', 'Gnosi (Local)')
                                : contact.source}
                        </span>
                    </div>
                    {contact.last_synced_at && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: '600' }}>
                            <RefreshCw size={14} />
                            {t('contacts.last_synced_label', "Last synced")}:{' '}
                            <span style={{ color: 'var(--text-primary)' }}>
                                {new Date(contact.last_synced_at).toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
        </div>
    );
}
