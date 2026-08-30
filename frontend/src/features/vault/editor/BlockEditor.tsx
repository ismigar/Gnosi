import { EditorInner } from './block-editor/EditorInner';
import { BlockEditor as PageEditor } from './block-editor/page-editor/PageEditor';
import type { PublicBlockEditorProps } from './block-editor/page-editor/types';

/** Keep the public editor entry stable while domains own their implementation. */
export function BlockEditor(props: PublicBlockEditorProps) {
    return <PageEditor {...props} EditorInner={EditorInner} />;
}

export { EditorInner };
export type { PublicBlockEditorProps } from './block-editor/page-editor/types';
export default BlockEditor;
