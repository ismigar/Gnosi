import { writeStorage, syncErrorsKey } from './settingsStorage';
import { bulkUpdateIntegrations } from '../../../shared/api/integrations';
import { fetchCalendarList } from '../../../shared/api/calendar';
import { fetchMailCounts } from '../../../shared/api/mail';
import { useEffect } from 'react';
import { useRef } from 'react';
import type { SettingsState } from './stateTypes';

type Input = SettingsState;

export function useSettingsMailEffects(state: Input) {
  const { activeTab, editingAccountId, identityAutoSaveRef, identityLoadedForRef, integrations, isOpen, mailAliases, mailCertificate, mailDisplayName, mailSignature, mailSubjectPrefix, setCalendarAuthErrors, setGoogleCalAuthError, setGoogleSubCalendars, setIntegrations, setSyncErrorAccounts, syncErrorAccounts } = state;
  const integrationsRef = useRef(integrations);

  useEffect(() => {
    integrationsRef.current = integrations;
  }, [integrations]);

  const mailFieldsRef = useRef({
    display_name: mailDisplayName,
    subject_prefix: mailSubjectPrefix,
    signature: mailSignature,
    certificate: mailCertificate,
    aliases: mailAliases,
    editingAccountId: editingAccountId,
  });

  useEffect(() => {
    mailFieldsRef.current = {
      display_name: mailDisplayName,
      subject_prefix: mailSubjectPrefix,
      signature: mailSignature,
      certificate: mailCertificate,
      aliases: mailAliases,
      editingAccountId: editingAccountId,
    };
  }, [mailDisplayName, mailSubjectPrefix, mailSignature, mailCertificate, mailAliases, editingAccountId]);

  useEffect(() => {
    if (!editingAccountId) return;
    // Skip the first run right after handleEditAccount populates the fields
    if (identityLoadedForRef.current !== editingAccountId) {
      identityLoadedForRef.current = editingAccountId;
      return;
    }

    const saveChanges = async () => {
      const fields = mailFieldsRef.current;
      if (!fields.editingAccountId) return;
      const currentList = integrationsRef.current.mail_accounts || [];
      const newList = currentList.map(a => a.id !== fields.editingAccountId ? a : {
        ...a,
        display_name: fields.display_name,
        subject_prefix: fields.subject_prefix,
        signature: fields.signature,
        certificate: fields.certificate,
        aliases: fields.aliases,
      });
      try {
        await bulkUpdateIntegrations({ ...integrationsRef.current, mail_accounts: newList });
        setIntegrations(prev => ({ ...prev, mail_accounts: newList }));
      } catch (err) {
        console.error("Error saving pending mail identity:", err);
      }
    };

    clearTimeout(identityAutoSaveRef.current);
    identityAutoSaveRef.current = setTimeout(() => { void saveChanges(); }, 800); // 800ms debounce is more interactive

    return () => {
      clearTimeout(identityAutoSaveRef.current);
      // If the component unmounts or the account changes while there are pending changes, we save them immediately
      void saveChanges();
    };
  }, [mailSignature, mailDisplayName, mailSubjectPrefix, mailAliases, mailCertificate, editingAccountId, identityLoadedForRef, identityAutoSaveRef, setIntegrations]);

  useEffect(() => {
    if (activeTab === 'calendar' && isOpen) {
      let cancelled = false;
      fetchCalendarList()
        .then(({ authError, items }) => {
          if (cancelled) return;
          const authErr = authError || '';
          setGoogleCalAuthError(Boolean(authErr));
          // Specific emails with an expired token → paint the ERROR badge
          // ONLY for this tab (not inherited from the Mail state).
          setCalendarAuthErrors(new Set(authErr.split(',').map(e => e.trim()).filter(Boolean)));
          setGoogleSubCalendars(items);
        })
        .catch(() => { });
      return () => { cancelled = true; };
    }
    return undefined;
  }, [activeTab, isOpen, setCalendarAuthErrors, setGoogleCalAuthError, setGoogleSubCalendars]);

  useEffect(() => {
    try { writeStorage(syncErrorsKey, [...syncErrorAccounts]); } catch { /* quota */ }
  }, [syncErrorAccounts]);

  useEffect(() => {
    if (activeTab !== 'mail' || !isOpen) return;
    const accs = [
      ...(integrations.mail_accounts || []),
      ...(integrations.emails || []),
    ];
    const seen = new Set<string>();
    const emails = accs
      .map(a => a.email || a.username)
      .filter((e): e is string => {
        if (!e) return false;
        const k = e.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    if (emails.length === 0) return;
    let cancelled = false;
    void Promise.all(emails.map(async email => {
      try {
        const data = await fetchMailCounts(email);
        return { email, ok: Object.keys(data).length > 0 };
      } catch {
        return { email, ok: false };
      }
    })).then(results => {
      if (cancelled) return;
      setSyncErrorAccounts(prev => {
        const next = new Set(prev);
        results.forEach(({ email, ok }) => {
          if (ok) next.delete(email);
          else next.add(email);
        });
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [activeTab, isOpen, integrations.mail_accounts, integrations.emails, setSyncErrorAccounts]);
  return { integrationsRef, mailFieldsRef };
}
