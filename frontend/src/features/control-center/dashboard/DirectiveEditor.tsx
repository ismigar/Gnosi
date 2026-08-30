import {RefreshCw, Save, X, Edit2} from 'lucide-react';
import type {DashboardState} from './useDashboard';

export function DirectiveEditor({state}: {state: DashboardState}) {
const {editingDirective, setEditingDirective, isEditorSaving, editorContent, setEditorContent, handleSaveDirective, t} = state;
return <>{editingDirective && (
                <div className="fixed inset-0 z-[var(--z-modal-dropdown)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in zoom-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-4xl h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                                    <Edit2 size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.editing')}: {editingDirective.name}</h3>
                                    <p className="text-xs text-[var(--text-secondary)] font-mono opacity-60">{editingDirective.path}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { void handleSaveDirective(); }}
                                    disabled={isEditorSaving}
                                    className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl transition-all shadow-lg active:scale-95 text-sm font-bold"
                                >
                                    {isEditorSaving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                                    {t('common.save_changes')}
                                </button>
                                <button
                                    onClick={() => { setEditingDirective(null); }}
                                    className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden bg-[var(--bg-primary)]">
                            <textarea
                                value={editorContent}
                                onChange={(e) => { setEditorContent(e.target.value); }}
                                className="flex-1 w-full bg-[var(--bg-secondary)] text-[var(--text-primary)] font-mono text-sm p-6 rounded-2xl border border-[var(--border-primary)] focus:border-cyan-500/50 outline-none resize-none shadow-inner"
                                placeholder={t('dashboard.directive_placeholder')}
                                spellCheck="false"
                            />

                            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] px-2">
                                <p>{t('dashboard.directive_tip')}</p>
                                <p>{t('dashboard.chars_lines', { chars: editorContent.length, lines: editorContent.split('\n').length })}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}</>;
}
