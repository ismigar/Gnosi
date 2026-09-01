
import type {DashboardState} from './useDashboard';

export function MembersPanel({state}: {state: DashboardState}) {
const {members, membersLoading, setIsAddMemberModalOpen, setIsPermissionsModalOpen, setSelectedMember, handleDeleteMember, t, isAdmin, selectedControlTab, gnosiMode} = state;
return <>{selectedControlTab === 'admin' && isAdmin && gnosiMode === 'org' && (
                    <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">{t('dashboard.workspace_members')}</h3>
                                <p className="text-[var(--text-secondary)] text-sm">{t('dashboard.manage_access_desc')}</p>
                            </div>
                            <button
                                onClick={() => { setIsAddMemberModalOpen(true); }}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors font-medium shadow-lg shadow-blue-900/20"
                            >
                                <i className="pi pi-user-plus text-sm"></i>
                                {t('dashboard.add_member')}
                            </button>
                        </div>

                        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden shadow-2xl">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.user')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.email')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.join_date')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.current_role')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">{t('dashboard.actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border-primary)]">
                                    {membersLoading ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                                <i className="pi pi-spin pi-spinner text-2xl mb-4 block"></i>
                                                {t('dashboard.loading_members')}
                                            </td>
                                        </tr>
                                    ) : members.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-12 text-center text-gray-500 italic">{t('dashboard.no_members')}</td>
                                        </tr>
                                    ) : members.map(m => (
                                        <tr key={m.user_id} className="hover:bg-[var(--bg-tertiary)] transition-colors group">
                                            <td className="px-6 py-4 flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs ring-1 ring-blue-500/30">
                                                    {m.name?.[0]?.toUpperCase() || 'U'}
                                                </div>
                                                <span className="text-[var(--text-primary)] font-medium">{m.name || t('dashboard.unnamed_user')}</span>
                                            </td>
                                            <td className="px-6 py-4 text-gray-300 text-sm font-mono">{m.email}</td>
                                            <td className="px-6 py-4 text-gray-400 text-sm">
                                                {new Date(m.joined_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border ${
                                                    m.role === 'owner' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                                    m.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                    m.role === 'editor' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                                    'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                                }`}>
                                                    {m.role}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-3">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedMember(m);
                                                            setIsPermissionsModalOpen(true);
                                                        }}
                                                        className="px-3 py-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-all text-xs font-bold flex items-center gap-2 border border-blue-500/20"
                                                    >
                                                        <i className="pi pi-cog"></i>
                                                        {t('dashboard.manage')}
                                                    </button>
                                                    {m.role !== 'owner' && (
                                                        <button
                                                            onClick={() => { handleDeleteMember(m.user_id); }}
                                                            className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                                            title={t('dashboard.delete_member')}
                                                        >
                                                            <i className="pi pi-trash"></i>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}</>;
}
