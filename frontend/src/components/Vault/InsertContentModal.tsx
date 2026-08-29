import { InsertContentModalView } from './insert-content/InsertContentModalView';
import type { InsertContentModalProps } from './insert-content/insertContentTypes';
import { useInsertContentController } from './insert-content/useInsertContentController';


function OpenInsertContentModal(props: InsertContentModalProps) {
    const modal = useInsertContentController(props);
    return <InsertContentModalView modal={modal} onClose={props.onClose} />;
}


export function InsertContentModal(props: InsertContentModalProps) {
    if (!props.open) return null;
    return <OpenInsertContentModal {...props} />;
}


InsertContentModal.displayName = 'InsertContentModal';


export type {
    InsertContentModalProps,
    InsertContentResult,
    InsertFileField,
    InsertImageMetadata,
} from './insert-content/insertContentTypes';
