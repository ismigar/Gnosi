import { useState, useRef } from 'react';
import type { ModalLayer } from '../../../hooks/useModalKeyboard';
import type { ResolvedProps } from './props';
import type { AgentSkill, Catalogs, DrupalContentType, DrupalField, Field, Functionality, Mapping, RelationTable, RemoveFieldState, ToggleConfirmation, VirtualComputer } from './types';
export function useSchemaState(props: ResolvedProps) {
    const {
        initialEnableSubitems, initialEnableTranslation, initialEnableDrupalSync, initialDrupalBundle,
        initialDrupalFieldMapping,
    } = props;
    const [fields, setFields] = useState<Field[]>([]);
    const [functionalities, setFunctionalities] = useState<Functionality[]>([]);
    const [isInitializedForSave, setIsInitializedForSave] = useState(false);
    const [allTables, setAllTables] = useState<readonly RelationTable[]>([]);
    const [virtualComputers, setVirtualComputers] = useState<VirtualComputer[]>([]);
    const [enableSubitems, setEnableSubitems] = useState(initialEnableSubitems);
    const [enableTranslation, setEnableTranslation] = useState(initialEnableTranslation);
    const [sharedCatalogs, setSharedCatalogs] = useState<Catalogs>({});
    const [enableDrupalSync, setEnableDrupalSync] = useState(initialEnableDrupalSync);
    const [drupalBundle, setDrupalBundle] = useState(initialDrupalBundle || '');
    const [drupalFieldMapping, setDrupalFieldMapping] = useState<Mapping>(initialDrupalFieldMapping || {});
    const [enableSocialPublish, setEnableSocialPublish] = useState(false);
    const [drupalContentTypes, setDrupalContentTypes] = useState<DrupalContentType[]>([]);
    const [drupalFields, setDrupalFields] = useState<DrupalField[]>([]);
    const [drupalLoading, setDrupalLoading] = useState(false);
    const [drupalError, setDrupalError] = useState('');
    const [matching, setMatching] = useState(false);
    const [aiActionModalFieldIndex, setAiActionModalFieldIndex] = useState<number | null>(null);
    const [aiActionPrompt, setAiActionPrompt] = useState('');
    const [aiActionLoading, setAiActionLoading] = useState(false);
    const [availableSkills, setAvailableSkills] = useState<AgentSkill[]>([]);
    const [toggleConfirm, setToggleConfirm] = useState<ToggleConfirmation>({ isOpen: false, title: '', message: '', confirmText: '', onConfirm: null });
    const [confirmRemoveField, setConfirmRemoveField] = useState<RemoveFieldState>({ isOpen: false, index: null, name: '' });
    const initializedRef = useRef(false);
    const modalRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
    const modalLayerRef = useRef<ModalLayer | null>(null);
    return {
        fields, setFields, functionalities, setFunctionalities, isInitializedForSave,
        setIsInitializedForSave, allTables, setAllTables, virtualComputers, setVirtualComputers,
        enableSubitems, setEnableSubitems, enableTranslation, setEnableTranslation, sharedCatalogs,
        setSharedCatalogs, enableDrupalSync, setEnableDrupalSync, drupalBundle, setDrupalBundle,
        drupalFieldMapping, setDrupalFieldMapping, enableSocialPublish, setEnableSocialPublish,
        drupalContentTypes, setDrupalContentTypes, drupalFields, setDrupalFields, drupalLoading,
        setDrupalLoading, drupalError, setDrupalError, matching, setMatching, aiActionModalFieldIndex,
        setAiActionModalFieldIndex, aiActionPrompt, setAiActionPrompt, aiActionLoading,
        setAiActionLoading, availableSkills, setAvailableSkills, toggleConfirm, setToggleConfirm,
        confirmRemoveField, setConfirmRemoveField, initializedRef, modalRef, scrollRef, pendingSaveRef,
        modalLayerRef,
    };
}
export type SchemaState = ReturnType<typeof useSchemaState>;
