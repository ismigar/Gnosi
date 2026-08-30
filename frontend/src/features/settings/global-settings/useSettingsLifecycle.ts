import { useEffect, useEffectEvent } from 'react';
import { subscribeDocumentEvent, subscribeWindowEvent } from '../../../shared/platform/browser-events';
import type { SettingsState } from './stateTypes';
import type { useSettingsLoaders } from './useSettingsLoaders';
import type { useSettingsModels } from './useSettingsModels';
import type { useSettingsReader } from './useSettingsReader';
import type { useSettingsSocial } from './useSettingsSocial';

type Input = SettingsState & ReturnType<typeof useSettingsLoaders> & ReturnType<typeof useSettingsModels> & ReturnType<typeof useSettingsReader> & ReturnType<typeof useSettingsSocial>;

export function useSettingsLifecycle(state: Input) {
  const { activeTab, aiCatalogLoadedRef, checkGoogleAuth, configLoadedRef, hydrationGenerationRef, identityLoadedRef, initialPluginId, initialTab, integrationsLoadedRef, isOpen, lastSavedDataRef, loadAiCatalog, loadAiRegistry, loadConfig, loadIdentity, loadIntegrations, loadNewsletterAccount, loadNewsletterSources, loadSocialSettings, loadTablesAndDatabases, setAccountEditorTarget, setActiveTab, setAddAccountType, setAgentEditorTarget, setEditingAccountId, setEditingAgent, setEditingSnippetId, setEditingTableColor, setIsAddingTable, setIsAdvancedOpen, setReaderSection, setSnippetEditorTarget, setTableColorEditorTarget } = state;
  useEffect(() => {
    if (!isOpen) return;
    const requestedTab = initialTab === 'newsletters' ? 'reader' : (initialTab ?? 'general');
    setActiveTab(requestedTab);
    if (initialTab === 'newsletters') setReaderSection('subscriptions');
    if (['api', 'plugins'].includes(requestedTab) || initialPluginId) {
      setIsAdvancedOpen(true);
    }
  }, [initialPluginId, initialTab, isOpen, setActiveTab, setIsAdvancedOpen, setReaderSection]);

  useEffect(() => {
    setEditingAgent(null);
    setAgentEditorTarget(null);
    setEditingAccountId(null);
    setAccountEditorTarget(null);
    setEditingTableColor(null);
    setTableColorEditorTarget(null);
    setEditingSnippetId(null);
    setSnippetEditorTarget(null);
    setAddAccountType(null);
    setIsAddingTable(false);
  }, [activeTab, setAccountEditorTarget, setAddAccountType, setAgentEditorTarget, setEditingAccountId, setEditingAgent, setEditingSnippetId, setEditingTableColor, setIsAddingTable, setSnippetEditorTarget, setTableColorEditorTarget]);

  const hydrate = useEffectEvent(() => {
    if (isOpen) {
      const hydrationGeneration = ++hydrationGenerationRef.current;
      configLoadedRef.current = false;
      aiCatalogLoadedRef.current = false;
      integrationsLoadedRef.current = false;
      identityLoadedRef.current = false;
      lastSavedDataRef.current = null; // Reset baseline to avoid spurious saves
      void loadConfig(hydrationGeneration);
      void loadAiCatalog(hydrationGeneration);
      void loadAiRegistry();
      void loadTablesAndDatabases();
      void loadIntegrations(hydrationGeneration);
      void loadNewsletterSources();
      void loadNewsletterAccount();
      void checkGoogleAuth();
      void loadIdentity(hydrationGeneration);
      void loadSocialSettings();
    }
  });
  useEffect(() => { hydrate(); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const wheelHandler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      // There is a nested modal on top (e.g. SchemaConfigModal, ported to the
      // body): defer scrolling to it, don't steal the event toward .settings-main.
      if (document.body.classList.contains('gnosi-modal-open')) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      const main = t.closest('.settings-main');
      if (!main) return;
      const tag = t.tagName;
      if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') return;
      if (tag === 'TEXTAREA' && t.scrollHeight > t.clientHeight + 1) return;
      if (main.scrollHeight > main.clientHeight) {
        main.scrollTop += e.deltaY;
        e.preventDefault();
      }
    };

    const keyScrollHandler = (e: KeyboardEvent) => {
      const scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '];
      if (!scrollKeys.includes(e.key)) return;
      // Nested modal open on top: let it handle keyboard scroll itself. Otherwise,
      // this handler (on window, in capture phase) scrolls the background .settings-main
      // and calls preventDefault → the nested modal's handler bails out due to defaultPrevented.
      if (document.body.classList.contains('gnosi-modal-open')) return;

      const ae = document.activeElement;
      if (ae) {
        const tag = ae.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ae instanceof HTMLElement && ae.isContentEditable)) {
          return;
        }
      }

      const main = document.querySelector('.settings-main');
      const sidebar = document.querySelector('.settings-sidebar');
      if (!main) return;

      let scrollTarget = main;
      if (sidebar && sidebar.contains(ae)) {
        scrollTarget = sidebar;
      }

      const step = 40;
      const pageStep = scrollTarget.clientHeight - 40;

      if (e.key === 'ArrowDown') {
        scrollTarget.scrollTop += step;
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        scrollTarget.scrollTop -= step;
        e.preventDefault();
      } else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        scrollTarget.scrollTop += pageStep;
        e.preventDefault();
      } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        scrollTarget.scrollTop -= pageStep;
        e.preventDefault();
      } else if (e.key === 'Home') {
        scrollTarget.scrollTop = 0;
        e.preventDefault();
      } else if (e.key === 'End') {
        scrollTarget.scrollTop = scrollTarget.scrollHeight;
        e.preventDefault();
      }
    };

    const stopWheel = subscribeDocumentEvent('wheel', wheelHandler, { passive: false, capture: true });
    const stopKeys = subscribeWindowEvent('keydown', keyScrollHandler, { capture: true });

    return () => {
      stopWheel();
      stopKeys();
    };
  }, [isOpen]);
  return {};
}
