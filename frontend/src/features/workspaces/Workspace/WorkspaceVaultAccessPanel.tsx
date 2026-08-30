import { Lock, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
    WorkspaceMember,
    WorkspaceMemberVault,
    WorkspaceMemberVaultAccess,
} from '../../../shared/api/workspace-members';


export interface WorkspaceVaultAccessPanelProps {
    readonly access: readonly WorkspaceMemberVaultAccess[];
    readonly member: WorkspaceMember;
    readonly onClose: () => void;
    readonly onToggleAccess: (userId: string, vaultId: string) => void;
    readonly vaults: readonly WorkspaceMemberVault[];
}


export function WorkspaceVaultAccessPanel({
    access,
    member,
    onClose,
    onToggleAccess,
    vaults,
}: WorkspaceVaultAccessPanelProps) {
    const { t } = useTranslation();
    return (
        <div className="mt-3 p-4 rounded-md border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/5">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <Lock size={14} className="text-[var(--gnosi-primary)]" />
                    {t('workspace.vault_access_for', {
                        email: member.email || member.user_id,
                        defaultValue: 'Vault access — {{email}}',
                    })}
                </div>
                <button onClick={onClose} className="text-[var(--text-tertiary)] p-1">
                    <X size={14} />
                </button>
            </div>
            {vaults.length === 0 ? (
                <p className="text-xs text-[var(--text-tertiary)] italic">
                    {t('workspace.no_vaults', {
                        defaultValue: 'There are no Vaults in this workspace.',
                    })}
                </p>
            ) : (
                <ul className="space-y-1.5">
                    {vaults.map((vault) => {
                        const hasAccess = access.some(
                            (item) => item.vault_id === vault.id,
                        );
                        return (
                            <li
                                key={vault.id}
                                className="flex items-center justify-between text-xs"
                            >
                                <span>{vault.name || vault.id}</span>
                                <button
                                    onClick={() => {
                                        onToggleAccess(member.user_id, vault.id);
                                    }}
                                    className={`px-2 py-0.5 rounded ${hasAccess
                                        ? 'bg-[var(--gnosi-primary)] text-white'
                                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                                    }`}
                                >
                                    {hasAccess
                                        ? t('workspace.has_access', {
                                            defaultValue: 'Has access',
                                        })
                                        : t('workspace.grant_access', {
                                            defaultValue: 'Grant',
                                        })}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
