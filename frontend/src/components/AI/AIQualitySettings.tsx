import { useEffect, useState } from 'react';
import { Activity, Check, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import { AIQualityMemorySection } from './AIQualityMemorySection';
import type {
    AIQualityAgent,
    AIQualityResources,
} from './aiQualityTypes';


interface MetricProps {
    readonly label: string;
    readonly value: number | string;
}


interface AIQualitySettingsPanelProps {
    readonly agents?: readonly AIQualityAgent[];
    readonly resources: AIQualityResources;
}


const Metric = ({ label, value }: MetricProps) => (
    <article className="ai-resource-card" style={{ minWidth: '150px', flex: '1 1 150px' }}>
        <div className="ai-resource-card__main">
            <span className="ai-resource-card__copy">
                <span>{label}</span>
                <strong style={{ fontSize: '1.35rem' }}>{value}</strong>
            </span>
        </div>
    </article>
);


export const AIQualitySettingsPanel = ({
    resources,
    agents = [],
}: AIQualitySettingsPanelProps) => {
    const { t } = useTranslation();
    const [trigger, setTrigger] = useState('');
    const [related, setRelated] = useState('');
    const [saving, setSaving] = useState(false);
    const [selectedAgentChoice, setSelectedAgentChoice] = useState('');
    const [runningEvaluation, setRunningEvaluation] = useState(false);
    const selectedAgentId = selectedAgentChoice || agents[0]?.id || '';
    const quality = resources.qualityDashboard?.quality ?? {};
    const capabilities = resources.qualityDashboard?.capabilities ?? [];
    const healthyCount = capabilities.filter(item => item.status === 'healthy').length;
    const loadAgentMemories = resources.loadAgentMemories;

    useEffect(() => {
        if (!selectedAgentId) return;
        void loadAgentMemories(selectedAgentId).catch((error: unknown) => {
            logError('ai-quality-memory-load', error);
        });
    }, [loadAgentMemories, selectedAgentId]);

    const saveAssociation = async (): Promise<void> => {
        const terms = related.split(',').map((value) => value.trim()).filter(Boolean);
        if (!trigger.trim() || terms.length === 0 || saving) return;
        setSaving(true);
        try {
            await resources.addSemanticAssociation(trigger, terms);
            setTrigger('');
            setRelated('');
            toast.success(t('settings.ai.quality.association_saved'));
        } catch (error) {
            logError('ai-quality-association-create', error);
            toast.error(t('settings.ai.quality.association_error'));
        } finally {
            setSaving(false);
        }
    };

    const removeAssociation = async (associationId: string): Promise<void> => {
        try {
            await resources.removeSemanticAssociation(associationId);
            toast.success(t('settings.ai.quality.association_deleted'));
        } catch (error) {
            logError('ai-quality-association-delete', error);
            toast.error(t('settings.ai.quality.association_error'));
        }
    };

    const runEvaluation = async (): Promise<void> => {
        if (!selectedAgentId || runningEvaluation) return;
        setRunningEvaluation(true);
        try {
            await resources.runModelEvaluation(selectedAgentId);
            toast.success(t('settings.ai.quality.evaluation_complete'));
        } catch (error) {
            logError('ai-quality-evaluation-run', error);
            toast.error(t('settings.ai.quality.evaluation_error'));
        } finally {
            setRunningEvaluation(false);
        }
    };

    return (
        <div className="ai-resources-panel">
            <div className="ai-resource-alert">
                <Activity size={18} />
                <span>{t('settings.ai.quality.privacy_help')}</span>
                <button
                    type="button"
                    className="btn-gnosi-secondary"
                    onClick={() => {
                        void resources.reload();
                    }}
                >
                    <RefreshCw size={15} /> {t('common.refresh')}
                </button>
            </div>
            <div className="ai-resource-list" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Metric label={t('settings.ai.quality.completed_turns')} value={quality.completed_turns || 0} />
                <Metric label={t('settings.ai.quality.errors')} value={quality.errors || 0} />
                <Metric label={t('settings.ai.quality.fast_turns')} value={quality.latency_buckets?.fast || 0} />
                <Metric label={t('settings.ai.quality.verified_turns')} value={quality.verification?.passed || 0} />
                <Metric
                    label={t('settings.ai.quality.healthy_tools')}
                    value={[healthyCount, capabilities.length].join('/')}
                />
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

            <h4>{t('settings.ai.quality.model_evaluations')}</h4>
            <p className="ai-resource-muted">{t('settings.ai.quality.model_evaluations_help')}</p>
            <div className="ai-resource-editor__actions" style={{ justifyContent: 'flex-start' }}>
                <select
                    className="gnosi-select"
                    value={selectedAgentId}
                    onChange={(event) => {
                        setSelectedAgentChoice(event.target.value);
                    }}
                >
                    {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                <button
                    type="button"
                    className="btn-gnosi btn-gnosi-primary"
                    disabled={!selectedAgentId || runningEvaluation}
                    onClick={() => {
                        void runEvaluation();
                    }}
                >
                    {runningEvaluation ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
                    {t('settings.ai.quality.run_evaluation')}
                </button>
            </div>
            <div className="ai-resource-list">
                {resources.modelEvaluations.slice(0, 10).map(item => (
                    <article key={item.evaluation_id} className="ai-resource-card">
                        <div className="ai-resource-card__main">
                            <span className="ai-resource-card__copy">
                                <strong>{item.provider} · {item.model}</strong>
                                <span>{Math.round((item.score || 0) * 100)}/100 · {item.latency_ms} ms · ${Number(item.estimated_cost_usd || 0).toFixed(6)}</span>
                            </span>
                        </div>
                    </article>
                ))}
            </div>

            <AIQualityMemorySection
                resources={resources}
                selectedAgentId={selectedAgentId}
            />

            <h4>{t('settings.ai.quality.conformance_title')}</h4>
            <p className="ai-resource-muted">{t('settings.ai.quality.conformance_help')}</p>
            <div className="ai-resource-list" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Metric label={t('settings.ai.quality.conformance_pass')} value={resources.capabilityConformance?.counts?.pass || 0} />
                <Metric label={t('settings.ai.quality.conformance_partial')} value={resources.capabilityConformance?.counts?.partial || 0} />
                <Metric label={t('settings.ai.quality.conformance_legacy')} value={resources.capabilityConformance?.counts?.legacy || 0} />
            </div>

            <h4>{t('settings.ai.quality.vocabulary_title')}</h4>
            <p className="ai-resource-muted">{t('settings.ai.quality.vocabulary_help')}</p>
            <div className="ai-resource-editor">
                <div className="ai-resource-editor__grid">
                    <label>
                        <span>{t('settings.ai.quality.trigger')}</span>
                        <input
                            className="gnosi-input"
                            value={trigger}
                            onChange={(event) => {
                                setTrigger(event.target.value);
                            }}
                        />
                    </label>
                    <label>
                        <span>{t('settings.ai.quality.related_terms')}</span>
                        <input
                            className="gnosi-input"
                            value={related}
                            onChange={(event) => {
                                setRelated(event.target.value);
                            }}
                            placeholder={t('settings.ai.quality.related_terms_placeholder')}
                        />
                    </label>
                </div>
                <div className="ai-resource-editor__actions">
                    <button
                        type="button"
                        className="btn-gnosi btn-gnosi-primary"
                        disabled={!trigger.trim() || !related.trim() || saving}
                        onClick={() => {
                            void saveAssociation();
                        }}
                    >
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
                            <button
                                type="button"
                                className="is-danger"
                                onClick={() => {
                                    void removeAssociation(item.id);
                                }}
                            >
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
