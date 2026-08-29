import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useApi } from '../../../hooks/use-api';
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { ConfirmModal } from '../../ConfirmModal';
import { PageCommentsPanel } from './PageCommentsPanel';
import type { PageCommentsProps } from './types';
import { usePageCommentsController } from './usePageCommentsController';


export function PageCommentsComponent(props: PageCommentsProps) {
    const { onClose, open, pageId } = props;
    const { t } = useTranslation();
    const { role } = useApi();
    const canComment = role !== 'viewer';
    const panelRef = useRef<HTMLDivElement>(null);
    const controller = usePageCommentsController({ open, pageId });

    useModalKeyboard({
        closeOnEscape: !controller.deleteTarget,
        containerRef: panelRef,
        isOpen: open,
        onClose,
        trapFocus: true,
    });

    if (!open) return null;

    return (
        <>
            <PageCommentsPanel
                {...props}
                canComment={canComment}
                controller={controller}
                panelRef={panelRef}
            />
            <ConfirmModal
                confirmText={t('common.delete', 'Delete')}
                isDestructive
                isOpen={Boolean(controller.deleteTarget)}
                message={t(
                    'comments.delete_msg',
                    'Are you sure you want to delete this comment?',
                )}
                onClose={() => {
                    controller.selectDeleteTarget(null);
                }}
                onConfirm={controller.deleteComment}
                title={t('comments.delete_title', 'Delete comment')}
            />
        </>
    );
}
