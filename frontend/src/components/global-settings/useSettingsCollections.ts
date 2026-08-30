import type { NewsletterDraft, MailAlias, Timer } from './types';
import type { ReaderSource } from '../../shared/api/reader';
import type { SocialNetwork, SocialStream } from '../../shared/api/social';
import { readStorage, syncErrorsKey, mailDarkBodyKey, snippetsKey } from './settingsStorage';
import { useRef } from 'react';
import { useState } from 'react';

export function useSettingsCollections() {
  const [newsletterSources, setNewsletterSources] = useState<ReaderSource[]>([]);
  const [newsletterSourcesLoaded, setNewsletterSourcesLoaded] = useState(false);
  const [newsletterSourcesError, setNewsletterSourcesError] = useState('');
  const [newsletterSourcesLoading, setNewsletterSourcesLoading] = useState(false);
  const [newsletterName, setNewsletterName] = useState('');
  const [newsletterAddress, setNewsletterAddress] = useState('');
  const [newsletterType, setNewsletterType] = useState('rss');
  const [newsletterStatus, setNewsletterStatus] = useState('');
  const [newsletterOpmlLoading, setNewsletterOpmlLoading] = useState(false);
  const newsletterOpmlRef = useRef<HTMLInputElement | null>(null);
  const [newsletterAccount, setNewsletterAccount] = useState<NewsletterDraft>({ mail_server: '', mail_port: 110, mail_ssl: 'starttls', email: '', password: '', delete_after_ingest: true });
  const [newsletterAccountLoaded, setNewsletterAccountLoaded] = useState(false);
  const [newsletterAccountStatus, setNewsletterAccountStatus] = useState('');
  const [newsletterAccountTesting, setNewsletterAccountTesting] = useState(false);
  const [newsletterAccountSyncing, setNewsletterAccountSyncing] = useState(false);
  const [newsletterPasswordDirty, setNewsletterPasswordDirty] = useState(false);
  const newsletterAccountSaveTimerRef = useRef<Timer>(undefined);
  const lastSavedNewsletterAccountRef = useRef<string | null>(null);
  const [addAccountType, setAddAccountType] = useState<string | null>(null);
  const [addAccountEmail, setAddAccountEmail] = useState('');
  const [addAccountEmailBlurred, setAddAccountEmailBlurred] = useState(false);
  const [isManualGoogle, setIsManualGoogle] = useState(false);
  const [manualServer, setManualServer] = useState('');
  const [manualPassword, setManualPassword] = useState('');
  const [editingAccountId, setEditingAccountId] = useState<string | null | undefined>(null);
  const [accountEditorTarget, setAccountEditorTarget] = useState<HTMLDivElement | null>(null);
  const [tableColorEditorTarget, setTableColorEditorTarget] = useState<HTMLDivElement | null>(null);
  const [syncingAccounts, setSyncingAccounts] = useState<Record<string, boolean>>({});
  const [syncErrorAccounts, setSyncErrorAccounts] = useState(() => {
    return new Set(readStorage(syncErrorsKey) ?? []);
  });
  const [calendarAuthErrors, setCalendarAuthErrors] = useState(() => new Set<string>());
  const [contactsSyncErrors, setContactsSyncErrors] = useState(() => new Set<string>());
  const [mailDarkBody, setMailDarkBody] = useState(() => {
    return readStorage(mailDarkBodyKey) === '1';
  });
  const DEFAULT_SNIPPETS = [
    { id: 'snip_default_1', title: 'Salutació formal', content: 'Benvolgut/da,\n\nEspero que es trobi bé.' },
    { id: 'snip_default_2', title: 'Gràcies per la resposta', content: 'Moltes gràcies per la seva resposta.' },
    { id: 'snip_default_3', title: 'Comiat formal', content: 'Atentament,\n\n' },
    { id: 'snip_default_4', title: 'Proposta reunió', content: 'Li proposo una reunió per tractar aquest tema.' },
    { id: 'snip_default_5', title: 'Seguiment', content: 'Em poso en contacte per fer seguiment del tema anterior.' },
  ];
  const [snippets, setSnippets] = useState(() => {
    try {
      const stored = readStorage(snippetsKey);
      return stored ?? DEFAULT_SNIPPETS;
    } catch { return DEFAULT_SNIPPETS; }
  });
  const [snippetDraft, setSnippetDraft] = useState({ title: '', content: '' });
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
  const [snippetEditorTarget, setSnippetEditorTarget] = useState<HTMLDivElement | null>(null);
  const SOCIAL_NETWORK_DEFAULTS = [
    { id: 'mastodon', name: 'Mastodon', icon: '🐘', enabled: true },
    { id: 'bluesky', name: 'Bluesky', icon: '🦋', enabled: true },
    { id: 'linkedin', name: 'LinkedIn', icon: '💼', enabled: true },
    { id: 'facebook', name: 'Facebook', icon: '📘', enabled: false },
    { id: 'telegram', name: 'Telegram', icon: '✈️', enabled: false },
  ];
  const [socialNetworks, setSocialNetworks] = useState<SocialNetwork[]>(SOCIAL_NETWORK_DEFAULTS);
  const [socialStreams, setSocialStreams] = useState<SocialStream[]>([]);
  const [newStreamForm, setNewStreamForm] = useState({ id: '', title: '', icon: '📡', network: 'mastodon' });
  const [showAddStream, setShowAddStream] = useState(false);
  const [mailImapHost, setMailImapHost] = useState('');
  const [mailImapPort, setMailImapPort] = useState<string | number>('993');
  const [mailImapUser, setMailImapUser] = useState('');
  const [mailImapPass, setMailImapPass] = useState('');
  const [mailImapEnc, setMailImapEnc] = useState('ssl');
  const [mailSmtpHost, setMailSmtpHost] = useState('');
  const [mailSmtpPort, setMailSmtpPort] = useState<string | number>('465');
  const [mailSmtpUser, setMailSmtpUser] = useState('');
  const [mailSmtpPass, setMailSmtpPass] = useState('');
  const [mailSmtpEnc, setMailSmtpEnc] = useState('ssl');
  const [mailSignature, setMailSignature] = useState('');
  const [mailCertificate, setMailCertificate] = useState('');
  const [mailDisplayName, setMailDisplayName] = useState('');
  const [mailSubjectPrefix, setMailSubjectPrefix] = useState('');
  const [mailAliases, setMailAliases] = useState<MailAlias[]>([]);
  const [mailTestStatus, setMailTestStatus] = useState<string | null>(null);
  const identityAutoSaveRef = useRef<Timer>(undefined);
  const identityLoadedForRef = useRef<string | null>(null);
  return {
    newsletterSources, setNewsletterSources, newsletterSourcesLoaded, setNewsletterSourcesLoaded, newsletterSourcesError, setNewsletterSourcesError,
    newsletterSourcesLoading, setNewsletterSourcesLoading, newsletterName, setNewsletterName, newsletterAddress, setNewsletterAddress,
    newsletterType, setNewsletterType, newsletterStatus, setNewsletterStatus, newsletterOpmlLoading, setNewsletterOpmlLoading,
    newsletterOpmlRef, newsletterAccount, setNewsletterAccount, newsletterAccountLoaded, setNewsletterAccountLoaded, newsletterAccountStatus,
    setNewsletterAccountStatus, newsletterAccountTesting, setNewsletterAccountTesting, newsletterAccountSyncing, setNewsletterAccountSyncing, newsletterPasswordDirty,
    setNewsletterPasswordDirty, newsletterAccountSaveTimerRef, lastSavedNewsletterAccountRef, addAccountType, setAddAccountType, addAccountEmail,
    setAddAccountEmail, addAccountEmailBlurred, setAddAccountEmailBlurred, isManualGoogle, setIsManualGoogle, manualServer,
    setManualServer, manualPassword, setManualPassword, editingAccountId, setEditingAccountId, accountEditorTarget,
    setAccountEditorTarget, tableColorEditorTarget, setTableColorEditorTarget, syncingAccounts, setSyncingAccounts, syncErrorAccounts,
    setSyncErrorAccounts, calendarAuthErrors, setCalendarAuthErrors, contactsSyncErrors, setContactsSyncErrors, mailDarkBody,
    setMailDarkBody, DEFAULT_SNIPPETS, snippets, setSnippets, snippetDraft, setSnippetDraft,
    editingSnippetId, setEditingSnippetId, snippetEditorTarget, setSnippetEditorTarget, SOCIAL_NETWORK_DEFAULTS, socialNetworks,
    setSocialNetworks, socialStreams, setSocialStreams, newStreamForm, setNewStreamForm, showAddStream,
    setShowAddStream, mailImapHost, setMailImapHost, mailImapPort, setMailImapPort, mailImapUser,
    setMailImapUser, mailImapPass, setMailImapPass, mailImapEnc, setMailImapEnc, mailSmtpHost,
    setMailSmtpHost, mailSmtpPort, setMailSmtpPort, mailSmtpUser, setMailSmtpUser, mailSmtpPass,
    setMailSmtpPass, mailSmtpEnc, setMailSmtpEnc, mailSignature, setMailSignature, mailCertificate,
    setMailCertificate, mailDisplayName, setMailDisplayName, mailSubjectPrefix, setMailSubjectPrefix, mailAliases,
    setMailAliases, mailTestStatus, setMailTestStatus, identityAutoSaveRef, identityLoadedForRef,
  };
}
