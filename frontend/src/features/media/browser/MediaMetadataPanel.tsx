import {ExternalLink, MapPin, Calendar, Tag, FileText, X, FolderOpen, Check, Loader2, AlertCircle} from 'lucide-react';
import toast from '../../../shared/notifications/toast';
import type {MediaCenterState} from './useMediaCenter';
export function MediaMetadataPanel({state}: {state: MediaCenterState}) {
const {selectedPhoto, editingMetadata, setEditingMetadata, saveStatus, slideshowActive, isFullscreen, t} = state;
if (!selectedPhoto) return null;
return <>{!isFullscreen && !slideshowActive && (
                <aside className="w-80 bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col h-full border-l border-white/10 shrink-0">
                  <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2.5 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                        <p className="text-[9px] text-[var(--text-tertiary)] uppercase font-bold mb-1">{t('media.date_taken')}</p>
                        <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <Calendar size={12} className="text-blue-500" />
                          {selectedPhoto.date_taken ? new Date(selectedPhoto.date_taken).toLocaleDateString() : 'N/A'}
                        </p>
                      </div>
                      <div className="p-2.5 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                        <p className="text-[9px] text-[var(--text-tertiary)] uppercase font-bold mb-1">{t('media.album')}</p>
                        <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <FolderOpen size={12} className="text-orange-500" />
                          <span className="truncate">{selectedPhoto.album}</span>
                        </p>
                      </div>
                    </div>

                    {selectedPhoto.lat != null && selectedPhoto.lng != null && (
                      <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                        <p className="text-[9px] text-emerald-600 uppercase font-bold mb-1.5">{t('media.location')}</p>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <MapPin size={14} className="text-emerald-500 shrink-0" />
                            <span className="text-[11px] text-[var(--text-secondary)] truncate">{selectedPhoto.lat.toFixed(4)}, {selectedPhoto.lng.toFixed(4)}</span>
                          </div>
                          <a
                            href={`https://www.google.com/maps?q=${String(selectedPhoto.lat)},${String(selectedPhoto.lng)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 bg-white border border-emerald-200 text-emerald-600 rounded text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-50 shrink-0"
                          >
                            <ExternalLink size={10} /> Maps
                          </a>
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">{t('media.tags')}</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {editingMetadata.tags.map(tag => (
                            <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] text-[10px] font-bold rounded-full">
                              {tag}
                              <button onClick={() => { setEditingMetadata({...editingMetadata, tags: editingMetadata.tags.filter(t => t !== tag)}); }}>
                                <X size={10} className="hover:text-red-500" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="relative">
                          <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={12} />
                          <input
                            type="text"
                            placeholder={t('media.add_tag_placeholder')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && e.currentTarget.value) {
                                if (!editingMetadata.tags.includes(e.currentTarget.value)) {
                                  setEditingMetadata({...editingMetadata, tags: [...editingMetadata.tags, e.currentTarget.value]});
                                }
                                e.currentTarget.value = '';
                              }
                            }}
                            className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-xs focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">{t('media.description')}</label>
                        <textarea
                          value={editingMetadata.description}
                          onChange={(e) => { setEditingMetadata({...editingMetadata, description: e.currentTarget.value}); }}
                          placeholder={t('media.description_placeholder')}
                          className="w-full p-3 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-xs min-h-[100px] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none resize-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] flex items-center gap-3">
                    <button
                      className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[var(--border-primary)] text-[var(--text-primary)] rounded-lg text-[11px] font-bold hover:bg-[var(--bg-primary)] transition-all shadow-sm"
                      onClick={() => toast.success(t('media.create_note_soon'))}
                    >
                      <FileText size={14} className="text-purple-500" />
                      {t('media.create_note')}
                    </button>
                    <div className="flex-1 text-right text-[10px] font-medium" aria-live="polite">
                      {saveStatus === 'saving' && (
                        <span className="text-[var(--text-tertiary)] inline-flex items-center gap-1.5">
                          <Loader2 size={12} className="animate-spin" /> {t('media.saving')}
                        </span>
                      )}
                      {saveStatus === 'saved' && (
                        <span className="text-emerald-600 inline-flex items-center gap-1.5">
                          <Check size={12} /> {t('media.saved')}
                        </span>
                      )}
                      {saveStatus === 'error' && (
                        <span className="text-red-500 inline-flex items-center gap-1.5">
                          <AlertCircle size={12} /> {t('media.save_error')}
                        </span>
                      )}
                      {saveStatus === 'idle' && (
                        <span className="text-[var(--text-tertiary)]">{t('media.autosave')}</span>
                      )}
                    </div>
                  </div>
                </aside>
              )}</>;
}
