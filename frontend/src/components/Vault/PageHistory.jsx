import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { History, RotateCcw, X, Loader2, FileText, Clock, Trash2 } from 'lucide-react';

const PageHistory = ({ pageId, open, onClose, onRestore }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewContent, setPreviewContent] = useState(null);
  const [previewVersion, setPreviewVersion] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (open && pageId) {
      fetchHistory();
    }
  }, [open, pageId]);

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
    } catch (error) {
      console.error('Error fetching version content:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRestore = async (version) => {
    if (window.confirm(`Segur que vols restaurar la versió del ${version.timestamp}?`)) {
      try {
        await axios.post(`/api/vault/pages/${pageId}/history/restore/${version.id}`);
        onRestore();
        onClose();
      } catch (error) {
        console.error('Error restoring version:', error);
        alert('Error al restaurar la versió');
      }
    }
  };

  const handlePurge = async () => {
    if (window.confirm('Segur que vols eliminar tot l\'historial de versions d\'aquesta pàgina? Aquesta acció no es pot desfer.')) {
      try {
        await axios.delete(`/api/vault/pages/${pageId}/history`);
        setHistory([]);
        setPreviewContent(null);
        setPreviewVersion(null);
      } catch (error) {
        console.error('Error purging history:', error);
        alert('Error al purgar l\'historial');
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--gnosi-primary)]/10 rounded-lg text-[var(--gnosi-primary)]">
              <History size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Històric de Versions</h3>
              <p className="text-xs text-[var(--text-tertiary)]">Consulta i restaura versions anteriors d'aquesta pàgina</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-tertiary)] rounded-full text-[var(--text-tertiary)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Versions List */}
          <div className="w-1/3 border-r border-[var(--border-primary)] flex flex-col bg-[var(--bg-secondary)]/50">
            <div className="p-4 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Versions Disponibles</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="flex flex-col items-center justify-center p-12 text-[var(--text-tertiary)]">
                  <Loader2 size={32} className="animate-spin mb-4" />
                  <p className="text-sm">Carregant historial...</p>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <Clock size={40} className="text-[var(--bg-tertiary)] mb-4" strokeWidth={1} />
                  <p className="text-sm text-[var(--text-tertiary)]">No hi ha versions guardades.</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-primary)]">
                  {history.map((version) => (
                    <button
                      key={version.id}
                      onClick={() => handlePreview(version)}
                      className={`w-full px-5 py-4 text-left flex items-center justify-between group transition-all ${
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
                        title="Restaurar aquesta versió"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </button>
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
                <p className="text-sm text-[var(--text-secondary)] font-medium">Recuperant contingut...</p>
              </div>
            ) : previewContent ? (
              <div className="flex flex-col h-full">
                <div className="px-6 py-3 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]/30">
                  <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                    <FileText size={14} className="text-[var(--text-tertiary)]" />
                    <span>Versió del {previewVersion.timestamp}</span>
                  </div>
                  <button
                    onClick={() => handleRestore(previewVersion)}
                    className="btn-gnosi btn-gnosi-primary !py-1.5 !px-3 !text-xs"
                  >
                    <RotateCcw size={12} />
                    Restaurar ara
                  </button>
                </div>
                <div className="flex-1 p-8 overflow-y-auto custom-scrollbar bg-[var(--bg-primary)]">
                  <div className="max-w-3xl mx-auto">
                    <pre className="text-sm font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed selection:bg-[var(--gnosi-primary)]/20">
                      {previewContent}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-16 h-16 bg-[var(--bg-tertiary)] rounded-full flex items-center justify-center mb-6">
                  <FileText size={32} className="text-[var(--text-tertiary)]" strokeWidth={1} />
                </div>
                <h4 className="text-base font-bold text-[var(--text-primary)] mb-2">Cap versió seleccionada</h4>
                <p className="text-sm text-[var(--text-tertiary)] max-w-xs">Tria una versió de la llista de l'esquerra per veure'n la previsualització i poder restaurar-la.</p>
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
                Purgar Historial
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-xl transition-all border border-[var(--border-primary)]"
            >
              Tancar
            </button>
            {previewVersion && (
              <button 
                onClick={() => handleRestore(previewVersion)}
                className="btn-gnosi btn-gnosi-primary"
              >
                <RotateCcw size={16} />
                Restaurar versió seleccionada
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PageHistory;
