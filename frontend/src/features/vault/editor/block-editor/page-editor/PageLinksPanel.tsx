import { AtSign } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { Link2 } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { PageLinksGraph } from '../../PageLinksGraph';
import { Share2 } from 'lucide-react';
import { Workflow } from 'lucide-react';
import type { PageEditorController } from './usePageEditorController';
export function PageLinksPanel({ context }: { context: PageEditorController }) {
  const { linksHeaderRef, setIsLinksInfoOpen, handleLinksHeaderKeyDown, t, outgoingLinks, incomingLinks, relatedPages, unlinkedMentions, isLinksInfoOpen, metadata, openLinkedPage, incomingLinksLoading, formatIncomingLinkLabel, handleLinkMentions, linkMentionsBusy, unlinkedMentionsLoading } = context;
  return (<div className="rounded-xl border border-[var(--border-primary)] focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 bg-[var(--bg-secondary)]/40 overflow-hidden transition-all">
    <button
      ref={linksHeaderRef}
      tabIndex={0}
      type="button"
      onClick={() => { setIsLinksInfoOpen((prev) => !prev); }}
      onKeyDown={handleLinksHeaderKeyDown}
      className="w-full h-[var(--control-height-touch)] flex items-center justify-between gap-3 px-3 text-left hover:bg-[var(--bg-secondary)]/60 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/40 rounded transition-all"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Link2 size={14} className="text-[var(--text-secondary)]/80" />
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/85">
          {t('editor.links_and_mentions')}
        </div>
        <div className="vault-page-summary-meta text-[11px] truncate">
          {t('editor.outgoing')} {outgoingLinks.length} · {t('editor.incoming')} {incomingLinks.length} · {t('editor.relations')} {relatedPages.length} · {t('editor.pending')} {unlinkedMentions.length}
        </div>
        <div className="vault-page-summary-badges" aria-hidden="true">
          {outgoingLinks.length > 0 && <span>{t('editor.outgoing')} {outgoingLinks.length}</span>}
          {incomingLinks.length > 0 && <span>{t('editor.incoming')} {incomingLinks.length}</span>}
          {relatedPages.length > 0 && <span>{t('editor.relations')} {relatedPages.length}</span>}
          {unlinkedMentions.length > 0 && <span>{t('editor.pending')} {unlinkedMentions.length}</span>}
          {outgoingLinks.length === 0
            && incomingLinks.length === 0
            && relatedPages.length === 0
            && unlinkedMentions.length === 0
            && <span>0</span>}
        </div>
      </div>
      {isLinksInfoOpen ? (
        <ChevronDown size={14} className="text-[var(--text-tertiary)]/80 shrink-0" />
      ) : (
        <ChevronRight size={14} className="text-[var(--text-tertiary)]/80 shrink-0" />
      )}
    </button>

    {isLinksInfoOpen && (
      <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]/35">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80">
                <Workflow size={13} />
                {t('editor.links_graph')}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
                <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--gnosi-primary)]" />{t('editor.outgoing')}</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--text-secondary)]" />{t('editor.incoming')}</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#6366f1]" />{t('editor.relations')}</span>
              </div>
            </div>
            <PageLinksGraph
              currentTitle={metadata.title}
              outgoingLinks={outgoingLinks}
              incomingLinks={incomingLinks}
              relatedPages={relatedPages}
              onOpenPage={openLinkedPage}
              labels={{
                untitled: t('editor.untitled'),
                empty: t('editor.links_graph_empty'),
                ariaLabel: t('editor.links_graph_aria'),
                outgoing: t('editor.outgoing'),
                incoming: t('editor.incoming'),
                relation: t('editor.relations'),
              }}
            />
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80 mb-2">
              <Link2 size={13} />
              {t('editor.links_to')} ({outgoingLinks.length})
            </div>
            {outgoingLinks.length === 0 ? (
              <div className="text-xs text-[var(--text-tertiary)]/70">{t('editor.no_outgoing_links')}</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {outgoingLinks.map((link, idx) => (
                  link.id ? (
                    <button
                      type="button"
                      key={`${link.id}-${String(idx)}`}
                      onClick={() => { openLinkedPage(link.id); }}
                      className="vault-page-link-chip max-w-64 px-2 py-0.5 rounded-full border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:brightness-110 transition-all"
                      title={`${link.title} — ${t('editor.open_parallel_tooltip')}`}
                    >
                      <span className="block truncate">{link.title}</span>
                    </button>
                  ) : (
                    <span
                      key={`${link.title}-${String(idx)}`}
                      className="vault-page-link-chip max-w-64 px-2 py-0.5 rounded-full border border-[var(--border-primary)] text-[var(--text-tertiary)]/80"
                      title={`${link.title} — ${t('editor.unresolved_link')}`}
                    >
                      <span className="block truncate">{link.title}</span>
                    </span>
                  )
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80 mb-2">
              <Share2 size={13} />
              {t('editor.linked_by')} ({incomingLinks.length})
            </div>
            {incomingLinksLoading ? (
              <div className="text-xs text-[var(--text-tertiary)]/70 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                {t('editor.loading_backlinks')}
              </div>
            ) : incomingLinks.length === 0 ? (
              <div className="text-xs text-[var(--text-tertiary)]/70">{t('editor.no_backlinks')}</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {incomingLinks.map((link) => (
                  <button
                    type="button"
                    key={link.id}
                    onClick={() => { openLinkedPage(link.id); }}
                    className="vault-page-link-chip max-w-64 px-2 py-0.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--gnosi-primary)]/40 hover:text-[var(--gnosi-primary)] transition-all"
                    title={`${formatIncomingLinkLabel(link)} — ${t('editor.open_parallel_tooltip')}`}
                  >
                    <span className="block truncate">{formatIncomingLinkLabel(link)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3 md:col-span-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80 mb-2">
              <Share2 size={13} className="text-[#6366f1]" />
              {t('editor.relations')} ({relatedPages.length})
            </div>
            {relatedPages.length === 0 ? (
              <div className="text-xs text-[var(--text-tertiary)]/70">{t('editor.no_relations')}</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {relatedPages.map((link) => (
                  <button
                    type="button"
                    key={link.id}
                    onClick={() => { openLinkedPage(link.id); }}
                    className="vault-page-link-chip max-w-64 px-2 py-0.5 rounded-full border border-[#6366f1]/30 bg-[#6366f1]/10 text-[#6366f1] hover:brightness-110 transition-all"
                    title={`${link.title} — ${t('editor.open_parallel_tooltip')}`}
                  >
                    <span className="block truncate">{link.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3 md:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80">
                <AtSign size={13} />
                {t('editor.unlinked_mentions')} ({unlinkedMentions.length})
              </div>
              <button
                type="button"
                onClick={() => { void handleLinkMentions(''); }}
                disabled={linkMentionsBusy || unlinkedMentionsLoading || unlinkedMentions.length === 0}
                className="px-2.5 py-1 text-xs rounded-md border border-[var(--gnosi-primary)]/40 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] disabled:opacity-50"
              >
                {linkMentionsBusy ? t('editor.linking') : t('editor.link_all')}
              </button>
            </div>

            {unlinkedMentionsLoading ? (
              <div className="text-xs text-[var(--text-tertiary)]/70 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                {t('editor.searching_mentions')}
              </div>
            ) : unlinkedMentions.length === 0 ? (
              <div className="text-xs text-[var(--text-tertiary)]/70">{t('editor.no_unlinked_mentions')}</div>
            ) : (
              <div className="space-y-1.5">
                {unlinkedMentions.slice(0, 12).map((mention) => (
                  <div key={mention.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-[var(--border-primary)]/70 bg-[var(--bg-primary)]/60">
                    <button
                      type="button"
                      onClick={() => { openLinkedPage(mention.id); }}
                      className="text-left flex-1 min-w-0"
                      title={t('editor.open_source_note')}
                    >
                      <div className="text-xs font-semibold text-[var(--text-primary)] truncate">{mention.title}</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]/80 truncate">{mention.snippet || t('editor.no_snippet')}</div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-[var(--text-secondary)]/80">{mention.count}x</span>
                      <button
                        type="button"
                        onClick={() => { void handleLinkMentions(mention.id || ''); }}
                        disabled={linkMentionsBusy}
                        className="px-2 py-1 text-[11px] rounded-md border border-[var(--gnosi-primary)]/30 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 disabled:opacity-50"
                      >
                        {t('editor.link_action')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
  </div>);
}
