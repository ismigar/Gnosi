import { ViewDialog } from './page-view-modal/ViewDialog';
import { useViewController } from './page-view-modal/useViewController';
import type { PageViewModalProps } from './page-view-modal/types';

export function PageViewModal(props: PageViewModalProps) {
    const { panelRef, ...view } = useViewController(props);
    return props.isOpen ? <ViewDialog panelRef={panelRef} view={view} /> : null;
}
