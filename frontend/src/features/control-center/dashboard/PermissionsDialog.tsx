import {Users, X, Bug, FileText, Layers, Database, Check} from 'lucide-react';
import {ROLE_CAPABILITIES} from './model';
import type {DashboardState} from './useDashboard';

export function PermissionsDialog({state}: {state: DashboardState}) {
const {isPermissionsModalOpen, setIsPermissionsModalOpen, selectedMember, setSelectedMember, allVaults, memberVaultAccess, vaultAccessLoading, handleUpdatePermissions, toggleVaultAccess, t} = state;
return <>{isPermissionsModalOpen && selectedMember && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="w-full max-w-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-[var(--text-primary)]">{t('dashboard.configure_permissions')}: {selectedMember.name || selectedMember.email}</h3>
                            <button onClick={() => { setIsPermissionsModalOpen(false); }} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">{t('dashboard.member_role')}</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        { id: 'viewer', label: t('dashboard.role_viewer'), desc: t('dashboard.role_viewer_desc') },
                                        { id: 'editor', label: t('dashboard.role_editor'), desc: t('dashboard.role_editor_desc') },
                                        { id: 'admin', label: t('dashboard.role_admin'), desc: t('dashboard.role_admin_desc') },
                                        { id: 'owner', label: t('dashboard.role_owner'), desc: t('dashboard.role_owner_desc') }
                                    ].map(role => (
                                        <button
                                            key={role.id}
                                            onClick={() => {
                                                const newCaps = ROLE_CAPABILITIES[role.id] || [];
                                                setSelectedMember({
                                                    ...selectedMember,
                                                    role: role.id,
                                                    permissions: {
                                                        ...selectedMember.permissions,
                                                        capabilities: newCaps
                                                    }
                                                });
                                            }}
                                            className={`p-3 rounded-xl border text-left transition-all ${
                                                selectedMember.role === role.id
                                                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                                                    : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-blue-500/20'
                                            }`}
                                        >
                                            <div className="font-bold text-sm uppercase">{role.label}</div>
                                            <div className="text-[10px] opacity-70">{role.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">{t('dashboard.system_capabilities')}</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    {[
                                        { id: 'read', label: t('dashboard.cap_read'), icon: <FileText size={16} /> },
                                        { id: 'write', label: t('dashboard.cap_write'), icon: <FileText size={16} /> },
                                        { id: 'delete', label: t('dashboard.cap_delete'), icon: <Bug size={16} /> },
                                        { id: 'admin', label: t('dashboard.cap_admin'), icon: <Users size={16} /> },
                                        { id: 'analytics', label: t('dashboard.cap_analytics'), icon: <Database size={16} /> },
                                        { id: 'tools', label: t('dashboard.cap_tools'), icon: <Layers size={16} /> }
                                    ].map(cap => {
                                        const hasCap = selectedMember.permissions?.capabilities?.includes(cap.id);
                                        return (
                                            <button
                                                key={cap.id}
                                                onClick={() => {
                                                    const currentCaps = selectedMember.permissions?.capabilities || [];
                                                    const newCaps = hasCap
                                                        ? currentCaps.filter(c => c !== cap.id)
                                                        : [...currentCaps, cap.id];

                                                    const newMember = {
                                                        ...selectedMember,
                                                        permissions: { ...selectedMember.permissions, capabilities: newCaps }
                                                    };
                                                    setSelectedMember(newMember);
                                                }}
                                                className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                                                    hasCap
                                                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                                                        : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-blue-500/20'
                                                }`}
                                            >
                                                {cap.icon}
                                                <span className="text-sm font-medium">{cap.label}</span>
                                                {hasCap && <Check size={14} className="ml-auto" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('dashboard.specific_data_access')}</h4>
                                <p className="text-xs text-[var(--text-secondary)] mb-4 italic">{t('dashboard.limit_access_desc')}</p>

                                {vaultAccessLoading ? (
                                    <div className="text-[var(--text-secondary)] text-xs animate-pulse">{t('dashboard.loading_access')}</div>
                                ) : allVaults.length === 0 ? (
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.no_vaults')}</p>
                                ) : (
                                    <div className="space-y-2">
                                        {allVaults.map(v => {
                                            const hasAccess = memberVaultAccess.some(acc => acc.vault_id === v.id);
                                            return (
                                                <div key={v.id} className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-xl hover:border-[var(--border-primary)] transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <Layers size={16} className="text-blue-400/50" />
                                                        <span className="text-sm font-medium text-[var(--text-primary)]">{v.name}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => { void toggleVaultAccess(selectedMember.user_id, v.id); }}
                                                        className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                                                            hasAccess
                                                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]'
                                                        }`}
                                                    >
                                                        {hasAccess ? t('dashboard.with_access') : t('dashboard.without_access')}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 mt-8">
                                <button
                                    onClick={() => { setIsPermissionsModalOpen(false); }}
                                    className="px-4 py-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-xl transition-all font-medium flex-1"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={() => { void handleUpdatePermissions(selectedMember.user_id, selectedMember.permissions, selectedMember.role); }}
                                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all font-medium flex-1 shadow-lg shadow-blue-900/20"
                                >
                                    {t('common.save_changes')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}</>;
}
