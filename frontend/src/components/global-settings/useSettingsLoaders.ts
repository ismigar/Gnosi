import { fetchAiCatalog } from '../../shared/api/ai';
import { fetchConfiguration } from '../../shared/api/configuration';
import { fetchGoogleOAuthStatus } from '../../shared/api/google-auth';
import { fetchIdentity } from '../../shared/api/identity';
import { fetchIntegrations } from '../../shared/api/integrations';
import { fetchVaultDatabases } from '../../shared/api/vaults';
import { fetchVaultTables } from '../../shared/api/vaults';
import type { SettingsState } from './stateTypes';
import { hydrateDraft, settingsIntegrations, settingsRegistry } from './settingsDocuments';
import { isJsonRecord } from '../AI/aiResourcesApi';
import { readStorage, writeStorage, themeKey } from './settingsStorage';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';

type Input = SettingsState;

export function useSettingsLoaders(state: Input) {
  const { aiCatalogLoadedRef, configLoadedRef, hydrationGenerationRef, identityLoadedRef, integrationsLoadedRef, setDatabases, setDraft, setGoogleAuthConfigured, setIntegrations, setTables } = state;
  const loadIdentity = async (hydrationGeneration: number | null = null) => {
    try {
      const identity = await fetchIdentity();
      setDraft(prev => ({ ...prev, identity: { ...prev.identity, ...identity } }));
    } catch (error) {
      console.error("Error loading identity:", error);
    } finally {
      if (
        hydrationGeneration === null
        || hydrationGeneration === hydrationGenerationRef.current
      ) {
        identityLoadedRef.current = true;
      }
    }
  };

  const checkGoogleAuth = async () => {
    try {
      const data = await fetchGoogleOAuthStatus();
      setGoogleAuthConfigured(data.configured);
    } catch (err) { console.error("Error checking Google Auth:", err); }
  };

  const loadConfig = async (hydrationGeneration: number | null = null) => {
    try {
      const cfg = await fetchConfiguration();
      setDraft(prev => hydrateDraft(prev, cfg));
      // Sync the backend-persisted theme into the browser persistence channel the
      // theme engine reads, so the saved preference survives a reload.
      if (isJsonRecord(cfg.settings) && typeof cfg.settings.theme === 'string' && cfg.settings.theme && cfg.settings.theme !== readStorage(themeKey)) {
        writeStorage(themeKey, cfg.settings.theme);
        dispatchWindowEvent(new Event('db-theme-changed'));
      }
    } catch (err) {
      console.error("Error loading config:", err);
    } finally {
      if (
        hydrationGeneration === null
        || hydrationGeneration === hydrationGenerationRef.current
      ) {
        configLoadedRef.current = true;
      }
    }
  };

  const loadIntegrations = async (hydrationGeneration: number | null = null) => {
    try {
      const data = await fetchIntegrations();
      setIntegrations(settingsIntegrations(data));
    } catch (err) {
      console.error("Error loading integrations:", err);
    } finally {
      if (
        hydrationGeneration === null
        || hydrationGeneration === hydrationGenerationRef.current
      ) {
        integrationsLoadedRef.current = true;
      }
    }
  };

  const loadAiCatalog = async (hydrationGeneration: number | null = null) => {
    try {
      const payload = await fetchAiCatalog();
      const providers = payload.config.providers;
      if (isJsonRecord(providers)) {
        setDraft(prev => ({
          ...prev,
          ai: { ...prev.ai, providers }
        }));
      }
    } catch (err) {
      console.error("Error loading AI catalog:", err);
    } finally {
      if (
        hydrationGeneration === null
        || hydrationGeneration === hydrationGenerationRef.current
      ) {
        aiCatalogLoadedRef.current = true;
      }
    }
  };

  const loadTablesAndDatabases = async () => {
    // Vault Tables and Databases — used by the Calendar
    // (table selection) and Databases tabs. They used to be loaded inside
    // loadZoteroData, removed when the Zotero integration was taken out of Settings.
    try {
      setTables(settingsRegistry(await fetchVaultTables()));
    } catch (e) { console.error("Tables fetch error:", e); }
    try {
      setDatabases(settingsRegistry(await fetchVaultDatabases()));
    } catch (e) { console.error("Databases fetch error:", e); }
  };
  return { checkGoogleAuth, loadAiCatalog, loadConfig, loadIdentity, loadIntegrations, loadTablesAndDatabases };
}
