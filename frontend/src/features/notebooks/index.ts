import { lazy } from 'react';

// Public composition boundary: evaluating this entry never loads either screen.
export const NotebooksPage = lazy(() => import('./NotebooksPage'));
export const NotebookCreateDialog = lazy(() => import('./create/NotebookCreateDialog'));
