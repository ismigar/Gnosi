import { lazy, Suspense, useEffect, useRef } from 'react';
import { AppearancePanel } from './AppearancePanel';
import { ConfirmModal } from '../../../shared/ui/dialogs/ConfirmModal';
import { Database } from 'lucide-react';
import { FileText } from 'lucide-react';
import { GeneralPanel } from './GeneralPanel';
import { LanguagePanel } from './LanguagePanel';
import { Mail } from 'lucide-react';
import { SettingsBackButton } from '../../../shared/ui/settings/SettingsBackButton';
import { pluginConfigurationForSettingsTab, pluginForSettingsTab } from './pluginSettingsNavigation';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { SettingsSectionTabs } from '../../../shared/ui/settings/SettingsSectionTabs';
import { SettingsSidebar } from './SettingsSidebar';
import { X } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';
import { settingsPanelLoaders } from './settingsPanelLoaders';

// Load editors only when their section or dialog is opened.
const AIModelComparisonModal = lazy(() => import('../AIModelComparisonModal'));
const AIUsageHistoryModal = lazy(() => import('../AIUsageHistoryModal'));
const AccountSettings = lazy(settingsPanelLoaders.account);
const AccountsPanel = lazy(settingsPanelLoaders.accounts);
const AiPanel = lazy(settingsPanelLoaders.ai);
const ApiTokensSettings = lazy(settingsPanelLoaders.api);
const AppSidebarSettings = lazy(settingsPanelLoaders.menu);
const FilesystemPickerModal = lazy(() => import('../../../shared/ui/filesystem-picker/FilesystemPickerModal').then(module => ({ default: module.FilesystemPickerModal })));
const GraphPanel = lazy(settingsPanelLoaders.graph);
const IdentityProfile = lazy(settingsPanelLoaders.profile);
const NotionImportSettings = lazy(settingsPanelLoaders.notion);
const PluginsSettings = lazy(settingsPanelLoaders.plugins);
const ReaderPanel = lazy(settingsPanelLoaders.reader);
const SnippetsPanel = lazy(() => import('./SnippetsPanel').then(module => ({ default: module.SnippetsPanel })));
const SocialPanel = lazy(settingsPanelLoaders.social);
const TranslationPanel = lazy(settingsPanelLoaders.translate);
const WorkspacePanel = lazy(settingsPanelLoaders.workspace);

export function GlobalSettingsView({ context }: { context: SettingsController }) {
  const { activeTab, aiRegistry, confirmConfig, draft, googleCalAuthError, handleClose, initialPluginId, isModelComparisonOpen, isOpen, isUsageHistoryOpen, mailSection, panelRef, pickerField, pickerOpen, setActiveTab, setAddAccountType, setAiSection, setConfirmConfig, setDraft, setIsModelComparisonOpen, setIsUsageHistoryOpen, setMailSection, setPickerOpen, sidebarNavigation, t, tn } = context;
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [activeTab]);
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
          <main ref={mainRef} className="settings-main gnosi-modal-scroll">
            <div className="settings-content-wrap">
              {pluginForSettingsTab(activeTab) && (
                <SettingsBackButton onClick={() => { setActiveTab('plugins'); setAddAccountType(null); }} />
              )}
              <Suspense fallback={<div role="status">{t('common.loading')}</div>}>

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
                {activeTab === 'workspace' && <WorkspacePanel context={context} />}

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
                {(activeTab === 'plugins' || pluginConfigurationForSettingsTab(activeTab)) && (
                  <PluginsSettings
                    configurationPluginId={pluginConfigurationForSettingsTab(activeTab)}
                    initialPluginId={initialPluginId}
                    onOpenSettingsTab={(tab) => {
                      if (tab === 'automations') {
                        setAiSection('automations');
                        setActiveTab('ai');
                      } else {
                        setActiveTab(tab);
                      }
                      setAddAccountType(null);
                    }}
                  />
                )}

                {/* TRANSLATION */}
                {activeTab === 'translate' && (
                  <TranslationPanel context={context} />
                )}

              </Suspense>
            </div>
          </main>
        </div>
      </div>
      <Suspense fallback={<div role="status">{t('common.loading')}</div>}>
        {pickerOpen && <FilesystemPickerModal
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
        />}
      </Suspense>


      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        onClose={() => { setConfirmConfig(prev => ({ ...prev, isOpen: false })); }}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isDestructive={true}
      />

      <Suspense fallback={<div role="status">{t('common.loading')}</div>}>
        {isModelComparisonOpen && <AIModelComparisonModal
          isOpen={isModelComparisonOpen}
          onClose={() => { setIsModelComparisonOpen(false); }}
        />}

        {isUsageHistoryOpen && <AIUsageHistoryModal
          isOpen={isUsageHistoryOpen}
          onClose={() => { setIsUsageHistoryOpen(false); }}
          activeModels={aiRegistry}
        />}
      </Suspense>

    </>
  );
}
