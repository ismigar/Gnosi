import { useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../lib/notifyError';
import { toast } from '../lib/toast';
import { uploadVaultAsset } from '../shared/api/vault-specialized';
import { AgentContextPicker } from './agent-context/AgentContextPicker';
import { AgentContextReferenceList } from './agent-context/AgentContextReferenceList';
import { AgentContextScopeEditor } from './agent-context/AgentContextScopeEditor';
import { internalSourceLabel } from './agent-context/agentContextLabels';
import {
    newContextRefId,
    type ContextPickingKind,
    type ContextReference,
    type ContextScope,
    type ContextSourceKind,
} from './agent-context/agentContextModel';
import { useAgentContextCatalog } from './agent-context/useAgentContextCatalog';


export interface AgentContextSourcesProps {
    readonly onChange: (references: ContextReference[]) => void;
    readonly value?: readonly ContextReference[] | null;
}


export default function AgentContextSources({
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
    const { internalDescriptors, options } = useAgentContextCatalog(
        picking,
        needsInternal,
    );

    const addReference = (
        type: ContextSourceKind,
        ref: string,
        label: string,
        scope?: ContextScope,
    ): void => {
        if (references.some((item) => item.type === type && item.ref === ref)) {
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

    const editingReference = references.find((reference) => (
        reference.id === editingRefId && reference.type === 'internal'
    ));
    const editingDescriptor = internalDescriptors.find((descriptor) => (
        descriptor.id === editingReference?.ref
    ));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <AgentContextReferenceList
                editingRefId={editingRefId}
                onEdit={setEditingRefId}
                onRemove={removeReference}
                references={references}
            />
            <AgentContextPicker
                onAdd={addReference}
                onAddUrl={addUrl}
                onPickingChange={setPicking}
                onUpload={handleUpload}
                options={options}
                picking={picking}
                uploading={uploading}
            />
            {editingReference && editingDescriptor ? (
                <AgentContextScopeEditor
                    descriptor={editingDescriptor}
                    onPatch={(patch) => {
                        patchReferenceScope(editingReference.id, patch);
                    }}
                    reference={editingReference}
                    sourceLabel={internalSourceLabel(
                        t,
                        editingReference.ref,
                        editingReference.label,
                    )}
                />
            ) : null}
        </div>
    );
}
