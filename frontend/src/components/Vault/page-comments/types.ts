import type { RefObject } from 'react';

import type { VaultPageComment } from '../../../shared/api/vault-comments';


export interface PageCommentsProps {
    readonly onClose: () => unknown;
    readonly open: boolean;
    readonly pageId: string;
    readonly pageTitle?: string | null;
}


export interface PageCommentsController {
    readonly comments: readonly VaultPageComment[];
    readonly deleteComment: () => Promise<void>;
    readonly deleteTarget: VaultPageComment | null;
    readonly draft: string;
    readonly editDraft: string;
    readonly editingId: string | null;
    readonly loading: boolean;
    readonly saveEdit: (commentId: string) => Promise<void>;
    readonly selectDeleteTarget: (comment: VaultPageComment | null) => void;
    readonly setDraft: (draft: string) => void;
    readonly setEditDraft: (draft: string) => void;
    readonly startEditing: (comment: VaultPageComment) => void;
    readonly stopEditing: () => void;
    readonly submitComment: () => Promise<void>;
    readonly submitting: boolean;
    readonly toggleResolved: (comment: VaultPageComment) => Promise<void>;
}


export interface PageCommentsPanelProps extends PageCommentsProps {
    readonly canComment: boolean;
    readonly controller: PageCommentsController;
    readonly panelRef: RefObject<HTMLDivElement | null>;
}
