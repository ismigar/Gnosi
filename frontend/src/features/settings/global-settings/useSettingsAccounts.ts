import { bulkUpdateIntegrations } from '../../../shared/api/integrations';
import { syncContacts as requestContactsSync } from '../../../shared/api/contacts';
import { syncCalendar } from '../../../shared/api/calendar';
import { syncMail } from '../../../shared/api/mail';
import { toast } from '../../../shared/notifications/toast';
import type { SettingsState } from './stateTypes';
import type { IntegrationAccount } from './types';
import { errorDetail } from './settingsDocuments';
import { isJsonRecord } from '../AI/aiResourcesApi';
import type { useSettingsLoaders } from './useSettingsLoaders';

type Input = SettingsState & ReturnType<typeof useSettingsLoaders>;

export function useSettingsAccounts(state: Input) {
  const { integrations, loadIntegrations, setAddAccountEmail, setAddAccountEmailBlurred, setAddAccountType, setCalendarAuthErrors, setConfirmConfig, setContactsSyncErrors, setEditingAccountId, setIntegrations, setIsManualGoogle, setMailAliases, setMailCertificate, setMailDisplayName, setMailImapEnc, setMailImapHost, setMailImapPass, setMailImapPort, setMailImapUser, setMailSignature, setMailSmtpEnc, setMailSmtpHost, setMailSmtpPass, setMailSmtpPort, setMailSmtpUser, setMailSubjectPrefix, setManualPassword, setManualServer, setSavingStatus, setSyncErrorAccounts, setSyncingAccounts, tn } = state;
  const handleDeleteAccount = (_category: string, accountId: string | undefined) => {
    setConfirmConfig({
      isOpen: true,
      title: tn('accounts.delete_title'),
      message: tn('accounts.delete_msg'),
      onConfirm: async () => {
        const updatedIntegrations = { ...integrations };
        // Aggressive removal of ALL lists from the object
        Object.keys(updatedIntegrations).forEach(key => {
          const rows = updatedIntegrations[key];
          if (Array.isArray(rows)) {
            updatedIntegrations[key] = rows.filter((a: unknown) => !isJsonRecord(a) || (a.id !== accountId && a.email !== accountId));
          }
        });

        setSavingStatus('saving');
        try {
          // We force the save even if 'changed' is false to clean up possible inconsistencies
          await bulkUpdateIntegrations(updatedIntegrations);
          setIntegrations(updatedIntegrations);
          setSavingStatus('saved');
          setTimeout(() => { setSavingStatus('idle'); }, 2000);
        } catch (e) {
          setSavingStatus('error');
          console.error("Critical error deleting account:", e);
        }
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleEditAccount = (category: string, account: IntegrationAccount) => {
    setAddAccountType(category);
    setEditingAccountId(account.id);
    setAddAccountEmail(account.email || account.username || '');
    setAddAccountEmailBlurred(true);
    if (account.provider === 'manual') {
      setManualServer(account.server_url || '');
      setManualPassword(account.password || '');
    } else {
      setIsManualGoogle(false);
    }

    if (category === 'mail') {
      setMailSignature(account.signature || '');
      setMailCertificate(account.certificate || '');
      setMailDisplayName(account.display_name || '');
      setMailSubjectPrefix(account.subject_prefix || '');
      setMailAliases(account.aliases || []);
      if (account.provider === 'manual') {
        setMailImapHost(account.imap_host || '');
        setMailImapPort(account.imap_port || '993');
        setMailImapUser(account.imap_user || '');
        setMailImapPass(account.imap_password || '');
        setMailImapEnc(account.imap_encryption || 'ssl');
        setMailSmtpHost(account.smtp_host || '');
        setMailSmtpPort(account.smtp_port || '465');
        setMailSmtpUser(account.smtp_user || '');
        setMailSmtpPass(account.smtp_password || '');
        setMailSmtpEnc(account.smtp_encryption || 'ssl');
      } else {
        setMailImapHost(''); setMailImapPort('993'); setMailImapUser(''); setMailImapPass(''); setMailImapEnc('ssl');
        setMailSmtpHost(''); setMailSmtpPort('465'); setMailSmtpUser(''); setMailSmtpPass(''); setMailSmtpEnc('ssl');
      }
    }
  };

  const handleSyncAccount = async (category: string, account: IntegrationAccount) => {
    // Legacy JSON accounts without an id used the object's property-key coercion.
    const accountId = account.id || Object.prototype.toString.call(account);
    const email = account.email || account.username || '';
    // Each service keeps its own set of errors: a failed sync of
    // Contacts/Calendar must not mark the account as errored in Mail.
    const markError = category === 'contacts' ? setContactsSyncErrors
      : category === 'calendar' ? setCalendarAuthErrors
        : setSyncErrorAccounts;
    setSyncingAccounts(prev => ({ ...prev, [accountId]: true }));
    setSavingStatus('saving');
    try {
      let data;
      if (category === 'contacts') {
        const provider = account.provider || 'manual';
        data = await requestContactsSync({
          provider,
          email,
          server_url: account.server_url,
          password: account.password,
          username: account.username,
        });
      } else if (category === 'calendar') {
        data = await syncCalendar(email);
      } else {
        data = await syncMail(email);
      }

      const ok = data.status === 'success' || data.status === 'ok';
      const partial = data.status === 'partial';
      if (ok || partial) {
        const failedEmails = ('failed' in data ? data.failed : undefined) || [];
        markError(prev => {
          const next = new Set(prev);
          if (email) {
            if (failedEmails.includes(email)) next.add(email);
            else next.delete(email);
          }
          return next;
        });
        setSavingStatus(partial ? 'error' : 'saved');
        void loadIntegrations();
        if (partial && failedEmails.length) {
          toast.error(tn('accounts.sync_partial_error', { emails: failedEmails.join(', ') }));
        }
      } else {
        setSavingStatus('error');
        if (email) markError(prev => new Set(prev).add(email));
        toast.error(tn('accounts.sync_error', { detail: ('error' in data ? data.error : undefined) || ('detail' in data ? data.detail : undefined) || tn('accounts.unknown_error') }));
      }
    } catch (e) {
      console.error("Sync error:", e);
      setSavingStatus('error');
      if (email) markError(prev => new Set(prev).add(email));
      const detail = errorDetail(e, tn('accounts.unknown_error'));
      toast.error(tn('accounts.sync_error', { detail }));
    } finally {
      setSyncingAccounts(prev => ({ ...prev, [accountId]: false }));
      setTimeout(() => { setSavingStatus('idle'); }, 3000);
    }
  };
  return { handleDeleteAccount, handleEditAccount, handleSyncAccount };
}
