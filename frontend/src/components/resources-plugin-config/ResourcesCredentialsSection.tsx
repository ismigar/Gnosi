import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ACADEMIC_SERVICES } from './resourcesPluginConfigModel';
import type { ResourcesPluginConfigController } from './resourcesPluginConfigTypes';

interface ResourcesCredentialsSectionProps {
    readonly controller: ResourcesPluginConfigController;
}

export function ResourcesCredentialsSection({
    controller,
}: ResourcesCredentialsSectionProps) {
    const { t } = useTranslation();
    const {
        credentialFeedback,
        credentialsInputs,
        credentialsStatus,
        credentialsVisible,
        deleteCredential,
        highlightCredentialKey,
        saveCredential,
        savingCredentialKey,
        toggleCredentialVisibility,
        updateCredentialInput,
    } = controller;

    return (
        <div className="resources-plugin-config__credentials-box">
            <div className="resources-plugin-config__credentials-heading">
                <KeyRound size={16} />
                <div>
                    <h5>{t('literature.settings.credentials_modal_title')}</h5>
                    <p>{t('literature.settings.credentials_modal_desc')}</p>
                </div>
            </div>

            <div className="resources-plugin-config__credentials-list">
                {ACADEMIC_SERVICES.map((service) => {
                    const isConfigured = credentialsStatus[service.key] === true;
                    const isSaving = savingCredentialKey === service.key;
                    const isHighlighted = highlightCredentialKey === service.key;
                    const isVisible = credentialsVisible[service.key] === true;
                    const currentInput = credentialsInputs[service.key] ?? '';
                    const currentFeedback = credentialFeedback.key === service.key
                        ? credentialFeedback
                        : null;

                    return (
                        <div
                            key={service.key}
                            id={`credential-${service.key}`}
                            className={`resources-plugin-config__credential-card ${isHighlighted ? 'is-highlighted' : ''}`}
                        >
                            <div className="resources-plugin-config__credential-header">
                                <div className="resources-plugin-config__credential-name-row">
                                    <strong>{service.name}</strong>
                                    <span className="resources-plugin-config__credential-badge-type">
                                        {service.badge}
                                    </span>
                                    <span className={`resources-plugin-config__status ${isConfigured ? 'is-ready' : ''}`}>
                                        {isConfigured ? (
                                            <>
                                                <CheckCircle2 size={10} />
                                                {t('literature.settings.credential_configured')}
                                            </>
                                        ) : t('literature.settings.credential_not_configured')}
                                    </span>
                                </div>
                                <a
                                    href={service.docsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="resources-plugin-config__credential-doc-link"
                                >
                                    {t('literature.settings.get_api_key')} ↗
                                </a>
                            </div>

                            <div className="resources-plugin-config__credential-input-row">
                                <div className="resources-plugin-config__credential-input-wrap">
                                    <input
                                        type={isVisible ? 'text' : 'password'}
                                        value={currentInput}
                                        placeholder={isConfigured
                                            ? '••••••••••••••••••••••••'
                                            : 'API Key / Token'}
                                        onChange={(event) => {
                                            updateCredentialInput(service.key, event.target.value);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') event.currentTarget.blur();
                                        }}
                                        onBlur={(event) => {
                                            const value = event.target.value.trim();
                                            if (value) saveCredential(service.key, service.name, value);
                                        }}
                                        disabled={isSaving}
                                    />
                                    <button
                                        type="button"
                                        className="resources-plugin-config__credential-visibility-btn"
                                        onClick={() => {
                                            toggleCredentialVisibility(service.key);
                                        }}
                                        aria-label="Toggle visibility"
                                        tabIndex={-1}
                                    >
                                        {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>

                                {isSaving && (
                                    <Loader2 size={16} className="resources-plugin-config__spin" />
                                )}

                                {isConfigured && !isSaving && (
                                    <button
                                        type="button"
                                        className="gnosi-icon-button resources-plugin-config__icon-button is-danger"
                                        title={t('literature.settings.delete_credential')}
                                        aria-label={t('literature.settings.delete_credential')}
                                        onClick={() => {
                                            deleteCredential(service.key, service.name);
                                        }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>

                            {currentFeedback && (
                                <p className={`resources-plugin-config__credential-feedback ${currentFeedback.isError ? 'is-error' : 'is-success'}`}>
                                    {currentFeedback.message}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
