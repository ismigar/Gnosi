import { act } from 'react';
import { expect, test, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import type { CatalogueItem, SiteConfig } from '../../shared/api/sites';
import { SourcesEditor } from './SourcesEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const site: SiteConfig = { id: 'site', name: 'Synthetic', schema_version: 1, revision: 1, legacy_pilot: false, origin: 'https://example.invalid', languages: ['ca'], default_language: 'ca', sources: [] };
const catalogue: CatalogueItem[] = [
  { id: 'table', kind: 'table', publishable: true, title: 'Articles' },
  { id: 'view', kind: 'view', publishable: true, title: 'Educació seleccionada' },
  { id: 'page', kind: 'page', publishable: true, title: 'Contacte' },
  { id: 'record', kind: 'record', publishable: true, title: 'Excluded imported record' },
];
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing picker control'); return value; }
function open(container: HTMLElement) {
  const picker = required(container.querySelector<HTMLElement>('[role="combobox"]'));
  act(() => { picker.click(); });
  return required(document.querySelector<HTMLInputElement>('input[role="combobox"]'));
}

test('adding a source waits for a searchable explicit choice and keeps the chosen source private', () => {
  const onChange = vi.fn(); const view = mountTestComponent(<SourcesEditor site={site} catalogue={catalogue} onChange={onChange} />);
  const input = open(view.container);
  expect(onChange).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
  expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain('Excluded imported record');
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'educacio'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const option = required(document.querySelector<HTMLElement>('[role="option"]'));
  expect(option.textContent).toContain('Educació seleccionada');
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sources: [expect.objectContaining({ source_id: 'view', kind: 'view', title: 'Educació seleccionada', enabled: false, field_ids: [], attachment_field_ids: [], include_body: false })] }));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

test('cancelling the picker does not create a source or call autosave', () => {
  const onChange = vi.fn(); const view = mountTestComponent(<SourcesEditor site={site} catalogue={catalogue} onChange={onChange} />);
  const input = open(view.container);
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(onChange).not.toHaveBeenCalled();
});

test('no selectable catalogue items disables the source picker', () => {
  const onChange = vi.fn(); const view = mountTestComponent(<SourcesEditor site={site} catalogue={[required(catalogue[3])]} onChange={onChange} />);
  const picker = required(view.container.querySelector<HTMLElement>('[role="combobox"]'));
  expect(picker.getAttribute('aria-disabled')).toBe('true'); act(() => { picker.click(); });
  expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(onChange).not.toHaveBeenCalled();
});

test('unpublishable tables and their views cannot be selected as new website sources',()=>{
  const onChange=vi.fn();const view=mountTestComponent(<SourcesEditor site={site} catalogue={[{id:'private',kind:'table',title:'Private table',publishable:false},{id:'private-view',kind:'view',title:'Private view',publishable:false},{id:'public',kind:'table',title:'Allowed table',publishable:true}]} onChange={onChange}/>);
  open(view.container);
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain('Allowed table');
  expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain('Private');
});
