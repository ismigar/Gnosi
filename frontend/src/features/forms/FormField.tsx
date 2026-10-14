import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormValue, PublicFormField } from '../../shared/api/forms';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';

export const formInputClass = 'w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-[var(--text-primary)]';
export const formButtonClass = 'rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm hover:bg-[var(--bg-secondary)] disabled:opacity-50';

interface Props { field: PublicFormField; value: FormValue | undefined; onChange: (value: FormValue) => void; disabled?: boolean }

export function FormField({ field, value, onChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const helpId = `${id}-help`;
  const label = `${field.label}${field.required ? ' *' : ''}`;
  const common = { id, disabled, required: field.required, 'aria-describedby': field.help ? helpId : undefined, className: formInputClass };
  const options = field.options ?? [];
  const stringValue = typeof value === 'string' ? value : '';
  let control;
  if (field.kind === 'checkbox') {
    control = <GnosiToggle label={label} active={value === true} disabled={disabled} onChange={() => { onChange(value !== true); }} />;
  } else if (field.kind === 'select' || field.kind === 'status') {
    control = <select {...common} value={stringValue} onChange={event => { onChange(event.target.value); }}>
      <option value="">{t('forms.choose_option', 'Choose an option')}</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>;
  } else if (field.kind === 'multi_select') {
    const chosen = Array.isArray(value) ? value : [];
    control = <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map(option => <button type="button" key={option} disabled={disabled} aria-pressed={chosen.includes(option)}
        className={`${formButtonClass} ${chosen.includes(option) ? 'bg-[var(--sidebar-item-active)]' : ''}`}
        onClick={() => { onChange(chosen.includes(option) ? chosen.filter(item => item !== option) : [...chosen, option]); }}>{option}</button>)}
    </div>;
  } else if (field.kind === 'text') {
    control = <textarea {...common} maxLength={4000} rows={3} value={stringValue} onChange={event => { onChange(event.target.value); }} />;
  } else if (field.kind === 'number') {
    control = <input {...common} type="number" step="any" min={-1e15} max={1e15} value={typeof value === 'number' ? value : ''}
      onChange={event => { onChange(event.target.value === '' ? null : event.target.valueAsNumber); }} />;
  } else {
    const type = field.kind === 'title' ? 'text' : field.kind === 'phone' ? 'tel' : field.kind;
    control = <input {...common} type={type} maxLength={field.kind === 'title' ? 200 : 4000} value={stringValue}
      onChange={event => { onChange(event.target.value); }} />;
  }
  return <div className="space-y-2">
    <label className="block text-sm font-medium" htmlFor={field.kind === 'checkbox' || field.kind === 'multi_select' ? undefined : id}>{label}</label>
    {field.help && <p id={helpId} className="text-sm text-[var(--text-secondary)]">{field.help}</p>}
    {control}
  </div>;
}
