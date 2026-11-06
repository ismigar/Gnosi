import { act, type ReactElement } from 'react';
import { expect, test, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import type { SiteConfig } from '../../shared/api/sites';
import { NavigationEditor } from './NavigationEditor';
import { PagesEditor } from './PagesEditor';
import { SourcesEditor } from './SourcesEditor';
import { FormsEditor } from './FormsEditor';
import { ImportedHtmlEditor } from './ImportedHtmlEditor';

vi.mock('../../shared/editor/InstructionMarkdownEditor', () => ({ InstructionMarkdownEditor: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => <textarea aria-label={label} value={value} onChange={event => { onChange(event.target.value); }} /> }));

test('visual blocks preserve selected layout, keyboard reorder and undo through a saved response', () => {
  const initial: SiteConfig = { ...base, pages: [{ id: 'visual', title: 'Visual', path: '/ca/visual', language: 'ca', enabled: true, template: 'page', description: '', css: '', blocks: [
    { id: 'one', type: 'image', title: 'Portrait', body: '', image: '/portrait.png', alt: 'Portrait', image_position: 'right', columns: 3, limit: 3, href: '', css: '' },
    { id: 'two', type: 'text', title: 'Introduction', body: 'Original introduction', image: '', alt: '', image_position: 'right', columns: 3, limit: 3, href: '', css: '' },
  ] }] };
  const view = mountEditor(initial, (site, onChange) => <PagesEditor site={site} catalogue={[]} onChange={onChange} />);
  edit(view.container, 'websites.visual.imageWidth', '60');
  edit(view.container, 'websites.visual.alignment', 'center');
  const first = required(view.container.querySelector<HTMLElement>('.websites-canvas-block'));
  click(first, 'websites.moveDown');
  expect(view.site.pages?.[0]?.blocks?.map(block => block.id)).toEqual(['two', 'one']);
  expect(view.site.pages?.[0]?.blocks?.[1]).toMatchObject({ image_width: 60, alignment: 'center' });
  click(view.container, 'websites.visual.undo');
  expect(view.site.pages?.[0]?.blocks?.map(block => block.id)).toEqual(['one', 'two']);
  click(view.container, 'websites.visual.redo');
  view.savedResponse();
  expect(view.site.pages?.[0]?.blocks?.[1]).toMatchObject({ image_width: 60, alignment: 'center' });
  click(view.container, 'websites.visual.mobile');
  expect(view.container.querySelector('.websites-canvas')?.getAttribute('data-width')).toBe('mobile');
});

test('imported text edits immediately preserve columns, links, image and other paragraphs without executing markup', () => {
  const original = '<div class="layout layout--twocol-section"><div class="layout__region"><p>Keep <strong>bold</strong></p><p>Other paragraph</p></div><div class="layout__region"><img src="/portrait.png" alt="Portrait"></div></div>';
  const changes = vi.fn();
  const view = mountTestComponent(<ImportedHtmlEditor label="Body" value={original} onChange={changes} />);
  const field = required(view.container.querySelector<HTMLElement>('[role="textbox"]'));
  act(() => { field.innerHTML = 'Updated <em>text</em>'; field.dispatchEvent(new Event('input', { bubbles: true })); });
  const saved = String(changes.mock.lastCall?.[0]);
  expect(saved).toContain('layout--twocol-section');
  expect(saved).toContain('<em>text</em>'); expect(saved).toContain('Other paragraph'); expect(saved).toContain('src="/portrait.png"');
  view.render(<ImportedHtmlEditor label="Body" value={'<p><a href="javascript:bad()">Unsafe</a><img src="https://tracker.invalid/pixel" onerror="bad()"><script>bad()</script></p>'} onChange={changes} />);
  expect(view.container.querySelector('[role="textbox"] img')).toBeNull();
  expect(view.container.querySelector('[role="textbox"] script')).toBeNull();
  expect(view.container.querySelector('[role="textbox"] a[href^="javascript:"]')).toBeNull();
});

test('imported text keeps quote styling and new lines when typing inside a preserved fragment', () => {
  const changes = vi.fn();
  const original = '<div class="layout__region"><p><span class="cita-coneix-me">Original quote</span></p><p>Unchanged</p></div>';
  const view = mountTestComponent(<ImportedHtmlEditor label="Body" value={original} onChange={changes} />);
  const field = required(view.container.querySelector<HTMLElement>('[role="textbox"]'));
  const span = required(field.querySelector('span'));
  act(() => { span.textContent = 'Updated quote'; field.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(changes.mock.lastCall?.[0]).toContain('<span class="cita-coneix-me">Updated quote</span>');
  act(() => { field.innerHTML = 'First line<div>Second line</div>'; field.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(changes.mock.lastCall?.[0]).toContain('First line<br>Second line');
  expect(changes.mock.lastCall?.[0]).toContain('<p>Unchanged</p>');
});

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const base: SiteConfig = { id: 'site', name: 'Synthetic', schema_version: 1, revision: 1, legacy_pilot: false, origin: 'https://example.invalid', languages: ['ca', 'en'], default_language: 'ca' };
type Editor = (site: SiteConfig, onChange: (next: SiteConfig) => void) => ReactElement;

function mountEditor(initial: SiteConfig, editor: Editor) {
  let current = structuredClone(initial);
  const onChange = vi.fn((next: SiteConfig) => {
    current = next;
    view.render(editor(current, onChange));
  });
  const view = mountTestComponent(editor(current, onChange));
  return {
    ...view,
    get site() { return current; },
    savedResponse() {
      current = structuredClone({ ...current, revision: current.revision + 1 });
      view.render(editor(current, onChange));
      return current;
    },
  };
}
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing editor control'); return value; }
function card(container: HTMLElement, title: string) {
  return required([...container.querySelectorAll<HTMLElement>('.websites-card')].find(element => element.querySelector('h2')?.textContent === title));
}
function control(container: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement {
  return required([...container.querySelectorAll('label')].find(element => element.querySelector('span')?.textContent === label)?.querySelector<HTMLInputElement | HTMLSelectElement>('input,select'));
}
function edit(container: HTMLElement, label: string, value: string) {
  const element = control(container, label);
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
function click(container: HTMLElement, label: string) {
  const element = required([...container.querySelectorAll<HTMLElement>('button,[role="switch"]')].find(item => item.textContent === label || item.getAttribute('aria-label') === label));
  act(() => { element.click(); });
}

test('header actions retain all link fields through parent updates and a saved response', () => {
  const view = mountEditor(base, (site, onChange) => <NavigationEditor site={site} onChange={onChange} />);
  const actions = card(view.container, 'websites.headerActions');
  click(actions, 'websites.addLink');
  expect(view.site.header_actions).toEqual([{ label: '', href: '', language: null, appearance: 'button' }]);
  edit(actions, 'websites.label', 'Col·labora');
  edit(actions, 'websites.destination', '/ca/collabora');
  edit(actions, 'websites.language', 'ca');
  edit(actions, 'websites.linkAppearance', 'outline');
  edit(view.container, 'websites.siteName', 'Updated site');
  const saved = view.savedResponse();
  expect(saved).toMatchObject({ name: 'Updated site', revision: 2, header_actions: [{ label: 'Col·labora', href: '/ca/collabora', language: 'ca', appearance: 'outline' }] });
  expect(control(actions, 'websites.label').value).toBe('Col·labora');
  expect(control(actions, 'websites.linkAppearance').value).toBe('outline');

  click(actions, 'websites.addLink');
  edit(required(actions.querySelectorAll<HTMLElement>('.websites-row')[1]), 'websites.label', 'Second action');
  click(required(actions.querySelectorAll<HTMLElement>('.websites-row')[1]), 'websites.moveUp');
  expect(view.site.header_actions?.map(link => link.label)).toEqual(['Second action', 'Col·labora']);
  click(required(actions.querySelector<HTMLElement>('.websites-row')), 'websites.remove');
  expect(view.savedResponse().header_actions).toEqual(saved.header_actions);
});

test('menu and footer links offer styles while social links keep their existing fields', () => {
  const initial = { ...base, navigation: [{ label: 'Home', href: '/ca/', language: 'ca' }], footer: [{ label: 'Contact', href: '/ca/contacte', language: null }], social_links: [{ label: 'Social', href: 'https://social.example.invalid', language: null }] };
  const view = mountEditor(initial, (site, onChange) => <NavigationEditor site={site} onChange={onChange} />);
  const navigation = card(view.container, 'websites.navigation');
  expect(control(navigation, 'websites.linkAppearance').value).toBe('link');
  edit(navigation, 'websites.linkAppearance', 'button');
  edit(card(view.container, 'websites.footer'), 'websites.linkAppearance', 'outline');
  const social = card(view.container, 'websites.social_links');
  expect([...social.querySelectorAll('label')].some(label => label.textContent.includes('websites.linkAppearance'))).toBe(false);
  edit(social, 'websites.label', 'Updated social');
  expect(view.savedResponse()).toMatchObject({ navigation: [{ appearance: 'button' }], footer: [{ appearance: 'outline' }], social_links: [{ label: 'Updated social', href: 'https://social.example.invalid', language: null }] });
});

test('split-block actions survive page edits and save responses and can be explicitly cleared', () => {
  const initial: SiteConfig = { ...base, pages: [{ id: 'home', title: 'Home', language: 'ca', path: '/ca/', enabled: true, template: 'home', description: '', css: '', blocks: [{ id: 'hero', type: 'split', title: 'Welcome', body: 'Introduction', image: '/hero.webp', alt: 'Landscape', image_position: 'right', href: '', columns: 3, limit: 3, css: '', actions: null }] }] };
  const view = mountEditor(initial, (site, onChange) => <PagesEditor site={site} catalogue={[]} onChange={onChange} />);
  const actions = card(view.container, 'websites.blockActions');
  click(actions, 'websites.addLink');
  edit(actions, 'websites.label', 'Explore');
  edit(actions, 'websites.destination', '/ca/blog');
  edit(actions, 'websites.linkAppearance', 'outline');
  edit(view.container, 'websites.titleLabel', 'Updated home');
  edit(view.container, 'websites.image', '/new-hero.webp');
  expect(view.savedResponse().pages?.[0]).toMatchObject({ title: 'Updated home', blocks: [{ image: '/new-hero.webp', actions: [{ label: 'Explore', href: '/ca/blog', language: null, appearance: 'outline' }] }] });
  expect(control(actions, 'websites.destination').value).toBe('/ca/blog');
  expect(actions.querySelectorAll('select')).toHaveLength(1);
  click(actions, 'websites.remove');
  expect(view.savedResponse().pages?.[0]?.blocks?.[0]?.actions).toEqual([]);
});

test('source pagination and the public tag filter retain their values through other edits and save responses', () => {
  const initial: SiteConfig = { ...base, sources: [{ id: 'blog', source_id: 'articles', kind: 'table', title: 'Blog', enabled: false, include_body: false, sort_descending: false, presentation: 'cards', path_prefix: '/blog', selection_mode: 'all' }] };
  const view = mountEditor(initial, (site, onChange) => <SourcesEditor site={site} catalogue={[{ id: 'articles', kind: 'table', title: 'Articles' }]} onChange={onChange} />);
  expect(control(view.container, 'websites.pageSize').value).toBe('16');
  const tagFilter = required(view.container.querySelector<HTMLElement>('[role="switch"][aria-label="websites.showTagFilter"]'));
  expect(tagFilter.getAttribute('aria-checked')).toBe('false');
  edit(view.container, 'websites.pageSize', '24');
  click(view.container, 'websites.showTagFilter');
  edit(view.container, 'websites.publicTitle', 'Latest articles');
  expect(view.savedResponse().sources?.[0]).toMatchObject({ title: 'Latest articles', page_size: 24, show_tag_filter: true, enabled: false });
  expect(control(view.container, 'websites.pageSize').value).toBe('24');
  expect(tagFilter.getAttribute('aria-checked')).toBe('true');
  edit(view.container, 'websites.pageSize', '101');
  expect(view.site.sources?.[0]?.page_size).toBe(100);
  edit(view.container, 'websites.pageSize', '0');
  expect(view.savedResponse().sources?.[0]?.page_size).toBe(1);
});


test('contact consent and error captions remain independent for each configured language', () => {
  const initial = { ...base, forms: [{ id: 'support', name: 'Support', revision: 1, enabled: false, privacy_url: '', require_privacy: false }] };
  const view = mountEditor(initial, (site, onChange) => <FormsEditor site={site} onChange={onChange} />);
  edit(view.container, 'websites.formTexts.privacy_label', 'Consentiment propi');
  edit(view.container, 'websites.formTexts.privacy_link_label', 'Política pròpia');
  edit(view.container, 'websites.formTexts.failure_message', 'Torna-ho a provar');
  edit(view.container, 'websites.editingLanguage', 'en');
  edit(view.container, 'websites.formTexts.privacy_label', 'My consent');
  edit(view.container, 'websites.formTexts.privacy_link_label', 'Our policy');
  edit(view.container, 'websites.formTexts.required_message', 'Check these fields');
  const saved = view.savedResponse();
  expect(saved.forms?.[0]).toMatchObject({ privacy_label: { ca: 'Consentiment propi', en: 'My consent' }, privacy_link_label: { ca: 'Política pròpia', en: 'Our policy' }, failure_message: { ca: 'Torna-ho a provar' }, required_message: { en: 'Check these fields' } });
  edit(view.container, 'websites.editingLanguage', 'ca');
  expect(control(view.container, 'websites.formTexts.privacy_label').value).toBe('Consentiment propi');
  view.unmount();
});

test.each(['select', 'radio'] as const)('%s captions translate independently while submitted option values stay stable', type => {
  const initial = { ...base, forms: [{ id: 'support', name: 'Support', revision: 1, enabled: false, privacy_url: '', require_privacy: false, fields: [{ id: 'topic', type, required: false, max_length: 2000, options: ['blue'] }] }] };
  const view = mountEditor(initial, (site, onChange) => <FormsEditor site={site} onChange={onChange} />);
  edit(view.container, 'websites.optionCaption', 'Blau');
  edit(view.container, 'websites.editingLanguage', 'en');
  expect(control(view.container, 'websites.optionCaption').value).toBe('');
  edit(view.container, 'websites.optionCaption', 'Blue');
  expect(view.savedResponse().forms?.[0]?.fields?.[0]).toMatchObject({ options: ['blue'], option_labels: { blue: { ca: 'Blau', en: 'Blue' } } });
  edit(view.container, 'websites.editingLanguage', 'ca');
  expect(control(view.container, 'websites.optionCaption').value).toBe('Blau');
  view.unmount();
});


test('each form folds independently and keeps edited values when reopened', () => {
  const initial = { ...base, forms: [{ id: 'one', name: 'One', revision: 1, enabled: false, privacy_url: '', require_privacy: false }, { id: 'two', name: 'Two', revision: 1, enabled: false, privacy_url: '', require_privacy: false }] };
  const view = mountEditor(initial, (site, onChange) => <FormsEditor site={site} onChange={onChange} />);
  edit(view.container, 'websites.titleLabel', 'Retained title');
  const details = required(view.container.querySelector<HTMLDetailsElement>('details.websites-form'));
  act(() => { details.open = false; details.dispatchEvent(new Event('toggle')); });
  expect(details.open).toBe(false);
  expect(details.querySelector('input')).toBeNull();
  act(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });
  expect(control(details, 'websites.titleLabel').value).toBe('Retained title');
  expect(view.container.querySelectorAll('details.websites-form[open]')).toHaveLength(1);
  expect(view.savedResponse().forms?.[0]?.title).toEqual({ ca: 'Retained title' }); view.unmount();
});


test('gallery path editing keeps the same input and keyboard focus', () => {
  const initial: SiteConfig = { ...base, pages: [{ id: 'gallery-page', title: 'Gallery', language: 'ca', path: '/ca/gallery', enabled: false, template: 'page', description: '', css: '', blocks: [{ id: 'gallery', type: 'gallery', images: ['a'], title: '', body: '', image: '', alt: '', image_position: 'right', href: '', columns: 3, limit: 3, css: '' }] }] };
  const view = mountEditor(initial, (site, onChange) => <PagesEditor site={site} catalogue={[]} onChange={onChange} />);
  const input = required(view.container.querySelector<HTMLInputElement>('input[aria-label="websites.image 1"]'));
  input.focus();
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'ab'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(view.container.querySelector('input[aria-label="websites.image 1"]')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('ab'); view.unmount();
});


test('social network URL fields keep unrelated profiles and explicitly remove a cleared network', () => {
  const initial = { ...base, social_links: [{ label: 'Mastodon', href: 'https://social.example.invalid/@reader', language: null }, { label: 'Custom network', href: 'https://custom.example.invalid/profile', language: null }] };
  const view = mountEditor(initial, (site, onChange) => <NavigationEditor site={site} onChange={onChange} />);
  expect(view.container.querySelectorAll('.websites-social-icon')).toHaveLength(14);
  expect(control(view.container, 'Mastodon').value).toBe('https://social.example.invalid/@reader');
  edit(view.container, 'Instagram', 'https://www.instagram.com/reader/');
  expect(view.savedResponse().social_links).toContainEqual({ label: 'Instagram', href: 'https://www.instagram.com/reader/', language: null });
  edit(view.container, 'Mastodon', '');
  expect(view.savedResponse().social_links).not.toContainEqual(expect.objectContaining({ label: 'Mastodon' }));
  expect(view.savedResponse().social_links).toContainEqual(initial.social_links[1]);
});
