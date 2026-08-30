import { Globe, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SELECT_STYLE } from './pluginSettingsModel';
import type { ThirdPartyPluginsController } from './thirdPartyModel';

interface PluginRegistryTrustProps {
    readonly controller: ThirdPartyPluginsController;
}

export function PluginRegistryTrust({ controller }: PluginRegistryTrustProps) {
    const { t } = useTranslation();
    const tp = (key: string): string => t(`settings.plugins.${key}`);
    return (
        <div style={{ marginTop: 24 }}>
            <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 8 }}>
                <Globe size={16} /><h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tp('remote_title')}</h4>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>{tp('registry_url_label')}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input type="url" placeholder="https://github.com/ismigar/Gnosi/releases/latest/download/plugins-index.json" value={controller.registryUrl} onChange={(event) => { controller.setRegistryUrl(event.target.value); }} style={{ ...SELECT_STYLE, flex: 1 }} />
                    <button type="button" onClick={() => { void controller.saveRegistryUrl(); }} disabled={controller.busy === 'reg'} style={{ background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: 'var(--text-primary, #0f172a)', fontSize: 13, fontWeight: 600, padding: '8px 12px' }}>{tp('save')}</button>
                </div>
            </label>
            <div style={{ alignItems: 'center', display: 'flex', gap: 6, marginBottom: 6 }}>
                <KeyRound size={14} style={{ color: 'var(--text-tertiary, #94a3b8)' }} />
                <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>{tp('trust_keys')}</span>
            </div>
            {controller.trustKeys.length === 0 && <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12, marginBottom: 8 }}>{tp('no_trust_keys')}</div>}
            {controller.trustKeys.map((key) => (
                <div key={key.name} style={{ alignItems: 'center', display: 'flex', fontSize: 12, gap: 8, marginBottom: 4 }}>
                    <ShieldCheck size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{key.name}</span>
                    <code style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 11 }}>{key.fingerprint}…</code>
                    <button type="button" onClick={() => { void controller.removeTrustKey(key.name); }} aria-label={tp('remove')} title={tp('remove')} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', marginLeft: 'auto' }}><Trash2 size={13} /></button>
                </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input type="text" placeholder={tp('publisher_placeholder')} value={controller.newKey.name} onChange={(event) => { controller.setNewKey({ ...controller.newKey, name: event.target.value }); }} style={{ ...SELECT_STYLE, width: 160 }} />
                <input type="text" placeholder={tp('pubkey_placeholder')} value={controller.newKey.public_key} onChange={(event) => { controller.setNewKey({ ...controller.newKey, public_key: event.target.value }); }} style={{ ...SELECT_STYLE, flex: 1 }} />
                <button type="button" onClick={() => { void controller.addTrustKey(); }} disabled={controller.busy === 'key'} style={{ background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: 'var(--text-primary, #0f172a)', fontSize: 13, fontWeight: 600, padding: '8px 12px' }}>{tp('add')}</button>
            </div>
        </div>
    );
}
