import { act } from 'react';
import { expect, test, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { CreateSiteDialog } from './CreateSiteDialog';
import type { WebsiteImportPreview } from '../../shared/api/sites';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const preview: WebsiteImportPreview = { id: 'review', url: 'https://independent.example/', name: 'Independent', pages: [{ id: 'home', title: 'Home', path: '/', language: 'en' }, { id: 'about', title: 'About', path: '/about', language: 'en' }], warnings: ['Forms need configuration.'], expires_at: '2099-01-01T00:00:00Z', assets_count: 1 };
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing dialog control'); return value; }
function control(container: HTMLElement, label: string) {
  return required([...container.querySelectorAll('label')].find(element => element.querySelector('span')?.textContent === label)?.querySelector<HTMLInputElement | HTMLSelectElement>('input,select'));
}
function edit(container: HTMLElement, label: string, value: string) {
  const element = control(container, label);
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
function button(container: HTMLElement, label: string) { return required([...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)); }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

test('blank creation is generic and never opts into the legacy pilot', async () => {
  const create = vi.fn(); const review = vi.fn(); const importing = vi.fn();
  const view = mountTestComponent(<CreateSiteDialog busy={false} onClose={vi.fn()} onCreate={create} onReview={review} onImport={importing} />);
  expect(view.container.textContent).not.toContain('importPilot');
  edit(view.container, 'websites.siteName', 'Another website');
  act(() => { button(view.container, 'websites.create').click(); }); await settle();
  expect(create).toHaveBeenCalledWith('Another website', false);
  expect(review).not.toHaveBeenCalled(); expect(importing).not.toHaveBeenCalled();
  view.unmount();
});

test('URL review is separate from explicit creation and URL changes invalidate the review', async () => {
  const create = vi.fn(); const review = vi.fn().mockResolvedValue(preview); const importing = vi.fn();
  const view = mountTestComponent(<CreateSiteDialog busy={false} onClose={vi.fn()} onCreate={create} onReview={review} onImport={importing} />);
  edit(view.container, 'websites.createMode', 'url'); edit(view.container, 'websites.sourceUrl', preview.url);
  expect(button(view.container, 'websites.importSelected').disabled).toBe(true);
  act(() => { button(view.container, 'websites.importReview').click(); }); await settle();
  expect(review).toHaveBeenCalledWith(preview.url, 20);
  expect(importing).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  expect(control(view.container, 'websites.siteName').value).toBe('Independent');
  expect(view.container.textContent).toContain('/about');
  act(() => { button(view.container, 'websites.importSelected').click(); }); await settle();
  expect(importing).toHaveBeenCalledWith('review', 'Independent', ['home', 'about']);
  edit(view.container, 'websites.sourceUrl', 'https://other.example/');
  expect(button(view.container, 'websites.importSelected').disabled).toBe(true);
  view.unmount();
});

test('failed URL analysis does not enable creation or reuse an older preview', async () => {
  const importing = vi.fn(); const view = mountTestComponent(<CreateSiteDialog busy={false} onClose={vi.fn()} onCreate={vi.fn()} onReview={vi.fn().mockRejectedValue(new Error('Unavailable'))} onImport={importing} />);
  edit(view.container, 'websites.createMode', 'url'); edit(view.container, 'websites.sourceUrl', preview.url);
  act(() => { button(view.container, 'websites.importReview').click(); }); await settle();
  expect(view.container.querySelector('[role=alert]')).not.toBeNull();
  expect(button(view.container, 'websites.importSelected').disabled).toBe(true);
  expect(importing).not.toHaveBeenCalled(); view.unmount();
});
