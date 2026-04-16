import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Mail, Phone, MapPin, Building2, Briefcase, Tag, X, Save, ArrowLeft, Plus, Trash2, Globe, ChevronLeft, Star, Search } from 'lucide-react';
import { isGmail, getGoogleAvatarUrl } from '../../utils/avatar-utils';

export default function ContactForm({ contact, onSave, onCancel, onBack, contactAccounts = [], defaultAccount }) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        type: 'personal',
        phone: '',
        company: '',
        job_title: '',
        address: '',
        notes: '',
        tags: [],
        emails: [],
        phones: [],
        addresses: [],
        source: 'local',
        photo_url: ''
    });
    const [tagInput, setTagInput] = useState('');

    useEffect(() => {
        if (contact) {
            // Try to find the matching account email if source is just a provider name
            let initialSource = contact.source || 'local';
            if (initialSource !== 'local' && !initialSource.includes('@')) {
                const matchingAccount = contactAccounts.find(acc => acc.provider === initialSource);
                if (matchingAccount) {
                    initialSource = matchingAccount.email || matchingAccount.provider;
                }
            }

            setFormData({
                name: contact.name || '',
                email: contact.email || '',
                type: contact.type || 'personal',
                phone: contact.phone || '',
                company: contact.company || '',
                job_title: contact.job_title || '',
                address: contact.address || '',
                notes: contact.notes || '',
                tags: contact.tags || [],
                emails: contact.emails && contact.emails.length > 0 ? contact.emails : [{ label: 'home', value: contact.email || '' }],
                phones: contact.phones && contact.phones.length > 0 ? contact.phones : [{ label: 'mobile', value: contact.phone || '' }],
                addresses: contact.addresses && contact.addresses.length > 0 ? contact.addresses : [{ label: 'home', value: contact.address || '' }],
                source: initialSource,
                photo_url: contact.photo_url || ''
            });
        } else {
            // Default empty fields for new contact
            setFormData(prev => ({
                ...prev,
                emails: [{ label: 'home', value: '' }],
                phones: [{ label: 'mobile', value: '' }],
                addresses: [{ label: 'home', value: '' }],
            }));
        }
    }, [contact]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleTypeChange = (value) => {
        setFormData((prev) => ({ ...prev, type: value }));
    };

    const handleAddField = (field) => {
        setFormData(prev => ({
            ...prev,
            [field]: [...prev[field], { label: 'home', value: '' }]
        }));
    };

    const handleRemoveField = (field, index) => {
        setFormData(prev => ({
            ...prev,
            [field]: prev[field].filter((_, i) => i !== index)
        }));
    };

    const handleFieldChange = (field, index, key, value) => {
        const newList = [...formData[field]];
        newList[index] = { ...newList[index], [key]: value };
        setFormData(prev => ({ ...prev, [field]: newList }));
    };

    const handleAddTag = () => {
        const trimmed = tagInput.trim();
        if (trimmed && !formData.tags.includes(trimmed)) {
            setFormData((prev) => ({
                ...prev,
                tags: [...prev.tags, trimmed],
            }));
            setTagInput('');
        }
    };

    const handleRemoveTag = (tagToRemove) => {
        setFormData((prev) => ({
            ...prev,
            tags: prev.tags.filter((tag) => tag !== tagToRemove),
        }));
    };

    const handleFetchGmailAvatar = () => {
        const primaryEmail = formData.emails[0]?.value || formData.email;
        if (isGmail(primaryEmail)) {
            const avatarUrl = getGoogleAvatarUrl(primaryEmail);
            setFormData(prev => ({ ...prev, photo_url: avatarUrl }));
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.name) {
            return;
        }

        // Extract primary values from lists for backward compatibility and backend indexing
        const finalData = {
            ...formData,
            email: formData.emails[0]?.value || formData.email,
            phone: formData.phones[0]?.value || formData.phone,
            address: formData.addresses[0]?.value || formData.address
        };

        if (!finalData.email && finalData.emails.length > 0) {
            finalData.email = finalData.emails[0].value;
        }

        onSave(finalData);
    };

    const inputStyle = {
        width: '100%',
        padding: '10px 14px',
        borderRadius: '8px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        color: 'var(--text-primary)',
        fontSize: '14px',
        outline: 'none',
        transition: 'all 0.2s',
        marginTop: '6px'
    };

    const selectStyle = {
        ...inputStyle,
        width: 'auto',
        minWidth: '100px',
        cursor: 'pointer'
    };

    const labelStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        fontWeight: '600',
        color: 'var(--text-tertiary)',
        opacity: 0.8
    };

    const sectionTitleStyle = {
        fontSize: '11px',
        fontWeight: '700',
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
    };

    const emailLabels = [
        { value: 'home', label: t('contacts.label_home', 'Casa') },
        { value: 'work', label: t('contacts.label_work', 'Feina') },
        { value: 'other', label: t('contacts.label_other', 'Altres') },
    ];

    const phoneLabels = [
        { value: 'mobile', label: t('contacts.label_mobile', 'Mòbil') },
        { value: 'home', label: t('contacts.label_home', 'Casa') },
        { value: 'work', label: t('contacts.label_work', 'Feina') },
        { value: 'other', label: t('contacts.label_other', 'Altres') },
    ];

    const addressLabels = [
        { value: 'home', label: t('contacts.label_home', 'Casa') },
        { value: 'work', label: t('contacts.label_work', 'Feina') },
        { value: 'other', label: t('contacts.label_other', 'Altres') },
    ];

    const renderMultiFieldSection = (title, field, icon, placeholder, labels, type = "text") => (
        <div style={{ background: 'rgba(255,255,255,0.01)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
            <div style={sectionTitleStyle}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {icon} {title}
                </span>
                <button 
                    type="button" 
                    onClick={() => handleAddField(field)}
                    style={{
                        padding: '4px 8px',
                        background: 'rgba(59,130,246,0.1)',
                        color: 'var(--gnosi-blue)',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                    }}
                >
                    <Plus size={12} /> {t('common.btn.add', 'Afegir')}
                </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Unified Field List */}
                {formData[field].map((item, index) => (
                    <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                        <select
                            value={item.label}
                            onChange={(e) => handleFieldChange(field, index, 'label', e.target.value)}
                            style={{ ...selectStyle, marginTop: 0 }}
                        >
                            {labels.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        
                        {item.label === 'other' && (
                            <input
                                type="text"
                                value={item.customLabel || ''}
                                onChange={(e) => handleFieldChange(field, index, 'customLabel', e.target.value)}
                                placeholder={t('contacts.label_custom_placeholder', 'Especifiqueu...')}
                                style={{ ...inputStyle, marginTop: 0, width: '120px', flex: 'none' }}
                            />
                        )}

                        <input
                            type={type}
                            value={item.value}
                            onChange={(e) => handleFieldChange(field, index, 'value', e.target.value)}
                            placeholder={placeholder}
                            style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: '150px' }}
                            required={index === 0 && field === 'emails'}
                        />
                        {formData[field].length > 1 && (
                            <button
                                type="button"
                                onClick={() => handleRemoveField(field, index)}
                                style={{
                                    padding: '8px',
                                    background: 'transparent',
                                    color: 'var(--text-tertiary)',
                                    border: 'none',
                                    cursor: 'pointer',
                                    opacity: 0.6
                                }}
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="contact-form" style={{ 
            padding: '40px', 
            maxWidth: '800px', 
            margin: '0 auto',
            color: 'var(--text-primary)'
        }}>
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
                                transition: 'all 0.2s'
                            }}
                            title={t('common.back', 'Tornar')}
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}
                    <h2 style={{ 
                        margin: 0, 
                        fontSize: '24px', 
                        fontWeight: '700', 
                        color: 'var(--text-primary)', 
                        letterSpacing: '-0.02em' 
                    }}>
                        {contact ? t('contacts.edit_title', 'Editar Contacte') : t('contacts.new_title', 'Nou Contacte')}
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
                        transition: 'all 0.2s'
                    }}
                >
                    <ArrowLeft size={16} /> {t('common.btn.cancel', 'Cancel·lar')}
                </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                {/* Basic Info Group */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                        <label style={labelStyle}><User size={14} /> {t('contacts.name_label', 'Nom')} *</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            placeholder="Ex: Joan Sala"
                            style={inputStyle}
                        />
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                        <label style={labelStyle}><Globe size={14} /> {t('contacts.photo_url_label', 'Foto de perfil')}</label>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '10px' }}>
                            <div style={{ 
                                width: '64px', 
                                height: '64px', 
                                borderRadius: '12px', 
                                background: formData.photo_url ? 'transparent' : 'var(--gnosi-blue)', 
                                border: '1px solid var(--border-primary)',
                                overflow: 'hidden',
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                            }}>
                                {formData.photo_url ? (
                                    <img 
                                        src={formData.photo_url} 
                                        alt="Preview" 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.parentNode.style.background = 'var(--gnosi-blue)';
                                            e.target.parentNode.style.color = 'white';
                                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
                                        }}
                                    />
                                ) : null}
                                <div style={{ display: formData.photo_url ? 'none' : 'block' }}>
                                    <User size={32} />
                                </div>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                        type="text"
                                        name="photo_url"
                                        value={formData.photo_url}
                                        onChange={handleChange}
                                        placeholder="https://exemple.com/foto.jpg"
                                        style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                                    />
                                    {isGmail(formData.emails[0]?.value || formData.email) && (
                                        <button
                                            type="button"
                                            onClick={handleFetchGmailAvatar}
                                            style={{
                                                padding: '0 12px',
                                                background: 'rgba(59,130,246,0.1)',
                                                color: 'var(--gnosi-blue)',
                                                border: '1px solid rgba(59,130,246,0.2)',
                                                borderRadius: '8px',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                whiteSpace: 'nowrap'
                                            }}
                                            title={t('contacts.fetch_gmail_avatar', 'Obtenir avatar de Gmail')}
                                        >
                                            <Search size={14} />
                                            Gmail
                                        </button>
                                    )}
                                </div>
                                <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-tertiary)', opacity: 0.7 }}>
                                    {t('contacts.photo_url_hint', 'Posa una URL directa a una imatge o fes servir el botó de Gmail si és possible.')}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Type Selection */}
                <div>
                    <label style={labelStyle}><Tag size={14} /> {t('contacts.type_label', 'Tipus de contacte')}</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                        <button
                            type="button"
                            onClick={() => handleTypeChange('personal')}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                background: formData.type === 'personal' ? 'rgba(16,185,129,0.08)' : 'var(--bg-secondary)',
                                color: formData.type === 'personal' ? '#10b981' : 'var(--text-tertiary)',
                                border: '1px solid',
                                borderColor: formData.type === 'personal' ? '#10b981' : 'var(--border-primary)',
                                fontWeight: '600',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {t('contacts.type_personal', 'Personal')}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTypeChange('b2b')}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                background: formData.type === 'b2b' ? 'rgba(59,130,246,0.08)' : 'var(--bg-secondary)',
                                color: formData.type === 'b2b' ? 'var(--gnosi-blue)' : 'var(--text-tertiary)',
                                border: '1px solid',
                                borderColor: formData.type === 'b2b' ? 'var(--gnosi-blue)' : 'var(--border-primary)',
                                fontWeight: '600',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {t('contacts.type_business', 'Empresa')}
                        </button>
                    </div>
                </div>

                {/* Company Info row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div>
                        <label style={labelStyle}><Building2 size={14} /> {t('contacts.company_label', 'Empresa')}</label>
                        <input
                            type="text"
                            name="company"
                            value={formData.company}
                            onChange={handleChange}
                            placeholder="Opcional"
                            style={inputStyle}
                        />
                    </div>
                    <div>
                        <label style={labelStyle}><Briefcase size={14} /> {t('contacts.job_label', 'Càrrec')}</label>
                        <input
                            type="text"
                            name="job_title"
                            value={formData.job_title}
                            onChange={handleChange}
                            placeholder="Ex: Director IT"
                            style={inputStyle}
                            disabled={formData.type !== 'b2b'}
                        />
                    </div>
                </div>

                {/* Account Selection (Source) */}
                <div>
                    <label style={labelStyle}><Globe size={14} /> {t('contacts.sync_with_account', 'Sincronització amb')}</label>
                    <select
                        name="source"
                        value={formData.source}
                        onChange={handleChange}
                        style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                        <option value="local">{t('contacts.source_local', 'Gnosi (Només local)')}</option>
                        {contactAccounts.map((account) => {
                            const displayName = account.name || (account.provider === 'google' ? 'Google' : account.provider.toUpperCase());
                            return (
                                <option key={account.id} value={account.email || account.provider}>
                                    {displayName} ({account.email})
                                </option>
                            );
                        })}
                    </select>
                </div>

                {/* Multi-field Sections */}
                {renderMultiFieldSection(t('contacts.email_label', 'Emails'), 'emails', <Mail size={14} />, "email@exemple.com", emailLabels, "email")}
                {renderMultiFieldSection(t('contacts.phone_label', 'Telèfons'), 'phones', <Phone size={14} />, "+34 600 000 000", phoneLabels, "tel")}
                {renderMultiFieldSection(t('contacts.address_label', 'Adreces'), 'addresses', <MapPin size={14} />, "Carrer, Número, Ciutat...", addressLabels)}

                <div>
                    <label style={labelStyle}><Tag size={14} /> {t('contacts.notes_label', 'Notes / Comentaris')}</label>
                    <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleChange}
                        rows={4}
                        placeholder="Notes addicionals sobre el contacte..."
                        style={{ ...inputStyle, resize: 'vertical', minHeight: '120px' }}
                    />
                </div>

                {/* Tags Management */}
                <div>
                    <label style={labelStyle}><Tag size={14} /> {t('contacts.tags_label', 'Etiquetes')}</label>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                            placeholder={t('contacts.tag_placeholder', 'Afegeix una etiqueta...')}
                            style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                        />
                        <button
                            type="button"
                            onClick={handleAddTag}
                            style={{
                                padding: '0 24px',
                                borderRadius: '8px',
                                background: 'rgba(255,255,255,0.04)',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--border-primary)',
                                fontWeight: '600',
                                fontSize: '13px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {t('common.btn.add', 'Afegir')}
                        </button>
                    </div>
                    {formData.tags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' }}>
                            {formData.tags.map((tag, index) => (
                                <span
                                    key={index}
                                    style={{
                                        padding: '4px 10px 4px 12px',
                                        background: 'rgba(59,130,246,0.08)',
                                        color: 'var(--gnosi-blue)',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        border: '1px solid rgba(59,130,246,0.1)'
                                    }}
                                >
                                    {tag}
                                    <X
                                        size={12}
                                        onClick={() => handleRemoveTag(tag)}
                                        style={{ cursor: 'pointer', opacity: 0.6 }}
                                    />
                                </span>
                            ))}
                        </div>
                    )}
                </div>

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
                            transition: 'all 0.2s'
                        }}
                    >
                        <Save size={18} />
                        {contact ? t('common.btn.save_changes', 'Guardar Canvis') : t('contacts.btn_create', 'Crear Contacte')}
                    </button>
                </div>
            </form>
        </div>
    );
}
