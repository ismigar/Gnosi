import { useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import '../settings/styles/settings-controls.css';

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  const id = useId();
  return <label className="websites-field" id={id}><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`websites-input ${props.className ?? ''}`} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`websites-input ${props.className ?? ''}`} />; }
// Keep the editable text separate from its parsed value: a trailing comma or
// newline is meaningful while typing, although it is not yet another item.
// Publish parsed values immediately so autosave uses the latest text.
export function ListInput({ value, onChange, multiline = false, delimiter = 'comma' }: { value: string[]; onChange: (value: string[]) => void; multiline?: boolean; delimiter?: 'comma' | 'newline' }) {
  const serialized = JSON.stringify(value);
  const [draft, setDraft] = useState({ serialized, text: value.join(multiline ? '\n' : ', ') });
  const text = draft.serialized === serialized ? draft.text : value.join(multiline ? '\n' : ', ');
  const edit = (raw: string) => {
    const items = raw.split(delimiter === 'newline' ? /\n/u : /[\n,]/u).map(item => item.trim()).filter(Boolean);
    setDraft({ text: raw, serialized: JSON.stringify(items) });
    onChange(items);
  };
  return multiline ? <Textarea value={text} onChange={event => { edit(event.target.value); }} /> : <Input value={text} onChange={event => { edit(event.target.value); }} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`websites-input ${props.className ?? ''}`} />; }
export function Toggle({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="websites-toggle"><span>{label}</span><GnosiToggle label={label} active={value} disabled={disabled} onChange={() => { onChange(!value); }} /></div>;
}
export function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <Disclosure title={title} className="websites-card" level={2} actions={actions}>{children}</Disclosure>;
}
export function Empty({ children }: { children: ReactNode }) { return <p className="websites-empty">{children}</p>; }
export function FileImportButton({ label, accept, disabled = false, onFile }: { label: string; accept: string; disabled?: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <><button type="button" className="websites-button" aria-label={label} disabled={disabled} onClick={() => { input.current?.click(); }}>{label}</button><input ref={input} type="file" accept={accept} disabled={disabled} hidden aria-label={label} onChange={event => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ''; }} /></>;
}
export function ReorderActions({ index, length, move, remove, removeDisabled = false }: { index: number; length: number; move: (direction: -1 | 1) => void; remove: () => void; removeDisabled?: boolean }) {
  const { t } = useTranslation();
  return <div className="websites-actions"><button type="button" className="websites-button" aria-label={t('websites.moveUp')} disabled={index === 0} onClick={() => { move(-1); }}><ArrowUp size={15} /></button><button type="button" className="websites-button" aria-label={t('websites.moveDown')} disabled={index === length - 1} onClick={() => { move(1); }}><ArrowDown size={15} /></button><button type="button" className="websites-button" aria-label={t('websites.remove')} disabled={removeDisabled} onClick={remove}><Trash2 size={15} /></button></div>;
}

/** Keep children mounted when folded so drafts and uploads survive. */
export function Disclosure({ title, children, actions, className = 'websites-row', level = 3 }: { title: string; children: ReactNode; actions?: ReactNode; className?: string; level?: 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const Heading = level === 2 ? 'h2' : 'h3';
  return <details className={`websites-disclosure ${className}`} open={open} onToggle={event => { setOpen(event.currentTarget.open); }}>
    <summary><Heading>{title}</Heading></summary>
    <div className="websites-disclosure-body">{actions && <div className="websites-actions">{actions}</div>}{children}</div>
  </details>;
}
