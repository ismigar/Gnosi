import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createVaultPage, patchVaultPage, fetchVaultPages } from '../../shared/api/vaults';
import { genogramRequestContext } from '../../shared/api/genograms';
import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import { errorMessage } from './errors';
import { PERSON_OPTIONS, RELATION_OPTIONS, personOptionLabel, type Network, type Person, type Relation } from './model';

type Draft = Record<string, string | number | boolean | string[] | null | undefined>;
export interface EditorTarget { type: 'people' | 'relations'; record?: Person | Relation; values?: Draft; relative?: { personId: string; kind: 'parent' | 'child' | 'union' | 'emotional' } }
interface Props { target: EditorTarget; network: Network; onClose: () => void; onSaved: (id: string) => void }
const PERSON_FIELDS = ['title', 'alias', 'kind', 'symbol', 'gender', 'birth_date', 'birth_approximate', 'death_date', 'death_approximate', 'vital_status', 'pregnancy_status', 'pregnancy_date', 'pregnancy_weeks', 'multiple_group', 'multiple_type', 'birth_order', 'notes', 'tags', 'sources'];
const RELATION_FIELDS = ['title', 'kind', 'source', 'target', 'union_type', 'union_status', 'union_id', 'parentage', 'emotion', 'start_date', 'separation_date', 'divorce_date', 'end_date', 'observed_date', 'informant', 'notes', 'sources'];

export function RecordEditor({ target, network, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const context = useRef(genogramRequestContext().vaultId);
  const [createdPersonId, setCreatedPersonId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({ kind: target.type === 'people' ? 'person' : 'union', symbol: 'neutral', vital_status: 'unknown', union_type: 'partnership', union_status: 'unknown', parentage: 'unknown', emotion: 'close', pregnancy_status: 'ongoing', multiple_type: 'unknown', ...target.record, ...target.values }));
  const [existing, setExisting] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  useModalKeyboard({ isOpen: true, onClose: () => { if (!busy) onClose(); }, containerRef, trapFocus: true });
  useEffect(() => {
    let active = true;
    void fetchVaultPages({ limit: 1000 }).then(rows => {
      if (active && genogramRequestContext().vaultId === context.current) setSources(rows.map(p => ({ id: p.id, title: p.title || p.id })));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const options = target.type === 'people' ? PERSON_OPTIONS : RELATION_OPTIONS;
  const mapping = target.type === 'people' ? network.people_fields : network.relations_fields;
  const tableId = target.type === 'people' ? network.people_table_id : network.relations_table_id;
  const fields = (target.type === 'people' ? PERSON_FIELDS : RELATION_FIELDS).filter(field => {
    if (target.type === 'people') return !field.startsWith('pregnancy_') || draft.kind === 'pregnancy';
    if (['union_type', 'union_status', 'separation_date', 'divorce_date'].includes(field)) return draft.kind === 'union';
    if (['union_id', 'parentage'].includes(field)) return draft.kind === 'parent';
    if (['emotion', 'observed_date', 'informant'].includes(field)) return draft.kind === 'emotional';
    return true;
  });
  const set = (field: string, value: Draft[string]) => { setDraft(current => ({ ...current, [field]: value })); };
  const save = async () => {
    if (context.current !== genogramRequestContext().vaultId) { onClose(); return; }
    setBusy(true); setError('');
    try {
      let id = existing || createdPersonId || target.record?.id;
      if (!existing && !createdPersonId) {
        const metadata: Record<string, string | number | boolean | string[] | null> = { table_id: tableId };
        for (const [role, name] of Object.entries(mapping)) {
          if (role === 'tags') { metadata[name] = typeof draft.tags === 'string' ? draft.tags.split(',').map(value => value.trim()).filter(Boolean) : draft.tags ?? []; continue; }
          if (role !== 'title') metadata[name] = draft[role] ?? (['sources', 'tags'].includes(role) ? [] : role.endsWith('_approximate') ? false : ['pregnancy_weeks', 'birth_order'].includes(role) ? null : '');
        }
        const title = String(draft.title || '').trim() || (target.type === 'relations' ? t(`genograms.options.${String(draft.kind)}`) : t('genograms.unnamed'));
        const response = target.record
          ? await patchVaultPage(target.record.id, { title, metadata, expected_etag: target.record.etag || undefined })
          : await createVaultPage({ title, metadata, content: '' });
        id = response.id;
        if (target.relative) setCreatedPersonId(id);
      }
      if (!id) throw new Error('Missing record identity');
      if (context.current !== genogramRequestContext().vaultId) return;
      if (target.relative) {
        const source = target.relative.kind === 'parent' ? id : target.relative.personId;
        const destination = target.relative.kind === 'parent' ? target.relative.personId : id;
        const values: Draft = { source, target: destination, kind: target.relative.kind === 'child' ? 'parent' : target.relative.kind, parentage: 'unknown', union_type: 'partnership', union_status: 'unknown', emotion: 'close' };
        const metadata: Record<string, string> = { table_id: network.relations_table_id };
        for (const [role, value] of Object.entries(values)) { const name = network.relations_fields[role]; if (name) metadata[name] = String(value); }
        await createVaultPage({ title: t(`genograms.options.${String(values.kind)}`), metadata, content: '' });
      }
      onSaved(id);
    } catch (reason) {
      setError(`${createdPersonId ? `${t('genograms.person_created_relation_pending')} ` : ''}${errorMessage(reason, t)}`);
    } finally { setBusy(false); }
  };
  const referenceSelect = (field: string, list: { id: string; title?: string }[], multiple = false) => <select multiple={multiple} value={multiple ? Array.isArray(draft[field]) ? draft[field] : [] : String(draft[field] ?? '')} onChange={event => { set(field, multiple ? [...event.target.selectedOptions].map(option => option.value) : event.target.value); }}><option value="">{t('genograms.unspecified')}</option>{list.map(item => <option key={item.id} value={item.id}>{item.title || t('genograms.unnamed')}</option>)}</select>;
  return <div className="genogram-modal"><div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="genogram-editor-title" className="genogram-editor">
    <h2 id="genogram-editor-title">{t(target.record ? 'genograms.edit_record' : 'genograms.add_record')}</h2>
    {target.relative && <label>{t('genograms.link_existing')}<select value={existing} onChange={event => { setExisting(event.target.value); }} disabled={Boolean(createdPersonId)}><option value="">{t('genograms.create_person')}</option>{network.people.filter(person => person.id !== target.relative?.personId).map(person => <option key={person.id} value={person.id}>{personOptionLabel(person, network.people)}</option>)}</select></label>}
    {!existing && !createdPersonId && <div className="genogram-fields">{fields.map(field => <label key={field}>
      {t(`genograms.fields.${field}`)}
      {options[field] ? <select value={String(draft[field] ?? '')} onChange={event => { set(field, event.target.value); }}>{options[field].map(value => <option key={value} value={value}>{t(`genograms.options.${value}`)}</option>)}</select>
        : field.endsWith('_approximate') ? <input type="checkbox" checked={Boolean(draft[field])} onChange={event => { set(field, event.target.checked); }} />
        : ['source', 'target'].includes(field) ? referenceSelect(field, network.people.map(p => ({ id: p.id, title: personOptionLabel(p, network.people) })))
        : field === 'union_id' ? referenceSelect(field, network.relations.filter(relation => relation.kind === 'union'))
        : field === 'sources' ? referenceSelect(field, sources, true)
        : field === 'tags' ? <input value={Array.isArray(draft.tags) ? draft.tags.join(', ') : String(draft.tags ?? '')} onChange={event => { set('tags', event.target.value); }} />
        : field === 'notes' ? <textarea value={String(draft[field] ?? '')} onChange={event => { set(field, event.target.value); }} />
        : <input type={['pregnancy_weeks', 'birth_order'].includes(field) ? 'number' : 'text'} placeholder={field.endsWith('_date') ? t('genograms.partial_date_hint') : undefined} value={String(draft[field] ?? '')} onChange={event => { set(field, ['pregnancy_weeks', 'birth_order'].includes(field) ? event.target.value === '' ? null : Number(event.target.value) : event.target.value); }} />}
    </label>)}</div>}
    {error && <p role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button disabled={busy} onClick={() => { void save(); }}>{t(busy ? 'common.loading' : 'common.save')}</button></footer>
  </div></div>;
}
