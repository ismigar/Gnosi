import React from 'react';
import { useTranslation } from 'react-i18next';
import { setInterfaceLanguage } from '../lib/interfaceLanguage';

const LanguageSwitcher = () => {
    const { i18n, t } = useTranslation();

    const changeLanguage = (event) => {
        void setInterfaceLanguage(i18n, event.target.value);
    };

    return (
        <div className="language-switcher" style={{ marginBottom: '10px' }}>
            <label htmlFor="language-select" style={{ marginRight: '5px', fontWeight: 'bold' }}>{t('language')}: </label>
            <select id="language-select" onChange={changeLanguage} value={i18n.resolvedLanguage || 'en'} style={{ padding: '5px', borderRadius: '4px' }}>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="ca">Català</option>
            </select>
        </div>
    );
};

export default LanguageSwitcher;
