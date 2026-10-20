import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InstructionMarkdownEditor } from './InstructionMarkdownEditor';

vi.mock('./InstructionRichEditor', () => ({ default: () => <div role="toolbar">Formatting controls</div> }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let host: HTMLDivElement;
let root: Root;
const changed = vi.fn();
const original = '# Instruccions\n\n- Conserva [[Una nota]]\n\n```json\n{"source_segment_id": "ÀbC"}\n```\n\nText amb  dos espais.\n';

function Harness({ disabled = false, maxLength }: { disabled?: boolean; maxLength?: number }) {
    const [value, setValue] = useState(original);
    return <InstructionMarkdownEditor label="Instructions" value={value} disabled={disabled} maxLength={maxLength}
        onChange={next => { changed(next); setValue(next); }} />;
}

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    changed.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
});

function render(props: { disabled?: boolean; maxLength?: number } = {}) {
    act(() => { root.render(<Harness {...props} />); });
}
function click(key: string) {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === key || item.getAttribute('aria-label') === key);
    if (!button) throw new Error(`Missing button ${key}`);
    act(() => { button.click(); });
}
function field() {
    const textarea = document.querySelector('textarea');
    if (!textarea) throw new Error('Missing source editor');
    return textarea;
}

it('preserves original Markdown, whitespace and identifiers through visual/source switching and expansion', () => {
    render();
    expect(field().value).toBe(original);
    expect(host.querySelector('pre')?.textContent).toBe(`${original}\n`);
    click('shell.switch_code_view');
    expect(host.querySelector('.instruction-markdown__source')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('[aria-label="shell.switch_normal_view"]')?.getAttribute('aria-pressed')).toBe('true');
    click('instruction_editor.expand');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    click('shell.switch_normal_view');
    expect(field().value).toBe(original);
    click('instruction_editor.reduce');
    expect(host.querySelector('textarea')?.value).toBe(original);
    expect(changed).not.toHaveBeenCalled();
});

it('edits the controlled original text without interpreting HTML or normalizing Markdown', () => {
    render();
    const next = `${original}<script>alert("keep as text")</script>\n\n`;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field(), next);
        field().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(changed).toHaveBeenLastCalledWith(next);
    click('shell.switch_code_view');
    expect(host.querySelector('script')).toBeNull();
    click('shell.switch_normal_view');
    expect(field().value).toBe(next);
});

it('indents and outdents selected list lines while Tab keeps its normal focus behavior', () => {
    render();
    const start = original.indexOf('- Conserva');
    const end = original.indexOf('\n', start);
    field().setSelectionRange(start, end);
    act(() => { field().dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(field().value).toBe(original.replace('- Conserva', '  - Conserva'));
    act(() => { field().dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true, cancelable: true })); });
    expect(field().value).toBe(original);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { field().dispatchEvent(tab); });
    expect(tab.defaultPrevented).toBe(false);
});

it('closes only the expanded editor on Escape and restores focus', () => {
    render();
    const expand = host.querySelector<HTMLButtonElement>('[aria-label="instruction_editor.expand"]');
    expand?.focus();
    click('instruction_editor.expand');
    act(() => { field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(field().value).toBe(original);
    expect(changed).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('instruction_editor.expand');
});

it.each([{ disabled: true }, { maxLength: original.length }])('keeps disabled state and length limits when expanded: %j', props => {
    render(props);
    click('instruction_editor.expand');
    expect(field().disabled).toBe(Boolean(props.disabled));
    if (props.maxLength) expect(field().maxLength).toBe(props.maxLength);
    act(() => { field().dispatchEvent(new KeyboardEvent('keydown', { key: ']', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(changed).not.toHaveBeenCalled();
    expect(field().value).toBe(original);
});
