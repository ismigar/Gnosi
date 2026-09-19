import { subscribeWindowEvent, subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Bot, Settings2 } from 'lucide-react';
import { SettingsSectionTabs } from '../../../shared/ui/settings/SettingsSectionTabs';
import { fetchConfiguration } from '../../../shared/api/configuration';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { useAIResources } from './useAIResources';
import { isJsonRecord } from './aiResourcesApi';
import { AutomationsSettingsPanel } from './AIOperationsSettings';
import { OperationsHistoryPanel } from './AIOperationsHistoryPanel';
import { ActivityHistory } from './ActivityHistory';
import { CatalogError } from './AIResourcePrimitives';
import { automationResources, operationResources } from '../global-settings/aiOperationsBridge';
import type { AIResourceAgent } from './aiResourceSettingsTypes';
import type { SchedulerHistory } from '../../../shared/api/scheduler';
import './AIResourcesSettings.css';
import '../styles/settings-controls.css';

export function AIActivityPanel({ tab, aiEnabled, automationsEnabled, canEdit, systemPanel, systemHistory, systemHistoryMore, systemDiagnostics, systemHistoryError }: {
    readonly tab: string;
    readonly aiEnabled: boolean;
    readonly automationsEnabled: boolean;
    readonly canEdit: boolean;
    readonly systemDiagnostics: ReactNode;
    readonly systemHistoryError: string;
    readonly systemPanel: ReactNode;
    readonly systemHistory: SchedulerHistory['items'];
    readonly systemHistoryMore: ReactNode;
}) {
    const { t } = useTranslation();
    const vaultId = useActiveVaultId();
    const resources = useAIResources(aiEnabled);
    const [agents, setAgents] = useState<AIResourceAgent[]>([]);
    const [configVersion, setConfigVersion] = useState(0);
    const [configError, setConfigError] = useState('');
    const [params, setParams] = useSearchParams();
    const kind = params.get('kind') === 'system' ? 'system' : 'personal';
    const { refreshApprovals } = resources;
    useEffect(() => {
        if (!aiEnabled || tab !== 'approvals') return;
        const refresh = () => { if (document.visibilityState === 'visible') void refreshApprovals(); };
        const timer = window.setInterval(refresh, 15_000);
        const stopFocus = subscribeWindowEvent('focus', refresh);
        const stopVisibility = subscribeDocumentEvent('visibilitychange', refresh);
        return () => {
            window.clearInterval(timer);
            stopFocus();
            stopVisibility();
        };
    }, [aiEnabled, tab, vaultId, refreshApprovals]);
    useEffect(() => {
        if (!aiEnabled) return;
        let active = true;
        void Promise.resolve().then(() => { if (active) { setAgents([]); setConfigError(''); } return fetchConfiguration(); }).then(config => {
            if (!active) return;
            const ai = isJsonRecord(config.ai) ? config.ai : {};
            setAgents(Array.isArray(ai.agents) ? ai.agents.filter((agent): agent is AIResourceAgent => isJsonRecord(agent) && typeof agent.id === 'string') : []);
            setConfigError('');
        }).catch((error: unknown) => { if (active) setConfigError(String(error)); });
        return () => { active = false; };
    }, [aiEnabled, vaultId, configVersion]);
    const openRuns = (id: string) => { setParams({ tab: 'history', automation: id }); };
    const available = aiEnabled && automationsEnabled;
    return <div className="ai-activity-panel ai-resources-panel">
        {tab === 'schedulers' && <>
            <SettingsSectionTabs activeId={kind} ariaLabel={t('activity.origin')} items={[
                { id: 'personal', icon: Bot, label: t('activity.personal') },
                { id: 'system', icon: Settings2, label: t('activity.system') },
            ]} onChange={value => { setParams({ tab, kind: value }); }} />
            {kind === 'system' ? (automationsEnabled ? systemPanel : <p>{t('activity.plugins_required')}</p>) : <>
                {!available ? <p>{t('activity.plugins_required')}</p> : <>
                    <CatalogError error={resources.error || resources.resourceErrors.automations || configError} onRetry={async () => { setConfigVersion(value => value + 1); await resources.reload(); }} />
                    {resources.loading && <p role="status">{t('common.loading')}</p>}
                    {!resources.error && !resources.resourceErrors.automations && !configError && <AutomationsSettingsPanel key={vaultId} selectedAutomationId={params.get('automation') || undefined} resources={automationResources(resources)} agents={agents} canEdit={canEdit} onViewRuns={openRuns} />}
                </>}
            </>}
        </>}
        {tab === 'history' && <ActivityHistory key={`${vaultId}:${params.get('automation') || ''}`} aiEnabled={aiEnabled} canEdit={canEdit} resources={resources} agents={agents} systemHistory={systemHistory} systemHistoryMore={systemHistoryMore} systemDiagnostics={systemDiagnostics} systemHistoryError={systemHistoryError} />}
        {tab === 'approvals' && <>
            {aiEnabled && <div className="flex justify-end"><RefreshButton disabled={resources.loading} onClick={() => { void refreshApprovals(); }} /></div>}
            {!aiEnabled ? <p>{t('activity.ai_required')}</p> : <>
                <CatalogError error={resources.error || resources.resourceErrors.approvals || ''} onRetry={resources.reload} />
                {resources.loading ? <p role="status">{t('common.loading')}</p> : !resources.error && !resources.resourceErrors.approvals && <OperationsHistoryPanel resources={operationResources(resources)} agents={agents} section="approvals" />}
            </>}
        </>}
    </div>;
}
