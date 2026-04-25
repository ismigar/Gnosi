import React, { useState, useEffect } from 'react';
import { User, Briefcase, ChevronRight, Plus, Check } from 'lucide-react';
import { useApi } from '../../hooks/use-api';
import './WorkspaceSwitcher.css';

export function WorkspaceSwitcher() {
    const { apiFetch } = useApi();
    const [workspaces, setWorkspaces] = useState([]);
    const [activeWorkspace, setActiveWorkspace] = useState(null);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const fetchWorkspaces = async () => {
            try {
                const data = await apiFetch('/api/workspaces');
                
                // Eliminar duplicats per ID
                const uniqueData = Array.isArray(data) ? data.filter((ws, index, self) =>
                    index === self.findIndex((t) => t.id === ws.id)
                ) : [];

                const wsList = uniqueData.length > 0 ? uniqueData : [
                    { id: 'personal', name: 'Personal', role: 'owner' }
                ];
                
                setWorkspaces(wsList);
                
                const savedId = localStorage.getItem('gnosi_workspace_id') || 'personal';
                const active = wsList.find(w => w.id === savedId) || wsList[0];
                
                setActiveWorkspace(active);
                if (active) {
                    localStorage.setItem('gnosi_role', active.role || 'viewer');
                }
            } catch (err) {
                console.error("Error fetching workspaces:", err);
            }
        };
        fetchWorkspaces();
    }, [apiFetch]);

    const handleSelect = (ws) => {
        if (ws.id === activeWorkspace.id) {
            setIsOpen(false);
            return;
        }
        setActiveWorkspace(ws);
        localStorage.setItem('gnosi_workspace_id', ws.id);
        localStorage.setItem('gnosi_role', ws.role || 'viewer');
        setIsOpen(false);
        window.location.reload();
    };

    if (!activeWorkspace) return null;

    return (
        <div className="workspace-switcher" onMouseLeave={() => setIsOpen(false)}>
            <button 
                className={`workspace-switcher__trigger ${isOpen ? 'workspace-switcher__trigger--active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title={`Workspace: ${activeWorkspace.name}`}
            >
                <div className="workspace-switcher__icon-box">
                    {activeWorkspace.id === 'personal' ? <User size={18} strokeWidth={2.5} /> : <Briefcase size={18} strokeWidth={2.5} />}
                </div>
                {workspaces.length > 1 && <div className="workspace-switcher__badge" />}
            </button>

            {isOpen && (
                <div className="workspace-switcher__menu">
                    <div className="workspace-switcher__menu-header">Espais de Treball</div>
                    {workspaces.map(ws => (
                        <button 
                            key={ws.id}
                            className={`workspace-switcher__item ${ws.id === activeWorkspace.id ? 'workspace-switcher__item--active' : ''}`}
                            onClick={() => handleSelect(ws)}
                        >
                            <div className="workspace-switcher__item-icon">
                                {ws.id === 'personal' ? <User size={16} /> : <Briefcase size={16} />}
                            </div>
                            <div className="workspace-switcher__item-info">
                                <span className="workspace-switcher__item-name">{ws.name}</span>
                                <span className="workspace-switcher__item-role">{ws.role || 'viewer'}</span>
                            </div>
                            {ws.id === activeWorkspace.id && <Check size={14} style={{ marginLeft: 'auto' }} />}
                        </button>
                    ))}
                    
                    <div className="workspace-switcher__divider" />
                    
                    <button className="workspace-switcher__item workspace-switcher__action">
                        <div className="workspace-switcher__item-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--gnosi-blue)' }}>
                            <Plus size={16} />
                        </div>
                        <span className="workspace-switcher__item-name">Nou Workspace</span>
                    </button>
                </div>
            )}
        </div>
    );
}
