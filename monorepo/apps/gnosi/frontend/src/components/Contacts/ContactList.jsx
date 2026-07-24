import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, Building2, User, CheckCircle2 } from 'lucide-react';
import { isGmail, getGoogleAvatarUrl } from '../../utils/avatar-utils';

export default function ContactList({ contacts, selectedId, onSelect, filter, onFilterChange, loading }) {
    const { t } = useTranslation();

    return (
        <div className="contact-list" style={{ 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column', 
            background: 'var(--bg-primary)', 
            borderRight: '1px solid var(--border-primary)' 
        }}>
            {/* Filter Area - more compact and consistent */}
            <div className="contact-list__filters" style={{ 
                padding: '12px 16px', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '8px', 
                borderBottom: '1px solid var(--border-primary)',
                background: 'var(--bg-primary)'
            }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Search size={14} style={{ 
                        position: 'absolute', 
                        left: '10px', 
                        color: 'var(--text-tertiary)',
                        opacity: 0.6
                    }} />
                    <input
                        type="text"
                        placeholder={t('contacts.search_placeholder', "Search contacts...")}
                        value={filter.search}
                        onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
                        style={{
                            width: '100%',
                            padding: '6px 10px 6px 32px',
                            borderRadius: '6px',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            outline: 'none',
                            transition: 'all 0.2s',
                        }}
                    />
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Filter size={12} style={{ 
                        position: 'absolute', 
                        left: '10px', 
                        color: 'var(--text-tertiary)',
                        opacity: 0.6
                    }} />
                    <select
                        value={filter.type}
                        onChange={(e) => onFilterChange({ ...filter, type: e.target.value })}
                        style={{
                            width: '100%',
                            padding: '6px 10px 6px 32px',
                            borderRadius: '6px',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '12px',
                            appearance: 'none',
                            outline: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="">{t('contacts.filter_all', "All")}</option>
                        <option value="personal">{t('contacts.type_personal', 'Personal')}</option>
                        <option value="b2b">{t('contacts.type_business', "Business")}</option>
                    </select>
                </div>
            </div>

            <div className="contact-list__items" style={{ 
                flex: 1, 
                overflowY: 'auto', 
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
            }}>
                {loading ? (
                    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        <div className="animate-spin" style={{ display: 'inline-block', marginBottom: '8px' }}>
                            <Filter size={20} opacity={0.3} />
                        </div>
                        <p style={{ fontSize: '12px' }}>{t('common.status.loading')}</p>
                    </div>
                ) : contacts.length === 0 ? (
                    <div style={{ padding: '48px 16px', textAlign: 'center', opacity: 0.4 }}>
                        <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{t('contacts.no_contacts', "You don't have any contacts yet.")}</p>
                    </div>
                ) : (
                    contacts.map((contact) => (
                        <div
                            key={contact.id}
                            onClick={() => onSelect(contact)}
                            style={{
                                padding: '8px 12px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                transition: 'all 0.1s ease',
                                background: selectedId === contact.id ? 'var(--bg-secondary)' : 'transparent',
                                border: '1px solid',
                                borderColor: selectedId === contact.id ? 'var(--border-primary)' : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                position: 'relative'
                            }}
                            onMouseEnter={(e) => {
                                if (selectedId !== contact.id) {
                                    e.currentTarget.style.background = 'var(--bg-secondary)';
                                    e.currentTarget.style.opacity = '0.8';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (selectedId !== contact.id) {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.opacity = '1';
                                }
                            }}
                        >
                        <div style={{ 
                                width: '32px', 
                                height: '32px', 
                                borderRadius: '8px', 
                                background: (contact.photo_url || (isGmail(contact.email) ? getGoogleAvatarUrl(contact.email) : '')) ? 'transparent' : 'var(--gnosi-blue)', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                color: (contact.photo_url || (isGmail(contact.email) ? getGoogleAvatarUrl(contact.email) : '')) ? 'inherit' : 'white',
                                fontSize: '14px',
                                fontWeight: '700',
                                flexShrink: 0,
                                overflow: 'hidden'
                            }}>
                                {contact.photo_url || (isGmail(contact.email) ? getGoogleAvatarUrl(contact.email) : '') ? (
                                    <img 
                                        src={contact.photo_url || getGoogleAvatarUrl(contact.email)} 
                                        alt={contact.name} 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        onError={(e) => { 
                                            e.target.style.display = 'none'; 
                                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
                                            e.target.parentNode.style.background = 'var(--gnosi-blue)';
                                            e.target.parentNode.style.color = 'white';
                                        }}
                                    />
                                ) : null}
                                <div style={{ width: '100%', textAlign: 'center', display: (contact.photo_url || (isGmail(contact.email) ? getGoogleAvatarUrl(contact.email) : '')) ? 'none' : 'block' }}>
                                    {(contact.name || '?').charAt(0).toUpperCase()}
                                </div>
                            </div>
                            
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <p style={{ 
                                        margin: 0, 
                                        fontSize: '13px', 
                                        fontWeight: selectedId === contact.id ? '600' : '500', 
                                        color: selectedId === contact.id ? 'var(--text-primary)' : 'var(--text-primary)', 
                                        whiteSpace: 'nowrap', 
                                        overflow: 'hidden', 
                                        textOverflow: 'ellipsis' 
                                    }}>
                                        {contact.name}
                                    </p>
                                    {contact.google_resource_name && (
                                        <CheckCircle2 size={10} style={{ color: '#4285f4', opacity: 0.8 }} />
                                    )}
                                </div>
                                <p style={{ 
                                    margin: 0, 
                                    fontSize: '11px', 
                                    color: 'var(--text-tertiary)', 
                                    whiteSpace: 'nowrap', 
                                    overflow: 'hidden', 
                                    textOverflow: 'ellipsis',
                                    opacity: 0.7
                                }}>
                                    {contact.company || contact.email}
                                </p>
                            </div>
                            
                            {selectedId === contact.id && (
                                <div style={{ 
                                    width: '2px', 
                                    height: '16px', 
                                    background: 'var(--gnosi-blue)', 
                                    borderRadius: '1px', 
                                    position: 'absolute', 
                                    left: '0px' 
                                }} />
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );

}
