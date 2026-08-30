import {X, ShieldCheck, ShieldAlert, Edit2, Trash2} from 'lucide-react';
import type {DashboardState} from './useDashboard';

export function ToolsDialog({state}: {state: DashboardState}) {
const {approvedTools, pendingTools, analytics, isToolsModalOpen, setIsToolsModalOpen, handleEditDirective, handleDeleteDirective, t, aiEnabled} = state;
return <>{aiEnabled && isToolsModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-green-500/10 text-green-400 flex items-center justify-center">
                                    <ShieldCheck size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.intelligence_details', "Intelligence Details")}</h3>
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.tools_and_capabilities', "Tools and Capabilities")}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setIsToolsModalOpen(false); }}
                                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                <div className="bg-green-500/5 border border-green-500/20 p-4 rounded-2xl text-center">
                                    <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold tracking-widest block mb-1">{t('dashboard.approved')}</span>
                                    <span className="text-3xl font-black text-green-400">{Math.max(analytics?.tools.approved || 0, approvedTools.length)}</span>
                                </div>
                                <div className="bg-yellow-500/5 border border-yellow-500/20 p-4 rounded-2xl text-center">
                                    <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold tracking-widest block mb-1">{t('dashboard.pending')}</span>
                                    <span className="text-3xl font-black text-yellow-400">{Math.max(analytics?.tools.pending || 0, pendingTools.length)}</span>
                                </div>
                                <div className="bg-blue-500/5 border border-blue-500/20 p-4 rounded-2xl text-center">
                                    <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold tracking-widest block mb-1">{t('dashboard.last_7_days')}</span>
                                    <span className="text-3xl font-black text-blue-400">
                                        {Math.max(analytics?.tools.created_last_7_days || 0, approvedTools.filter(t => {
                                            const d = new Date(t.approved_at || t.created_at || NaN);
                                            const weekAgo = new Date();
                                            weekAgo.setDate(weekAgo.getDate() - 7);
                                            return d >= weekAgo;
                                        }).length)}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <ShieldAlert size={14} className="text-yellow-500" />
                                        {t('dashboard.pending_approval')}
                                    </h4>
                                    <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                                        {pendingTools.length === 0 ? (
                                            <p className="text-xs text-[var(--text-secondary)] italic py-4">{t('dashboard.no_pending_tools')}</p>
                                        ) : (
                                            pendingTools.map(tool => (
                                                <div key={tool.name} className="p-3 rounded-xl border border-yellow-500/10 bg-[var(--bg-tertiary)]/50">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-sm font-bold text-yellow-400 font-gnosi">{tool.name}</span>
                                                        <span className="text-[8px] bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">{t('dashboard.status_pending')}</span>
                                                    </div>
                                                    <p className="text-[10px] text-[var(--text-secondary)] line-clamp-1 italic">{tool.description}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <ShieldCheck size={14} className="text-green-500" />
                                        {t('dashboard.recent_approved', "Recently Approved")}
                                    </h4>
                                    <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                                        {approvedTools.length === 0 ? (
                                            <p className="text-xs text-[var(--text-secondary)] italic py-4">{t('dashboard.no_approved_tools')}</p>
                                        ) : (
                                            approvedTools.slice(0, 10).map(tool => (
                                                <div key={tool.name} className="p-3 rounded-xl border border-blue-500/10 bg-[var(--bg-tertiary)]/50 hover:border-blue-500/30 transition-all flex items-center justify-between group">
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-sm font-bold text-blue-300 font-gnosi">{tool.name}</span>
                                                            <span className="text-[8px] italic text-[var(--text-secondary)]">{tool.approved_at ? new Date(tool.approved_at).toLocaleDateString() : t('dashboard.recent')}</span>
                                                        </div>
                                                        <p className="text-[10px] text-[var(--text-secondary)] line-clamp-1">{tool.description}</p>
                                                    </div>
                                                    {tool.path && (
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => { void handleEditDirective(tool); }}
                                                                className="p-2 hover:bg-blue-500/10 text-blue-400 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                                title={t('dashboard.edit_skill')}
                                                            >
                                                                <Edit2 size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => { handleDeleteDirective(tool); }}
                                                                className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                                title={t('dashboard.delete_skill')}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}</>;
}
