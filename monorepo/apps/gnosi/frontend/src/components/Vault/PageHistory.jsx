import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { History, RotateCcw, X, Loader2, FileText, Clock, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { ConfirmModal } from '../ConfirmModal';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

const PageHistory = ({ pageId, open, onClose, onRestore }) => {
  const { t } = useTranslation();
  const panelRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewContent, setPreviewContent] = useState(null);
  const [previewVersion, setPreviewVersion] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [isPurgeOpen, setIsPurgeOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [comparisonContent, setComparisonContent] = useState(null);

  const diffSummary = (left, right) => {
    const before = new Set(String(left || '').split('\n').filter(Boolean));
    const after = new Set(String(right || '').split('\n').filter(Boolean));
    return {
      added: [...after].filter((line) => !before.has(line)).length,
      removed: [...before].filter((line) => !after.has(line)).length,
    };
  };
  const diffLines = (left, right) => {
    const before = String(left || '').split('\n');
    const after = String(right || '').split('\n');
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return [
      ...before.filter((line) => line && !afterSet.has(line)).map((line) => ({ line, kind: 'removed' })),
      ...after.map((line) => ({ line, kind: line && !beforeSet.has(line) ? 'added' : 'unchanged' })),
    ];
  };

  useEffect(() => {
    if (open && pageId) {
      fetchHistory();
    }
  }, [open, pageId]);

  // Esc + focus-trap centralized in the canonical hook. No onConfirm: the
  // restore/purge is handled via clicks and internal ConfirmModals. When one
  // of these ConfirmModals is open, Esc must close only it (which has
  // its own hook), not this parent modal.
  useModalKeyboard({
    isOpen: open,
    onClose,
    containerRef: panelRef,
    trapFocus: true,
    closeOnEscape: !isRestoreOpen && !isPurgeOpen,
  });

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/vault/pages/${pageId}/history`);
      setHistory(response.data);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async (version) => {
    setPreviewLoading(true);
    setPreviewVersion(version);
    try {
      const response = await axios.get(`/api/vault/pages/${pageId}/history/${version.id}`);
      setPreviewContent(response.data.content);
      const index = history.findIndex((item) => item.id === version.id);
      const older = history[index + 1];
      if (older) {
        const olderResponse = await axios.get(`/api/vault/pages/${pageId}/history/${older.id}`);
        setComparisonContent(olderResponse.data.content);
      } else {
        setComparisonContent(null);
      }
    } catch (error) {
      console.error('Error fetching version content:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRestore = (version) => {
    setRestoreTarget(version);
    setIsRestoreOpen(true);
  };

  const executeRestore = async () => {
    if (!restoreTarget) return;
    try {
      await axios.post(`/api/vault/pages/${pageId}/history/restore/${restoreTarget.id}`);
      onRestore();
      onClose();
    } catch (error) {
      console.error('Error restoring version:', error);
      toast.error(t('vault.history.error_restore'));
    } finally {
      setIsRestoreOpen(false);
    }
  };

  const handlePurge = () => {
    setIsPurgeOpen(true);
  };

  const executePurge = async () => {
    try {
      await axios.delete(`/api/vault/pages/${pageId}/history`);
      setHistory([]);
      setPreviewContent(null);
      setPreviewVersion(null);
      toast.success(t('vault.history.purge_success', "History purged successfully"));
    } catch (error) {
      console.error('Error purging history:', error);
      toast.error(t('vault.history.error_purge'));
    } finally {
      setIsPurgeOpen(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={panelRef} className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--gnosi-primary)]/10 rounded-lg text-[var(--gnosi-primary)]">
              <History size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{t('vault.history.title')}</h3>
              <p className="text-xs text-[var(--text-tertiary)]">{t('vault.history.desc')}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="gnosi-close-btn"
            aria-label={t('vault.history.close', "Close history")}
          >
            <X />
          </button>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Versions List */}
          <div className="w-1/3 border-r border-[var(--border-primary)] flex flex-col bg-[var(--bg-secondary)]/50">
            <div className="p-4 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('vault.history.available_versions')}</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="flex flex-col items-center justify-center p-12 text-[var(--text-tertiary)]">
                  <Loader2 size={32} className="animate-spin mb-4" />
                  <p className="text-sm">{t('vault.history.loading')}</p>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <Clock size={40} className="text-[var(--bg-tertiary)] mb-4" strokeWidth={1} />
                  <p className="text-sm text-[var(--text-tertiary)]">{t('vault.history.empty')}</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-primary)]">
                  {history.map((version) => (
                    // WARNING: do NOT turn the wrapper into a <button>: we would have
                    // <button> inside <button> (invalid HTML → React hydration
                    // warning + erratic click bubbling). We use <div role="button"
                    // tabIndex=0> + keyboard handler for accessibility.
                    <div
                      key={version.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handlePreview(version)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handlePreview(version);
                        }
                      }}
                      className={`w-full px-5 py-4 text-left flex items-center justify-between group transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--gnosi-primary)]/40 ${
                        previewVersion?.id === version.id
                          ? 'bg-[var(--bg-primary)] border-l-4 border-l-[var(--gnosi-primary)]'
                          : 'hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${previewVersion?.id === version.id ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>
                          {version.timestamp}
                        </p>
                        <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 font-medium transition-colors">
                          {(version.size / 1024).toFixed(1)} KB • {version.author || 'Sistema'}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestore(version);
                        }}
                        className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] rounded-md transition-all shadow-sm bg-[var(--bg-primary)]"
                        title={t('vault.history.restore_tooltip')}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Preview Panel */}
          <div className="flex-1 flex flex-col bg-[var(--bg-primary)] relative">
            {previewLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-primary)]/80 z-10">
                <Loader2 size={40} className="animate-spin text-[var(--gnosi-primary)] mb-4" />
                <p className="text-sm text-[var(--text-secondary)] font-medium">{t('vault.history.preview_loading')}</p>
              </div>
            ) : previewContent ? (
              <div className="flex flex-col h-full">
                <div className="px-6 py-3 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]/30">
                  <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                    <FileText size={14} className="text-[var(--text-tertiary)]" />
                    <span>{t('vault.history.version_at', { timestamp: previewVersion.timestamp })}</span>
                  </div>
                  <button
                    onClick={() => handleRestore(previewVersion)}
                    className="btn-gnosi btn-gnosi-primary !py-1.5 !px-3 !text-xs"
                  >
                    <RotateCcw size={12} />
                    {t('vault.history.restore_now')}
                  </button>
                </div>
                {comparisonContent !== null && (() => {
                  const diff = diffSummary(comparisonContent, previewContent);
                  return <div className="px-6 py-2 border-b border-[var(--border-primary)] text-xs text-[var(--text-secondary)] bg-[var(--gnosi-primary)]/5">{t('vault.history.visual_diff', { added: diff.added, removed: diff.removed, defaultValue: '{{added}} lines added · {{removed}} lines removed versus the previous version' })}</div>;
                })()}
                <div className="flex-1 p-8 overflow-y-auto custom-scrollbar bg-[var(--bg-primary)]">
                  <div className="max-w-3xl mx-auto">
                    <pre className="text-sm font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed selection:bg-[var(--gnosi-primary)]/20">
                      {comparisonContent === null ? previewContent : diffLines(comparisonContent, previewContent).map(({ line, kind }, index) => <span key={`${kind}-${index}`} className={`vault-history-diff-line vault-history-diff-line--${kind}`}>{kind === 'added' ? '+ ' : kind === 'removed' ? '− ' : '  '}{line}{'\n'}</span>)}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-16 h-16 bg-[var(--bg-tertiary)] rounded-full flex items-center justify-center mb-6">
                  <FileText size={32} className="text-[var(--text-tertiary)]" strokeWidth={1} />
                </div>
                <h4 className="text-base font-bold text-[var(--text-primary)] mb-2">{t('vault.history.no_selection_title')}</h4>
                <p className="text-sm text-[var(--text-tertiary)] max-w-xs">{t('vault.history.no_selection_desc')}</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-between items-center gap-3">
          <div>
            {history.length > 0 && (
              <button 
                onClick={handlePurge}
                className="btn-gnosi btn-gnosi-danger"
              >
                <Trash2 size={16} />
                {t('vault.history.purge_btn')}
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-xl transition-all border border-[var(--border-primary)]"
            >
              {t('common.cancel')}
            </button>
            {previewVersion && (
              <button 
                onClick={() => handleRestore(previewVersion)}
                className="btn-gnosi btn-gnosi-primary"
              >
                <RotateCcw size={16} />
                {t('vault.history.restore_selected_btn')}
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal 
        isOpen={isRestoreOpen}
        onClose={() => setIsRestoreOpen(false)}
        onConfirm={executeRestore}
        title={t('vault.history.confirm_restore_title', "Restore version")}
        message={t('vault.history.confirm_restore', { timestamp: restoreTarget?.timestamp })}
        confirmText={t('common.restore', "Restore")}
        isDestructive={false}
      />

      <ConfirmModal 
        isOpen={isPurgeOpen}
        onClose={() => setIsPurgeOpen(false)}
        onConfirm={executePurge}
        title={t('vault.history.confirm_purge_title', "Purge history")}
        message={t('vault.history.confirm_purge')}
        confirmText={t('common.purge', "Purge")}
        isDestructive={true}
      />
    </div>
  );
};

export default PageHistory;
