import React from 'react';
import { useTranslation } from 'react-i18next';
import { User, ShieldCheck, Mail, Phone, MapPin, CreditCard, FileText } from 'lucide-react';
import { Section, FormGroup } from '../GlobalSettingsModal';

export default function IdentityProfile({ userName, setUserName, profile, setProfile }) {
    const { t } = useTranslation();

    const handleChange = (field, value) => {
        // Functional update: usar `profile` del closure pot perdre canvis
        // si l'usuari escriu ràpid a dos camps i el segon onChange usa
        // un snapshot abans que React aplique el primer.
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

            {/* AI Assistant Config Section */}
            <Section title="Configuració de l'Assistent" icon={FileText}>
                <FormGroup 
                    label="Nom d'usuari (IA)" 
                    description="Així és com t'anomenaran els agents d'intel·ligència artificial."
                >
                    <input
                        type="text"
                        className="gnosi-input"
                        value={userName || ''}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="P. ex. Ismael"
                    />
                </FormGroup>
            </Section>

            {/* Personal Data Section */}
            <Section title="Dades de Contacte i Formularis" icon={ShieldCheck}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                    <FormGroup label="Nom Complet">
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.full_name || ''}
                            onChange={(e) => handleChange('full_name', e.target.value)}
                            placeholder="Joan Puig i Cadafalch"
                        />
                    </FormGroup>

                    <FormGroup label="Email">
                        <div style={{ position: 'relative' }}>
                            <Mail size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                            <input
                                type="email"
                                className="gnosi-input"
                                style={{ paddingLeft: '44px' }}
                                value={profile.email || ''}
                                onChange={(e) => handleChange('email', e.target.value)}
                                placeholder="el-teu@correu.com"
                            />
                        </div>
                    </FormGroup>

                    <FormGroup label="Nom">
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.first_name || ''}
                            onChange={(e) => handleChange('first_name', e.target.value)}
                        />
                    </FormGroup>

                    <FormGroup label="Cognoms">
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.last_name || ''}
                            onChange={(e) => handleChange('last_name', e.target.value)}
                        />
                    </FormGroup>

                    <FormGroup label="Telèfon">
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

                    <FormGroup label="DNI / NIE">
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
                    <FormGroup label="Adreça">
                        <div style={{ position: 'relative' }}>
                            <MapPin size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                            <input
                                type="text"
                                className="gnosi-input"
                                style={{ paddingLeft: '44px' }}
                                value={profile.address || ''}
                                onChange={(e) => handleChange('address', e.target.value)}
                                placeholder="Carrer, número, pis..."
                            />
                        </div>
                    </FormGroup>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginTop: '32px' }}>
                    <FormGroup label="Ciutat">
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.city || ''}
                            onChange={(e) => handleChange('city', e.target.value)}
                        />
                    </FormGroup>
                    <FormGroup label="Codi Postal">
                        <input
                            type="text"
                            className="gnosi-input"
                            value={profile.zip_code || ''}
                            onChange={(e) => handleChange('zip_code', e.target.value)}
                        />
                    </FormGroup>
                </div>

                <div style={{ marginTop: '32px' }}>
                    <FormGroup label="Notes Addicionals">
                        <textarea
                            className="gnosi-input"
                            style={{ minHeight: '120px', resize: 'vertical', paddingTop: '14px' }}
                            value={profile.notes || ''}
                            onChange={(e) => handleChange('notes', e.target.value)}
                            placeholder="Altra informació útil..."
                        />
                    </FormGroup>
                </div>
            </Section>
        </div>
    );
}
