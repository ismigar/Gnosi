import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../test/mount-react';
import { InlineSelectPicker } from './InlineSelectPicker';
import { InlinePillsPicker } from './InlinePillsPicker';
import { isOutsidePicker } from './pickerTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

afterEach(() => { vi.restoreAllMocks(); });

function inputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!descriptor?.set) throw new Error('Missing native input setter');
  act(() => {
    descriptor.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function inputIn(container: HTMLElement) {
  const input = container.querySelector('input');
  if (!input) throw new Error('Missing picker input');
  return input;
}

function key(input: HTMLInputElement, name: string) {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); });
}

function mouseDown(element: Element) {
  act(() => { element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
}

function portalOption(text: string): HTMLElement {
  const options = [...document.querySelectorAll<HTMLElement>('[data-cell-dropdown] > div')];
  const option = options.find((entry) => entry.textContent.includes(text));
  if (!option) throw new Error(`Missing portaled option ${text}`);
  return option;
}

async function settlePortal() {
  await act(async () => {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
  });
}

describe('table single-value picker', () => {
  it('navigates with arrows and saves the highlighted option by Enter', () => {
    const save = vi.fn();
    const { container } = mountTestComponent(<InlineSelectPicker value="a" options={['a', 'b']} onSave={save} />);
    const input = inputIn(container);
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(save).toHaveBeenCalledWith('b');
  });

  it('searches titles case-insensitively and resets the highlighted result', () => {
    const save = vi.fn();
    const { container } = mountTestComponent(<InlineSelectPicker options={['a', 'b', 'c']}
      idToTitle={{ a: 'Mercè', b: 'Bernat', c: 'Clara' }} onSave={save} />);
    const input = inputIn(container);
    key(input, 'ArrowDown');
    inputValue(input, 'MERC');
    key(input, 'Enter');
    expect(save).toHaveBeenCalledWith('a');
  });

  it('creates trimmed text by Enter and never saves undefined with an empty list', () => {
    const create = vi.fn(); const save = vi.fn();
    const { container } = mountTestComponent(<InlineSelectPicker options={[]} onSave={save} onCreate={create} />);
    const input = inputIn(container);
    key(input, 'Enter');
    expect(save).not.toHaveBeenCalled();
    inputValue(input, '  Nou  ');
    key(input, 'Enter');
    expect(create).toHaveBeenCalledWith('Nou');
    expect(save).not.toHaveBeenCalled();
  });

  it('Escape and outside click preserve the original selection; listeners detach', () => {
    const save = vi.fn();
    const { container, unmount } = mountTestComponent(<InlineSelectPicker value="original" options={['a']} onSave={save} />);
    key(inputIn(container), 'Escape');
    mouseDown(document.body);
    expect(save.mock.calls).toEqual([['original'], ['original']]);
    unmount();
    mouseDown(document.body);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('portaled selection saves once and option deletion does not select or close', async () => {
    const save = vi.fn(); const remove = vi.fn();
    mountTestComponent(<InlineSelectPicker value="a" options={['a', 'b']} onSave={save} onDeleteOption={remove} />);
    await settlePortal();
    const option = portalOption('b');
    const button = option.querySelector('[role="button"]');
    if (!button) throw new Error('Missing remove option');
    mouseDown(button);
    expect(remove).toHaveBeenCalledWith('b');
    expect(save).not.toHaveBeenCalled();
    mouseDown(option);
    expect(save.mock.calls).toEqual([['b']]);
  });
});

describe('table multi-value picker', () => {
  it('toggles choices in the portal without committing until Escape', async () => {
    const save = vi.fn();
    const { container } = mountTestComponent(<InlinePillsPicker value={['a']} options={['a', 'b']} onSave={save} />);
    await settlePortal();
    mouseDown(portalOption('b'));
    expect(save).not.toHaveBeenCalled();
    key(inputIn(container), 'Escape');
    expect(save).toHaveBeenCalledWith(['a', 'b']);
  });

  it('creates one catalog option, selects it locally and commits on outside click', () => {
    const create = vi.fn(); const save = vi.fn();
    const { container } = mountTestComponent(<InlinePillsPicker value={[]} options={[]} onCreate={create} onSave={save} />);
    const input = inputIn(container);
    inputValue(input, ' Nou ');
    key(input, 'Enter');
    expect(create).toHaveBeenCalledWith('Nou');
    expect(input.value).toBe('');
    mouseDown(document.body);
    expect(save).toHaveBeenCalledWith(['Nou']);
  });

  it('does not unlink a relation locally when its callback declines', async () => {
    const save = vi.fn();
    const remove = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(false);
    const { container } = mountTestComponent(<InlinePillsPicker value={['note-1']} options={[]}
      idToTitle={{ 'note-1': 'Mercè' }} relationItems onRemoveRelation={remove} onSave={save} />);
    const button = container.querySelector<HTMLButtonElement>('button');
    if (!button) throw new Error('Missing unlink button');
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(remove).toHaveBeenCalledWith('note-1');
    expect(container.querySelector('[data-relation-item="note-1"]')).not.toBeNull();
    key(inputIn(container), 'Escape');
    expect(save).toHaveBeenCalledWith(['note-1']);
  });

  it('removes an accepted relation locally without deleting other relations', async () => {
    const save = vi.fn();
    const remove = vi.fn<(id: string) => Promise<boolean | undefined>>().mockResolvedValue(undefined);
    const { container } = mountTestComponent(<InlinePillsPicker value={['one', 'two']} options={[]}
      relationItems onRemoveRelation={remove} onSave={save} />);
    const button = container.querySelector<HTMLButtonElement>('[data-relation-item="one"] button');
    if (!button) throw new Error('Missing unlink button');
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(container.querySelector('[data-relation-item="one"]')).toBeNull();
    key(inputIn(container), 'Escape');
    expect(save).toHaveBeenCalledWith(['two']);
  });
});

describe('picker event boundaries', () => {
  it('recognizes inside content, portals, text nodes and detached event targets', () => {
    const container = document.createElement('div');
    const child = document.createElement('span'); container.appendChild(child);
    const portal = document.createElement('div'); portal.dataset.cellDropdown = '';
    const option = document.createElement('span'); portal.appendChild(option);
    expect(isOutsidePicker(null, document.body)).toBe(false);
    expect(isOutsidePicker(container, child)).toBe(false);
    expect(isOutsidePicker(container, option)).toBe(false);
    expect(isOutsidePicker(container, document.createTextNode('outside'))).toBe(true);
    expect(isOutsidePicker(container, new EventTarget())).toBe(true);
    expect(isOutsidePicker(container, null)).toBe(true);
  });
});
