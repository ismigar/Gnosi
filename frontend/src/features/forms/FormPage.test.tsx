import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fetchPublicForm, submitPublicForm, type PublicForm } from '../../shared/api/forms';
import { GnosiApiError } from '../../shared/api/errors';
import FormPage from './FormPage';
import { clearPendingSubmission, readPendingSubmission } from './submissionIdentity';

vi.mock('../../shared/api/forms', () => ({ fetchPublicForm: vi.fn(), submitPublicForm: vi.fn() }));
const translated = vi.hoisted(() => ({ t: (_key: string, fallback: string) => fallback }));
vi.mock('react-i18next', () => ({ useTranslation: () => translated }));
const roots: Array<{ root: Root; container: HTMLDivElement }> = [];
const definition: PublicForm = { title: 'Public survey', description: 'A survey', fields: [
  { key: 'field_0', kind: 'title', label: 'Your name', required: true, help: '', options: [] },
  { key: 'field_1', kind: 'checkbox', label: 'Subscribe', required: false, help: '', options: [] },
  { key: 'field_2', kind: 'multi_select', label: 'Topics', required: true, help: '', options: ['A', 'B'] },
] };
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { vi.mocked(fetchPublicForm).mockResolvedValue(definition); });
afterEach(() => { for (const item of roots.splice(0)) { act(() => { item.root.unmount(); }); item.container.remove(); } vi.resetAllMocks(); clearPendingSubmission('token'); });
async function render(element: ReactElement = <FormPage />) {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); roots.push({ root, container });
  await act(async () => { root.render(<MemoryRouter initialEntries={['/forms/token']}><Routes><Route path="/forms/:token" element={element} /></Routes></MemoryRouter>); await Promise.resolve(); });
  return container;
}
async function fill(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="text"]');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Person'); input?.dispatchEvent(new Event('input', { bubbles: true })); await Promise.resolve(); });
  await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'A')?.click(); await Promise.resolve(); });
}
async function submit(container: HTMLElement) { await act(async () => { container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); }); }

it('loads only the anonymous definition and submits selected values without internal IDs', async () => {
  vi.mocked(submitPublicForm).mockResolvedValue();
  const container = await render(); await fill(container); await submit(container);
  expect(fetchPublicForm).toHaveBeenCalledWith('token', expect.any(AbortSignal));
  const sent = vi.mocked(submitPublicForm).mock.calls[0];
  expect(sent?.[0]).toBe('token');
  expect(typeof sent?.[1].request_id).toBe('string');
  expect(sent?.[1].values).toEqual({ field_0: 'Person', field_1: false, field_2: ['A'] });
  expect(sent?.[1].website).toBe('');
  expect(container.textContent).toContain('Response received');
  expect(container.querySelector('form')).toBeNull();
});

it('retains the same identity and answers when checking an uncertain submission', async () => {
  vi.mocked(submitPublicForm).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce();
  const container = await render(); await fill(container); await submit(container);
  const first = vi.mocked(submitPublicForm).mock.calls[0]?.[1];
  expect(container.textContent).toContain('Check submission');
  expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(true);
  await submit(container);
  expect(vi.mocked(submitPublicForm).mock.calls[1]?.[1]).toEqual(first);
  expect(container.textContent).toContain('Response received');
});

it('keeps answers editable after server validation and requires multi-select answers', async () => {
  vi.mocked(submitPublicForm).mockRejectedValueOnce(new GnosiApiError(new Response(null, { status: 422 }), {}));
  const container = await render(); await submit(container);
  expect(submitPublicForm).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Complete all required fields.');
  await fill(container); await submit(container);
  expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(false);
  expect(container.textContent).toContain('Check your answers');
});

it('shows expired and revoked forms as unavailable', async () => {
  vi.mocked(fetchPublicForm).mockRejectedValueOnce(new GnosiApiError(new Response(null, { status: 404 }), {}));
  const container = await render();
  expect(container.textContent).toContain('unavailable or has expired');
  expect(container.querySelector('form')).toBeNull();
});


it('restores the same pending answers after a reload without sending a new record', async () => {
  vi.mocked(submitPublicForm).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce();
  const container = await render(); await fill(container); await submit(container);
  const first = vi.mocked(submitPublicForm).mock.calls[0]?.[1];
  const mounted = roots.shift();
  if (mounted) { act(() => { mounted.root.unmount(); }); mounted.container.remove(); }
  const reloaded = await render();
  expect(reloaded.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Person');
  expect(reloaded.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(true);
  await submit(reloaded);
  expect(vi.mocked(submitPublicForm).mock.calls[1]?.[1]).toEqual(first);
  expect(readPendingSubmission('token')).toBeNull();
});

it('stops offering retries when a link is revoked during completion', async () => {
  vi.mocked(submitPublicForm).mockRejectedValueOnce(new GnosiApiError(new Response(null, { status: 404 }), {}));
  const container = await render(); await fill(container); await submit(container);
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain('unavailable or has expired');
  expect(readPendingSubmission('token')).toBeNull();
});
