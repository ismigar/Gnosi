import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { PasswordInput } from './PasswordInput';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { Settings as SettingsIcon } from 'lucide-react';
import { SettingsSectionTabs } from '../../../shared/ui/settings/SettingsSectionTabs';
import VaultSwitcher from '../../vault-management/VaultSwitcher';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'draft' | 'generalSection' | 'setDraft' | 'setGeneralSection' | 'handleClose' | 'tn'> };

export function GeneralPanel({ context }: Props) {
  const { activeTab, draft, generalSection, setDraft, setGeneralSection, handleClose, tn } = context;
  const [folderError, setFolderError] = useState('');
  const chooseContainer = async () => {
    setFolderError('');
    try {
      await handleClose();
      await window.electronAPI?.chooseVaultContainer?.();
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error));
    }
  };
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
                  background: draft.settings.gnosi_mode === m ? 'var(--gnosi-action-bg)' : 'transparent',
                  color: draft.settings.gnosi_mode === m ? 'white' : 'var(--text-secondary)',
                  fontWeight: '800', fontSize: '0.95rem', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>{m === 'personal' ? tn('general.personal_use') : tn('general.organization')}</button>
              ))}
            </div>
          </FormGroup>

          {draft.settings.gnosi_mode === 'org' && (
            <div className="animate-in" style={{ marginTop: '30px', padding: '30px', borderRadius: '24px', background: 'color-mix(in srgb, var(--gnosi-primary) 4%, transparent)', border: '1px solid color-mix(in srgb, var(--gnosi-primary) 10%, transparent)' }}>
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
              <textarea rows={2} className="gnosi-input" aria-label={tn('general.root_folder')} value={draft.paths.vaults_root || ''} readOnly style={{ flex: 1, minWidth: 0, resize: 'none', overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: '0.82rem', letterSpacing: '0' }} />
              {window.electronAPI?.chooseVaultContainer && <button type="button" className="btn-gnosi-secondary" aria-label={tn('general.select_folder')} title={tn('general.container_restart')} onClick={() => { void chooseContainer(); }}><FolderOpen size={18} /></button>}
            </div>
            {window.electronAPI?.chooseVaultContainer && <p>{tn('general.container_restart')}</p>}
            {folderError && <p role="alert">{folderError}</p>}
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
