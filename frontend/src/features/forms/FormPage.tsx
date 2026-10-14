import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchPublicForm, submitPublicForm, type PublicForm, type FormValue } from '../../shared/api/forms';
import { GnosiApiError } from '../../shared/api/errors';
import { createSubmissionIdentity, readPendingSubmission, savePendingSubmission, clearPendingSubmission, isEmptyAnswer } from './submissionIdentity';
import { FormField, formInputClass } from './FormField';

export default function FormPage() {
  const { token = '' } = useParams();
  return <PublicFormView key={token} token={token} />;
}

function PublicFormView({ token }: { token: string }) {
  const { t } = useTranslation();
  const [pending] = useState(() => readPendingSubmission(token));
  const [form, setForm] = useState<PublicForm | null>(null);
  const [values, setValues] = useState<Record<string, FormValue>>(pending?.values ?? {});
  const [website, setWebsite] = useState('');
  const [requestId] = useState(() => pending?.requestId ?? createSubmissionIdentity());
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(Boolean(pending));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPublicForm(token, controller.signal).then(data => {
      if (!controller.signal.aborted) {
        setForm(data);
        setValues({ ...Object.fromEntries(data.fields.filter(field => field.kind === 'checkbox').map(field => [field.key, false])), ...pending?.values });
      }
    }).catch(() => { if (!controller.signal.aborted) setError(t('forms.unavailable', 'This form is unavailable or has expired.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [token, t, pending]);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !form) return;
    const missing = form.fields.some(field => field.required && isEmptyAnswer(values[field.key]));
    if (missing) { setError(t('forms.required_error', 'Complete all required fields.')); return; }
    setBusy(true); setLocked(true); setError('');
    savePendingSubmission(token, { requestId, values });
    try {
      await submitPublicForm(token, { request_id: requestId, values, website });
      clearPendingSubmission(token); setSubmitted(true);
    } catch (failure) {
      if (failure instanceof GnosiApiError && failure.status === 404) {
        clearPendingSubmission(token); setForm(null); setError(t('forms.unavailable', 'This form is unavailable or has expired.')); return;
      }
      const rejected = failure instanceof GnosiApiError && [400, 413, 422].includes(failure.status);
      if (rejected) { clearPendingSubmission(token); setLocked(false); }
      setError(rejected ? t('forms.validation_error', 'Check your answers and the selected options.')
        : t('forms.retry_error', 'We could not confirm your response. Retry to check the same submission; it will not be sent twice.'));
    } finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-[var(--bg-secondary)] px-4 py-10 text-[var(--text-primary)]">
    <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 sm:p-8">
      {loading ? <p role="status">{t('common.loading', 'Loading...')}</p> : submitted ? <div role="status">
        <h1 className="text-2xl font-semibold">{t('forms.received_title', 'Response received')}</h1>
        <p className="mt-3">{t('forms.received', 'Thank you. Your response has been saved.')}</p>
      </div> : form ? <form className="space-y-6" onSubmit={event => { void submit(event); }}>
        <h1 className="text-2xl font-semibold">{form.title}</h1>
        {form.description && <p className="whitespace-pre-wrap text-[var(--text-secondary)]">{form.description}</p>}
        <p className="text-sm text-[var(--text-secondary)]">{t('forms.required_hint', '* Required fields')}</p>
        {form.fields.map(field => <FormField key={field.key} field={field} value={values[field.key]} disabled={busy || locked}
          onChange={value => { setValues(previous => ({ ...previous, [field.key]: value })); }} />)}
        <div className="hidden" aria-hidden="true"><label>{t('forms.leave_empty', 'Leave this field empty')}<input className={formInputClass} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => { setWebsite(event.target.value); }} /></label></div>
        {error && <p role="alert" className="text-[var(--status-error)]">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-gnosi-primary">
          {busy ? t('forms.submitting', 'Sending...') : locked ? t('forms.retry', 'Check submission') : t('forms.submit', 'Send response')}
        </button>
      </form> : <p role="alert">{error}</p>}
    </div>
    <p className="mt-4 text-center text-xs text-[var(--text-tertiary)]">{t('app_title', 'Gnosi')}</p>
  </main>;
}
