import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { PluginCatalogGallery } from './PluginCatalogGallery';
import { PluginRegistryTrust } from './PluginRegistryTrust';
import type { ThirdPartyPluginsController } from './thirdPartyModel';

interface ThirdPartyCatalogProps {
    readonly controller: ThirdPartyPluginsController;
}

export function ThirdPartyCatalog({ controller }: ThirdPartyCatalogProps) {
    const { t } = useTranslation();
    const fileRef = useRef<HTMLInputElement | null>(null);
    const tp = (key: string): string => t(`settings.plugins.${key}`);
    return (
        <>
            <div style={{ alignItems: 'center', display: 'flex', gap: 10, marginBottom: 12 }}>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".zip"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                        const file = event.target.files?.item(0);
                        event.target.value = '';
                        if (file) void controller.installZip(file);
                    }}
                />
                <button type="button" onClick={() => { fileRef.current?.click(); }} disabled={controller.busy === 'zip'} style={{ alignItems: 'center', background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: 'var(--text-primary, #0f172a)', cursor: controller.busy === 'zip' ? 'wait' : 'pointer', display: 'flex', fontSize: 13, fontWeight: 600, gap: 8, padding: '8px 12px' }}>
                    <Upload size={15} /> {controller.busy === 'zip' ? tp('installing') : tp('install_zip')}
                </button>
            </div>
            {controller.error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 12, marginBottom: 10, padding: '8px 10px' }}>{controller.error}</div>}
            <PluginCatalogGallery controller={controller} />
            <PluginRegistryTrust controller={controller} />
        </>
    );
}
