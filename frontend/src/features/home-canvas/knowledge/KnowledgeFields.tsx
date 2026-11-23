import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readablePageTitle } from '../../../shared/records/pageReferenceTitle';

interface Choice { readonly id: string; readonly title: string }
interface Props {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly choices: readonly Choice[];
  readonly catalogComplete?: boolean;
  readonly onChange: (id: string) => void;
}

export function KnowledgePicker({ label, placeholder, value, choices, onChange, catalogComplete = true }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const search = filter.trim().normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const visible = choices.filter(item => item.title.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().includes(search)).slice(0, 60);
  const selected = choices.find(item => item.id === value);
  if (selected && !visible.some(item => item.id === selected.id)) visible.unshift(selected);
  return <div className="home-knowledge-field">
    {choices.length > 60 && <input type="search" className="home-field" value={filter}
      aria-label={t('home_canvas.knowledge.find')} placeholder={t('home_canvas.knowledge.find')}
      onChange={event => { setFilter(event.target.value); }} />}
    <label>{label}<select className="home-field" value={value} onChange={event => { onChange(event.target.value); }}>
      <option value="">{placeholder}</option>
      {value && !selected && <option value={value}>{catalogComplete ? t('home_canvas.knowledge.unavailable') : t('common.loading')}</option>}
      {visible.map(item => <option key={item.id} value={item.id}>{readablePageTitle(item.title)}</option>)}
    </select></label>
  </div>;
}

export function KnowledgeStatus({ state, retry }: { readonly state: 'loading' | 'failed'; readonly retry?: () => void }) {
  const { t } = useTranslation();
  return <p className="home-knowledge-status" role={state === 'failed' ? 'alert' : 'status'}>
    {state === 'failed' ? t('home_canvas.knowledge.failed') : t('common.loading')}
    {retry && <button className="home-knowledge-action" type="button" onClick={retry}>{t('common.retry')}</button>}
  </p>;
}
