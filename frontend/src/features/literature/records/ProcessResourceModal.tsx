import { useRef } from 'react';

import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { ProcessResourceModalView } from './process-resource/ProcessResourceModalView';
import type { ProcessResourceModalProps } from './process-resource/processResourceModel';
import { useProcessResourceController } from './process-resource/useProcessResourceController';


export type { ProcessResourceModalProps } from './process-resource/processResourceModel';


export function ProcessResourceModal(
    props: ProcessResourceModalProps,
) {
    const { isOpen, title } = props;
    const modalRef = useRef<HTMLDivElement>(null);
    const processState = useProcessResourceController(props);

    useModalKeyboard({
        confirmDisabled: processState.state !== 'confirm' || !processState.canStart,
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
            estimate={processState.estimate}
            estimateError={processState.estimateError}
            budgetLimit={processState.budgetLimit}
            onBudgetLimit={processState.setBudgetLimit}
            batchSize={processState.batchSize}
            onBatchSize={processState.setBatchSize}
            canStart={processState.canStart}
            error={processState.error}
            force={processState.force}
            fresh={processState.fresh}
            onReprocess={processState.reprocess}
            job={processState.job}
            modalRef={modalRef}
            onCancel={processState.dismiss}
            onDismiss={processState.dismiss}
            onStart={() => {
                void processState.start();
            }}
            state={processState.state}
            title={title}
        />
    );
}
