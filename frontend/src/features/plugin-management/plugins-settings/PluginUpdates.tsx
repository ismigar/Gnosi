import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { isNewerVersion } from './pluginSettingsModel';
import type { ThirdPartyPluginsController } from './thirdPartyModel';

interface PluginUpdatesProps {
    readonly controller: ThirdPartyPluginsController;
}

export function PluginUpdates({ controller }: PluginUpdatesProps) {
    const { t } = useTranslation();
    const tp = (key: string): string => t(`settings.plugins.${key}`);
    const installedVersions = new Map(controller.installed.flatMap((plugin) => (
        plugin.manifest ? [[plugin.manifest.id, plugin.manifest.version] as const] : []
    )));
    const updates = controller.gallery.filter((entry) => (
        installedVersions.has(entry.id)
        && isNewerVersion(entry.version, installedVersions.get(entry.id))
    ));
    return (
        <div>
            {controller.loading && <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{tp('loading')}</div>}
            {!controller.loading && updates.length === 0 && (
                <div style={{ border: '1px dashed var(--border-primary)', borderRadius: 12, padding: '26px 18px', textAlign: 'center' }}>
                    <RefreshCw size={24} style={{ color: '#16a34a', marginBottom: 8 }} />
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{tp('updates_empty_title')}</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 4 }}>{tp('updates_empty_desc')}</div>
                </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {updates.map((entry) => (
                    <div key={entry.id} style={{ alignItems: 'center', border: '1px solid var(--border-primary)', borderRadius: 10, display: 'flex', gap: 12, padding: '12px 14px' }}>
                        <RefreshCw size={17} style={{ color: '#6366f1' }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{entry.name}</div>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>v{installedVersions.get(entry.id)} → v{entry.version}</div>
                        </div>
                        <button type="button" className="btn-gnosi-secondary" onClick={() => { void controller.installFromCatalog(entry.id); }} disabled={controller.busy === `cat:${entry.id}`}>
                            <RefreshCw size={14} /> {controller.busy === `cat:${entry.id}` ? tp('installing') : tp('update')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
