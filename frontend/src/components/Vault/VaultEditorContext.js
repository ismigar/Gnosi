/**
 * VaultEditorContext.js
 * React context for sharing state and functions between
 * the BlockEditor and the rich blocks it renders.
 */
import { createContext } from 'react';

export const VaultEditorContext = createContext({
    allTables: [],
    onEditSchema: null,
    onCreateRecord: null,
    onDeletePage: null,
    onOpenParallel: null,
    idToTitle: {},
    registry: { databases: [], tables: [], views: [] },
    pageId: null,
});
