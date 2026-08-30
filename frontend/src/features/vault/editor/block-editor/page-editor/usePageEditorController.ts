import { usePageEditorState } from './usePageEditorState';
import { usePageMetadata } from './usePageMetadata';
import { usePageProperties } from './usePageProperties';
import { usePropertyNavigation } from './usePropertyNavigation';
import { usePageLinks } from './usePageLinks';
import { usePageLayout } from './usePageLayout';
import { usePageContext } from './usePageContext';
import type { PageEditorProps } from './types';
export function usePageEditorController(props: PageEditorProps) {
  const s0 = usePageEditorState(props);
  const s1 = usePageMetadata({ ...s0 });
  const s2 = usePageProperties({ ...s0, ...s1 });
  const s3 = usePropertyNavigation({ ...s0, ...s1, ...s2 });
  const s4 = usePageLinks({ ...s0, ...s1, ...s2, ...s3 });
  const s5 = usePageLayout({ ...s0, ...s1, ...s2, ...s3, ...s4 });
  const s6 = usePageContext({ ...s0, ...s1, ...s2, ...s3, ...s4, ...s5 });
  return { ...s0, ...s1, ...s2, ...s3, ...s4, ...s5, ...s6 };
}
export type PageEditorController = ReturnType<typeof usePageEditorController>;
