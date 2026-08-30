import { useCallback } from 'react';
import { useMemo } from 'react';
import type { VaultEditorContextValue } from '../../../../../shared/editor/VaultEditorContext';
import type { EditingBlock } from '../../../view-config/page-view-modal/types';
import type { ViewEditingBlock } from './types';
import { pageContextCallbacks } from './contextBridge';
import type { usePageEditorState } from './usePageEditorState';
type Input = ReturnType<typeof usePageEditorState>;
export function usePageContext(state: Input) {
  const { setPageViewPreselectedTable, setPageViewEditingBlock, setIsPageViewModalOpen, allTables, onEditSchema, onCreateRecord, onCreateTemplate, onCreateFromSource, onDeletePage, onOpenParallel, onOpenPage, onOpenInCurrentTab, onOpenInNewTab, idToTitle, registry, noteFilename, referenceTableId, onOpenViewConfig, viewSectionNonce } = state;


  const openPageViewModalFromContext = useCallback((tableId = '', editingBlock: ViewEditingBlock | null = null) => {
    setPageViewPreselectedTable(tableId);
    setPageViewEditingBlock(editingBlock);
    setIsPageViewModalOpen(true);
  }, [setPageViewPreselectedTable, setPageViewEditingBlock, setIsPageViewModalOpen]);


  const callbacks = useMemo(() => pageContextCallbacks({ noteFilename, EditorInner: state.EditorInner, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, onOpenPage, onOpenInCurrentTab, onOpenInNewTab, onOpenViewConfig }, openPageViewModalFromContext), [noteFilename, state.EditorInner, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, onOpenPage, onOpenInCurrentTab, onOpenInNewTab, onOpenViewConfig, openPageViewModalFromContext]);
  const contextValue: VaultEditorContextValue = useMemo(() => ({ allTables, ...callbacks, onCreateTemplate, onCreateFromSource, idToTitle, registry: registry || { databases: [], tables: [], views: [] }, pageId: noteFilename, referenceTableId, viewSectionNonce }), [allTables, callbacks, onCreateTemplate, onCreateFromSource, idToTitle, registry, noteFilename, referenceTableId, viewSectionNonce]);
  // BlockNote stores heading levels as strings; the modal already uses Number(value) || 1.
  // Keep the original block for the insertion/update callback and normalize only its modal view.
  const modalEditingBlock = useMemo<EditingBlock | null>(() => state.pageViewEditingBlock ? {
    ...state.pageViewEditingBlock,
    props: { ...state.pageViewEditingBlock.props, heading_level: Number(state.pageViewEditingBlock.props?.heading_level) || 1 },
  } : null, [state.pageViewEditingBlock]);
  return { openPageViewModalFromContext, contextValue, modalEditingBlock };
}
