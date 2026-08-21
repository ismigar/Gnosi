import React, { useState } from 'react';
import { Activity, Check, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { toast } from '../../lib/toast';


const Metric = ({ label, value }) => (
    <article className="ai-resource-card" style={{ minWidth: '150px', flex: '1 1 150px' }}>
        <div className="ai-resource-card__main">
            <span className="ai-resource-card__copy">
                <span>{label}</span>
                <strong style={{ fontSize: '1.35rem' }}>{value}</strong>
            </span>
        </div>
    </article>
);


export const AIQualitySettingsPanel = ({ resources }) => {
    const { t } = useTranslation();
    const [trigger, setTrigger] = useState('');
    const [related, setRelated] = useState('');
    const [saving, setSaving] = useState(false);
    const quality = resources.qualityDashboard?.quality || {};
    const capabilities = resources.qualityDashboard?.capabilities || [];
    const healthyCount = capabilities.filter(item => item.status === 'healthy').length;

    const saveAssociation = async () => {
        const terms = related.split(',').map(value => value.trim()).filter(Boolean);
        if (!trigger.trim() || terms.length === 0 || saving) return;
        setSaving(true);
        try {
            await resources.addSemanticAssociation(trigger, terms);
            setTrigger('');
            setRelated('');
            toast.success(t('settings.ai.quality.association_saved'));
        } catch (error) {
            console.error('Error saving semantic association:', error);
            toast.error(t('settings.ai.quality.association_error'));
        } finally {
            setSaving(false);
        }
    };

    const removeAssociation = async associationId => {
        try {
            await resources.removeSemanticAssociation(associationId);
            toast.success(t('settings.ai.quality.association_deleted'));
        } catch (error) {
            console.error('Error deleting semantic association:', error);
            toast.error(t('settings.ai.quality.association_error'));
        }
    };

    return (
        <div className="ai-resources-panel">
            <div className="ai-resource-alert">
                <Activity size={18} />
                <span>{t('settings.ai.quality.privacy_help')}</span>
                <button type="button" className="btn-gnosi-secondary" onClick={resources.reload}>
                    <RefreshCw size={15} /> {t('common.refresh')}
                </button>
            </div>
            <div className="ai-resource-list" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Metric label={t('settings.ai.quality.completed_turns')} value={quality.completed_turns || 0} />
                <Metric label={t('settings.ai.quality.errors')} value={quality.errors || 0} />
                <Metric label={t('settings.ai.quality.fast_turns')} value={quality.latency_buckets?.fast || 0} />
                <Metric label={t('settings.ai.quality.verified_turns')} value={quality.verification?.passed || 0} />
                <Metric label={t('settings.ai.quality.healthy_tools')} value={`${healthyCount}/${capabilities.length}`} />
            </div>

            <h4>{t('settings.ai.quality.capability_health')}</h4>
            <div className="ai-resource-list">
                {capabilities.slice(0, 50).map(item => (
                    <article key={item.capability_id} className="ai-resource-card">
                        <div className="ai-resource-card__main">
                            <Check size={17} />
                            <span className="ai-resource-card__copy">
                                <span className="ai-resource-card__heading">
                                    <strong>{item.capability_id}</strong>
                                    <code>{t(`settings.ai.quality.health_status.${item.status}`, item.status)}</code>
                                </span>
                                <span className="ai-resource-card__meta">
                                    <span>{t('settings.ai.quality.success_count', { count: item.successes || 0 })}</span>
                                    <span>{t('settings.ai.quality.failure_count', { count: item.failures || 0 })}</span>
                                    <span>{t('settings.ai.quality.average_latency', { count: item.average_latency_ms || 0 })}</span>
                                </span>
                            </span>
                        </div>
                    </article>
                ))}
                {!resources.loading && capabilities.length === 0 && (
                    <span className="ai-resource-muted">{t('settings.ai.quality.no_health_data')}</span>
                )}
            </div>

            <h4>{t('settings.ai.quality.vocabulary_title')}</h4>
            <p className="ai-resource-muted">{t('settings.ai.quality.vocabulary_help')}</p>
            <div className="ai-resource-editor">
                <div className="ai-resource-editor__grid">
                    <label>
                        <span>{t('settings.ai.quality.trigger')}</span>
                        <input className="gnosi-input" value={trigger} onChange={event => setTrigger(event.target.value)} />
                    </label>
                    <label>
                        <span>{t('settings.ai.quality.related_terms')}</span>
                        <input className="gnosi-input" value={related} onChange={event => setRelated(event.target.value)} placeholder={t('settings.ai.quality.related_terms_placeholder')} />
                    </label>
                </div>
                <div className="ai-resource-editor__actions">
                    <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!trigger.trim() || !related.trim() || saving} onClick={saveAssociation}>
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {t('common.add')}
                    </button>
                </div>
            </div>
            <div className="ai-resource-list">
                {resources.semanticAssociations.map(item => (
                    <article key={item.id} className="ai-resource-card">
                        <div className="ai-resource-card__main">
                            <span className="ai-resource-card__copy">
                                <span className="ai-resource-card__heading"><strong>{item.trigger_term}</strong><code>{item.related_term}</code></span>
                            </span>
                        </div>
                        <div className="ai-resource-card__actions">
                            <button type="button" className="is-danger" onClick={() => removeAssociation(item.id)}>
                                <Trash2 size={15} /> {t('common.delete')}
                            </button>
                        </div>
                    </article>
                ))}
                {!resources.loading && resources.semanticAssociations.length === 0 && (
                    <span className="ai-resource-muted">{t('settings.ai.quality.no_associations')}</span>
                )}
            </div>
        </div>
    );
};
