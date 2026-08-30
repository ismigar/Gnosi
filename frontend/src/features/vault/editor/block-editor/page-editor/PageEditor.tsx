import { PageEditorView } from './PageEditorView';
import { usePageEditorController } from './usePageEditorController';
import type { PageEditorProps } from './types';
export function BlockEditor(props: PageEditorProps) {
  return <PageEditorView context={usePageEditorController(props)} />;
}
