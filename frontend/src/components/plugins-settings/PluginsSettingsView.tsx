import {
    BookOpen, BrainCircuit, Calendar, CalendarDays, CalendarRange, Clock3,
    Cpu, Database, Hash, Inbox, Languages, LayoutDashboard, MessageSquare,
    NotebookTabs, PackageCheck, Puzzle, RefreshCw, Scissors, Settings,
    Share2, Store, Users,
    type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyError } from '../../lib/notifyError';
import { BUILTIN_PLUGINS } from '../../plugins/registry';
import { usePlugins } from '../../plugins/usePlugins';
import ConfirmModal from '../ConfirmModal';
import ResourcesPluginConfig from '../ResourcesPluginConfig';
import { SettingsSectionTabs } from '../SettingsSectionTabs';
import { DailyNotesConfig } from './DailyNotesConfig';
import { LlmWikiConfig } from './LlmWikiConfig';
import {
    isPluginSection,
    lifecycleConflict,
    normalizeBuiltinPlugins,
    readPendingPluginId,
    type InstalledFilter,
    type PendingLifecycle,
    type PluginConfigComponent,
    type PluginSection,
} from './pluginSettingsModel';
import { ProjectPlanningConfig } from './ProjectPlanningConfig';
import { ThirdPartyPlugins } from './ThirdPartyPlugins';
import { WebClipperConfig } from './WebClipperConfig';

const ICONS: Readonly<Record<string, LucideIcon>> = {
    BookOpen, BrainCircuit, Calendar, CalendarDays, CalendarRange, Clock3,
    Cpu, Database, Hash, Inbox, Languages, LayoutDashboard, MessageSquare,
    NotebookTabs, Scissors, Share2, Users,
};

const INLINE_CONFIGS: Readonly<Record<string, PluginConfigComponent>> = {
    'daily-notes': DailyNotesConfig,
    'llm-wiki': LlmWikiConfig,
    'project-planning': ProjectPlanningConfig,
    resources: ResourcesPluginConfig,
    'web-clipper': WebClipperConfig,
};

export interface PluginsSettingsProps {
    readonly initialPluginId?: string | null;
    readonly onOpenSettingsTab?: (tab: string, pluginId: string) => void;
}

export function PluginsSettingsView({
    onOpenSettingsTab,
    initialPluginId = null,
}: PluginsSettingsProps) {
    const { t } = useTranslation();
    const { builtins, isEnabled, setPluginEnabled } = usePlugins();
    const catalog = normalizeBuiltinPlugins(builtins.length > 0 ? builtins : BUILTIN_PLUGINS);
    const [section, setSection] = useState<PluginSection>('installed');
    const [installedFilter, setInstalledFilter] = useState<InstalledFilter>('all');
    const [pendingLifecycle, setPendingLifecycle] = useState<PendingLifecycle | null>(null);
    const [busyPluginIds, setBusyPluginIds] = useState<ReadonlySet<string>>(() => new Set());
    const [configuredPluginId, setConfiguredPluginId] = useState<string | null>(null);
    const tp = (key: string, values: Readonly<Record<string, unknown>> = {}): string => (
        t(`settings.plugins.${key}`, values)
    );

    useEffect(() => {
        const targetPluginId = initialPluginId ?? readPendingPluginId();
        if (!targetPluginId) return undefined;
        const stateTimer = setTimeout(() => {
            setSection('installed');
            setInstalledFilter('all');
            setConfiguredPluginId(targetPluginId);
        }, 0);
        const scrollTimer = setTimeout(() => {
            document.getElementById(`settings-plugin-${targetPluginId}`)?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        }, 120);
        return () => {
            clearTimeout(stateTimer);
            clearTimeout(scrollTimer);
        };
    }, [initialPluginId]);

    const openPluginConfiguration = (pluginId: string, settingsTab?: string): void => {
        if (INLINE_CONFIGS[pluginId]) {
            setConfiguredPluginId((current) => current === pluginId ? null : pluginId);
        } else if (settingsTab) {
            onOpenSettingsTab?.(settingsTab, pluginId);
        }
    };

    const markBusy = (pluginId: string, busy: boolean): void => {
        setBusyPluginIds((current) => {
            const next = new Set(current);
            if (busy) next.add(pluginId);
            else next.delete(pluginId);
            return next;
        });
    };

    const togglePlugin = async (pluginId: string, enabled: boolean): Promise<void> => {
        if (busyPluginIds.has(pluginId)) return;
        markBusy(pluginId, true);
        try {
            await setPluginEnabled(pluginId, enabled);
        } catch (error) {
            const conflict = lifecycleConflict(error);
            if (conflict) {
                setPendingLifecycle({ ...conflict, enabled, pluginId });
            } else {
                notifyError('plugin-lifecycle', error, tp('lifecycle_error'));
            }
        } finally {
            markBusy(pluginId, false);
        }
    };

    const confirmLifecycle = async (): Promise<void> => {
        if (!pendingLifecycle) return;
        markBusy(pendingLifecycle.pluginId, true);
        try {
            await setPluginEnabled(pendingLifecycle.pluginId, pendingLifecycle.enabled, {
                confirmDependencies: pendingLifecycle.enabled,
                confirmDisable: !pendingLifecycle.enabled,
            });
            setPendingLifecycle(null);
        } catch (error) {
            notifyError('plugin-lifecycle', error, tp('lifecycle_error'));
        } finally {
            markBusy(pendingLifecycle.pluginId, false);
        }
    };

    return (
        <div>
            <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} /><h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{tp('title')}</h3>
            </div>
            <p style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 13, marginBottom: 16 }}>{tp('desc')}</p>
            <SettingsSectionTabs
                ariaLabel={tp('sections_label')}
                activeId={section}
                onChange={(id) => {
                    if (isPluginSection(id)) setSection(id);
                }}
                items={[
                    { id: 'installed', icon: PackageCheck, label: tp('installed_tab') },
                    { id: 'catalog', icon: Store, label: tp('catalog_tab') },
                    { id: 'updates', icon: RefreshCw, label: tp('updates_tab') },
                ]}
            />
            {section === 'installed' && (
                <>
                    <div className="settings-filter-tabs" role="group" aria-label={tp('installed_filters_label')}>
                        {(['all', 'enabled', 'disabled'] as const).map((filter) => (
                            <button key={filter} type="button" className={installedFilter === filter ? 'is-active' : ''} aria-pressed={installedFilter === filter} onClick={() => { setInstalledFilter(filter); }}>{tp(`filter_${filter}`)}</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {catalog.filter((plugin) => installedFilter === 'all' || (installedFilter === 'enabled' ? isEnabled(plugin.id) : !isEnabled(plugin.id))).map((plugin) => {
                            const Icon = ICONS[plugin.icon] ?? Puzzle;
                            const enabled = isEnabled(plugin.id);
                            const InlineConfig = INLINE_CONFIGS[plugin.id];
                            const isConfigOpen = configuredPluginId === plugin.id;
                            return (
                                <div key={plugin.id} id={`settings-plugin-${plugin.id}`} className="settings-plugin-item" style={{ background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 0, padding: '12px 14px' }}>
                                    <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
                                        <Icon size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ color: 'var(--text-primary, #0f172a)', fontSize: 14, fontWeight: 600 }}>{tp(`catalog.${plugin.id}.name`)}</div>
                                            <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>{tp(`catalog.${plugin.id}.description`)}</div>
                                        </div>
                                        {plugin.settingsTab && enabled && (
                                            <button type="button" onClick={() => { openPluginConfiguration(plugin.id, plugin.settingsTab); }} aria-label={tp('configure')} aria-expanded={InlineConfig ? isConfigOpen : undefined} title={tp('configure')} style={{ alignItems: 'center', background: 'transparent', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: 'var(--text-tertiary, #94a3b8)', display: 'flex', flexShrink: 0, height: 30, justifyContent: 'center', width: 30 }}><Settings size={16} /></button>
                                        )}
                                        <button type="button" role="switch" aria-checked={enabled} onClick={() => { void togglePlugin(plugin.id, !enabled); }} disabled={busyPluginIds.has(plugin.id)} style={{ background: enabled ? '#6366f1' : 'var(--border-primary, #cbd5e1)', border: 'none', borderRadius: 999, cursor: 'pointer', flexShrink: 0, height: 24, opacity: busyPluginIds.has(plugin.id) ? 0.65 : 1, position: 'relative', transition: 'background 0.15s', width: 42 }} title={enabled ? tp('disable') : tp('enable')}>
                                            <span style={{ background: '#fff', borderRadius: '50%', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', height: 20, left: enabled ? 20 : 2, position: 'absolute', top: 2, transition: 'left 0.15s', width: 20 }} />
                                        </button>
                                    </div>
                                    {InlineConfig && isConfigOpen && <InlineConfig />}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
            <ConfirmModal
                isOpen={Boolean(pendingLifecycle)}
                onClose={() => { setPendingLifecycle(null); }}
                onConfirm={confirmLifecycle}
                title={tp('dependency_confirm_title', { defaultValue: 'Change related plugins?' })}
                message={pendingLifecycle?.enabled
                    ? tp('dependency_enable_message', { defaultValue: 'This feature also needs: {{plugins}}. They will be activated together.', plugins: pendingLifecycle.enable.join(', ') })
                    : tp('dependency_disable_message', { defaultValue: 'These dependent features will also be disabled: {{plugins}}. Their data and settings will be preserved.', plugins: pendingLifecycle?.disable.join(', ') ?? '' })}
                confirmText={tp('dependency_confirm_action', { defaultValue: 'Confirm change' })}
                isDestructive={!pendingLifecycle?.enabled}
            />
            <ThirdPartyPlugins section={section} installedFilter={installedFilter} />
        </div>
    );
}
