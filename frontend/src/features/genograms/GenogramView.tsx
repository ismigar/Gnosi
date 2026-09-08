import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { genogramRequestContext } from '../../shared/api/genograms';
import { emitAppEvent, subscribeAppEvent } from '../../shared/platform/app-events';
import { GenogramScene } from './scene';
import { legendHeight, legendKeys } from './legend';
import { RecordEditor, type EditorTarget } from './RecordEditor';
import { useGenogram, type GenogramViewProps } from './useGenogram';
import { boxNumbers, personOptionLabel, type Position } from './model';
import { errorMessage } from './errors';
import './genograms.css';

export default function GenogramView(props: GenogramViewProps) {
  const [scope, setScope] = useState(genogramRequestContext().vaultId);
  useEffect(() => subscribeAppEvent('gnosi:vault-changed', () => { setScope(genogramRequestContext().vaultId); }), []);
  const viewId = typeof props.view.id === 'string' ? props.view.id : 'embedded';
  return <GenogramWorkspace key={`${scope}:${viewId}`} {...props} />;
}

function GenogramWorkspace(props: GenogramViewProps) {
  const { t } = useTranslation();
  const model = useGenogram(props);
  const { config, update, network, layout, visible, loading, error } = model;
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState(''), [editor, setEditor] = useState<EditorTarget | null>(null);
  const [camera, setCamera] = useState<string | null>(null), [exporting, setExporting] = useState(false);
  const [paper, setPaper] = useState<'a4' | 'a3'>('a3'), [mosaic, setMosaic] = useState(false), [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const drag = useRef<{ id: string; relationId: string; matrix: DOMMatrix; origin: Position; start: Position; moved: boolean; camera: [number, number, number, number] } | null>(null);
  const title = typeof props.view.name === 'string' && props.view.name ? props.view.name : t('genograms.title');
  const person = network?.people.find(p => p.id === selected);
  const totalHeight = layout ? layout.height + (config.legend ? legendHeight(legendKeys(visible.people, visible.relations, config)) : 0) : 400;
  const exportWidth = layout ? Math.max(layout.width, title.length * 18 + 50, config.legend ? t('genograms.legend_note').length * 5 + 60 : 0) : 500;
  const bounds = layout ? `${String(layout.minX)} ${String(layout.minY)} ${String(exportWidth)} ${String(totalHeight)}` : '0 0 500 400';
  const point = (event: ReactPointerEvent<SVGSVGElement>): Position => {
    const matrix = drag.current?.matrix ?? svg.current?.getScreenCTM()?.inverse();
    const location = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return { x: location.x, y: location.y };
  };
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target.closest('[data-person]') : null;
    const id = target?.getAttribute('data-person') ?? '';
    const start = point(event);
    const relationId = event.target instanceof Element ? event.target.closest('[data-relation]')?.getAttribute('data-relation') ?? '' : '';
    const matrix = svg.current?.getScreenCTM()?.inverse();
    if (!matrix) return;
    drag.current = { id, relationId, matrix, start, origin: id ? layout?.positions[id] ?? start : start, moved: false, camera: boxNumbers(camera ?? bounds) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current) return;
    const now = point(event), dx = now.x - current.start.x, dy = now.y - current.start.y;
    if (Math.hypot(dx, dy) > 3) current.moved = true;
    if (current.id) {
      const group = svg.current?.querySelector(`[data-person="${CSS.escape(current.id)}"]`);
      group?.setAttribute('transform', `translate(${String(current.origin.x + dx)} ${String(current.origin.y + dy)})`);
    } else if (current.moved) {
      setCamera(`${String(current.camera[0] - dx)} ${String(current.camera[1] - dy)} ${String(current.camera[2])} ${String(current.camera[3])}`);
    }
  };
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current) return;
    const now = point(event);
    drag.current = null;
    if (current.id && current.moved) {
      update({ positions: { ...config.positions, [current.id]: { x: current.origin.x + now.x - current.start.x, y: current.origin.y + now.y - current.start.y } } });
    } else if (current.id) setSelected(current.id);
    else if (!current.moved) {
      const relation = network?.relations.find(r => r.id === current.relationId);
      if (relation) setEditor({ type: 'relations', record: relation });
    }
  };
  const zoom = (factor: number) => { const [x, y, w, h] = boxNumbers(camera ?? bounds); setCamera(`${String(x + w * (1 - factor) / 2)} ${String(y + h * (1 - factor) / 2)} ${String(w * factor)} ${String(h * factor)}`); };
  const center = () => { const p = layout?.positions[config.root_id]; if (p) setCamera(`${String(p.x - 350)} ${String(p.y - 250)} 700 500`); };
  const exportFile = async (format: 'svg' | 'png' | 'pdf') => {
    if (!svg.current) return;
    setExporting(true);
    try { const { exportGenogram } = await import('./export'); await exportGenogram(svg.current, title, { format, paper, orientation, mosaic }); }
    catch (reason) { model.setError(errorMessage(reason, t)); }
    finally { setExporting(false); }
  };
  const relative = (kind: 'parent' | 'child' | 'union' | 'emotional') => { if (person) setEditor({ type: 'people', relative: { personId: person.id, kind } }); };
  return <section className="genogram-view" aria-label={t('genograms.title')} aria-busy={loading}>
    <div className="genogram-toolbar">
      <label>{t('genograms.reference')}<select aria-label={t('genograms.reference')} value={config.root_id} onChange={event => { update({ root_id: event.target.value }); setCamera(null); }}><option value="">{t('genograms.choose_reference')}</option>{network?.people.map(p => <option key={p.id} value={p.id}>{personOptionLabel(p, network.people)}</option>)}</select></label>
      {(['ancestors', 'descendants'] as const).map(key => <label key={key}>{t(`genograms.${key}`)}<input aria-label={t(`genograms.${key}`)} type="number" min={0} max={20} value={config[key]} onChange={event => { update({ [key]: Math.max(0, Math.min(20, Number(event.target.value))) }); }} /></label>)}
      <button onClick={() => { setEditor({ type: 'people' }); }}>{t('genograms.add_person')}</button>
      <button onClick={() => { setEditor({ type: 'relations', values: { source: selected } }); }}>{t('genograms.add_relation')}</button>
      <button onClick={model.reload}>{t('genograms.refresh')}</button>
    </div>
    <div className="genogram-toolbar">
      {(['emotional', 'legend', 'age', 'dates'] as const).map(key => <label key={key}><input type="checkbox" checked={config[key]} onChange={event => { update({ [key]: event.target.checked }); }} />{t(`genograms.${key}`)}</label>)}
      <label>{t('genograms.labels')}<select value={config.labels} onChange={event => { update({ labels: event.target.value as 'name' | 'initials' | 'alias' }); }}>{['name', 'initials', 'alias'].map(key => <option key={key} value={key}>{t(`genograms.${key}`)}</option>)}</select></label>
      <button aria-label={t('genograms.zoom_in')} onClick={() => { zoom(.8); }}>+</button><button aria-label={t('genograms.zoom_out')} onClick={() => { zoom(1.25); }}>−</button>
      <button onClick={() => { setCamera(null); }}>{t('genograms.fit')}</button><button onClick={center}>{t('genograms.center')}</button>
      <button onClick={() => { update({ positions: {} }); setCamera(null); }}>{t('genograms.reorganize')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">{t('common.loading')}</p>}
    {network && network.hidden_connections > 0 && <p className="genogram-notice">{t('genograms.hidden_connections', { count: network.hidden_connections })}</p>}
    {network && network.issues.length > 0 && <details className="genogram-notice"><summary>{t('genograms.issues', { count: network.issues.length })}</summary><ul>{network.issues.map((issue, i) => <li key={`${issue.record_id}-${String(i)}`}><button onClick={() => { const record = network.people.find(p => p.id === issue.record_id) ?? network.relations.find(r => r.id === issue.record_id); if (record) setEditor({ type: network.people.some(p => p.id === record.id) ? 'people' : 'relations', record }); }}>{network.people.find(p => p.id === issue.record_id)?.title || network.relations.find(r => r.id === issue.record_id)?.title || t('genograms.unnamed')}</button>: {t(`genograms.issues_codes.${issue.code}`)}</li>)}</ul></details>}
    {!config.root_id && <p>{t('genograms.choose_reference')}</p>}
    <div className="genogram-workspace">
      <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox={camera ?? bounds} data-bounds={bounds} style={{ background: 'white', width: '100%', height: 600, touchAction: 'none' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { const current = drag.current; if (current?.id) svg.current?.querySelector(`[data-person="${CSS.escape(current.id)}"]`)?.setAttribute('transform', `translate(${String(current.origin.x)} ${String(current.origin.y)})`); drag.current = null; }} onKeyDown={event => {
        if (event.key !== 'Enter' || !(event.target instanceof Element)) return;
        const id = event.target.closest('[data-person]')?.getAttribute('data-person'); if (id) setSelected(id);
        const rid = event.target.closest('[data-relation]')?.getAttribute('data-relation'), relation = network?.relations.find(r => r.id === rid); if (relation) setEditor({ type: 'relations', record: relation });
      }}>{layout && <GenogramScene {...visible} layout={layout} config={config} t={t} title={title} selected={selected} search={props.search} />}</svg>
      {person && <aside className="genogram-selection"><strong>{person.title}</strong><button onClick={() => { setEditor({ type: 'people', record: person }); }}>{t('genograms.edit_record')}</button><button onClick={() => { props.onNoteSelect?.(person.id); }}>{t('genograms.open_note')}</button>{(['parent', 'child', 'union', 'emotional'] as const).map(kind => <button key={kind} onClick={() => { relative(kind); }}>{t(`genograms.add_${kind}`)}</button>)}<button onClick={() => { update({ exclude_ids: [...(config.exclude_ids ?? []), person.id] }); setSelected(''); }}>{t('genograms.hide')}</button><button onClick={() => { const ids = network?.relations.filter(r => r.source === person.id || r.target === person.id).flatMap(r => [r.source, r.target]).filter((id): id is string => Boolean(id)) ?? []; update({ include_ids: [...new Set([...(config.include_ids ?? []), ...ids])], exclude_ids: (config.exclude_ids ?? []).filter(id => !ids.includes(id)) }); }}>{t('genograms.expand')}</button></aside>}
    </div>
    {Boolean(config.exclude_ids?.length) && <button onClick={() => { update({ exclude_ids: [] }); }}>{t('genograms.restore_hidden')}</button>}
    <div className="genogram-toolbar"><label>{t('genograms.paper')}<select value={paper} onChange={event => { setPaper(event.target.value as 'a4' | 'a3'); }}><option value="a4">A4</option><option value="a3">A3</option></select></label><label>{t('genograms.orientation')}<select value={orientation} onChange={event => { setOrientation(event.target.value as 'landscape' | 'portrait'); }}><option value="landscape">{t('genograms.landscape')}</option><option value="portrait">{t('genograms.portrait')}</option></select></label><label><input type="checkbox" checked={mosaic} onChange={event => { setMosaic(event.target.checked); }} />{t('genograms.mosaic')}</label>{(['svg', 'png', 'pdf'] as const).map(format => <button disabled={!visible.people.length || exporting || loading} key={format} onClick={() => { void exportFile(format); }}>{t('genograms.export', { format: format.toUpperCase() })}</button>)}</div>
    {editor && network && <RecordEditor key={`${editor.type}:${editor.record?.id ?? 'new'}:${editor.relative?.kind ?? ''}`} target={editor} network={network} onClose={() => { setEditor(null); }} onSaved={id => { setEditor(null); if (!config.root_id && editor.type === 'people') update({ root_id: id }); model.reload(); props.onChanged?.(); emitAppEvent('gnosi:genograms-changed'); }} />}
  </section>;
}
