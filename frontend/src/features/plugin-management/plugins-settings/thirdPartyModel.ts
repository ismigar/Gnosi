import type {
    InstalledPlugin,
    PluginCatalogEntry,
    PluginTrustedKey,
} from '../../../shared/api/plugins';
import type { InstalledFilter, PluginSection } from './pluginSettingsModel';

export interface TrustedKeyDraft {
    readonly name: string;
    readonly public_key: string;
}

export interface ThirdPartyPluginsController {
    readonly addTrustKey: () => Promise<void>;
    readonly busy: string;
    readonly catalogSearch: string;
    readonly catalogSource: string;
    readonly error: string;
    readonly exportPackage: (id: string, version: string | null | undefined) => Promise<void>;
    readonly gallery: readonly PluginCatalogEntry[];
    readonly installFromCatalog: (id: string) => Promise<void>;
    readonly installZip: (file: File) => Promise<void>;
    readonly installed: readonly InstalledPlugin[];
    readonly isEnabled: (id: string) => boolean;
    readonly lifecycleBusyId: string | null;
    readonly loading: boolean;
    readonly newKey: TrustedKeyDraft;
    readonly notice: string;
    readonly permissions: Readonly<Record<string, string>>;
    readonly registryUrl: string;
    readonly removeTrustKey: (name: string) => Promise<void>;
    readonly saveRegistryUrl: () => Promise<void>;
    readonly setCatalogSearch: (value: string) => void;
    readonly setCatalogSource: (value: string) => void;
    readonly setNewKey: (value: TrustedKeyDraft) => void;
    readonly setRegistryUrl: (value: string) => void;
    readonly submitPackage: (id: string) => Promise<void>;
    readonly togglePermission: (
        pluginId: string,
        declared: readonly string[],
        granted: readonly string[],
        permission: string,
    ) => Promise<void>;
    readonly toggleThirdParty: (id: string, enabled: boolean) => Promise<void>;
    readonly trustKeys: readonly PluginTrustedKey[];
    readonly uninstall: (id: string) => Promise<void>;
}

export interface ThirdPartyPluginsProps {
    readonly installedFilter: InstalledFilter;
    readonly section: PluginSection;
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
