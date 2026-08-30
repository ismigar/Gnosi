import {RefreshCw, X, Bug, AlertTriangle} from 'lucide-react';
import {DashboardPaginationControls} from '../../../components/DashboardPaginationControls';
import type {DashboardState} from './useDashboard';

export function TrapsDialog({state}: {state: DashboardState}) {
const {traps, trapsTotal, trapsPage, TRAPS_LIMIT, isTrapsModalOpen, setIsTrapsModalOpen, isTrapsLoading, fetchTraps, t} = state;
return <>{isTrapsModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-6xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center">
                                    <Bug size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.documented_pitfalls_modal', "Documented Pitfalls")}</h3>
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.errors_prevented_desc', "Errors prevented thanks to the directives.")}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setIsTrapsModalOpen(false); }}
                                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {isTrapsLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <RefreshCw className="animate-spin text-blue-500" size={32} />
                                    <p className="text-[var(--text-secondary)] font-medium">{t('dashboard.loading_details')}</p>
                                </div>
                            ) : traps.length === 0 ? (
                                <div className="text-center py-20 text-[var(--text-secondary)]">
                                    <AlertTriangle className="mx-auto mb-4 opacity-20" size={48} />
                                    <p>{t('dashboard.no_traps')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left table-fixed">
                                            <thead>
                                                <tr className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border-primary)]">
                                                    <th className="px-4 py-3 w-32">{t('common.date', "Date")}</th>
                                                    <th className="px-4 py-3 w-40">{t('common.source', "Source")}</th>
                                                    <th className="px-4 py-3 w-1/3">{t('common.trap', "Pitfall / Error")}</th>
                                                    <th className="px-4 py-3">{t('common.solution', "Applied Solution")}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border-primary)]">
                                                {traps.map((t, i) => (
                                                    <tr key={i} className="hover:bg-[var(--bg-tertiary)] transition-all group">
                                                        <td className="px-4 py-4 text-[11px] font-mono text-[var(--text-secondary)] whitespace-nowrap">{t.date}</td>
                                                        <td className="px-4 py-4">
                                                            <div className="flex flex-col gap-1">
                                                                <span className={`text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded w-fit ${
                                                                    t.category === 'Agent' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                                    t.category === 'Skill' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                                                    'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                                }`}>
                                                                    {t.category || 'Memory'}
                                                                </span>
                                                                <span className="text-[10px] font-bold text-[var(--text-secondary)] truncate max-w-[120px]" title={t.source}>
                                                                    {t.source}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            <div className="text-sm font-semibold text-[var(--text-primary)] leading-tight break-words overflow-hidden">
                                                                {t.trap}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            <div className="text-xs text-green-500 italic leading-relaxed bg-green-500/5 p-3 rounded-xl border border-green-500/10 break-words overflow-hidden">
                                                                {t.solution}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <DashboardPaginationControls
                                        total={trapsTotal}
                                        limit={TRAPS_LIMIT}
                                        page={trapsPage}
                                        onPageChange={(page) => { void fetchTraps(page); }}
                                        loading={isTrapsLoading}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}</>;
}
