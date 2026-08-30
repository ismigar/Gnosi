import { IconRenderer } from '../../IconRenderer';
import { LayoutPanelLeft } from 'lucide-react';
import { Plus } from 'lucide-react';
import { Smile } from 'lucide-react';
import { X } from 'lucide-react';
import { normalizeVaultAssetUrl } from '../media';
import type { PageEditorController } from './usePageEditorController';
export function PageHero({ context }: { context: PageEditorController }) {
  const { metadata, setIsHeaderHovered, headerHoverRef, t, isHeaderHovered, setIsIconPickerOpen, coverTriggerRef, setIsCoverPickerOpen, handleMetaChange, iconTriggerRef } = context;
  return (<div
    className={`vault-page-hero relative w-full group/cover ${metadata.cover ? 'vault-page-hero--covered' : 'vault-page-hero--bare'}`}
    onMouseEnter={() => { setIsHeaderHovered(true); }}
    onMouseLeave={() => { setIsHeaderHovered(false); }}
    ref={headerHoverRef}
  >
    <div className="vault-page-cover w-full overflow-hidden transition-all duration-300 bg-[var(--bg-secondary)]/30">
      {metadata.cover && (
        <img
          src={normalizeVaultAssetUrl(metadata.cover)}
          alt={t('editor.cover_alt', "Cover")}
          className="w-full h-full object-cover animate-in fade-in duration-500"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}

      <div className={`vault-page-cover-actions absolute right-8 flex items-center gap-2 transition-opacity duration-200 ${!metadata.cover || isHeaderHovered ? 'opacity-100' : 'opacity-0'}`}>
        {!metadata.icon && (
          <button
            onClick={() => { setIsIconPickerOpen(true); }}
            className="vault-page-cover-action flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-xs font-semibold text-[var(--text-secondary)] transition-all"
            aria-label={t('editor.add_icon')}
          >
            <Smile size={14} />
            {t('editor.add_icon')}
          </button>
        )}
        <button
          ref={coverTriggerRef}
          onClick={() => { setIsCoverPickerOpen(true); }}
          className="vault-page-cover-action flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-xs font-semibold text-[var(--text-secondary)] transition-all"
          aria-label={metadata.cover ? t('editor.change_cover') : t('editor.add_cover')}
        >
          <LayoutPanelLeft size={14} />
          {metadata.cover ? t('editor.change_cover') : t('editor.add_cover')}
        </button>
        {metadata.cover && (
          <button
            onClick={() => { handleMetaChange('cover', ''); }}
            className="vault-page-cover-action p-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-[var(--text-tertiary)] transition-all"
            title={t('editor.remove_cover')}
            aria-label={t('editor.remove_cover')}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>

    <div className={`vault-page-icon absolute left-12 group/icon z-10 ${metadata.cover ? '-bottom-10' : '-bottom-8'}`}>
      <div
        ref={iconTriggerRef}
        onClick={() => { setIsIconPickerOpen(true); }}
        className={`relative flex items-center justify-center bg-[var(--bg-primary)] border-4 border-[var(--bg-primary)] shadow-sm cursor-pointer hover:bg-[var(--bg-secondary)] transition-all group-hover/icon:scale-105 active:scale-95 ${metadata.cover ? 'h-24 w-24 rounded-3xl' : 'h-20 w-20 rounded-2xl'} ${metadata.icon ? '' : 'opacity-0 group-hover/cover:opacity-100 group-focus-within/cover:opacity-100'}`}
      >
        {metadata.icon ? (
          <IconRenderer icon={metadata.icon} size={metadata.cover ? 64 : 52} />
        ) : (
          <div className="flex flex-col items-center gap-1 text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)]">
            <Plus size={24} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{t('common.icon')}</span>
          </div>
        )}

        {metadata.icon && (
          <button
            onClick={(e) => { e.stopPropagation(); handleMetaChange('icon', ''); }}
            className="vault-page-icon-remove absolute -top-2 -right-2 p-0 text-[var(--text-tertiary)] hover:text-[var(--status-error)] opacity-0 group-hover/icon:opacity-100 transition-opacity"
            title={t('editor.remove_icon')}
            aria-label={t('editor.remove_icon')}
          >
            <span className="vault-page-icon-remove-glyph flex h-6 w-6 items-center justify-center bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-full shadow-md">
              <X size={12} />
            </span>
          </button>
        )}
      </div>
    </div>
  </div>);
}
