import { ArrowDown, ArrowUp, GripVertical, IndentDecrease, IndentIncrease } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TimelineController } from './types';

export function TimelineRowActions({ controller, id, onDrag }: {
    readonly controller: TimelineController;
    readonly id: string;
    readonly onDrag: (id: string | null) => void;
}) {
    const { t } = useTranslation();
    const actions = [['up', ArrowUp], ['down', ArrowDown], ['indent', IndentIncrease], ['outdent', IndentDecrease]] as const;
    return <div className="flex shrink-0 items-center gap-0.5">
        <span draggable={controller.canMoveRow(id)}
            onDragStart={event => {
                event.dataTransfer.setData('text/plain', id);
                event.dataTransfer.effectAllowed = 'move';
                onDrag(id);
            }} onDragEnd={() => { onDrag(null); }}
            title={t('timeline.drag_row')} className="cursor-grab text-[var(--text-tertiary)]"
        ><GripVertical size={13} /></span>
        {actions.map(([action, Icon]) => <button key={action} type="button"
            disabled={!controller.canMoveRow(id, action) || controller.saving}
            title={t(`timeline.move_${action}`)} aria-label={t(`timeline.move_${action}`)}
            className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            onClick={() => { void controller.moveRow(id, action); }}
        ><Icon size={12} /></button>)}
    </div>;
}
