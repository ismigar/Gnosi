import { ErrorBoundary } from '../ErrorBoundary';
import { MarkdownCodeEditor } from '../MarkdownCodeEditor';
import type { PageEditorController } from './usePageEditorController';
export function PageBody({ context }: { context: PageEditorController }) {
  const { isCodeView, noteFilename, initialContent, metadata, onUpdate, onRefreshNotes, idToTitle, setLiveOutgoingLinks, EditorInner, aliasIndex, onUpdatePageMetadata, effectiveTheme, contextValue, saveStatus, setSaveStatus, metadataRef, isEditable, applyViewSectionRef, registerEditorApi, navigateUpFromBody, openPropertiesNav, spellEnabled, spellLang, setSpellLang } = context;
  return (<div className="vault-page-body relative min-h-[500px] px-16 pb-8">
    <ErrorBoundary>
      {isCodeView ? (
        <MarkdownCodeEditor
          noteFilename={noteFilename}
          initialContent={initialContent}
          metadata={metadata}
          onUpdate={onUpdate}
          onRefreshNotes={onRefreshNotes}
          idToTitle={idToTitle}
          onOutgoingLinksChange={setLiveOutgoingLinks}
        />
      ) : (
        <EditorInner
          noteFilename={noteFilename}
          initialContent={initialContent}
          metadata={metadata}
          onUpdate={onUpdate}
          idToTitle={idToTitle}
          aliasIndex={aliasIndex}
          onRefreshNotes={onRefreshNotes}
          onUpdatePageMetadata={onUpdatePageMetadata}
          effectiveTheme={effectiveTheme}
          contextValue={contextValue}
          saveStatus={saveStatus}
          setSaveStatus={setSaveStatus}
          metadataRef={metadataRef}
          isEditable={isEditable}
          onOpenPageViewModal={context.openPageViewModalFromContext}
          applyViewSectionRef={applyViewSectionRef}
          registerEditorApi={registerEditorApi}
          onNavigateUp={navigateUpFromBody}
          onOpenProperties={openPropertiesNav}
          spellEnabled={spellEnabled}
          spellLang={spellLang}
          forcedSpellLang={typeof metadata.spell_language === 'string' && ['ca', 'es', 'en'].includes(metadata.spell_language) ? metadata.spell_language : undefined}
          onLangDetected={setSpellLang}
          onOutgoingLinksChange={setLiveOutgoingLinks}
        />
      )}
    </ErrorBoundary>
  </div>);
}
