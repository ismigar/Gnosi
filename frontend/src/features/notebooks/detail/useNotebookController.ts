import { useMemo, useState } from 'react';
import type { NotebookDetail } from '../../../shared/api/notebooks';
import { useMediaQuery } from '../../../shared/hooks/useMediaQuery';
import { useNotebookDetailData } from './useNotebookDetailData';
import { useNotebookActions } from './useNotebookActions';
import { useNotebookSelection } from './useNotebookSelection';
import type { MobileTab } from './notebookTypes';

export function useNotebookController(notebookId: string) {
    const data = useNotebookDetailData(notebookId);
    const actions = useNotebookActions(notebookId, data);
    const selection = useNotebookSelection(notebookId, data.notebook, data.sources);
    const [mobileTab, setMobileTab] = useState<MobileTab>('sources');
    const useResponsiveTabs = useMediaQuery('(max-width: 1120px)');
    const currentIds = useMemo(() => new Set(data.sources.items.map((item) => item.resource_id)), [data.sources.items]);
    return { ...data, ...actions, ...selection, mobileTab, setMobileTab, useResponsiveTabs, currentIds };
}

export type NotebookController = Omit<ReturnType<typeof useNotebookController>, 'notebook'> & { notebook: NotebookDetail };
