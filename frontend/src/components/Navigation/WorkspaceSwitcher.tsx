import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Check, Plus, User } from 'lucide-react';

import { useApi } from '../../hooks/use-api';
import {
    defineStorageKey,
    readStorage,
    stringStorageCodec,
    writeStorage,
} from '../../shared/platform/browser-storage';

import './WorkspaceSwitcher.css';

interface WorkspaceSummary {
    id: string;
    name: string;
    role?: string | null;
}

const WORKSPACE_ID_KEY = defineStorageKey(
    'gnosi_workspace_id',
    stringStorageCodec,
);
const USER_ROLE_KEY = defineStorageKey('gnosi_role', stringStorageCodec);

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === 'string'
        && typeof record.name === 'string'
        && (
            record.role === undefined
            || record.role === null
            || typeof record.role === 'string'
        )
    );
}

function uniqueWorkspaces(value: unknown): WorkspaceSummary[] {
    if (!isUnknownArray(value)) return [];
    const workspaces = value.filter(isWorkspaceSummary);
    return workspaces.filter(
        (workspace, index) => index === workspaces.findIndex(
            (candidate) => candidate.id === workspace.id,
        ),
    );
}

export function WorkspaceSwitcher() {
    const { t } = useTranslation();
    const { apiFetch } = useApi();
    const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const fetchWorkspaces = async (): Promise<void> => {
            try {
                const data = await apiFetch('/api/workspaces');
                const uniqueData = uniqueWorkspaces(data);

                const wsList = uniqueData.length > 0 ? uniqueData : [
                    { id: 'personal', name: 'Personal', role: 'owner' },
                ];
                setWorkspaces(wsList);

                const savedId = readStorage(WORKSPACE_ID_KEY) || 'personal';
                const active = wsList.find((workspace) => workspace.id === savedId)
                    ?? wsList.at(0);
                if (!active) return;
                setActiveWorkspace(active);
                writeStorage(USER_ROLE_KEY, active.role || 'viewer');
            } catch (error: unknown) {
                console.error('Error fetching workspaces:', error);
            }
        };
        void fetchWorkspaces();
    }, [apiFetch]);

    const handleSelect = (workspace: WorkspaceSummary): void => {
        if (workspace.id === activeWorkspace?.id) {
            setIsOpen(false);
            return;
        }
        setActiveWorkspace(workspace);
        writeStorage(WORKSPACE_ID_KEY, workspace.id);
        writeStorage(USER_ROLE_KEY, workspace.role || 'viewer');
        setIsOpen(false);
        window.location.reload();
    };

    if (!activeWorkspace) return null;

    return (
        <div
            className="workspace-switcher"
            onMouseLeave={() => {
                setIsOpen(false);
            }}
        >
            <button
                className={`workspace-switcher__trigger ${isOpen ? 'workspace-switcher__trigger--active' : ''}`}
                onClick={() => {
                    setIsOpen(!isOpen);
                }}
                title={t('workspace.label_prefix', 'Workspace: {{name}}', { name: activeWorkspace.name })}
            >
                <div className="workspace-switcher__icon-box">
                    {activeWorkspace.id === 'personal' ? <User size={18} strokeWidth={2.5} /> : <Briefcase size={18} strokeWidth={2.5} />}
                </div>
                {workspaces.length > 1 && <div className="workspace-switcher__badge" />}
            </button>

            {isOpen && (
                <div className="workspace-switcher__menu">
                    <div className="workspace-switcher__menu-header">{t('doc_tabs.workspaces_title', 'Workspaces')}</div>
                    {workspaces.map((workspace) => (
                        <button
                            key={workspace.id}
                            className={`workspace-switcher__item ${workspace.id === activeWorkspace.id ? 'workspace-switcher__item--active' : ''}`}
                            onClick={() => {
                                handleSelect(workspace);
                            }}
                        >
                            <div className="workspace-switcher__item-icon">
                                {workspace.id === 'personal' ? <User size={16} /> : <Briefcase size={16} />}
                            </div>
                            <div className="workspace-switcher__item-info">
                                <span className="workspace-switcher__item-name">{workspace.name}</span>
                                <span className="workspace-switcher__item-role">{workspace.role || 'viewer'}</span>
                            </div>
                            {workspace.id === activeWorkspace.id && <Check size={14} style={{ marginLeft: 'auto' }} />}
                        </button>
                    ))}
                    <div className="workspace-switcher__divider" />

                    <button className="workspace-switcher__item workspace-switcher__action">
                        <div className="workspace-switcher__item-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--gnosi-blue)' }}>
                            <Plus size={16} />
                        </div>
                        <span className="workspace-switcher__item-name">{t('doc_tabs.new_workspace', 'New Workspace')}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
