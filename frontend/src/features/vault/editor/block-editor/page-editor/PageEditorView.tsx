import { CompactPageHeader } from './CompactPageHeader';
import { PageBody } from './PageBody';
import { PageHero } from './PageHero';
import { PageLinksPanel } from './PageLinksPanel';
import { PageModals } from './PageModals';
import { PagePropertiesPanel } from './PagePropertiesPanel';
import { PageTitle } from './PageTitle';
import type { PageEditorController } from './usePageEditorController';
export function PageEditorView({ context }: { context: PageEditorController }) {
  const { isFocusMode, contentRef, metadata, showKnowledgePanels, isPropertiesOpen, isLinksInfoOpen } = context;
  return (<div className={`vault-page-editor ${isFocusMode ? 'vault-page-editor--focus' : ''} w-full flex justify-center bg-[var(--bg-primary)] min-h-full transition-colors duration-300`}>
    <div ref={contentRef} className="max-w-7xl w-full flex flex-col min-h-full bg-[var(--bg-primary)] relative transition-colors duration-300">
      <CompactPageHeader context={context} />
      <PageHero context={context} />

      <div className={`vault-page-overview px-16 pb-2 ${metadata.cover ? '' : 'vault-page-overview--bare'} ${metadata.icon ? 'vault-page-overview--with-icon' : 'vault-page-overview--without-icon'}`}>
        <div className="mb-4 space-y-1.5">
          <PageTitle context={context} />
          {showKnowledgePanels && <div
            className="vault-page-summary-grid items-start px-1 mb-1.5"
            data-expanded={isPropertiesOpen || isLinksInfoOpen}
          >
            <PagePropertiesPanel context={context} />

            <PageLinksPanel context={context} />
          </div>}
        </div>
      </div>
      <PageBody context={context} />
    </div>
    <PageModals context={context} /></div>);
}
