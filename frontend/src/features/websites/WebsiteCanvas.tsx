import { useEffect, useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, closestCenter, pointerWithin } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { previewSiteImage, type SiteBlock, type SiteConfig } from '../../shared/api/sites';
import { useWebsiteAssets } from './websiteAssetContext';
import { ReorderActions } from './components';
import layoutCss from '../../../../extensions/web-publishing/renderer/src/lib/page-layout.css?raw';

function ImagePreview({ source, alt }: { source: string; alt: string }) {
  const { siteId, context } = useWebsiteAssets() ?? {}; const [preview, setPreview] = useState({ source: '', url: '' });
  useEffect(() => {
    if (!siteId || !context || !source) return;
    const controller = new AbortController(); let url = '';
    void previewSiteImage(siteId, source, context, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setPreview({ source, url });
    }).catch(() => undefined);
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [siteId, context, source]);
  return preview.source === source && preview.url ? <img src={preview.url} alt={alt} /> : <div className="websites-image-placeholder">{alt || source || '▧'}</div>;
}

function HtmlPreview({ body, title, legacy }: { body: string; title: string; legacy: boolean }) {
  const { siteId, context } = useWebsiteAssets() ?? {}; const [preview, setPreview] = useState({ body: '', html: '' });
  useEffect(() => {
    const controller = new AbortController(); const urls: string[] = [];
    const document = new DOMParser().parseFromString(body, 'text/html');
    // The iframe is opaque and scriptless. No imported network resources may load.
    for (const node of document.querySelectorAll('script,style,link,iframe,object,embed,form,base,meta')) node.remove();
    const images = [...document.querySelectorAll('img')];
    const sources = images.map(image => image.getAttribute('src') || '');
    for (const image of images) { image.removeAttribute('src'); image.removeAttribute('srcset'); }
    const update = () => { if (!controller.signal.aborted) setPreview({ body, html: document.body.innerHTML }); };
    update();
    void Promise.all(images.map(async (image, index) => {
      if (!siteId || !context || !sources[index]?.startsWith('/')) return;
      try { const blob = await previewSiteImage(siteId, sources[index], context, controller.signal); if (controller.signal.aborted) return; const url = URL.createObjectURL(blob); urls.push(url); image.src = url; } catch { /* Keep alt text for unavailable images. */ }
    })).then(update);
    return () => { controller.abort(); urls.forEach(url => { URL.revokeObjectURL(url); }); };
  }, [body, siteId, context]);
  const html = preview.body === body ? preview.html : '';
  return <iframe title={title} sandbox="" tabIndex={-1} srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src 'unsafe-inline'"><style>body{font:16px/1.6 Georgia,serif;color:#264653;margin:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}.split{display:grid;grid-template-columns:1fr 1fr;gap:1rem}${layoutCss}</style><div class="${legacy ? 'temenos-site' : ''}"><div class="static-page-body">${html}</div></div>`} />;
}

function CanvasBlock({ block, site, selected, onSelect, index, length, onMove, onRemove }: { block: SiteBlock; site: SiteConfig; selected: boolean; onSelect: () => void; index: number; length: number; onMove: (offset: -1 | 1) => void; onRemove: () => void }) {
  const { t } = useTranslation(); const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id: block.id });
  const body = block.body_format === 'html' ? <HtmlPreview body={block.body} title={t('websites.visual.blockPreview')} legacy={site.legacy_pilot} /> : <ReactMarkdown components={{ img: ({ src, alt }) => <ImagePreview source={typeof src === 'string' ? src : ''} alt={alt || ''} />, a: ({ children }) => <span>{children}</span> }}>{block.body}</ReactMarkdown>;
  const image = <div style={{ padding: block.image_frame === 'inset' ? '4rem' : 0 }}><div style={{ width: `${String(block.image_width ?? 100)}%`, marginInline: block.alignment === 'center' ? 'auto' : block.alignment === 'right' ? 'auto 0' : '0 auto' }}><ImagePreview source={block.image} alt={block.alt} /></div></div>;
  const source = site.sources?.find(item => item.id === block.source_id);
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition: transition, width: `${String(block.width ?? 100)}%`, marginInline: block.alignment === 'center' ? 'auto' : block.alignment === 'right' ? 'auto 0' : '0 auto', padding: { compact: '8px', normal: '16px', generous: '32px' }[block.spacing ?? 'normal'] };
  return <section ref={setNodeRef} style={style} className="websites-canvas-block" data-block-id={block.id} data-selected={selected || undefined}>
    <div className="websites-canvas-block-tools"><button ref={setActivatorNodeRef} type="button" className="websites-button" {...attributes} {...listeners} aria-label={t('websites.visual.dragBlock')}><GripVertical size={16} /></button><button type="button" className="websites-button" aria-pressed={selected} onClick={onSelect}>{block.title || t(`websites.blockTypes.${block.type}`)}</button><ReorderActions index={index} length={length} move={onMove} remove={onRemove} /></div>
    <div className="websites-canvas-content" onClick={onSelect}>
      {block.title && <h3>{block.title}</h3>}
      {block.type === 'text' && body}
      {block.type === 'image' && image}
      {block.type === 'split' && <div className="websites-canvas-split" data-image={block.image_position}>{block.image_position === 'left' && image}<div>{body}</div>{block.image_position !== 'left' && image}</div>}
      {block.type === 'gallery' && <div className="websites-canvas-gallery" style={{ gridTemplateColumns: `repeat(${String(block.columns)},minmax(0,1fr))` }}>{block.images?.map((url, at) => <ImagePreview key={`${String(at)}:${url}`} source={url} alt={block.alt} />)}</div>}
      {['collection', 'selected', 'collaborators'].includes(block.type) && <div className="websites-notice">{source?.title || t(`websites.blockTypes.${block.type}`)} · {t('websites.visual.dataPreview', { count: block.limit })}</div>}
      {block.type === 'form' && <div className="websites-notice">{site.forms?.find(form => form.id === block.form_id)?.name || t('websites.blockTypes.form')}</div>}
      {block.type === 'cta' && <span className="websites-button">{block.body || block.title || t('websites.blockTypes.cta')}</span>}
    </div>
  </section>;
}

export function WebsiteCanvas({ site, blocks, selectedId, onSelect, onChange }: { site: SiteConfig; blocks: SiteBlock[]; selectedId: string; onSelect: (id: string) => void; onChange: (blocks: SiteBlock[]) => void }) {
  const { t } = useTranslation(); const [width, setWidth] = useState('desktop');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const blockName = (id: string | number) => { const block = blocks.find(item => item.id === id); return block?.title || t(`websites.blockTypes.${block?.type ?? 'text'}`); };
  const position = (id: string | number) => blocks.findIndex(item => item.id === id) + 1;
  const accessibility = { screenReaderInstructions: { draggable: t('websites.visual.dragInstructions') }, announcements: {
    onDragStart: ({ active }: { active: { id: string | number } }) => t('websites.visual.dragPicked', { name: blockName(active.id) }),
    onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) => over ? t('websites.visual.dragPosition', { name: blockName(active.id), position: position(over.id), total: blocks.length }) : t('websites.visual.dragOutside'),
    onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) => t('websites.visual.dragDropped', { name: blockName(active.id), position: position(over?.id ?? active.id) }),
    onDragCancel: () => t('websites.visual.dragCancelled'),
  } };
  return <div><div className="websites-actions">{['desktop', 'mobile'].map(value => <button type="button" key={value} className="websites-button" aria-pressed={width === value} onClick={() => { setWidth(value); }}>{t(`websites.visual.${value}`)}</button>)}<span className="websites-muted">{t('websites.visual.previewHint')}</span></div>
    <DndContext sensors={sensors} accessibility={accessibility} collisionDetection={args => { const within = pointerWithin(args); return within.length ? within : closestCenter(args); }} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) { const from = blocks.findIndex(block => block.id === active.id); const to = blocks.findIndex(block => block.id === over.id); if (from >= 0 && to >= 0) onChange(arrayMove(blocks, from, to)); } }}>
      <SortableContext items={blocks.map(block => block.id)} strategy={verticalListSortingStrategy}><div className="websites-canvas" data-width={width}>{blocks.map((block, index) => <CanvasBlock key={block.id} site={site} block={block} selected={block.id === selectedId} onSelect={() => { onSelect(block.id); }} index={index} length={blocks.length} onMove={offset => { onChange(arrayMove(blocks, index, index + offset)); }} onRemove={() => { onChange(blocks.filter(item => item.id !== block.id)); }} />)}</div></SortableContext>
    </DndContext>
  </div>;
}
