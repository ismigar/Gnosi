import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, ShieldCheck, Mail, Phone, MapPin, CreditCard, FileText } from 'lucide-react';
import { Section, FormGroup } from '../GlobalSettingsModal';
import { SettingsSectionTabs } from '../SettingsSectionTabs';

export default function IdentityProfile({ userName, setUserName, profile, setProfile }) {
    const { t } = useTranslation();
    const [activeSection, setActiveSection] = useState('assistant');

    const handleChange = (field, value) => {
        // Functional update: using `profile` from the closure can lose changes
        // if the user types quickly into two fields and the second onChange uses
        // a snapshot before React applies the first one.
        setProfile(prev => ({ ...prev, [field]: value }));
    };

    return (
        <div className="animate-in">
            {/* Header / Intro Section */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '48px' }}>
                <div className="settings-section-icon-wrap" style={{ 
                    width: '64px', height: '64px', borderRadius: '22px', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <User size={32} strokeWidth={2.5} />
                </div>
                <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 900, margin: 0, letterSpacing: '-0.04em' }}>{t('settings.profile.title')}</h2>
                    <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', margin: '4px 0 0 0', opacity: 0.8 }}>{t('settings.profile.desc')}</p>
                </div>
            </div>

            <SettingsSectionTabs
                ariaLabel={t('settings.profile.sections_label')}
                activeId={activeSection}
                onChange={setActiveSection}
                items={[
                    { id: 'assistant', icon: FileText, label: t('settings.profile.assistant_section') },
                    { id: 'contact', icon: ShieldCheck, label: t('settings.profile.contact_section') },
                ]}
            />

            {/* AI Assistant Config Section */}
            {activeSection === 'assistant' && <Section title={t('settings.profile.assistant_section', "Assistant Configuration")} icon={FileText}>
                <FormGroup
                    label={t('settings.profile.ai_username_label', "Username (AI)")}
                    description={t('settings.profile.ai_username_desc', "This is how the artificial intelligence agents will address you.")}
                >
                    <input
                        type="text"
                        className="gnosi-input"
                        value={userName || ''}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder={t('settings.profile.ai_username_placeholder', "e.g. Ismael")}
                    />
                </FormGroup>
            </Section>}

            {/* Personal Data Section */}
            {activeSection === 'contact' && <Section title={t('settings.profile.contact_section', "Contact Details and Forms")} icon={ShieldCheck}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                    <FormGroup label={t('settings.profile.full_name_label', "Full Name")}>
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.full_name || ''}
                            onChange={(e) => handleChange('full_name', e.target.value)}
                            placeholder={t('settings.profile.full_name_placeholder', "John Smith")}
                        />
                    </FormGroup>

                    <FormGroup label={t('settings.profile.email_label', 'Email')}>
                        <div style={{ position: 'relative' }}>
                            <Mail size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                            <input
                                type="email"
                                className="gnosi-input"
                                style={{ paddingLeft: '44px' }}
                                value={profile.email || ''}
                                onChange={(e) => handleChange('email', e.target.value)}
                                placeholder={t('settings.profile.email_placeholder', "your@email.com")}
                            />
                        </div>
                    </FormGroup>

                    <FormGroup label={t('settings.profile.first_name_label', "First Name")}>
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.first_name || ''}
                            onChange={(e) => handleChange('first_name', e.target.value)}
                        />
                    </FormGroup>

                    <FormGroup label={t('settings.profile.last_name_label', "Last Name")}>
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.last_name || ''}
                            onChange={(e) => handleChange('last_name', e.target.value)}
                        />
                    </FormGroup>

                    <FormGroup label={t('settings.profile.phone_label', "Phone")}>
                        <div style={{ position: 'relative' }}>
                            <Phone size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                            <input
                                type="text"
                                className="gnosi-input"
                                style={{ paddingLeft: '44px' }}
                                value={profile.phone || ''}
                                onChange={(e) => handleChange('phone', e.target.value)}
                            />
                        </div>
                    </FormGroup>

                    <FormGroup label={t('settings.profile.dni_nie_label', 'DNI / NIE')}>
                        <div style={{ position: 'relative' }}>
                            <CreditCard size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                            <input
                                type="text"
                                className="gnosi-input"
                                style={{ paddingLeft: '44px' }}
                                value={profile.dni_nie || ''}
                                onChange={(e) => handleChange('dni_nie', e.target.value)}
                            />
                        </div>
                    </FormGroup>
                </div>

                <div style={{ marginTop: '32px' }}>
                    <FormGroup label={t('settings.profile.address_label', "Address")}>
                        <div style={{ position: 'relative' }}>
                            <MapPin size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                            <input
                                type="text"
                                className="gnosi-input"
                                style={{ paddingLeft: '44px' }}
                                value={profile.address || ''}
                                onChange={(e) => handleChange('address', e.target.value)}
                                placeholder={t('settings.profile.address_placeholder', "Street, number, floor...")}
                            />
                        </div>
                    </FormGroup>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginTop: '32px' }}>
                    <FormGroup label={t('settings.profile.city_label', "City")}>
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.city || ''}
                            onChange={(e) => handleChange('city', e.target.value)}
                        />
                    </FormGroup>
                    <FormGroup label={t('settings.profile.zip_code_label', "Zip Code")}>
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.zip_code || ''}
                            onChange={(e) => handleChange('zip_code', e.target.value)}
                        />
                    </FormGroup>
                </div>

                <div style={{ marginTop: '32px' }}>
                    <FormGroup label={t('settings.profile.notes_label', "Additional Notes")}>
                        <textarea
                            className="gnosi-input"
                            style={{ minHeight: '120px', resize: 'vertical', paddingTop: '14px' }}
                            value={profile.notes || ''}
                            onChange={(e) => handleChange('notes', e.target.value)}
                            placeholder={t('settings.profile.notes_placeholder', "Other useful information...")}
                        />
                    </FormGroup>
                </div>
            </Section>}
        </div>
    );
}
