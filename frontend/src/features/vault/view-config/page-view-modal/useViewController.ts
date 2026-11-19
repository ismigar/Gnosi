import { useEffect, useMemo, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../../../shared/hooks/useModalKeyboard';
import { PAGE_VIEW_MODAL_API } from './api';
import { decodeView } from './decode';
import { useViewState } from './useViewState';
import { useViewSession } from './useViewSession';
import { useViewSnapshot } from './useViewSnapshot';
import { useViewFields } from './useViewFields';
import { useViewAppearance } from './useViewAppearance';
import { useViewRelations } from './useViewRelations';
import { useViewModels } from './useViewModels';
import { useViewInitialization } from './useViewInitialization';
import { useViewCatalog } from './useViewCatalog';
import { useViewDiscovery } from './useViewDiscovery';
import { useViewSelection } from './useViewSelection';
import { useViewColumnValidation } from './useViewColumnValidation';
import { useViewFieldLabels } from './useViewFieldLabels';
import { useViewActions } from './useViewActions';
import { useViewPersistence } from './useViewPersistence';
import { useViewAutosave } from './useViewAutosave';
import { useViewOptions } from './useViewOptions';

import type { PageViewModalProps, ViewConfig } from './types';
import type { TFunction } from 'i18next';
export type ModalInput = Required<Omit<PageViewModalProps, 'editingView'>> & { editingView: ViewConfig | null; isTableMode: boolean; t: TFunction };
const EMPTY_TABLES = Object.freeze([]);
const NOOP_SAVE = () => {};
/** Coordinates the editing session; visual sections never receive persistence refs. */
export function useViewController(props: PageViewModalProps) {
    const { t } = useTranslation();
    const { isOpen, onClose, onSave = NOOP_SAVE, pageId, allTables = EMPTY_TABLES, api = PAGE_VIEW_MODAL_API,
        preselectedTableId = '', editingBlock = null, mode = 'embed', initialTab = null } = props;
    const editingView = useMemo(() => props.editingView ? decodeView(props.editingView) : null, [props.editingView]);
    const input: ModalInput = {
        isOpen, onClose, onSave, pageId, allTables, api, preselectedTableId,
        editingBlock, editingView, initialTab, mode, isTableMode: mode === 'table', t
    };
    const state = useViewState(input);
    const session = useViewSession(api, editingBlock?.props?.section_id);
    const context = { ...input, ...state, ...session };
    const snapshot = useViewSnapshot(context);
    const fields = useViewFields(context);
    const appearance = useViewAppearance(context);
    const editor = { ...context, ...fields, ...appearance };

    useViewRelations(editor);
    useViewModels(editor);
    useViewInitialization(editor);
    useViewCatalog(editor);
    useViewDiscovery(editor);
    useViewSelection(editor);
    useViewColumnValidation(editor);

    const labels = useViewFieldLabels(editor);
    const actions = useViewActions(editor);
    const persistence = useViewPersistence(editor);
    const autosave = useViewAutosave({ ...editor, ...snapshot, ...persistence });
    const options = useViewOptions({ ...editor, ...labels });
    const { panelRef } = session;
    useModalKeyboard({ isOpen, onClose: autosave.requestClose, containerRef: panelRef, trapFocus: true });

    // Baseline follows completed hydration, never ordinary user edits.
    const captureBaseline = useEffectEvent(() => { state.setFormBaselineSnapshot(snapshot.formSnapshot); });
    useEffect(() => { if (isOpen && state.formBaselineRevision > 0) captureBaseline(); }, [isOpen, state.formBaselineRevision]);
    return { panelRef, ...input, ...state, ...fields, ...labels, ...actions, ...autosave, ...options };
}
