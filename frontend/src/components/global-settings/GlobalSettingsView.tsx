import AIModelComparisonModal from '../AIModelComparisonModal';
import AIUsageHistoryModal from '../AIUsageHistoryModal';
import AccountSettings from '../Auth/AccountSettings';
import { AccountsPanel } from './AccountsPanel';
import { AiPanel } from './AiPanel';
import ApiTokensSettings from '../ApiTokensSettings';
import { AppSidebarSettings } from '../AppSidebarSettings';
import { AppearancePanel } from './AppearancePanel';
import { ConfirmModal } from '../ConfirmModal';
import { Database } from 'lucide-react';
import { FileText } from 'lucide-react';
import { FilesystemPickerModal } from '../FilesystemPickerModal';
import { GeneralPanel } from './GeneralPanel';
import { GraphPanel } from './GraphPanel';
import IdentityProfile from '../Vault/IdentityProfile';
import { LanguagePanel } from './LanguagePanel';
import { Mail } from 'lucide-react';
import NotionImportSettings from '../NotionImportSettings';
import { PluginsSettings } from '../PluginsSettings';
import { ReaderPanel } from './ReaderPanel';
import { ReferencesPanel } from './ReferencesPanel';
import { RefreshCw } from 'lucide-react';
import { Section } from './SettingsPrimitives';
import { SettingsSectionTabs } from '../SettingsSectionTabs';
import { SettingsSidebar } from './SettingsSidebar';
import { SnippetsPanel } from './SnippetsPanel';
import { SocialPanel } from './SocialPanel';
import { TranslationPanel } from './TranslationPanel';
import { WorkspacePanel } from './WorkspacePanel';
import { X } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';

export function GlobalSettingsView({ context }: { context: SettingsController }) {
  const { activeTab, aiRegistry, confirmConfig, draft, googleCalAuthError, handleClose, initialPluginId, isModelComparisonOpen, isOpen, isUsageHistoryOpen, mailSection, panelRef, pickerField, pickerOpen, setActiveTab, setAddAccountType, setConfirmConfig, setDraft, setIsModelComparisonOpen, setIsUsageHistoryOpen, setMailSection, setPickerOpen, sidebarNavigation, t, tn } = context;
  return (
    <>
      <div className={`settings-overlay ${isOpen ? 'active' : ''}`} />
      <div
        ref={panelRef}
        className={`settings-modal ${isOpen ? 'active' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        {/* X button outside .settings-main so it anchors to the modal and doesn't
                    disappear when the content scrolls. */}
        <button onClick={() => { void handleClose(); }} className="gnosi-close-btn settings-close-btn" aria-label={tn('close_settings')}>
          <X />
        </button>
        <div className="settings-inner">

          {/* SIDEBAR */}
          <SettingsSidebar context={context} />

          {/* CONTENT AREA */}
          <main className="settings-main gnosi-modal-scroll">
            <div className="settings-content-wrap">

              {/* API I TOKENS (PAT) */}
              {activeTab === 'api' && (
                <div className="animate-in">
                  <ApiTokensSettings />
                </div>
              )}

              {/* IDENTITY PROFILE */}
              {activeTab === 'profile' && (
                <div className="animate-in">
                  <IdentityProfile
                    userName={draft.settings.user_name}
                    setUserName={(val) => { setDraft(prev => ({ ...prev, settings: { ...prev.settings, user_name: typeof val === "function" ? val(prev.settings.user_name) : val } })); }}
                    profile={draft.identity}
                    setProfile={(val) => { setDraft(prev => ({ ...prev, identity: typeof val === "function" ? val(prev.identity) : val })); }}
                  />
                </div>
              )}

              {/* ACCOUNT (credentials) */}
              {activeTab === 'account' && <AccountSettings />}

              {activeTab === 'menu' && sidebarNavigation && (
                <div className="animate-in">
                  <AppSidebarSettings {...sidebarNavigation} />
                </div>
              )}

              {/* GENERAL */}
              <GeneralPanel context={context} />

              {/* WORKSPACE — member management and vault access */}
              <WorkspacePanel context={context} />

              {/* REFERENCES (Zotero style) */}
              <ReferencesPanel context={context} />

              {/* LANGUAGE AND REGION */}
              <LanguagePanel context={context} />

              {/* APPEARANCE */}
              <AppearancePanel context={context} />

              {/* Warning: Google token expired (calendars won't load) */}
              {activeTab === 'calendar' && googleCalAuthError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', marginBottom: '16px', borderRadius: '14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', flex: 1 }}>
                    {t('settings.calendar.google_token_expired') || "El token de Google ha caducat o s'ha revocat. Reconnecta el compte per tornar a carregar els calendaris."}
                  </div>
                  <button
                    onClick={() => { window.location.href = '/api/auth/google/login?type=calendar'; }}
                    style={{ padding: '8px 16px', fontSize: '0.82rem', borderRadius: '10px', border: 'none', background: '#4285f4', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    {t('settings.calendar.reconnect_google') || 'Reconnecta Google'}
                  </button>
                </div>
              )}

              {activeTab === 'mail' && (
                <SettingsSectionTabs
                  ariaLabel={tn('mail_accounts.sections_label')}
                  activeId={mailSection}
                  onChange={setMailSection}
                  items={[
                    { id: 'accounts', icon: Mail, label: tn('mail_accounts.title') },
                    { id: 'snippets', icon: FileText, label: tn('snippets.title') },
                  ]}
                />
              )}

              {/* CALENDAR, CONTACTS, MAIL */}
              {(activeTab === 'calendar' || activeTab === 'contacts' || (activeTab === 'mail' && mailSection === 'accounts')) && (
                <AccountsPanel context={context} />
              )}

              {/* MAIL SNIPPETS */}
              {activeTab === 'mail' && mailSection === 'snippets' && (
                <SnippetsPanel context={context} />
              )}

              {/* SOCIAL */}
              {activeTab === 'social' && (
                <SocialPanel context={context} />
              )}

              {/* READER */}
              {activeTab === 'reader' && (
                <ReaderPanel context={context} />
              )}

              {/* GRAF */}
              {activeTab === 'graph' && (
                <GraphPanel context={context} />
              )}

              {/* IA */}
              {activeTab === 'ai' && (
                <AiPanel context={context} />
              )}


              {/* NOTION IMPORT */}
              {activeTab === 'notion' && (
                <Section title={t('settings.tabs.notion')} icon={Database}>
                  <NotionImportSettings />
                </Section>
              )}

              {/* PLUGINS */}
              {activeTab === 'plugins' && (
                <PluginsSettings
                  initialPluginId={initialPluginId}
                  onOpenSettingsTab={(tab) => {
                    setActiveTab(tab);
                    setAddAccountType(null);
                  }}
                />
              )}

              {/* TRANSLATION */}
              {activeTab === 'translate' && (
                <TranslationPanel context={context} />
              )}

            </div>
          </main>
        </div>
      </div>
      <FilesystemPickerModal
        isOpen={pickerOpen}
        onClose={() => { setPickerOpen(false); }}
        initialPath={draft.paths[pickerField ?? "null"] || ''}
        mode="folder"
        onSelect={(path) => {
          setDraft(prev => ({
            ...prev,
            paths: { ...prev.paths, [pickerField ?? "null"]: path }
          }));
          setPickerOpen(false);
        }}
        preferNative={false}
      />


      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        onClose={() => { setConfirmConfig(prev => ({ ...prev, isOpen: false })); }}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isDestructive={true}
      />

      <AIModelComparisonModal
        isOpen={isModelComparisonOpen}
        onClose={() => { setIsModelComparisonOpen(false); }}
      />

      <AIUsageHistoryModal
        isOpen={isUsageHistoryOpen}
        onClose={() => { setIsUsageHistoryOpen(false); }}
        activeModels={aiRegistry}
      />

    </>
  );
}
