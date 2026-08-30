import { emitAppEvent } from '../../../../shared/platform/app-events';
import { CheckSquare } from 'lucide-react';
import { CollaborationPresence } from '../../CollaborationPresence';
import { Loader2 } from 'lucide-react';
import { PageActionsBar } from '../../PageActionsBar';
import { PanelBottomOpen } from 'lucide-react';
import { Sparkles } from 'lucide-react';
import { SpellCheck2 } from 'lucide-react';
import { X } from 'lucide-react';
import type { PageEditorController } from './usePageEditorController';
export function PageTitle({ context }: { context: PageEditorController }) {
  const { titleInputRef, metadata, handleTitleChange, openPropertiesNav, propertiesHeaderRef, linksHeaderRef, focusBody, t, saveStatus, setSpellEnabled, spellEnabled, spellLang, pageActions, isActivePage, contentWidth, isFloatingDockOpen, setIsFloatingDockOpen, noteFilename } = context;
  return (<div className="flex items-center justify-between gap-4 group/title mb-6">
    <textarea
      ref={titleInputRef}
      rows={1}
      value={metadata.title || ""}
      onChange={handleTitleChange}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); return; }
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        // ⌥↑: zone shortcut — jump to the properties panel.
        if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); openPropertiesNav(); return; }
        // ⌥↓: move down a zone.
        if (e.altKey && e.key === 'ArrowDown') {
          e.preventDefault();
          if (propertiesHeaderRef.current) propertiesHeaderRef.current.focus();
          else if (linksHeaderRef.current) linksHeaderRef.current.focus();
          else focusBody();
          return;
        }
        if (e.altKey) return;
        // ↓ on the last line of the title → moves down to properties or to the body.
        if (e.key === 'ArrowDown') {
          const el = e.currentTarget;
          const collapsed = el.selectionStart === el.selectionEnd;
          const after = (el.value || '').slice(el.selectionEnd);
          if (collapsed && !after.includes('\n')) {
            e.preventDefault();
            if (propertiesHeaderRef.current) propertiesHeaderRef.current.focus();
            else if (linksHeaderRef.current) linksHeaderRef.current.focus();
            else focusBody();
          }
        }
      }}
      placeholder={t('editor.untitled')}
      className="vault-page-title flex-1 min-w-0 border-none outline-none placeholder:[var(--text-tertiary)]/20 text-[var(--text-primary)] bg-transparent resize-none overflow-hidden break-words"
    />
    <div className="vault-page-title-actions flex items-center gap-2 shrink-0 animate-in fade-in duration-300 justify-end">
      {/* Page actions (history, comments, share, translate, code view,
                                    lock, delete) live here as inline icon buttons — see PageActionsBar.
                                    They used to sit in the VaultShell top-bar "…" menu; they were
                                    moved next to the title so the actions are visible rather than
                                    hidden. The title is `flex-1 min-w-0` and truncates, so the icons
                                    never collide with a long title; on a narrow pane they spill into a
                                    compact "…" overflow. Only the active pane renders them. */}
      {saveStatus === 'saving' && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--gnosi-primary)]/5 text-[var(--gnosi-primary)]/60 text-[10px] font-bold uppercase tracking-wider">
          <Loader2 size={12} className="animate-spin" />
          {t('editor.saving')}
        </div>
      )}
      {saveStatus === 'saved' && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--status-success)]/5 text-[var(--status-success)]/60 text-[10px] font-bold uppercase tracking-wider">
          <CheckSquare size={12} />
          {t('editor.saved')}
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--status-error)]/5 text-[var(--status-error)]/60 text-[10px] font-bold uppercase tracking-wider">
          <X size={12} />
          {t('editor.save_error')}
        </div>
      )}
      <button
        type="button"
        onClick={() => { setSpellEnabled((v) => !v); }}
        title={spellEnabled ? t('editor.spellcheck_active', { lang: spellLang.toUpperCase() }) : t('editor.spellcheck_disabled')}
        className={`vault-page-spell-action flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${spellEnabled ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]'}`}
      >
        <SpellCheck2 size={12} /> {spellLang.toUpperCase()}
      </button>
      <button
        type="button"
        onClick={() => emitAppEvent('gnosi:ai-correct-page')}
        title={t('editor.ai_correct_page')}
        aria-label={t('editor.ai_correct_page')}
        className="vault-page-ai-action flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-primary)] transition-colors"
      >
        <Sparkles size={12} /> IA
      </button>
      <PageActionsBar
        pageActions={isActivePage ? pageActions : null}
        containerWidth={contentWidth}
        compactOverflowItems={isActivePage ? [{
          key: 'spellcheck',
          Icon: SpellCheck2,
          active: spellEnabled,
          label: spellEnabled
            ? t('editor.spellcheck_active', { lang: spellLang.toUpperCase() })
            : t('editor.spellcheck_disabled'),
          onClick: () => { setSpellEnabled((value) => !value); },
        }, {
          key: 'ai-correct',
          Icon: Sparkles,
          label: t('editor.ai_correct_page'),
          onClick: () => emitAppEvent('gnosi:ai-correct-page'),
        }, {
          key: 'quick-actions',
          Icon: PanelBottomOpen,
          active: isFloatingDockOpen,
          label: isFloatingDockOpen
            ? t('shell.close_quick_actions', 'Close quick actions')
            : t('shell.open_quick_actions', 'Open quick actions'),
          onClick: () => { setIsFloatingDockOpen((value) => !value); },
        }] : []}
      />
      <CollaborationPresence pageId={noteFilename} />
    </div>
  </div>);
}
