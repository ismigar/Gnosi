/**
 * VaultEditorContext.js
 * Context de React per compartir l'estat i les funcions entre
 * el BlockEditor i els blocs enriquits que renderitza.
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
});
