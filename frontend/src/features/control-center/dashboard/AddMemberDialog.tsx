
import type {DashboardState} from './useDashboard';

export function AddMemberDialog({state}: {state: DashboardState}) {
const {isAddMemberModalOpen, setIsAddMemberModalOpen, newMemberEmail, setNewMemberEmail, newMemberRole, setNewMemberRole, handleAddMember, t} = state;
return <>{isAddMemberModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl p-6 zoom-in animate-in duration-300">
                        <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">{t('dashboard.add_new_member')}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('dashboard.user_email')}</label>
                                <input
                                    type="email"
                                    value={newMemberEmail}
                                    onChange={(e) => { setNewMemberEmail(e.target.value); }}
                                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                                    placeholder={t('dashboard.email_placeholder')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('dashboard.initial_role')}</label>
                                <select
                                    value={newMemberRole}
                                    onChange={(e) => { setNewMemberRole(e.target.value); }}
                                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                                >
                                    <option value="viewer">{t('dashboard.role_viewer_full')}</option>
                                    <option value="editor">{t('dashboard.role_editor_full')}</option>
                                    <option value="admin">{t('dashboard.role_admin_full')}</option>
                                </select>
                            </div>
                            <div className="flex gap-3 mt-8">
                                <button
                                    onClick={() => { setIsAddMemberModalOpen(false); }}
                                    className="flex-1 px-4 py-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-xl transition-all font-medium"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={() => { void handleAddMember(); }}
                                    className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all font-medium shadow-lg shadow-blue-900/20"
                                >
                                    {t('dashboard.send_invitation')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}</>;
}
