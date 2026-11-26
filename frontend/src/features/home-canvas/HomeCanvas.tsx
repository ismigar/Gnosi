import { useRef, useState } from 'react';
import { Check, Pencil, Plus } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import { usePlugins } from '../../shared/plugins/usePlugins';
import type { HomePreferences, StoredHomeBlock } from '../../shared/api/home-canvas';
import { GnosiApiError } from '../../shared/api/errors';
import { DEFAULT_BLOCKS, displayedBlocks, HOME_BLOCKS, makeBlock, moveBlock, type HomeBlockKind } from './model';
import { HomeBlockCard } from './HomeBlockCard';
import { HomeCatalog } from './HomeCatalog';
import { HomeHeader } from './HomeHeader';

interface Props {
    readonly preferences: HomePreferences;
    readonly onSave: (value: HomePreferences) => Promise<HomePreferences>;
    readonly onReload: () => Promise<HomePreferences | undefined>;
}
interface Draft { readonly base: HomePreferences; readonly blocks: readonly StoredHomeBlock[] }

export default function HomeCanvas({ preferences, onSave, onReload }: Props) {
    const { t } = useTranslation();
    const { isEnabled } = usePlugins();
    const [draft, setDraft] = useState<Draft | null>(null);
    const [catalog, setCatalog] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<'conflict' | 'save' | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const pending = useRef(false);
    const editButton = useRef<HTMLButtonElement>(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const blocks = draft?.blocks ?? preferences.blocks ?? DEFAULT_BLOCKS;
    const available = HOME_BLOCKS.filter(def => def.plugins.every(isEnabled));
    const visible = displayedBlocks(blocks, available);
    const begin = (base = preferences) => { setDraft({ base, blocks: base.blocks ?? DEFAULT_BLOCKS }); setError(null); };
    const finish = () => { setDraft(null); setCatalog(false); setError(null); };
    const change = (update: (previous: readonly StoredHomeBlock[]) => readonly StoredHomeBlock[]) => {
        setDraft(previous => previous ? { ...previous, blocks: update(previous.blocks) } : previous);
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
    const save = async () => {
        if (!draft || pending.current) return;
        pending.current = true; setSaving(true); setError(null);
        try {
            await onSave({ ...draft.base, blocks: draft.blocks });
            finish();
            setAnnouncement(t('home_canvas.saved'));
        } catch (cause) {
            setError(cause instanceof GnosiApiError && cause.status === 409 ? 'conflict' : 'save');
        } finally { pending.current = false; setSaving(false); }
    };
    const reload = async () => {
        const result = await onReload();
        if (result) begin(result);
    };
    return <div className="home-page" data-testid="home-canvas">
        <HomeHeader>
            {draft ? <>
                <button type="button" className="btn-gnosi home-button" disabled={saving} aria-expanded={catalog}
                    aria-controls="home-block-catalog" onClick={() => { setCatalog(!catalog); }}><Plus size={16} />{t('home_canvas.add')}</button>
                <button type="button" className="btn-gnosi home-button" disabled={saving} onClick={finish}>{t('common.cancel')}</button>
            </> : null}
            <button type="button" ref={editButton} className={'btn-gnosi ' + (draft ? 'btn-gnosi-primary' : 'home-button')}
                disabled={saving} data-testid="home-edit" onClick={() => { if (draft) void save(); else begin(); }}>
                {draft ? <Check size={16} /> : <Pencil size={15} />}
                {draft ? t(saving ? 'home_canvas.saving' : 'common.save') : t('home_canvas.edit')}
            </button>
        </HomeHeader>
        <div className="home-page__content">
            {error && <div className="home-message" role="alert">{t(error === 'conflict' ? 'home_canvas.conflict' : 'home_canvas.save_error')}
                {error === 'conflict' && <button type="button" className="btn-gnosi home-button" onClick={() => { void reload(); }}>{t('home_canvas.load_saved')}</button>}
            </div>}
            {draft && catalog && <div inert={saving}><HomeCatalog available={available} blocks={blocks} onAdd={add} /></div>}
            {visible.length === 0 && <div className="home-message"><span>{t('home_canvas.empty')}</span>
                <button type="button" className="btn-gnosi home-button" disabled={saving} onClick={() => { if (!draft) begin(); setCatalog(true); }}>
                    <Plus size={15} />{t('home_canvas.add')}</button>
            </div>}
            <DndContext sensors={sensors} collisionDetection={closestCenter}
                accessibility={{ screenReaderInstructions: { draggable: t('home_canvas.drag_help') }, announcements: {
                    onDragStart: () => t('home_canvas.drag_start'), onDragOver: ({ over }) => over
                        ? t('home_canvas.drag_position', { position: visible.findIndex(item => item.block.id === over.id) + 1 }) : undefined,
                    onDragEnd: () => t('home_canvas.drag_end'), onDragCancel: () => t('common.cancel'),
                } }}
                onDragEnd={({ active, over }) => { if (draft && over && active.id !== over.id) move(String(active.id), String(over.id)); }}>
                <SortableContext items={visible.map(item => item.block.id)} strategy={rectSortingStrategy}>
                    <div className="home-grid" inert={saving}>
                        {visible.map(({ block, definition }, index) => <HomeBlockCard key={block.id} block={block}
                            definition={definition} editing={draft !== null}
                            onConfigure={settings => { updateBlock(block.id, { settings }); }}
                            onWidth={width => { updateBlock(block.id, { width }); }}
                            onHeight={height => { updateBlock(block.id, { height }); }}
                            onRemove={() => { change(previous => previous.filter(item => item.id !== block.id)); editButton.current?.focus(); }}
                            onEarlier={index > 0 ? () => { move(block.id, visible[index - 1]?.block.id); } : undefined}
                            onLater={index < visible.length - 1 ? () => { move(block.id, visible[index + 1]?.block.id); } : undefined} />)}
                    </div>
                </SortableContext>
            </DndContext>
            <p className="sr-only" role="status">{announcement}</p>
        </div>
    </div>;
}
