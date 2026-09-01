import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    isWorkspaceRole,
    type WorkspaceRole,
} from './workspaceMemberModel';


export interface WorkspaceInviteFormProps {
    readonly email: string;
    readonly onCancel: () => void;
    readonly onEmailChange: (email: string) => void;
    readonly onRoleChange: (role: WorkspaceRole) => void;
    readonly onSubmit: () => void;
    readonly role: WorkspaceRole;
}


export function WorkspaceInviteForm({
    email,
    onCancel,
    onEmailChange,
    onRoleChange,
    onSubmit,
    role,
}: WorkspaceInviteFormProps) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-2 p-3 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30">
            <input
                autoFocus
                type="email"
                value={email}
                onChange={(event) => {
                    onEmailChange(event.target.value);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') onSubmit();
                    if (event.key === 'Escape') onCancel();
                }}
                placeholder={t('workspace.email_placeholder', {
                    defaultValue: 'email@cooperativa.coop',
                })}
                className="flex-1 px-2 py-1 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] outline-none focus:border-[var(--gnosi-primary)]"
            />
            <select
                value={role}
                onChange={(event) => {
                    if (isWorkspaceRole(event.target.value)) {
                        onRoleChange(event.target.value);
                    }
                }}
                className="px-2 py-1 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)]"
            >
                <option value="viewer">{t('dashboard.role_viewer', 'Viewer')}</option>
                <option value="editor">{t('dashboard.role_editor', 'Editor')}</option>
                <option value="admin">{t('dashboard.role_admin', 'Admin')}</option>
            </select>
            <button
                onClick={onSubmit}
                className="px-3 py-1 text-xs rounded-md bg-[var(--gnosi-primary)] text-white"
            >
                {t('workspace.ok', 'OK')}
            </button>
            <button onClick={onCancel} className="text-[var(--text-tertiary)] p-1">
                <X size={14} />
            </button>
        </div>
    );
}
