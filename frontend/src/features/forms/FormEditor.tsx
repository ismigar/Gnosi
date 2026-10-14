import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import { publishForm, type FormCandidate, type FormCreateInput, type PublishedForm } from '../../shared/api/forms';
import { formInputClass } from './FormField';

type Choice = FormCreateInput['fields'][number];
interface Props { tableId: string; tableName: string; candidates: FormCandidate[]; onPublished: (form: PublishedForm) => void }

export function FormEditor({ tableId, tableName, candidates, onPublished }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(tableName);
  const [description, setDescription] = useState('');
  const [days, setDays] = useState('30');
  const [fields, setFields] = useState<Choice[]>([{ ref: 'title', label: t('forms.record_title', 'Title'), required: true, help: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function update(ref: string, change: Partial<Choice>) { setFields(previous => previous.map(field => field.ref === ref ? { ...field, ...change } : field)); }
  async function publish(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await publishForm({ table_id: tableId, title, description, fields, expires_in_days: Number(days) });
      onPublished(result);
    } catch { setError(t('forms.publish_error', 'The form could not be published. Refresh its fields and try again.')); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { void publish(event); }} className="space-y-4">
    <h3 className="font-semibold">{t('forms.new_form', 'New form')}</h3>
    <label className="block text-sm">{t('forms.form_title', 'Form title')}<input className={`${formInputClass} mt-1`} value={title} disabled={busy} required maxLength={200} onChange={event => { setTitle(event.target.value); }} /></label>
    <label className="block text-sm">{t('forms.description', 'Description')}<textarea className={`${formInputClass} mt-1`} value={description} disabled={busy} maxLength={4000} onChange={event => { setDescription(event.target.value); }} /></label>
    <label className="block text-sm">{t('forms.expiry', 'Link lifetime')}<select className={`${formInputClass} mt-1`} value={days} disabled={busy} onChange={event => { setDays(event.target.value); }}>
      {[7, 30, 90, 365].map(day => <option key={day} value={String(day)}>{t('forms.days', '{{count}} days', { count: day })}</option>)}
    </select></label>
    <p className="text-sm text-[var(--text-secondary)]">{t('forms.fields_hint', 'Choose which table fields visitors can complete. Other fields and existing records stay private.')}</p>
    <div className="space-y-3">{candidates.map(candidate => {
      const field = fields.find(item => item.ref === candidate.ref);
      const fieldName = candidate.kind === 'title' ? t('forms.record_title', 'Title') : candidate.label;
      return <div key={candidate.ref} className="rounded-lg border border-[var(--border-primary)] p-3 space-y-2">
        <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{fieldName}</span>
          <GnosiToggle active={Boolean(field)} disabled={busy || candidate.kind === 'title' || (!field && fields.length >= 40)} label={t('forms.include_field', 'Include {{field}}', { field: fieldName })}
            onChange={() => { setFields(previous => field ? previous.filter(item => item.ref !== candidate.ref) : [...previous, { ref: candidate.ref, label: fieldName, required: false, help: '' }]); }} /></div>
        {field && <>
          <label className="block text-sm">{t('forms.question_label', 'Question')}<input className={`${formInputClass} mt-1`} required maxLength={200} disabled={busy} value={field.label} onChange={event => { update(candidate.ref, { label: event.target.value }); }} /></label>
          <label className="block text-sm">{t('forms.question_help', 'Help text')}<input className={`${formInputClass} mt-1`} maxLength={1000} disabled={busy} value={field.help} onChange={event => { update(candidate.ref, { help: event.target.value }); }} /></label>
          <div className="flex items-center justify-between text-sm"><span>{t('forms.required', 'Required')}</span><GnosiToggle active={field.required} disabled={busy || candidate.kind === 'title'} label={t('forms.require_field', 'Require {{field}}', { field: fieldName })} onChange={() => { update(candidate.ref, { required: !field.required }); }} /></div>
        </>}
      </div>;
    })}</div>
    {error && <p role="alert" className="text-sm text-[var(--status-error)]">{error}</p>}
    <button className="btn btn-gnosi-primary" disabled={busy || !candidates.length} type="submit">{busy ? t('forms.publishing', 'Publishing...') : t('forms.publish', 'Publish form')}</button>
  </form>;
}
