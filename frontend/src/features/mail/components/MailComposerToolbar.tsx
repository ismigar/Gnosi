import {
  Calendar,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';

import type { MailComposerController } from './useMailComposerController';


interface MailComposerToolbarProps {
  readonly controller: MailComposerController;
}


export function MailComposerToolbar({ controller }: MailComposerToolbarProps) {
  const {
    aiGenerating,
    attachments,
    handleAIAssist,
    handleFileSelect,
    handleInsertAvailability,
    handleInsertSnippet,
    handleSend,
    fileInputRef,
    onClose,
    sending,
    setShowSnippets,
    showSnippets,
    snippets,
    t,
  } = controller;

  return (
    <div className="flex items-center justify-between border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 px-6 py-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { void handleAIAssist(); }}
          disabled={aiGenerating}
          className="flex items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-bold text-[var(--gnosi-blue)] shadow-sm transition-all hover:bg-[var(--sidebar-item-active)]"
        >
          {aiGenerating
            ? <RefreshCw size={16} className="animate-spin" />
            : <Sparkles size={16} />}
          {t('mail.ai_draft')}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <button
          type="button"
          onClick={() => { fileInputRef.current?.click(); }}
          className="relative rounded-xl border border-transparent p-2.5 text-[var(--text-secondary)] transition-all hover:border-[var(--border-primary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          title={t('mail.attach_file')}
        >
          <Paperclip size={18} />
          {attachments.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--gnosi-blue)] text-[9px] font-bold text-white">
              {attachments.length}
            </span>
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => { setShowSnippets((visible) => !visible); }}
            className="rounded-xl border border-transparent p-2.5 text-[var(--text-secondary)] transition-all hover:border-[var(--border-primary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            title={t('mail.insert_snippet')}
          >
            <Type size={18} />
          </button>
          {showSnippets && (
            <>
              <button
                type="button"
                aria-label={t('mail.close_snippets', 'Close snippets')}
                className="fixed inset-0 z-[var(--z-overlay)]"
                onClick={() => { setShowSnippets(false); }}
              />
              <div className="absolute bottom-full left-0 z-[var(--z-modal)] mb-2 w-64 animate-in rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 shadow-xl fade-in zoom-in-95 duration-150">
                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('mail.insert_snippet')}
                </div>
                {snippets.map((snippet) => (
                  <button
                    type="button"
                    key={snippet.key}
                    onMouseDown={() => {
                      handleInsertSnippet(snippet.content || snippet.label);
                    }}
                    className="w-full px-4 py-2 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    <span className="block truncate font-semibold">
                      {snippet.label}
                    </span>
                    {snippet.content !== snippet.label && (
                      <span className="block truncate text-[11px] text-[var(--text-secondary)] opacity-70">
                        {snippet.content.slice(0, 50)}
                        {snippet.content.length > 50 ? '…' : ''}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={handleInsertAvailability}
          className="rounded-xl border border-transparent p-2.5 text-[var(--text-secondary)] transition-all hover:border-[var(--border-primary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          title={t('mail.availability')}
        >
          <Calendar size={18} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-transparent p-2.5 text-[var(--text-secondary)] transition-all hover:border-[var(--border-primary)] hover:bg-[var(--bg-primary)] hover:text-[var(--status-error)]"
          title={t('mail.discard_draft')}
        >
          <Trash2 size={18} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => { void handleSend(); }}
        disabled={sending}
        className="flex items-center gap-2 rounded-2xl bg-[var(--gnosi-blue)] px-8 py-3 font-bold text-white shadow-lg transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
      >
        {sending
          ? <RefreshCw size={18} className="animate-spin" />
          : <Send size={18} />}
        {t('mail.send_btn')}
      </button>
    </div>
  );
}
