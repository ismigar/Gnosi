import { bulkUpdateIntegrations } from '../../../shared/api/integrations';
import { emitConfigChanged } from '../../../shared/platform/configEvents';
import { saveIdentity } from '../../../shared/api/identity';
import { updateConfiguration } from '../../../shared/api/configuration';
import { updateNewsletterAccount } from '../../../shared/api/reader';
import { useEffect, useEffectEvent } from 'react';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import type { SettingsState } from './stateTypes';
import type { useSettingsMailEffects } from './useSettingsMailEffects';

type Input = SettingsState & ReturnType<typeof useSettingsMailEffects>;

export function useSettingsPersistence(state: Input) {
  const { aiCatalogLoadedRef, autoSaveTimeoutRef, configLoadedRef, confirmConfig, draft, editingAccountId, identityAutoSaveRef, identityLoadedRef, integrations, integrationsLoadedRef, isModelComparisonOpen, isOpen, isSaving, lastSavedDataRef, lastSavedNewsletterAccountRef, mailFieldsRef, newsletterAccount, newsletterAccountLoaded, newsletterAccountSaveTimerRef, newsletterPasswordDirty, onClose, panelRef, pickerOpen, setAccountEditorTarget, setAddAccountType, setAgentEditorTarget, setEditingAccountId, setEditingAgent, setEditingSnippetId, setEditingTableColor, setIsAddingTable, setIsSaving, setSavingStatus, setSnippetEditorTarget, setTableColorEditorTarget } = state;
  const childModalOpen = pickerOpen || confirmConfig.isOpen || isModelComparisonOpen;

  const handleClose = async () => {
    try {
      // 1. We cancel the auto-save timeouts to prevent them from firing again in duplicate
      clearTimeout(autoSaveTimeoutRef.current);
      clearTimeout(identityAutoSaveRef.current);
      if (newsletterAccountSaveTimerRef.current) clearTimeout(newsletterAccountSaveTimerRef.current);

      // 2. We determine whether there are pending changes in the mail identity
      let updatedIntegrations = { ...integrations };
      let hasIdentityChanges = false;
      if (editingAccountId) {
        const fields = mailFieldsRef.current;
        const currentList = integrations.mail_accounts || [];
        const accountIndex = currentList.findIndex(a => a.id === fields.editingAccountId);
        const a = currentList[accountIndex];
        if (a) {
          if (
            a.display_name !== fields.display_name ||
            a.subject_prefix !== fields.subject_prefix ||
            a.signature !== fields.signature ||
            a.certificate !== fields.certificate ||
            JSON.stringify(a.aliases) !== JSON.stringify(fields.aliases)
          ) {
            const newList = currentList.map(acc => acc.id !== fields.editingAccountId ? acc : {
              ...acc,
              display_name: fields.display_name,
              subject_prefix: fields.subject_prefix,
              signature: fields.signature,
              certificate: fields.certificate,
              aliases: fields.aliases,
            });
            updatedIntegrations = { ...integrations, mail_accounts: newList };
            hasIdentityChanges = true;
          }
        }
      }

      // 3. We determine whether there are pending changes in the general settings or integrations
      const currentData = JSON.stringify({
        settings: draft.settings,
        paths: draft.paths,
        graph: draft.graph,
        ai: {
          agents: draft.ai.agents,
          active_agent_id: draft.ai.active_agent_id,
          providers: draft.ai.providers
        },
        integrations: updatedIntegrations,
        identity: draft.identity
      });

      const hasConfigChanges = lastSavedDataRef.current !== null && lastSavedDataRef.current !== currentData;

      // Canvis newsletter POP3
      let hasNewsletterChanges = false;
      if (newsletterAccountLoaded) {
        const currentNewsletter = JSON.stringify({ ...newsletterAccount, _passwordDirty: newsletterPasswordDirty });
        hasNewsletterChanges = lastSavedNewsletterAccountRef.current !== currentNewsletter;
      }

      // 4. If there is any pending change, we save them sequentially/synchronously (awaiting Promise.all)
      if (hasIdentityChanges || hasConfigChanges || hasNewsletterChanges) {
        setSavingStatus('saving');
        setIsSaving(true);
        try {
          const promises = [];

          // Save general config, integrations, and identity
          if (hasConfigChanges || hasIdentityChanges) {
            promises.push(
              updateConfiguration({
                settings: draft.settings,
                paths: draft.paths,
                graph: draft.graph,
                ai: {
                  agents: draft.ai.agents,
                  active_agent_id: draft.ai.active_agent_id,
                  providers: draft.ai.providers
                }
              }),
              bulkUpdateIntegrations(updatedIntegrations),
              saveIdentity(draft.identity)
            );
          }

          // Save newsletter
          if (hasNewsletterChanges) {
            const next = { ...newsletterAccount, mail_port: parseInt(String(newsletterAccount.mail_port), 10) || 110 };
            if (!newsletterPasswordDirty) delete next.password;
            promises.push(
              updateNewsletterAccount(next)
            );
          }

          await Promise.all(promises);
          setSavingStatus('saved');
        } catch (err) {
          console.error("Error saving while closing settings:", err);
          setSavingStatus('error');
        } finally {
          setIsSaving(false);
        }
      }
    } catch (globalErr) {
      console.error("Critical global error in handleClose:", globalErr);
    } finally {
      // Inline editors are scoped to an open Settings session. Leaving
      // one selected after closing makes its row look active when the
      // modal is opened again, even though its portal target is gone.
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
      // 5. We call the original onClose to close the modal ALWAYS, even if there are errors
      onClose();
    }
  };

  useModalKeyboard({
    isOpen,
    onClose: handleClose,
    containerRef: panelRef,
    trapFocus: !childModalOpen,
  });

  const triggerAutoSave = async () => {
    if (isSaving) return;

    const currentData = JSON.stringify({
      settings: draft.settings,
      paths: draft.paths,
      graph: draft.graph,
      ai: {
        agents: draft.ai.agents,
        active_agent_id: draft.ai.active_agent_id,
        providers: draft.ai.providers
      },
      integrations,
      identity: draft.identity
    });

    // Initialize baseline on first load
    if (lastSavedDataRef.current === null) {
      lastSavedDataRef.current = currentData;
      return;
    }

    // The draft is hydrated by independent requests. Treat their completion
    // as one initialization gate so the first autosave pass only records a
    // complete baseline and never persists initial placeholder values.
    if (
      !configLoadedRef.current
      || !aiCatalogLoadedRef.current
      || !integrationsLoadedRef.current
      || !identityLoadedRef.current
    ) {
      return;
    }

    // Prevent redundant saves
    if (lastSavedDataRef.current === currentData) return;

    setSavingStatus('saving');
    setIsSaving(true);

    try {
      await Promise.all([
        updateConfiguration({
          settings: draft.settings,
          paths: draft.paths,
          graph: draft.graph,
          ai: {
            agents: draft.ai.agents,
            active_agent_id: draft.ai.active_agent_id,
            providers: draft.ai.providers
          }
        }),
        bulkUpdateIntegrations(integrations),
        saveIdentity(draft.identity)
      ]);

      lastSavedDataRef.current = currentData;
      setSavingStatus('saved');
      setTimeout(() => { setSavingStatus('idle'); }, 3000);
      // Notifies consumers of `/api/config` so they refetch without a reload.
      emitConfigChanged();
    } catch (err) {
      console.error("Auto-save error:", err);
      setSavingStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const scheduleSave = useEffectEvent(() => {
    if (!isOpen) return;

    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);

    autoSaveTimeoutRef.current = setTimeout(() => {
      void triggerAutoSave();
    }, 800); // 800ms debounce

    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  });
  useEffect(() => scheduleSave(), [draft, integrations]);
  return { childModalOpen, handleClose, triggerAutoSave };
}
