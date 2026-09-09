import { pluginForSettingsTab } from './pluginSettingsNavigation';
import { ChevronDown } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { Globe } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { Palette } from 'lucide-react';
import { Settings as SettingsIcon } from 'lucide-react';
import { SettingsNavGroup } from './SettingsNavigation';
import { Share2 } from 'lucide-react';
import { SidebarItem } from './SettingsNavigation';
import { User } from 'lucide-react';
import { Users } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'isAdvancedOpen' | 'isOpen' | 'setActiveTab' | 'setAddAccountType' | 'setIsAdvancedOpen' | 'sidebarNavigation' | 't'> };

export function SettingsSidebar({ context }: Props) {
  const { activeTab, isAdvancedOpen, setActiveTab, setAddAccountType, setIsAdvancedOpen, sidebarNavigation, t } = context;
  return (<aside className="settings-sidebar gnosi-modal-scroll">
    <div className="settings-sidebar-header">
      <div className="settings-sidebar-brand">
        <div className="settings-section-icon-wrap">
          <SettingsIcon size={20} strokeWidth={2} />
        </div>
        <h2 id="settings-modal-title" className="settings-sidebar-title">{t('settings.title')}</h2>
      </div>

    </div>

    <div className="settings-sidebar-nav">
      <SettingsNavGroup label={t('settings.navigation.basic')}>
        <SidebarItem id="general" icon={SettingsIcon} label={t('settings.tabs.general') || 'General'} active={activeTab === 'general'} onClick={() => { setActiveTab('general'); setAddAccountType(null); }} />
        <SidebarItem id="appearance" icon={Palette} label={t('settings.tabs.appearance') || 'Aparença'} active={activeTab === 'appearance'} onClick={() => { setActiveTab('appearance'); setAddAccountType(null); }} />
        {sidebarNavigation && <SidebarItem id="menu" icon={LucideIcons.PanelLeft} label={t('settings.tabs.menu', 'Menú')} active={activeTab === 'menu'} onClick={() => { setActiveTab('menu'); setAddAccountType(null); }} />}
        <SidebarItem id="language" icon={Globe} label={t('settings.tabs.language') || 'Idioma i Regió'} active={activeTab === 'language'} onClick={() => { setActiveTab('language'); setAddAccountType(null); }} />
        <SidebarItem id="profile" icon={User} label={t('settings.tabs.profile') || 'Perfil'} active={activeTab === 'profile'} onClick={() => { setActiveTab('profile'); setAddAccountType(null); }} />
        <SidebarItem id="account" icon={LucideIcons.UserCog} label={t('settings.tabs.account', 'Compte')} active={activeTab === 'account'} onClick={() => { setActiveTab('account'); setAddAccountType(null); }} />
        <SidebarItem id="workspace" icon={Users} label={t('settings.tabs.workspace') || 'Workspace'} active={activeTab === 'workspace'} onClick={() => { setActiveTab('workspace'); setAddAccountType(null); }} />
      </SettingsNavGroup>

      <SettingsNavGroup label={t('settings.navigation.knowledge')}>
        <SidebarItem id="plugins" icon={LucideIcons.Puzzle} label={t('settings.tabs.plugins', 'Plugins')} active={activeTab === 'plugins' || Boolean(pluginForSettingsTab(activeTab))} onClick={() => { setActiveTab('plugins'); setAddAccountType(null); }} />
        <SidebarItem id="graph" icon={Share2} label={t('settings.tabs.graph') || 'Grafe'} active={activeTab === 'graph'} onClick={() => { setActiveTab('graph'); setAddAccountType(null); }} />
      </SettingsNavGroup>

      <section className="settings-sidebar-group settings-sidebar-group--advanced">
        <button
          type="button"
          className="settings-sidebar-group__toggle gnosi-sidebar-section-title"
          aria-expanded={isAdvancedOpen}
          onClick={() => { setIsAdvancedOpen(isOpen => !isOpen); }}
        >
          <span>{t('settings.navigation.advanced')}</span>
          {isAdvancedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {isAdvancedOpen && (
          <div className="settings-sidebar-group__content">
            <SidebarItem id="api" icon={LucideIcons.KeyRound} label={t('settings.tabs.api', { defaultValue: 'API i tokens' })} active={activeTab === 'api'} onClick={() => { setActiveTab('api'); setAddAccountType(null); }} />
          </div>
        )}
      </section>
    </div>

  </aside>);
}
