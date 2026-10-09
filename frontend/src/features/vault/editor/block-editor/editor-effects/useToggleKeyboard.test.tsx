import { useRef } from 'react';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import { useToggleKeyboard } from './useToggleKeyboard';
import type { EffectsEditor } from './types';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => { cleanup(); }); });
function fixture() {
    const click = vi.fn();
    const position = vi.fn(() => ({ block: { id: 'heading' } }));
    const editor = { getTextCursorPosition: position } as unknown as EffectsEditor;
    function Probe() {
        const ref = useRef<HTMLDivElement>(null);
        useToggleKeyboard({ editor, editorWrapperRef: ref, editorReady: true });
        return <div ref={ref}><div className="bn-editor" contentEditable suppressContentEditableWarning>
            <div className="bn-block-outer" data-id="heading"><div className="bn-toggle-wrapper" data-show-children="false">
                <button className="bn-toggle-button" onClick={event => {
                    click(); const parent = event.currentTarget.parentElement;
                    if (!parent) throw new Error('Missing disclosure wrapper');
                    parent.setAttribute('data-show-children', String(parent.getAttribute('data-show-children') !== 'true'));
                }} />Title<div className="bn-block-outer" data-id="child">Body</div>
            </div></div><input />
        </div></div>;
    }
    const view = mountTestComponent(<Probe />); cleanups.push(view.unmount);
    const body = view.container.querySelector<HTMLElement>('.bn-editor');
    const button = view.container.querySelector<HTMLButtonElement>('button');
    if (!body || !button) throw new Error('Missing editor controls');
    const key = (target: HTMLElement, value: string, extra: KeyboardEventInit = {}) => {
        const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
        act(() => { target.dispatchEvent(event); }); return event;
    };
    return { ...view, body, button, key, click, position };
}
it('toggles the current heading with Alt+Enter, leaving plain Enter and composing events untouched', () => {
    const f = fixture();
    expect(f.key(f.body, 'Enter').defaultPrevented).toBe(false);
    expect(f.key(f.body, 'Enter', { altKey: true, isComposing: true }).defaultPrevented).toBe(false);
    expect(f.key(f.body, 'Enter', { altKey: true }).defaultPrevented).toBe(true);
    expect(f.click).toHaveBeenCalledTimes(1);
    expect(f.button.getAttribute('aria-expanded')).toBe('true');
});
it('supports focused disclosure Enter and Space and exposes accessible state', () => {
    const f = fixture(); f.button.focus();
    expect(f.button.tabIndex).toBe(0);
    expect(f.button.getAttribute('aria-label')).toBe('editor.expand_section');
    f.key(f.button, 'Enter'); expect(f.button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(f.button);
    f.key(f.button, ' '); expect(f.button.getAttribute('aria-expanded')).toBe('false');
    expect(f.click).toHaveBeenCalledTimes(2);
});
it('does not toggle a parent section from its child paragraph or consume input shortcuts', () => {
    const f = fixture(); f.position.mockReturnValue({ block: { id: 'child' } });
    expect(f.key(f.body, 'Enter', { altKey: true }).defaultPrevented).toBe(false);
    expect(f.key(f.container.querySelector('input') ?? f.body, 'Enter', { altKey: true }).defaultPrevented).toBe(false);
    expect(f.click).not.toHaveBeenCalled();
});
