import { useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../shared/notifications/notifyError';
import { toast } from '../../shared/notifications/toast';
import { uploadVaultAsset } from '../../shared/api/vault-specialized';
import { AgentContextPicker } from './agent-context/AgentContextPicker';
import { AgentContextReferenceList } from './agent-context/AgentContextReferenceList';
import { AgentContextScopeEditor } from './agent-context/AgentContextScopeEditor';
import { internalSourceLabel } from './agent-context/agentContextLabels';
import {
    newContextRefId,
    contextReferenceKey,
    type ContextPickingKind,
    type ContextReference,
    type ContextScope,
    type ContextSourceKind,
} from './agent-context/agentContextModel';
import './AgentContextSources.css';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { useContextKey } from './agent-context/useContextResource';
import { useAgentContextCatalog } from './agent-context/useAgentContextCatalog';


export interface AgentContextSourcesProps {
    readonly onChange: (references: ContextReference[]) => void;
    readonly value?: readonly ContextReference[] | null;
}


function ContextSources({
    onChange,
    value = [],
}: AgentContextSourcesProps) {
    const { t } = useTranslation();
    const references = useMemo(() => value ?? [], [value]);
    const [picking, setPicking] = useState<ContextPickingKind | null>(null);
    const [editingRefId, setEditingRefId] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const needsInternal = references.some((reference) => (
        reference.type === 'internal'
    ));
    const catalog = useAgentContextCatalog(
        picking,
        needsInternal,
    );
    const { internalDescriptors, options } = catalog;

    const addReference = (
        type: ContextSourceKind,
        ref: string,
        label: string,
        scope?: ContextScope,
    ): void => {
        if (references.some((item) => contextReferenceKey(item.type, item.ref) === contextReferenceKey(type, ref))) {
            toast(t(
                'settings.ai.context_already_added',
                'That source is already in the context.',
            ));
            return;
        }
        const id = newContextRefId();
        onChange([
            ...references,
            { id, label, ref, ...(scope ? { scope } : {}), type },
        ]);
        setPicking(null);
        if (type === 'internal') setEditingRefId(id);
    };
    const removeReference = (id: string): void => {
        onChange(references.filter((reference) => reference.id !== id));
        if (editingRefId === id) setEditingRefId(null);
    };
    const patchReferenceScope = (id: string, patch: ContextScope): void => {
        onChange(references.map((reference) => reference.id === id
            ? {
                ...reference,
                scope: { ...(reference.scope ?? {}), ...patch },
            }
            : reference));
    };
    const handleUpload = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setUploading(true);
        void uploadVaultAsset(file)
            .then((result) => {
                addReference('file', result.path, file.name);
            })
            .catch((error: unknown) => {
                logError('agent-context-upload-asset', error);
                toast.error(t(
                    'settings.ai.context_upload_error',
                    'The file could not be uploaded.',
                ));
            })
            .finally(() => {
                setUploading(false);
            });
    };
    const addUrl = (url: string): boolean => {
        if (!/^https?:\/\//iu.test(url)) {
            toast.error(t(
                'settings.ai.context_url_invalid',
                'The URL must start with http:// or https://',
            ));
            return false;
        }
        let label = url;
        try {
            label = new URL(url).hostname;
        } catch {
            // The protocol check above keeps the raw URL as a recoverable label.
        }
        addReference('url', url, label);
        return true;
    };

    const selected = new Set(references.map(item => contextReferenceKey(item.type, item.ref)));
    const available = options?.filter(item => !selected.has(contextReferenceKey(picking ?? 'internal', item.id))) ?? null;
    const wholeVaultAdded = selected.has(contextReferenceKey('vault', 'active'));
    const vaultAvailable = !wholeVaultAdded || [catalog.pages, catalog.tables].some((resource, index) => (
        resource.data === null || resource.data.some(item => !selected.has(contextReferenceKey(index === 0 ? 'page' : 'table', item.id)))
    ));

    return (
        <div className="agent-context-sources">
            <AgentContextReferenceList
                editingRefId={editingRefId}
                onEdit={setEditingRefId}
                onRemove={removeReference}
                references={references}
                descriptors={internalDescriptors}
                renderEditor={(reference, descriptor) => descriptor ? <AgentContextScopeEditor
                    descriptor={descriptor} reference={reference} onRefresh={catalog.refresh}
                    sourceLabel={internalSourceLabel(t, reference.ref, reference.label)}
                    onPatch={patch => { patchReferenceScope(reference.id, patch); }} /> : (
                        <div className="agent-source-feedback" role={catalog.internal.error ? 'alert' : 'status'}>
                            <span>{catalog.internal.loading ? t('common.loading', 'Loading...') : catalog.internal.error
                                ? t('settings.ai.sources.load_error', 'Could not load options. Try again.')
                                : t('settings.ai.sources.unavailable', 'Unavailable')}</span>
                            <RefreshButton loading={catalog.internal.loading} onClick={catalog.refresh} />
                        </div>
                    )}
            />
            <AgentContextPicker
                onAdd={addReference}
                onAddUrl={addUrl}
                onPickingChange={setPicking}
                onUpload={handleUpload}
                options={available}
                totalOptions={(options?.length ?? 0) + (picking === 'internal' ? 1 : 0)}
                error={catalog.error}
                loading={catalog.loading}
                onRefresh={catalog.refresh}
                wholeVaultAdded={wholeVaultAdded}
                vaultAvailable={vaultAvailable}
                picking={picking}
                uploading={uploading}
            />

        </div>
    );
}

export default function AgentContextSources(props: AgentContextSourcesProps) {
    const contextKey = useContextKey();
    return <ContextSources key={contextKey} {...props} />;
}
