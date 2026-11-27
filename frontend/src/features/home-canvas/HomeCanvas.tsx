import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import { usePlugins } from '../../shared/plugins/usePlugins';
import type { HomePreferences, StoredHomeBlock } from '../../shared/api/home-canvas';
import { GnosiApiError } from '../../shared/api/errors';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import { DEFAULT_BLOCKS, displayedBlocks, HOME_BLOCKS, makeBlock, moveBlock, type HomeBlockKind } from './model';
import { HomeBlockCard } from './HomeBlockCard';
import { HomeCatalog } from './HomeCatalog';
import { HomeHeader } from './HomeHeader';

interface Props {
    readonly preferences: HomePreferences;
    readonly onSave: (value: HomePreferences) => Promise<HomePreferences>;
    readonly onReload: () => Promise<HomePreferences | undefined>;
}

export default function HomeCanvas({ preferences, onSave, onReload }: Props) {
    const { t } = useTranslation();
    const { isEnabled } = usePlugins();
    const [editing, setEditing] = useState(false);
    const [blocksState, setBlocksState] = useState<readonly StoredHomeBlock[] | null>(null);
    const [catalog, setCatalog] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<'conflict' | 'save' | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const baseRef = useRef(preferences);
    const queuedRef = useRef<readonly StoredHomeBlock[] | null>(null);
    const savingRef = useRef(false);
    const editToggleRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!savingRef.current && queuedRef.current === null) {
            baseRef.current = preferences;
            setBlocksState(null);
        }
    }, [preferences]);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const blocks = blocksState ?? preferences.blocks ?? DEFAULT_BLOCKS;
    const available = HOME_BLOCKS.filter(def => def.plugins.every(isEnabled));
    const visible = displayedBlocks(blocks, available);
    const flushSave = async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError(null);
        try {
            while (queuedRef.current !== null) {
                const next = queuedRef.current;
                queuedRef.current = null;
                baseRef.current = await onSave({ ...baseRef.current, blocks: next });
            }
            setAnnouncement(t('home_canvas.saved'));
        } catch (cause) {
            setError(cause instanceof GnosiApiError && cause.status === 409 ? 'conflict' : 'save');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    const change = (update: (previous: readonly StoredHomeBlock[]) => readonly StoredHomeBlock[]) => {
        const next = update(blocks);
        setBlocksState(next);
        queuedRef.current = next;
        void flushSave();
    };
    const updateBlock = (id: string, patch: Partial<Pick<StoredHomeBlock, 'width' | 'height' | 'settings'>>) => {
        change(previous => previous.map(block => block.id === id ? { ...block, ...patch } : block));
    };
    const add = (kind: HomeBlockKind) => {
        const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
        change(previous => [...previous, makeBlock(kind, id)]);
        setCatalog(false);
        setAnnouncement(t('home_canvas.added'));
    };
    const move = (id: string, targetId?: string) => {
        if (!targetId) return;
        change(previous => moveBlock(previous, id, targetId));
        setAnnouncement(t('home_canvas.moved', { position: visible.findIndex(item => item.block.id === targetId) + 1 }));
    };
    const reload = async () => {
        const result = await onReload();
        if (result) {
            baseRef.current = result;
            queuedRef.current = null;
            setBlocksState(null);
            setError(null);
        }
    };
    const toggleEditing = (next: boolean) => {
        setEditing(next);
        if (!next) setCatalog(false);
    };
    return <div className="home-page" data-testid="home-canvas">
        <HomeHeader>
            {editing && <button type="button" className="btn-gnosi home-button" aria-expanded={catalog}
                aria-controls="home-block-catalog" onClick={() => { setCatalog(!catalog); }}><Plus size={16} />{t('home_canvas.add')}</button>}
            <div ref={editToggleRef} data-testid="home-edit">
                <GnosiToggle active={editing} onChange={() => { toggleEditing(!editing); }} label={t('home_canvas.edit')} />
            </div>
        </HomeHeader>
        <div className="home-page__content">
            {error && <div className="home-message" role="alert">{t(error === 'conflict' ? 'home_canvas.conflict' : 'home_canvas.save_error')}
                {error === 'conflict' && <button type="button" className="btn-gnosi home-button" onClick={() => { void reload(); }}>{t('home_canvas.load_saved')}</button>}
                {error === 'save' && <button type="button" className="btn-gnosi home-button" disabled={saving} onClick={() => { queuedRef.current = blocks; void flushSave(); }}>{t('home_canvas.retry')}</button>}
            </div>}
            {editing && catalog && <HomeCatalog available={available} blocks={blocks} onAdd={add} />}
            {visible.length === 0 && <div className="home-message"><span>{t('home_canvas.empty')}</span>
                <button type="button" className="btn-gnosi home-button" onClick={() => { setEditing(true); setCatalog(true); }}>
                    <Plus size={15} />{t('home_canvas.add')}</button>
            </div>}
            <DndContext sensors={sensors} collisionDetection={closestCenter}
                accessibility={{ screenReaderInstructions: { draggable: t('home_canvas.drag_help') }, announcements: {
                    onDragStart: () => t('home_canvas.drag_start'), onDragOver: ({ over }) => over
                        ? t('home_canvas.drag_position', { position: visible.findIndex(item => item.block.id === over.id) + 1 }) : undefined,
                    onDragEnd: () => t('home_canvas.drag_end'), onDragCancel: () => t('common.cancel'),
                } }}
                onDragEnd={({ active, over }) => { if (editing && over && active.id !== over.id) move(String(active.id), String(over.id)); }}>
                <SortableContext items={visible.map(item => item.block.id)} strategy={rectSortingStrategy}>
                    <div className="home-grid">
                        {visible.map(({ block, definition }, index) => <HomeBlockCard key={block.id} block={block}
                            definition={definition} editing={editing}
                            onConfigure={settings => { updateBlock(block.id, { settings }); }}
                            onWidth={width => { updateBlock(block.id, { width }); }}
                            onHeight={height => { updateBlock(block.id, { height }); }}
                            onRemove={() => { change(previous => previous.filter(item => item.id !== block.id)); editToggleRef.current?.querySelector('button')?.focus(); }}
                            onEarlier={index > 0 ? () => { move(block.id, visible[index - 1]?.block.id); } : undefined}
                            onLater={index < visible.length - 1 ? () => { move(block.id, visible[index + 1]?.block.id); } : undefined} />)}
                    </div>
                </SortableContext>
            </DndContext>
            <p className="sr-only" role="status">{announcement}</p>
        </div>
    </div>;
}
