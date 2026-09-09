import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyError } from '../../../shared/notifications/notifyError';
import { reloadPlugins } from '../../../shared/plugins/usePluginHost';
import { usePlugins } from '../../../shared/plugins/usePlugins';
import { exportPluginPackage, uploadPluginZip } from '../../../shared/api/plugin-runtime';
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
} from '../../../shared/api/plugins';
import { apiErrorMessage, type PluginSection } from './pluginSettingsModel';
import {
    downloadBlob,
    type ThirdPartyPluginsController,
    type TrustedKeyDraft,
} from './thirdPartyModel';

type ReadGroup = 'installed' | 'catalog' | 'trust';

function sectionReads(section: PluginSection): readonly ReadGroup[] {
    if (section === 'catalog') return ['catalog', 'trust'];
    if (section === 'updates') return ['installed', 'catalog'];
    return ['installed'];
}

export function useThirdPartyPlugins(section: PluginSection): ThirdPartyPluginsController {
    const { t } = useTranslation();
    const { isEnabled, setPluginEnabled, reload: reloadPluginState } = usePlugins();
    const [installed, setInstalled] = useState<readonly InstalledPlugin[]>([]);
    const [permissions, setPermissions] = useState<Readonly<Record<string, string>>>({});
    const [gallery, setGallery] = useState<readonly PluginCatalogEntry[]>([]);
    const [loaded, setLoaded] = useState<Readonly<Record<ReadGroup, boolean>>>({ installed: false, catalog: false, trust: false });
    const [failedReads, setFailedReads] = useState<Partial<Record<ReadGroup, boolean>>>({});
    const reads = useRef<Partial<Record<ReadGroup, Promise<void>>>>({});
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

    const readGroup = useCallback((group: ReadGroup, force: boolean): Promise<void> => {
        if (!force && reads.current[group]) return reads.current[group];
        const request = Promise.resolve().then(async () => {
            if (group === 'installed') {
                const [plugins, permissionCatalog] = await Promise.all([
                    fetchInstalledPlugins(), fetchPluginPermissionsCatalog(),
                ]);
                if (reads.current[group] !== request) return;
                setInstalled(plugins.plugins);
                setPermissions(permissionCatalog.permissions);
            } else if (group === 'catalog') {
                const catalog = await fetchPluginCatalog();
                if (reads.current[group] !== request) return;
                setGallery(catalog.catalog);
            } else {
                const [keys, registry] = await Promise.all([
                    fetchPluginTrustedKeys(), fetchPluginRegistryUrl(),
                ]);
                if (reads.current[group] !== request) return;
                setTrustKeys(keys.keys);
                setRegistryUrl(registry.url);
            }
            setLoaded((current) => ({ ...current, [group]: true }));
            setFailedReads((current) => ({ ...current, [group]: false }));
        }).catch(() => {
            if (reads.current[group] !== request) return;
            reads.current[group] = undefined;
            setFailedReads((current) => ({ ...current, [group]: true }));
        });
        reads.current[group] = request;
        return request;
    }, []);

    const refresh = useCallback(async (): Promise<void> => {
        // A mutation can change installed badges in a catalog opened later.
        const groups = new Set([...sectionReads(section), ...Object.keys(reads.current) as ReadGroup[]]);
        await Promise.all([...groups].map((group) => readGroup(group, true)));
    }, [readGroup, section]);

    useEffect(() => {
        void Promise.all(sectionReads(section).map((group) => readGroup(group, false)));
    }, [readGroup, section]);

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
        lifecycleBusyId, loading: sectionReads(section).some((group) => !loaded[group]),
        loadFailed: sectionReads(section).some((group) => failedReads[group]), retryLoad: refresh,
        catalogLoading: !loaded.catalog, trustLoading: !loaded.trust,
        newKey, notice, permissions, registryUrl,
        removeTrustKey, saveRegistryUrl, setCatalogSearch, setCatalogSource,
        setNewKey, setRegistryUrl, submitPackage, togglePermission,
        toggleThirdParty, trustKeys, uninstall,
    };
}
