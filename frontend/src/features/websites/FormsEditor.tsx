import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { SiteConfig, SiteForm, FormField } from '../../shared/api/sites';
import { Card, Empty, Field, Input, ListInput, Textarea, Select, Toggle, ReorderActions } from './components';
import { moveItem, newId } from './helpers';

export function FormsEditor({ site, onChange }: { site: SiteConfig; onChange: (site: SiteConfig) => void }) {
  const { t } = useTranslation();
  const [editingLanguage, setEditingLanguage] = useState(site.default_language);
  const language = (site.languages ?? []).includes(editingLanguage) ? editingLanguage : site.default_language;
  const forms = site.forms ?? [];
  const update = (index: number, patch: Partial<SiteForm>) => { onChange({ ...site, forms: forms.map((form, position) => position === index ? { ...form, ...patch } : form) }); };
  return <Card title={t('websites.forms')} actions={<div className="websites-actions"><Field label={t('websites.editingLanguage')}><Select value={language} onChange={event => { setEditingLanguage(event.target.value); }}>{(site.languages ?? []).map(item => <option key={item} value={item}>{item.toUpperCase()}</option>)}</Select></Field><button type="button" className="websites-button" onClick={() => { onChange({ ...site, forms: [...forms, { id: newId('form'), revision: 1, name: t('websites.newForm'), enabled: false, title: {}, intro: {}, fields: [], submit_label: {}, confirmation: {}, privacy_text: {}, privacy_url: '', require_privacy: false, redirect_path: null, newsletter_list: null }] }); }}><Plus size={16} />{t('websites.addForm')}</button></div>}>
    <p className="websites-muted">{t('websites.formHelp')}</p>
    {!forms.length && <Empty>{t('websites.noForms')}</Empty>}
    <div className="websites-list websites-spacer">{forms.map((form, index) => <section key={form.id} className="websites-row"><div className="websites-row-title"><strong>{form.name}</strong><button type="button" className="websites-button" onClick={() => { onChange({ ...site, forms: forms.filter((_, position) => position !== index) }); }}>{t('websites.remove')}</button></div>
      <div className="websites-grid"><Field label={t('websites.internalName')}><Input value={form.name} onChange={event => { update(index, { name: event.target.value }); }} /></Field><Field label={t('websites.titleLabel')}><Input value={form.title?.[language] ?? ''} onChange={event => { update(index, { title: { ...form.title, [language]: event.target.value } }); }} /></Field><Field label={t('websites.introduction')}><Textarea value={form.intro?.[language] ?? ''} onChange={event => { update(index, { intro: { ...form.intro, [language]: event.target.value } }); }} /></Field><Field label={t('websites.submitLabel')}><Input value={form.submit_label?.[language] ?? ''} onChange={event => { update(index, { submit_label: { ...form.submit_label, [language]: event.target.value } }); }} /></Field></div>
      <Toggle label={t('websites.formEnabled')} value={form.enabled} onChange={enabled => { update(index, { enabled }); }} />
      <ContactFields fields={form.fields ?? []} language={language} onChange={fields => { update(index, { fields }); }} />
      <div className="websites-grid websites-spacer"><Field label={t('websites.confirmation')}><Textarea value={form.confirmation?.[language] ?? ''} onChange={event => { update(index, { confirmation: { ...form.confirmation, [language]: event.target.value } }); }} /></Field><Field label={t('websites.redirectPath')} help={t('websites.redirectHint')}><Input value={form.redirect_path ?? ''} onChange={event => { update(index, { redirect_path: event.target.value || null }); }} /></Field><Field label={t('websites.privacyText')}><Textarea value={form.privacy_text?.[language] ?? ''} onChange={event => { update(index, { privacy_text: { ...form.privacy_text, [language]: event.target.value } }); }} /></Field><Field label={t('websites.privacyUrl')}><Input value={form.privacy_url} onChange={event => { update(index, { privacy_url: event.target.value }); }} /></Field></div>
      <Toggle label={t('websites.requirePrivacy')} value={form.require_privacy} onChange={require_privacy => { update(index, { require_privacy }); }} />
      <Field label={t('websites.newsletterList')} help={t('websites.separateOptIn')}><Input value={form.newsletter_list ?? ''} onChange={event => { update(index, { newsletter_list: event.target.value || null }); }} /></Field>
    </section>)}</div>
  </Card>;
}

function ContactFields({ fields, language, onChange }: { fields: FormField[]; language: string; onChange: (fields: FormField[]) => void }) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<FormField>) => { onChange(fields.map((field, position) => position === index ? { ...field, ...patch } : field)); };
  return <div className="websites-list"><div className="websites-section-title"><h3>{t('websites.fields')}</h3><button type="button" className="websites-button" onClick={() => { onChange([...fields, { id: newId('field'), type: 'text', label: {}, help: {}, placeholder: {}, required: false, max_length: 2000, options: [] }]); }}>{t('websites.addField')}</button></div>{fields.map((field, index) => <section className="websites-row" key={field.id}><div className="websites-row-title"><strong>{field.label?.[language] || field.id}</strong><ReorderActions index={index} length={fields.length} move={direction => { onChange(moveItem(fields, index, direction)); }} remove={() => { onChange(fields.filter((_, position) => position !== index)); }} /></div>
    <div className="websites-grid"><Field label={t('websites.fieldType')}><Select value={field.type} onChange={event => { update(index, { type: event.target.value as FormField['type'] }); }}>{['text', 'textarea', 'email', 'tel', 'select', 'radio', 'checkbox'].map(value => <option key={value} value={value}>{t(`websites.fieldTypes.${value}`)}</option>)}</Select></Field><Field label={t('websites.fieldLabel')}><Input value={field.label?.[language] ?? ''} onChange={event => { update(index, { label: { ...field.label, [language]: event.target.value } }); }} /></Field><Field label={t('websites.helpText')}><Input value={field.help?.[language] ?? ''} onChange={event => { update(index, { help: { ...field.help, [language]: event.target.value } }); }} /></Field><Field label={t('websites.placeholder')}><Input value={field.placeholder?.[language] ?? ''} onChange={event => { update(index, { placeholder: { ...field.placeholder, [language]: event.target.value } }); }} /></Field>
      {['select', 'radio'].includes(field.type) ? <Field label={t('websites.options')}><ListInput multiline delimiter="newline" value={field.options ?? []} onChange={options => { update(index, { options }); }} /></Field> : <Field label={t('websites.maxLength')}><Input type="number" min={1} max={20000} value={field.max_length} onChange={event => { update(index, { max_length: event.target.valueAsNumber || 1 }); }} /></Field>}
    </div><Toggle label={t('websites.required')} value={field.required} onChange={required => { update(index, { required }); }} />
  </section>)}</div>;
}
