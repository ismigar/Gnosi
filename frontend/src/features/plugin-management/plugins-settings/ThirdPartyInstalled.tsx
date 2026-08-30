import { Download, Puzzle, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import type { InstalledFilter } from './pluginSettingsModel';
import type { ThirdPartyPluginsController } from './thirdPartyModel';

interface ThirdPartyInstalledProps {
    readonly controller: ThirdPartyPluginsController;
    readonly filter: InstalledFilter;
}

export function ThirdPartyInstalled({ controller, filter }: ThirdPartyInstalledProps) {
    const { t } = useTranslation();
    const tp = (key: string, values: Readonly<Record<string, unknown>> = {}): string => t(`settings.plugins.${key}`, values);
    const visible = controller.installed.filter((plugin) => {
        const pluginId = plugin.manifest?.id ?? plugin.id ?? '';
        if (filter === 'enabled') return controller.isEnabled(pluginId);
        if (filter === 'disabled') return !controller.isEnabled(pluginId);
        return true;
    });

    return (
        <>
            <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{tp('third_party_title')}</h3>
            </div>
            <p style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 13, marginBottom: 12 }}>
                <Trans i18nKey="settings.plugins.third_party_desc" components={{ code: <code /> }} />
            </p>
            {controller.error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 12, marginBottom: 10, padding: '8px 10px' }}>{controller.error}</div>}
            {controller.notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#15803d', fontSize: 12, marginBottom: 10, padding: '8px 10px' }}>{controller.notice}</div>}
            {controller.loading && <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 13 }}>{tp('loading')}</div>}
            {!controller.loading && visible.length === 0 && (
                <div style={{ border: '1px dashed var(--border-primary, #e2e8f0)', borderRadius: 10, color: 'var(--text-tertiary, #94a3b8)', fontSize: 13, padding: '12px 14px' }}>{tp('installed_filter_empty')}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visible.map((plugin) => {
                    const manifest = plugin.manifest;
                    if (!manifest) {
                        return (
                            <div key={plugin.id ?? plugin.error ?? 'broken-plugin'} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#dc2626', fontSize: 13, padding: '12px 14px' }}>
                                <Trans i18nKey="settings.plugins.broken_plugin" values={{ error: plugin.error ?? '', id: plugin.id ?? '' }} components={{ b: <strong /> }} />
                            </div>
                        );
                    }
                    const enabled = controller.isEnabled(manifest.id);
                    const granted = plugin.granted ?? [];
                    const declared = manifest.permissions ?? [];
                    return (
                        <div key={manifest.id} style={{ background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
                                <Puzzle size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ color: 'var(--text-primary, #0f172a)', fontSize: 14, fontWeight: 600 }}>
                                        {manifest.name} <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 11, fontWeight: 400 }}>v{manifest.version}</span>
                                    </div>
                                    <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                                        {manifest.description || tp('no_description')}{manifest.author ? ` · ${manifest.author}` : ''}
                                    </div>
                                    {plugin.provenance?.signedBy && <div style={{ alignItems: 'center', color: '#16a34a', display: 'flex', fontSize: 11, gap: 4, marginTop: 3 }}><ShieldCheck size={11} /> {tp('signed_by', { publisher: plugin.provenance.signedBy })}</div>}
                                </div>
                                <button
                                    type="button" role="switch" aria-checked={enabled}
                                    onClick={() => { void controller.toggleThirdParty(manifest.id, !enabled); }}
                                    disabled={controller.lifecycleBusyId === manifest.id}
                                    style={{ background: enabled ? '#6366f1' : 'var(--border-primary, #cbd5e1)', border: 'none', borderRadius: 999, cursor: 'pointer', flexShrink: 0, height: 24, opacity: controller.lifecycleBusyId === manifest.id ? 0.65 : 1, position: 'relative', width: 42 }}
                                    title={enabled ? tp('disable') : tp('enable')}
                                ><span style={{ background: '#fff', borderRadius: '50%', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', height: 20, left: enabled ? 20 : 2, position: 'absolute', top: 2, width: 20 }} /></button>
                                <button type="button" onClick={() => { void controller.exportPackage(manifest.id, manifest.version); }} disabled={controller.busy === `export:${manifest.id}`} aria-label={tp('export_package')} title={tp('export_package')} style={{ alignItems: 'center', background: 'transparent', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: 'var(--text-secondary)', display: 'flex', flexShrink: 0, height: 30, justifyContent: 'center', width: 30 }}>
                                    {controller.busy === `export:${manifest.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                                </button>
                                <button type="button" onClick={() => { void controller.submitPackage(manifest.id); }} disabled={controller.busy === `submit:${manifest.id}`} aria-label={tp('submit_repository')} title={tp('submit_repository')} style={{ alignItems: 'center', background: 'transparent', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: '#6366f1', display: 'flex', flexShrink: 0, height: 30, justifyContent: 'center', width: 30 }}>
                                    {controller.busy === `submit:${manifest.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                                </button>
                                <button type="button" onClick={() => { void controller.uninstall(manifest.id); }} disabled={controller.busy === `del:${manifest.id}`} aria-label={tp('uninstall')} title={tp('uninstall')} style={{ alignItems: 'center', background: 'transparent', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: '#dc2626', display: 'flex', flexShrink: 0, height: 30, justifyContent: 'center', width: 30 }}><Trash2 size={15} /></button>
                            </div>
                            {declared.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                                    <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{tp('permissions')}</span>
                                    {declared.map((permission) => (
                                        <label key={permission} style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', fontSize: 12, gap: 8 }}>
                                            <input type="checkbox" checked={granted.includes(permission)} onChange={() => { void controller.togglePermission(manifest.id, declared, granted, permission); }} />
                                            <code style={{ fontSize: 11 }}>{permission}</code>
                                            <span style={{ color: 'var(--text-tertiary, #94a3b8)' }}>{controller.permissions[permission] ?? ''}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );
}
