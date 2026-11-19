import { ViewDialog } from './page-view-modal/ViewDialog';
import { useViewController } from './page-view-modal/useViewController';
import type { PageViewModalProps } from './page-view-modal/types';

export function PageViewModal(props: PageViewModalProps) {
    return props.isOpen ? <OpenPageViewModal key={props.pageId} {...props} /> : null;
}

function OpenPageViewModal(props: PageViewModalProps) {
    const { panelRef, ...view } = useViewController(props);
    return <ViewDialog panelRef={panelRef} view={view} />;
}
