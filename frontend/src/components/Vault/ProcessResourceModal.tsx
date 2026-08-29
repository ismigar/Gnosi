import { useRef } from 'react';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { ProcessResourceModalView } from './process-resource/ProcessResourceModalView';
import type { ProcessResourceModalProps } from './process-resource/processResourceModel';
import { useProcessResourceController } from './process-resource/useProcessResourceController';


export type { ProcessResourceModalProps } from './process-resource/processResourceModel';


export function ProcessResourceModal(
    props: ProcessResourceModalProps,
) {
    const { force = false, isOpen, onClose, title } = props;
    const modalRef = useRef<HTMLDivElement>(null);
    const processState = useProcessResourceController(props);

    useModalKeyboard({
        confirmDisabled: processState.state !== 'confirm',
        containerRef: modalRef,
        isOpen,
        onClose: processState.dismiss,
        onConfirm: () => {
            if (processState.state === 'confirm') {
                void processState.start();
            }
        },
        trapFocus: true,
    });

    if (!isOpen) return null;

    return (
        <ProcessResourceModalView
            error={processState.error}
            force={force}
            job={processState.job}
            modalRef={modalRef}
            onCancel={onClose}
            onDismiss={processState.dismiss}
            onStart={() => {
                void processState.start();
            }}
            state={processState.state}
            title={title}
        />
    );
}
