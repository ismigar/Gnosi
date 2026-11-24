import { Component, lazy, Suspense, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, GripVertical, X } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { legacyBrowserPathToCanonical } from '../../shared/routing/vaultRouting';
import type { BlockDefinition, HomeBlockProps, HomeBlock } from './model';

const KnowledgeBlocks = lazy(() => import('./knowledge/KnowledgeBlocks'));
const DayBlocks = lazy(() => import('./day/DayBlocks'));
const OptionalBlock = lazy(() => import('./apps/OptionalBlock'));

class BlockBoundary extends Component<{ children: ReactNode; label: string; retry: string }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() {
        if (this.state.failed) return <div role="alert" className="home-block__state">
            <p>{this.props.label}</p>
            <button type="button" className="btn-gnosi" onClick={() => { this.setState({ failed: false }); }}>{this.props.retry}</button>
        </div>;
        return this.props.children;
    }
}

interface CardProps extends HomeBlockProps {
    readonly definition: BlockDefinition;
    readonly onWidth: (width: HomeBlock['width']) => void;
    readonly onRemove: () => void;
    readonly onEarlier?: () => void;
    readonly onLater?: () => void;
}

export function HomeBlockCard({ block, editing, definition, onConfigure, onWidth, onRemove, onEarlier, onLater }: CardProps) {
    const { t } = useTranslation();
    const { setNodeRef, setActivatorNodeRef, isDragging, transform, transition, attributes, listeners } = useSortable({ id: block.id, disabled: !editing });
    const title = t(definition.titleKey);
    const app = t(definition.appKey);
    const Body = block.kind === 'board' || block.kind === 'graph' ? KnowledgeBlocks
        : block.kind === 'agenda' || block.kind === 'audio' ? DayBlocks : OptionalBlock;
    return <section ref={setNodeRef} aria-label={title} data-home-block={block.kind} data-width={block.width}
        className={'home-block' + (isDragging ? ' home-block--dragging' : '')}
        style={{ transform: CSS.Translate.toString(transform), transition }}>
        <header className="home-block__header">
            <div><h2>{title}</h2></div>
            {definition.route && <Link className="home-block__icon" to={legacyBrowserPathToCanonical(definition.route)}
                aria-label={t('home_canvas.open_app', { app })} title={t('home_canvas.open_app', { app })}><ArrowUpRight size={17} /></Link>}
        </header>
        <div className="home-block__body">
            <BlockBoundary label={t('home_canvas.block_error')} retry={t('home_canvas.retry')}>
                <Suspense fallback={<p className="home-block__state" role="status">{t('common.loading')}</p>}>
                    <Body block={block} editing={editing} onConfigure={onConfigure} />
                </Suspense>
            </BlockBoundary>
        </div>
        {editing && <div className="home-block__tools">
            <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
                className="home-block__icon home-block__handle" aria-label={t('home_canvas.move_named', { title })}>
                <GripVertical size={16} />
            </button>
            <select className="home-field" aria-label={t('home_canvas.width_named', { title })} value={block.width}
                onChange={event => { onWidth(Number(event.target.value) as HomeBlock['width']); }}>
                {([1, 2, 3] as const).map(width => <option key={width} value={width}>{t('home_canvas.columns_' + String(width))}</option>)}
            </select>
            <button type="button" className="home-block__icon" disabled={!onEarlier} onClick={onEarlier}
                aria-label={t('home_canvas.earlier', { title })} title={t('home_canvas.earlier', { title })}><ArrowUp size={15} /></button>
            <button type="button" className="home-block__icon" disabled={!onLater} onClick={onLater}
                aria-label={t('home_canvas.later', { title })} title={t('home_canvas.later', { title })}><ArrowDown size={15} /></button>
            <button type="button" className="home-block__icon" onClick={onRemove}
                aria-label={t('home_canvas.remove_named', { title })} title={t('home_canvas.remove_named', { title })}><X size={15} /></button>
        </div>}
    </section>;
}
