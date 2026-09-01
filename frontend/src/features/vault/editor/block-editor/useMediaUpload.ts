import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { uploadVaultAsset } from '../../../../shared/api/vault-specialized';
import { countMediaBlocks } from './media';
import type { GnosiEditor } from './schema';
import type { CodeEditorMetadata } from './codeTypes';

/** Stable upload callback: changing metadata must never recreate BlockNote. */
export function useMediaUpload(tableId: string, metadataRef: RefObject<CodeEditorMetadata>, editorRef: RefObject<GnosiEditor | null>) {
    const tableIdRef = useRef(tableId);
    useEffect(() => { tableIdRef.current = tableId; }, [tableId]);
    return useCallback(async (file: File) => {
        const title = (metadataRef.current.title || '').trim();
        let targetName: string | undefined;
        if (title) {
            const index = countMediaBlocks(editorRef.current?.document) + 1;
            targetName = index > 1 ? `${title} ${String(index)}` : title;
        }
        return (await uploadVaultAsset(file, { tableId: tableIdRef.current, targetName })).url;
    }, [editorRef, metadataRef]);
}
