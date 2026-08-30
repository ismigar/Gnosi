import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { Users } from 'lucide-react';
import { WorkspaceMembersPanel } from '../../workspaces/Workspace/WorkspaceMembersPanel';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'draft' | 'role' | 't'> };

export function WorkspacePanel({ context }: Props) {
  const { activeTab, draft, role, t } = context;
  return (activeTab === 'workspace' && (
    <Section
      title={t('settings.tabs.workspace') || 'Workspace'}
      icon={Users}
    >
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '16px', lineHeight: 1.5 }}>
        {t('settings.workspace.intro', {
          defaultValue: 'Gestiona membres, rols i accés a vaults del workspace actiu. Aquesta secció existeix per a cooperatives, equips de recerca i col·lectius que comparteixen una mateixa instància de Gnosi. La col·laboració en temps real està en desenvolupament — vegis la directiva collaboration_proposal.md.',
        })}
      </p>
      <WorkspaceMembersPanel
        workspaceId={draft.settings.active_workspace_id || draft.settings.workspace_id || ''}
        isAdmin={role === 'admin' || role === 'owner'}
        currentUserId={draft.settings.user_id || null}
      />
    </Section>
  ));
}
