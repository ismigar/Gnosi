import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fetchFormCandidates, fetchForms, publishForm, revokeForm, type PublishedForm } from '../../shared/api/forms';
import FormsManager from './FormsManager';

vi.mock('../../shared/api/forms', () => ({ fetchFormCandidates: vi.fn(), fetchForms: vi.fn(), publishForm: vi.fn(), revokeForm: vi.fn() }));
vi.mock('../../shared/platform/clipboard', () => ({ writeClipboardText: vi.fn() }));
const translated = vi.hoisted(() => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'en' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translated }));
const roots: Root[] = [];
const form: PublishedForm = { title: 'Requests', description: '', fields: [], id: 'id', table_id: 'table', url: '/forms/token', expires_at: '2099-01-01T00:00:00Z', revoked: false, created_at: '2026-10-13T00:00:00Z' };
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.mocked(fetchForms).mockResolvedValue([form]);
  vi.mocked(fetchFormCandidates).mockResolvedValue([{ ref: 'title', label: 'Title', kind: 'title', options: [] }, { ref: 'email-id', label: 'Email', kind: 'email', options: [] }]);
});
afterEach(() => { for (const root of roots.splice(0)) act(() => { root.unmount(); }); vi.resetAllMocks(); });
async function render() {
  const root = createRoot(document.createElement('div')); roots.push(root);
  await act(async () => { root.render(<FormsManager tableId="table" tableName="Requests" onClose={vi.fn()} />); await Promise.resolve(); });
}

it('publishes only selected questions, keeping their stable table field references', async () => {
  vi.mocked(publishForm).mockResolvedValue({ ...form, id: 'new' }); await render();
  await act(async () => { document.querySelector<HTMLElement>('[role="switch"][aria-label="Include {{field}}"]:not([aria-disabled="true"])')?.click(); await Promise.resolve(); });
  await act(async () => { document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(publishForm).toHaveBeenCalledWith({ table_id: 'table', title: 'Requests', description: '', expires_in_days: 30,
    fields: [{ ref: 'title', label: 'Title', required: true, help: '' }, { ref: 'email-id', label: 'Email', required: false, help: '' }] });
  expect(document.body.textContent).toContain('The form is ready.');
});

it('revokes the existing link without modifying the table', async () => {
  vi.mocked(revokeForm).mockResolvedValue(); await render();
  await act(async () => { Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'Revoke link')?.click(); await Promise.resolve(); });
  expect(revokeForm).toHaveBeenCalledWith('id');
  expect(document.body.querySelector('a[href="/forms/token"]')).toBeNull();
  expect(document.body.textContent).toContain('Revoked');
  expect(publishForm).not.toHaveBeenCalled();
});

it('publishes the selected finite lifetime and offers no perpetual link', async () => {
  vi.mocked(publishForm).mockResolvedValue({ ...form, id: 'new' }); await render();
  const select = document.body.querySelector('form select');
  expect(select).toBeInstanceOf(HTMLSelectElement);
  if (!(select instanceof HTMLSelectElement)) throw new Error('Lifetime selector missing');
  expect(Array.from(select.options, option => option.value)).toEqual(['7', '30', '90', '365']);
  await act(async () => { select.value = '365'; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
  await act(async () => { document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(publishForm).toHaveBeenCalledWith(expect.objectContaining({ expires_in_days: 365 }));
});

it.each([null, '2020-01-01T00:00:00Z', 'invalid'])('does not offer an inactive link with deadline %s', async expires_at => {
  vi.mocked(fetchForms).mockResolvedValue([{ ...form, expires_at }]); await render();
  expect(document.body.querySelector('a[href="/forms/token"]')).toBeNull();
  expect(Array.from(document.body.querySelectorAll('button')).some(button => button.textContent === 'Copy link')).toBe(false);
  expect(document.body.textContent).not.toContain('No expiry');
});
