import React, { useState, useEffect } from 'react';
import { User, Briefcase, ChevronDown, Plus } from 'lucide-react';
import { useApi } from '../../hooks/use-api';

export function WorkspaceSwitcher() {
    const { apiFetch } = useApi();
    const [workspaces, setWorkspaces] = useState([]);
    const [activeWorkspace, setActiveWorkspace] = useState(null);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const fetchWorkspaces = async () => {
            try {
                const data = await apiFetch('/api/workspaces');
                
                // Eliminar duplicats per ID (per si el backend retorna repetits)
                const uniqueData = Array.isArray(data) ? data.filter((ws, index, self) =>
                    index === self.findIndex((t) => t.id === ws.id)
                ) : [];

                // Si no hi ha cap workspace (cas extrem d'error), forçar el personal
                const wsList = uniqueData.length > 0 ? uniqueData : [
                    { id: 'personal', name: 'Personal', icon: <User size={16} />, role: 'owner' }
                ];
                
                // Mapejar icones basats en tipus/nom si cal, o usar default
                const workspacesWithIcons = wsList.map(ws => ({
                    ...ws,
                    icon: ws.id === 'personal' ? <User size={16} /> : <Briefcase size={16} />
                }));
                
                setWorkspaces(workspacesWithIcons);
                
                const savedId = localStorage.getItem('gnosi_workspace_id') || 'personal';
                const active = workspacesWithIcons.find(w => w.id === savedId) || workspacesWithIcons[0];
                
                setActiveWorkspace(active);
                // Guardar el rol actual
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
        setActiveWorkspace(ws);
        localStorage.setItem('gnosi_workspace_id', ws.id);
        localStorage.setItem('gnosi_role', ws.role || 'viewer');
        setIsOpen(false);
        // Recarregar la pàgina per aplicar canvis de context a tot el sistema
        window.location.reload();
    };

    if (!activeWorkspace) return null;

    return (
        <div className="workspace-switcher">
            <button 
                className="workspace-switcher__trigger"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="workspace-switcher__icon">
                    {activeWorkspace.icon}
                </div>
                <div className="workspace-switcher__info">
                    <span className="workspace-switcher__label">{activeWorkspace.name}</span>
                    <span className="workspace-switcher__role">{activeWorkspace.role || 'viewer'}</span>
                </div>
                <ChevronDown size={14} className={`workspace-switcher__chevron ${isOpen ? 'workspace-switcher__chevron--open' : ''}`} />
            </button>

            {isOpen && (
                <div className="workspace-switcher__menu">
                    {workspaces.map(ws => (
                        <button 
                            key={ws.id}
                            className={`workspace-switcher__item ${ws.id === activeWorkspace.id ? 'workspace-switcher__item--active' : ''}`}
                            onClick={() => handleSelect(ws)}
                        >
                            <span className="workspace-switcher__item-icon">{ws.icon}</span>
                            <div className="workspace-switcher__item-content">
                                <span className="workspace-switcher__item-name">{ws.name}</span>
                                <span className="workspace-switcher__item-role">{ws.role || 'viewer'}</span>
                            </div>
                        </button>
                    ))}
                    <div className="workspace-switcher__divider" />
                    <button className="workspace-switcher__item workspace-switcher__item--action">
                        <Plus size={14} /> Nou Workspace
                    </button>
                </div>
            )}
            
            <style>{`
                .workspace-switcher {
                    position: relative;
                    padding: 4px;
                    margin-bottom: 20px;
                }
                .workspace-switcher__trigger {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1.5px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    color: #fff;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .workspace-switcher__trigger:hover {
                    background: rgba(255, 255, 255, 0.08);
                    border-color: rgba(255, 255, 255, 0.2);
                }
                .workspace-switcher__icon {
                    width: 24px;
                    height: 24px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .workspace-switcher__info {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    overflow: hidden;
                }
                .workspace-switcher__label {
                    width: 100%;
                    text-align: left;
                    font-size: 13px;
                    font-weight: 600;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    line-height: 1.2;
                }
                .workspace-switcher__role {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: rgba(255, 255, 255, 0.4);
                    font-weight: 700;
                }
                .workspace-switcher__item-content {
                    display: flex;
                    flex-direction: column;
                }
                .workspace-switcher__item-name {
                    font-size: 13px;
                    font-weight: 500;
                }
                .workspace-switcher__item-role {
                    font-size: 9px;
                    text-transform: uppercase;
                    color: rgba(255, 255, 255, 0.3);
                    font-weight: 600;
                }
                .workspace-switcher__menu {
                    position: absolute;
                    top: 100%;
                    left: 4px;
                    right: 4px;
                    margin-top: 4px;
                    background: #1a1a1a;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    z-index: 100;
                    overflow: hidden;
                    padding: 4px;
                }
                .workspace-switcher__item {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 12px;
                    background: transparent;
                    border: none;
                    border-radius: 6px;
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 13px;
                    cursor: pointer;
                    text-align: left;
                }
                .workspace-switcher__item:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: #fff;
                }
                .workspace-switcher__item--active {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                    font-weight: 600;
                }
                .workspace-switcher__divider {
                    height: 1px;
                    background: rgba(255, 255, 255, 0.1);
                    margin: 4px 0;
                }
                .workspace-switcher__item--action {
                    color: #8b5cf6;
                    font-weight: 500;
                }
                .workspace-switcher__chevron {
                    transition: transform 0.2s ease;
                }
                .workspace-switcher__chevron--open {
                    transform: rotate(180deg);
                }
            `}</style>
        </div>
    );
}
