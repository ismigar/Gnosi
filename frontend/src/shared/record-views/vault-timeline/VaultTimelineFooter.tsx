import { useEffect, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TimelineController } from './types';

export function VaultTimelineFooter({ controller }: { readonly controller: TimelineController }) {
    const { t } = useTranslation();
    const horizontal = useRef<HTMLDivElement>(null);
    const contentWidth = controller.columnWidth + Number.parseFloat(controller.scaleMinWidth);
    useEffect(() => {
        const element = horizontal.current;
        if (element && Math.abs(element.scrollLeft - controller.scrollLeft) > 0.5) element.scrollLeft = controller.scrollLeft;
    }, [controller.scrollLeft]);
    return <div data-timeline-footer className="sticky bottom-0 z-40 shrink-0 bg-[var(--bg-primary)]">
        <div ref={horizontal} data-timeline-horizontal-scroll tabIndex={0}
            aria-label={t('timeline.horizontal_scroll', 'Horizontal timeline scroll')}
            className="custom-scrollbar border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]"
            style={{ width: controller.viewportWidth, maxWidth: '100%', height: 16, overflowX: 'scroll', overflowY: 'hidden' }}
            onScroll={event => {
                const body = document.getElementById(controller.scrollContainerId);
                if (body && Math.abs(body.scrollLeft - event.currentTarget.scrollLeft) > 0.5) body.scrollLeft = event.currentTarget.scrollLeft;
            }}>
            <div aria-hidden="true" style={{ width: contentWidth, height: 1 }} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-[10px] font-medium text-[var(--text-tertiary)]">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded bg-[var(--gnosi-primary)]" />
                    <span>{t('timeline.legend_page', 'Page / Task')}</span>
                </div>
                <div className="flex items-center gap-1.5 font-bold text-[var(--gnosi-primary)]">
                    <ArrowRight size={10} />
                    <span>{t(
                        'timeline.active_deps',
                        '{{count}} dependencies',
                        { count: controller.chartData.reduce((count, note) => count + controller.getPredecessors(note).length, 0) },
                    )}</span>
                </div>
            </div>
            <div>
                {t(
                    'timeline.footer_hint',
                    'Drag tasks to move them, their edges to resize them, and the connection point to link a successor.',
                )}
            </div>
        </div>
    </div>;
}
