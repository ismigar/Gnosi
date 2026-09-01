import { fileUrlToSentinel } from '../../../../shared/editor/markdown-mapper';
import {
    linkExistingVaultFile,
    registerLocalVaultFile,
    uploadVaultInsertFile,
} from '../../../../shared/api/vault-content';
import { assertFileReadable } from './insertContentFile';
import type { InsertFileField } from './insertContentTypes';


export interface InsertTransferContext {
    readonly fileField: InsertFileField | null;
    readonly isFieldUpload: boolean;
    readonly resolvedName: string;
    readonly tableId: string | null;
}


export interface InsertTransferFeedback {
    readonly onMaterializing: (active: boolean) => void;
    readonly onProgress: (percentage: number) => void;
}


export async function performInsertUpload(
    file: File,
    destinationFolder: string,
    context: InsertTransferContext,
    feedback: InsertTransferFeedback,
): Promise<string> {
    try {
        await assertFileReadable(file, {
            onDownloading: () => {
                feedback.onMaterializing(true);
            },
        });
    } finally {
        feedback.onMaterializing(false);
    }
    const data = await uploadVaultInsertFile(file, {
        destFolder: context.isFieldUpload ? destinationFolder : undefined,
        onProgress: (event) => {
            if (event.total) {
                feedback.onProgress(Math.round((event.loaded / event.total) * 100));
            }
        },
        propertyName: context.isFieldUpload
            ? context.fileField?.propertyName || undefined
            : undefined,
        storageFolder: context.isFieldUpload
            ? context.fileField?.storageFolder || 'assets'
            : undefined,
        tableId: context.tableId || undefined,
        targetName: context.isFieldUpload && context.resolvedName
            ? context.resolvedName
            : undefined,
    });
    return data.url || data.path;
}


export async function registerInsertLocalFile(
    path: string,
    context: InsertTransferContext,
): Promise<string> {
    if (context.isFieldUpload) {
        const data = await linkExistingVaultFile(path, context.resolvedName);
        return data.url || data.path;
    }
    const data = await registerLocalVaultFile(path);
    return data.url;
}


export function localFolderSentinel(path: string): string {
    const sentinel: unknown = fileUrlToSentinel(`file://${path}`);
    if (typeof sentinel !== 'string') {
        throw new TypeError('The local folder URL could not be normalized');
    }
    return sentinel;
}
