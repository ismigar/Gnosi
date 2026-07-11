import React from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Phone, MapPin, Building2, Briefcase, Tag, Calendar, Globe, Edit3, Trash2, CheckCircle2, RefreshCw } from 'lucide-react';
import { isGmail, getGoogleAvatarUrl } from '../../utils/avatar-utils';

export default function ContactDetail({ contact, onEdit, onDelete }) {
    const { t } = useTranslation();
    if (!contact) return null;

    // contact.name can be undefined/null if the DB has incomplete contacts
    // (partial Google sync, contacts without a name). `null.split` would crash
    // and the whole page would render a generic error instead of the detail.
    const initials = (contact.name || '?').split(' ').map(n => n[0] || '').join('').toUpperCase().substring(0, 2) || '?';
    
    // Check if we should try a Gmail avatar fallback
    const effectivePhotoUrl = contact.photo_url || (isGmail(contact.email) ? getGoogleAvatarUrl(contact.email) : '');

    const getLabelText = (item) => {
        if (item.label === 'other' && item.customLabel) {
            return item.customLabel;
        }
        const labels = {
            home: t('contacts.label_home', 'Casa'),
            work: t('contacts.label_work', 'Feina'),
            mobile: t('contacts.label_mobile', 'Mòbil'),
            other: t('contacts.label_other', 'Altres')
        };
        return labels[item.label] || item.label;
    };

    return (
        <div className="contact-detail" style={{ 
            padding: '40px', 
            maxWidth: '1000px', 
            margin: '0 auto',
            color: 'var(--text-primary)'
        }}>
            {/* Header Section */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '48px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
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
                        overflow: 'hidden'
                    }}>
                        {effectivePhotoUrl ? (
                            <img 
                                src={effectivePhotoUrl} 
                                alt={contact.name} 
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { 
                                    e.target.style.display = 'none'; 
                                    const next = e.target.nextSibling;
                                    if (next) next.style.display = 'block';
                                    // If even the effective URL fails, we fall back to placeholders
                                    e.target.parentNode.style.background = 'var(--gnosi-blue)';
                                    e.target.parentNode.style.color = 'white';
                                }}
                            />
                        ) : null}
                        <div style={{ width: '100%', textAlign: 'center', display: effectivePhotoUrl ? 'none' : 'block' }}>
                            {initials}
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <h2 style={{ 
                                margin: 0, 
                                fontSize: '32px', 
                                fontWeight: '700', 
                                color: 'var(--text-primary)', 
                                letterSpacing: '-0.03em' 
                            }}>{contact.name}</h2>
                            {contact.google_resource_name && (
                                <CheckCircle2 size={18} style={{ color: '#4285f4' }} />
                            )}
                        </div>
                        <div style={{ 
                            marginTop: '6px', 
                            fontSize: '14px', 
                            color: 'var(--text-tertiary)', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '12px' 
                        }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                {contact.type === 'b2b' ? <Briefcase size={14} /> : <Tag size={14} />}
                                {contact.type === 'b2b' ? (contact.job_title || t('contacts.type_business', 'Empresa')) : t('contacts.type_personal', 'Personal')}
                            </span>
                            {contact.company && (
                                <>
                                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'currentColor', opacity: 0.3 }}></span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <Building2 size={14} /> {contact.company}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={onEdit}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 20px',
                            background: 'rgba(255,255,255,0.05)',
                            color: 'var(--text-primary)',
                            borderRadius: '10px',
                            border: '1px solid var(--border-primary)',
                            fontWeight: '600',
                            fontSize: '0.875rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Edit3 size={16} />
                        {t('common.btn.edit', 'Editar')}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onDelete(contact.id);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 20px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            borderRadius: '10px',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            fontWeight: '600',
                            fontSize: '0.875rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Trash2 size={16} />
                        {t('common.btn.delete', 'Eliminar')}
                    </button>
                </div>
            </div>

            {/* Info Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '32px' }}>
                {/* Contact Info */}
                <div style={{ 
                    background: 'var(--bg-secondary)', 
                    padding: '28px', 
                    borderRadius: '20px', 
                    border: '1px solid var(--border-primary)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                }}>
                    <h3 style={{ 
                        margin: '0 0 24px 0', 
                        fontSize: '11px', 
                        fontWeight: '700', 
                        color: 'var(--text-tertiary)', 
                        textTransform: 'uppercase', 
                        letterSpacing: '0.1em', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px',
                        opacity: 0.6
                    }}>
                        <Globe size={14} /> {t('contacts.info_section', 'Informació de contacte')}
                    </h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* Emails */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', gap: '14px' }}>
                                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gnosi-blue)' }}>
                                    <Mail size={16} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.email_label', 'Emails')}</span>
                                    
                                    {(contact.emails && contact.emails.length > 0) ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {contact.emails.map((email, i) => (
                                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: i === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', padding: i === 0 ? '4px 0' : '0' }}>
                                                    <a href={`mailto:${email.value}`} style={{ color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: 'none', fontSize: i === 0 ? '14px' : '13px', fontWeight: i === 0 ? '600' : 'normal' }}>{email.value}</a>
                                                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', fontWeight: '700', textTransform: 'uppercase' }}>{getLabelText(email)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <a href={`mailto:${contact.email}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '14px', fontWeight: '600' }}>{contact.email}</a>
                                    )}
                                </div>
                            </div>
                        </div>
                        
                        {/* Phones */}
                        <div style={{ display: 'flex', gap: '14px' }}>
                            <div style={{ 
                                width: '36px', 
                                height: '36px', 
                                borderRadius: '10px', 
                                background: 'var(--bg-tertiary)', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-primary)'
                            }}>
                                <Phone size={16} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.phone_label', 'Telèfons')}</span>
                                
                                {(contact.phones && contact.phones.length > 0) ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {contact.phones.map((phone, i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: i === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', padding: i === 0 ? '4px 0' : '0' }}>
                                                <a href={`tel:${phone.value}`} style={{ color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: 'none', fontSize: i === 0 ? '14px' : '13px', fontWeight: i === 0 ? '600' : 'normal' }}>{phone.value}</a>
                                                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', fontWeight: '700', textTransform: 'uppercase' }}>{getLabelText(phone)}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    contact.phone ? (
                                        <a href={`tel:${contact.phone}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '14px', fontWeight: '600' }}>{contact.phone}</a>
                                    ) : (
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: '13px', fontStyle: 'italic' }}>{t('common.none', 'Cap')}</span>
                                    )
                                )}
                            </div>
                        </div>
                        
                        {/* Addresses */}
                        <div style={{ display: 'flex', gap: '14px' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                                <MapPin size={16} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.address_label', 'Adreces')}</span>
                                
                                {(contact.addresses && contact.addresses.length > 0) ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {contact.addresses.map((addr, i) => (
                                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2px', background: i === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', padding: i === 0 ? '4px 0' : '0' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: '700', textTransform: 'uppercase' }}>{getLabelText(addr)}</span>
                                                </div>
                                                <span style={{ color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: i === 0 ? '14px' : '13px', fontWeight: i === 0 ? '600' : 'normal' }}>{addr.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    contact.address ? (
                                        <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: '600' }}>{contact.address}</span>
                                    ) : (
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: '13px', fontStyle: 'italic' }}>{t('common.none', 'Cap')}</span>
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Additional Details */}
                {(contact.notes || (contact.tags && contact.tags.length > 0)) && (
                    <div style={{ 
                        background: 'var(--bg-secondary)', 
                        padding: '28px', 
                        borderRadius: '20px', 
                        border: '1px solid var(--border-primary)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                    }}>
                        <h3 style={{ 
                            margin: '0 0 24px 0', 
                            fontSize: '11px', 
                            fontWeight: '700', 
                            color: 'var(--text-tertiary)', 
                            textTransform: 'uppercase', 
                            letterSpacing: '0.1em', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                            opacity: 0.6
                        }}>
                             <Tag size={14} /> {t('contacts.details_section', 'Detalls addicionals')}
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            {contact.notes && (
                                <div>
                                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.notes_label', 'Notes')}</span>
                                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.6', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>{contact.notes}</p>
                                </div>
                            )}

                            {contact.tags && contact.tags.length > 0 && (
                                <div>
                                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '10px', textTransform: 'uppercase', fontWeight: '700', opacity: 0.7 }}>{t('contacts.tags_label', 'Etiquetes')}</span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {contact.tags.map((tag, index) => (
                                            <span key={index} style={{ 
                                                padding: '6px 14px', 
                                                background: 'rgba(59,130,246,0.08)', 
                                                color: 'var(--gnosi-blue)', 
                                                borderRadius: '8px', 
                                                fontSize: '11px', 
                                                fontWeight: '800', 
                                                border: '1px solid rgba(59,130,246,0.1)',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.02em'
                                            }}>
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer / Metadata */}
            <div style={{ marginTop: '48px', padding: '24px', borderTop: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.6 }}>
                <div style={{ display: 'flex', gap: '32px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: '600' }}>
                        <Globe size={14} />
                        {t('contacts.source_label', 'Origen')}: <span style={{ color: 'var(--text-primary)', textTransform: contact.source === 'local' ? 'capitalize' : 'none' }}>
                            {contact.source === 'local' ? t('contacts.source_local', 'Gnosi (Local)') : contact.source}
                        </span>
                    </div>
                    {contact.last_synced_at && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: '600' }}>
                            <RefreshCw size={14} />
                            {t('contacts.last_synced_label', 'Darrera sincronització')}: <span style={{ color: 'var(--text-primary)' }}>{new Date(contact.last_synced_at).toLocaleString()}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
