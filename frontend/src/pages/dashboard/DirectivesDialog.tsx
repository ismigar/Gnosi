import {RefreshCw, Shield, X, FileText, Edit2, Trash2} from 'lucide-react';
import {DashboardPaginationControls} from '../../components/DashboardPaginationControls';
import type {DashboardState} from './useDashboard';

export function DirectivesDialog({state}: {state: DashboardState}) {
const {directives, directivesTotal, directivesPage, DIRECTIVES_LIMIT, isDirectivesModalOpen, setIsDirectivesModalOpen, isDirectivesLoading, fetchDirectives, handleEditDirective, handleDeleteDirective, t} = state;
return <>{isDirectivesModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                                    <FileText size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.directives_modal', "System Directives")}</h3>
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.directives_desc', "Active SOPs and lessons learned by the system.")}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setIsDirectivesModalOpen(false); }}
                                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {isDirectivesLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <RefreshCw className="animate-spin text-blue-500" size={32} />
                                    <p className="text-[var(--text-secondary)] font-medium">{t('dashboard.loading_details')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 gap-3">
                                        {directives.map((d, i) => (
                                            <div key={i} className="p-4 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-2xl flex items-center justify-between hover:border-cyan-500/30 transition-all cursor-default group">
                                                <div className="flex items-center gap-4">
                                                    <div className="text-cyan-500/50 group-hover:text-cyan-400 transition-colors">
                                                        <Shield size={24} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide block">{d.name.replace(/_/g, ' ')}</span>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-[var(--text-secondary)] font-mono">{(d.size_bytes / 1024).toFixed(1)} KB</span>
                                                            <span className="text-[10px] text-cyan-500/60 font-medium px-1.5 py-0.5 bg-cyan-500/5 rounded uppercase">{d.category}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-1 rounded-md">
                                                        {d.trap_count} {t('dashboard.traps', "pitfalls")}
                                                    </span>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => { void handleEditDirective(d); }}
                                                            className="p-1.5 hover:bg-cyan-500/10 text-cyan-400 rounded-lg transition-colors"
                                                            title={t('dashboard.edit_directive')}
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => { handleDeleteDirective(d); }}
                                                            className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                                                            title={t('dashboard.delete_directive')}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <DashboardPaginationControls
                                        total={directivesTotal}
                                        limit={DIRECTIVES_LIMIT}
                                        page={directivesPage}
                                        onPageChange={(page) => { void fetchDirectives(page); }}
                                        loading={isDirectivesLoading}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}</>;
}
