import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Trash2, X } from 'lucide-react';
import { useModalKeyboard } from '../../../../../shared/hooks/useModalKeyboard';
import { propertyDisplayText } from './propertyModel';
import type { PageEditorController } from './usePageEditorController';

export function PageFieldsManager({ context, onClose }: { context: PageEditorController; onClose: () => void }) {
  const { t, currentTable, onEditSchema, adhocProperties, metadata, handleRemoveProperty, isEditor } = context;
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [removing, setRemoving] = useState<string | null>(null);
  const close = () => { if (!removing) onClose(); };
  useModalKeyboard({ isOpen: true, onClose: close, containerRef: modalRef, trapFocus: true });
  const remove = async (key: string) => {
    setRemoving(key);
    try { await handleRemoveProperty(key); }
    finally { setRemoving(null); }
  };
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--z-confirm-modal)' }} onClick={close} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-[var(--bg-primary)]/40 backdrop-blur-sm" />
      <div ref={modalRef} onClick={event => { event.stopPropagation(); }} className="relative bg-[var(--bg-primary)] text-[var(--text-primary)] rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6 border border-[var(--border-primary)]">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 id={titleId} className="text-lg font-semibold">{t('editor.manage_fields')}</h2>
          <button type="button" className="gnosi-close-btn" onClick={close} disabled={removing !== null} aria-label={t('common.close')}><X /></button>
        </div>
        {currentTable && <section className="mb-6">
          <h3 className="font-semibold mb-2">{t('editor.table_fields')}</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-3">{t('editor.table_fields_description')}</p>
          <button type="button" className="btn btn-secondary flex items-center gap-2" disabled={!isEditor || !onEditSchema || removing !== null} onClick={() => { onClose(); onEditSchema?.(currentTable); }}>
            <Settings size={16} />{t('editor.configure_table_fields')}
          </button>
        </section>}
        <section>
          <h3 className="font-semibold mb-2">{t('editor.page_only_fields')}</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-3">{t('editor.page_only_fields_description')}</p>
          {adhocProperties.length === 0 && <p className="text-sm text-[var(--text-secondary)]">{t('editor.no_page_only_fields')}</p>}
          <ul className="space-y-2">
            {adhocProperties.map(key => <li key={key} data-local-property={key} className="flex items-start gap-3 rounded-lg border border-[var(--border-primary)] p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium break-words">{key}</div>
                <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">{propertyDisplayText(metadata[key]) || t('common.empty')}</div>
              </div>
              <button type="button" className="btn btn-secondary flex items-center gap-2 shrink-0 text-[var(--status-error)]" disabled={!isEditor || removing !== null} aria-label={`${t('editor.remove_local_property')}: ${key}`} onClick={() => { void remove(key); }}>
                <Trash2 size={16} />{t('common.delete')}
              </button>
            </li>)}
          </ul>
        </section>
      </div>
    </div>, document.body,
  );
}
