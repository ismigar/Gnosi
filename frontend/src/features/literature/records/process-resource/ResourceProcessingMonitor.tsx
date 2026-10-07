import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Maximize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../../../shared/hooks/useModalKeyboard';
import { useProcessResourceController } from './useProcessResourceController';
import { ProcessResourceModalView } from './ProcessResourceModalView';
import { getProcessPhase, getProgressPercent } from './processResourceModel';
import { dismissResourceProcessingTask, resetResourceProcessingTasks, useResourceProcessingTasks, type ResourceProcessingTask } from './resourceProcessingTasks';
import './resource-processing-monitor.css';

function ProcessingDetails({ task, onClose }: { readonly task: ResourceProcessingTask; readonly onClose: () => void }) {
    const controller = useProcessResourceController({ isOpen: true, keepBackground: true,
        noteId: task.noteId, sourceTableId: task.sourceTableId, title: task.title, onClose });
    const modalRef = useRef<HTMLDivElement>(null);
    useModalKeyboard({ containerRef: modalRef, isOpen: true, onClose, trapFocus: true });
    return <ProcessResourceModalView estimate={controller.estimate} estimateError={controller.estimateError}
        budgetLimit={controller.budgetLimit} onBudgetLimit={controller.setBudgetLimit}
        batchSize={controller.batchSize} onBatchSize={controller.setBatchSize} canStart={controller.canStart}
        error={task.error} force={controller.force} fresh={controller.fresh} onReprocess={controller.reprocess} job={task.job} modalRef={modalRef}
        onCancel={onClose} onDismiss={onClose} onStart={() => { void controller.start(); }}
        state={task.state} title={task.title} />;
}

function ProcessingCard({ task, onOpen }: { readonly task: ResourceProcessingTask; readonly onOpen: () => void }) {
    const { t } = useTranslation();
    const phase = getProcessPhase(task.job);
    const progress = getProgressPercent(task.job);
    const running = task.state === 'running';
    const needsReview = (task.job?.warnings?.length ?? 0) > 0;
    const Icon = running ? Loader2 : task.state === 'done' && !needsReview ? CheckCircle2 : AlertTriangle;
    const status = running ? t(`llm_wiki.phase_${phase.key}`, phase.defaultLabel)
        : task.state === 'done' ? needsReview ? t('llm_wiki.done_with_warnings', 'Saved with observations to review') : t('llm_wiki.done_title', 'Resource processed')
            : t('llm_wiki.background_error', 'Processing needs attention');
    return <article className="resource-processing-card">
        <button type="button" className="resource-processing-card-open" onClick={onOpen}
            aria-label={t('llm_wiki.background_open', { defaultValue: 'Show processing details: {{title}}', title: task.title || t('llm_wiki.modal_title') })}>
            <Icon size={18} aria-hidden="true" className={running ? 'animate-spin text-[var(--gnosi-primary)]' : task.state === 'done' && !needsReview ? 'text-green-500' : 'text-[var(--status-warning)]'} />
            <span className="resource-processing-card-content">
                <span className="resource-processing-card-title">{task.title || t('llm_wiki.modal_title', 'Process resource into the Brain')}</span>
                <span className="resource-processing-card-status" role="status">{status}</span>
                {(task.job?.chunks_total ?? 0) > 0 && <span className="resource-processing-card-status">
                    {t('llm_wiki.fragments_progress', { defaultValue: '{{count}} of {{total}} fragments completed', count: task.job?.chunks_done ?? 0, total: task.job?.chunks_total ?? 0 })}
                </span>}
                {running && <span className="resource-processing-card-progress" role="progressbar" aria-label={status}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}>
                    <span className={progress === null ? 'animate-pulse' : ''} style={{ width: `${String(progress ?? 25)}%` }} />
                </span>}
            </span>
            <Maximize2 size={14} aria-hidden="true" />
        </button>
        {!running && <button type="button" className="gnosi-close-btn" onClick={() => { dismissResourceProcessingTask(task.id); }}
            aria-label={t('llm_wiki.background_dismiss', { defaultValue: 'Dismiss processing result: {{title}}', title: task.title || t('llm_wiki.modal_title') })}><X /></button>}
    </article>;
}

export function ResourceProcessingMonitor() {
    const { t } = useTranslation();
    const tasks = useResourceProcessingTasks();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = tasks.find(task => task.id === selectedId && task.background);
    const background = tasks.filter(task => task.background);
    // The shell remounts this monitor on Vault or account changes, never on navigation.
    useEffect(() => () => { resetResourceProcessingTasks(); }, []);
    return <>
        {background.length > 0 && <section className="resource-processing-monitor" aria-label={t('llm_wiki.background_title', 'Resource processing')}>
            {background.map(task => <ProcessingCard key={task.id} task={task} onOpen={() => { setSelectedId(task.id); }} />)}
        </section>}
        {selected && <ProcessingDetails task={selected} onClose={() => { setSelectedId(null); }} />}
    </>;
}
