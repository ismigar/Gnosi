import { FolderOpen } from 'lucide-react';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { PasswordInput } from './PasswordInput';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { Settings as SettingsIcon } from 'lucide-react';
import { SettingsSectionTabs } from '../../../shared/ui/settings/SettingsSectionTabs';
import VaultSwitcher from '../../vault-management/VaultSwitcher';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'draft' | 'generalSection' | 'setDraft' | 'setGeneralSection' | 'setPickerField' | 'setPickerOpen' | 'tn'> };

export function GeneralPanel({ context }: Props) {
  const { activeTab, draft, generalSection, setDraft, setGeneralSection, setPickerField, setPickerOpen, tn } = context;
  return (activeTab === 'general' && (
    <>
      <SettingsSectionTabs
        ariaLabel={tn('general.sections_label')}
        activeId={generalSection}
        onChange={setGeneralSection}
        items={[
          { id: 'system', icon: SettingsIcon, label: tn('general.system_title') },
          { id: 'files', icon: FolderOpen, label: tn('general.files_structure') },
        ]}
      />
      {generalSection === 'system' && (
        <Section title={tn('general.system_title')} icon={SettingsIcon}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '40px' }}>
            <FormGroup label={tn('general.workspace_name')} description={tn('general.workspace_name_desc')}>
              <input type="text" className="gnosi-input" value={draft.settings.workspace_name} onChange={e => { setDraft({ ...draft, settings: { ...draft.settings, workspace_name: e.target.value } }); }} placeholder={tn('general.workspace_name_placeholder')} />
            </FormGroup>
          </div>

          <FormGroup label={tn('general.workspace_type')} description={tn('general.workspace_type_desc')}>
            <div className="segmented-control" style={{ display: 'flex', background: 'var(--settings-sidebar-bg)', padding: '6px', borderRadius: '18px', border: '1px solid var(--settings-border)' }}>
              {['personal', 'org'].map(m => (
                <button key={m} onClick={() => { setDraft({ ...draft, settings: { ...draft.settings, gnosi_mode: m } }); }} style={{
                  flex: 1, padding: '12px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                  background: draft.settings.gnosi_mode === m ? 'var(--gnosi-blue)' : 'transparent',
                  color: draft.settings.gnosi_mode === m ? 'white' : 'var(--text-secondary)',
                  fontWeight: '800', fontSize: '0.95rem', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>{m === 'personal' ? tn('general.personal_use') : tn('general.organization')}</button>
              ))}
            </div>
          </FormGroup>

          {draft.settings.gnosi_mode === 'org' && (
            <div className="animate-in" style={{ marginTop: '30px', padding: '30px', borderRadius: '24px', background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <FormGroup label={tn('general.org_admin_user')}><input type="text" className="gnosi-input" value={draft.settings.org_user} onChange={e => { setDraft({ ...draft, settings: { ...draft.settings, org_user: e.target.value } }); }} /></FormGroup>
                <FormGroup label={tn('general.org_admin_password')}><PasswordInput value={draft.settings.org_password} onChange={e => { setDraft({ ...draft, settings: { ...draft.settings, org_password: e.target.value } }); }} name="org-admin-password" autoComplete="new-password" /></FormGroup>
              </div>
            </div>
          )}

        </Section>
      )}
      {generalSection === 'files' && (
        <Section title={tn('general.files_structure')} icon={FolderOpen}>
          <FormGroup label={tn('general.root_folder')} description={tn('general.root_folder_desc')}>
            <div style={{ display: 'flex', gap: '14px' }}>
              {/* Show the CONTAINER folder (parent of the active vault), not the vault: vaults live inside this root. */}
              <input type="text" className="gnosi-input" value={(draft.paths.vault || '').replace(/[/\\][^/\\]+[/\\]?$/, '') || draft.paths.vault || ''} readOnly style={{ flex: 1, opacity: 0.7, fontFamily: 'monospace', fontSize: '0.82rem', letterSpacing: '0' }} />
              <button onClick={() => { setPickerField('vault'); setPickerOpen(true); }} className="btn-gnosi-secondary" style={{ padding: '0 24px', borderRadius: '14px', border: 'none', background: 'rgba(59, 130, 246, 0.12)', color: 'var(--gnosi-blue)', flexShrink: 0 }}>
                <FolderOpen size={18} />
              </button>
            </div>
          </FormGroup>
          {draft.settings.gnosi_mode === 'personal' && (
            <FormGroup label={tn('general.vaults_label')} description={tn('general.vaults_desc')}>
              <VaultSwitcher />
            </FormGroup>
          )}
        </Section>
      )}
    </>
  ));
}
