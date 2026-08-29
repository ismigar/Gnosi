import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyError } from '../../lib/notifyError';
import { reloadPlugins } from '../../plugins/usePluginHost';
import { usePlugins } from '../../plugins/usePlugins';
import { exportPluginPackage, uploadPluginZip } from '../../shared/api/plugin-runtime';
import {
    addPluginTrustedKey,
    fetchInstalledPlugins,
    fetchPluginCatalog,
    fetchPluginPermissionsCatalog,
    fetchPluginRegistryUrl,
    fetchPluginTrustedKeys,
    installPluginFromCatalog,
    removePluginTrustedKey,
    setPluginPermissions,
    setPluginRegistryUrl,
    submitPluginPackage,
    uninstallPlugin,
    type InstalledPlugin,
    type PluginCatalogEntry,
    type PluginTrustedKey,
} from '../../shared/api/plugins';
import { apiErrorMessage } from './pluginSettingsModel';
import {
    downloadBlob,
    type ThirdPartyPluginsController,
    type TrustedKeyDraft,
} from './thirdPartyModel';

export function useThirdPartyPlugins(): ThirdPartyPluginsController {
    const { t } = useTranslation();
    const { isEnabled, setPluginEnabled, reload: reloadPluginState } = usePlugins();
    const [installed, setInstalled] = useState<readonly InstalledPlugin[]>([]);
    const [permissions, setPermissions] = useState<Readonly<Record<string, string>>>({});
    const [gallery, setGallery] = useState<readonly PluginCatalogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [trustKeys, setTrustKeys] = useState<readonly PluginTrustedKey[]>([]);
    const [registryUrl, setRegistryUrl] = useState('');
    const [newKey, setNewKey] = useState<TrustedKeyDraft>({ name: '', public_key: '' });
    const [catalogSearch, setCatalogSearch] = useState('');
    const [catalogSource, setCatalogSource] = useState('all');
    const tp = useCallback((key: string): string => t(`settings.plugins.${key}`), [t]);

    const refresh = useCallback(async (): Promise<void> => {
        const [plugins, permissionCatalog, catalog, keys, registry] = await Promise.all([
            fetchInstalledPlugins().then((response) => response.plugins).catch(() => []),
            fetchPluginPermissionsCatalog().then((response) => response.permissions).catch(() => ({})),
            fetchPluginCatalog().then((response) => response.catalog).catch(() => []),
            fetchPluginTrustedKeys().then((response) => response.keys).catch(() => []),
            fetchPluginRegistryUrl().then((response) => response.url).catch(() => ''),
        ]);
        setInstalled(plugins);
        setPermissions(permissionCatalog);
        setGallery(catalog);
        setTrustKeys(keys);
        setRegistryUrl(registry);
        setLoading(false);
    }, []);

    useEffect(() => {
        void Promise.resolve().then(refresh);
    }, [refresh]);

    const saveRegistryUrl = async (): Promise<void> => {
        setError('');
        setBusy('reg');
        try {
            await setPluginRegistryUrl(registryUrl);
            await refresh();
        } catch (saveError) {
            setError(apiErrorMessage(saveError, tp('error_save_url')));
        } finally {
            setBusy('');
        }
    };

    const addTrustKey = async (): Promise<void> => {
        if (!newKey.name.trim() || !newKey.public_key.trim()) return;
        setError('');
        setBusy('key');
        try {
            await addPluginTrustedKey(newKey);
            setNewKey({ name: '', public_key: '' });
            await refresh();
        } catch (keyError) {
            setError(apiErrorMessage(keyError, tp('error_invalid_key')));
        } finally {
            setBusy('');
        }
    };

    const removeTrustKey = async (name: string): Promise<void> => {
        setBusy(`key:${name}`);
        try {
            await removePluginTrustedKey(name);
            await refresh();
        } catch {
            // The legacy UI intentionally keeps removal failures silent.
        } finally {
            setBusy('');
        }
    };

    const togglePermission = async (
        pluginId: string,
        declared: readonly string[],
        granted: readonly string[],
        permission: string,
    ): Promise<void> => {
        const next = granted.includes(permission)
            ? granted.filter((item) => item !== permission)
            : [...granted, permission];
        try {
            await setPluginPermissions(pluginId, next.filter((item) => declared.includes(item)));
            await Promise.all([refresh(), reloadPlugins()]);
        } catch {
            // The legacy permission toggle intentionally remains quiet.
        }
    };

    const toggleThirdParty = async (pluginId: string, enabled: boolean): Promise<void> => {
        setError('');
        setLifecycleBusyId(pluginId);
        try {
            await setPluginEnabled(pluginId, enabled);
            await refresh();
            await reloadPlugins();
        } catch (lifecycleError) {
            const message = tp('lifecycle_error');
            setError(message);
            notifyError('plugin-lifecycle', lifecycleError, message);
        } finally {
            setLifecycleBusyId(null);
        }
    };

    const refreshRuntime = async (): Promise<void> => {
        await refresh();
        await reloadPluginState();
        await reloadPlugins();
    };

    const installZip = async (file: File): Promise<void> => {
        setError('');
        setBusy('zip');
        try {
            await uploadPluginZip(file);
            await refreshRuntime();
        } catch (installError) {
            setError(apiErrorMessage(installError, tp('error_install_plugin')));
        } finally {
            setBusy('');
        }
    };

    const installFromCatalog = async (id: string): Promise<void> => {
        setError('');
        setBusy(`cat:${id}`);
        try {
            await installPluginFromCatalog(id);
            await refreshRuntime();
        } catch (installError) {
            setError(apiErrorMessage(installError, tp('error_install')));
        } finally {
            setBusy('');
        }
    };

    const uninstall = async (id: string): Promise<void> => {
        setError('');
        setBusy(`del:${id}`);
        try {
            await uninstallPlugin(id);
            await refreshRuntime();
        } catch (uninstallError) {
            setError(apiErrorMessage(uninstallError, tp('error_uninstall')));
        } finally {
            setBusy('');
        }
    };

    const exportPackage = async (id: string, version: string | null | undefined): Promise<void> => {
        setError('');
        setNotice('');
        setBusy(`export:${id}`);
        try {
            const versionPart = version === null ? 'null' : version ?? 'undefined';
            downloadBlob(await exportPluginPackage(id), `${id}-${versionPart}.gnosi-plugin.zip`);
        } catch (exportError) {
            setError(apiErrorMessage(exportError, tp('error_export')));
        } finally {
            setBusy('');
        }
    };

    const submitPackage = async (id: string): Promise<void> => {
        setError('');
        setNotice('');
        setBusy(`submit:${id}`);
        try {
            await submitPluginPackage(id);
            setNotice(tp('submitted_for_review'));
        } catch (submitError) {
            setError(apiErrorMessage(submitError, tp('error_submit')));
        } finally {
            setBusy('');
        }
    };

    return {
        addTrustKey, busy, catalogSearch, catalogSource, error, exportPackage,
        gallery, installFromCatalog, installZip, installed, isEnabled,
        lifecycleBusyId, loading, newKey, notice, permissions, registryUrl,
        removeTrustKey, saveRegistryUrl, setCatalogSearch, setCatalogSource,
        setNewKey, setRegistryUrl, submitPackage, togglePermission,
        toggleThirdParty, trustKeys, uninstall,
    };
}
