import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import { saveToggleExpansionState, saveToggleDomExpansionState, restoreToggleDomExpansionState } from '../../toggleExpansionStateUtils';
import { useEditorEffects } from './useEditorEffects';
import { editorFixture, paragraph, heading, embed } from './testFixtures';
import type { EditorEffectsInputs, EditorFocusApi } from './types';

vi.mock('../../toggleExpansionStateUtils', () => ({ saveToggleExpansionState: vi.fn(), saveToggleDomExpansionState: vi.fn(), restoreToggleDomExpansionState: vi.fn() }));
const cleanups: (() => void)[] = [];
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

function setup(blocks = [paragraph('first')]) {
    const fixture = editorFixture(blocks);
    const inputs: EditorEffectsInputs = {
        editor: fixture.editor, editorWrapperRef: { current: fixture.wrapper }, editorReady: true, noteFilename: 'page',
        setIsCitePickerOpen: vi.fn(), setLinkPasteCtx: vi.fn(),
        requestInsertContent: vi.fn(() => Promise.resolve(null)), uploadFileToAssetsDirect: vi.fn(() => Promise.resolve(null)),
        applyInsertResultRef: { current: vi.fn() }, toggleDropHandlerRef: { current: null },
    };
    let bridge: ReturnType<typeof useEditorEffects> | undefined;
    function Harness({ value }: { value: EditorEffectsInputs }) { bridge = useEditorEffects(value); return null; }
    const mounted = mountTestComponent(<Harness value={inputs} />);
    cleanups.push(() => { mounted.unmount(); fixture.destroy(); });
    return { ...fixture, ...mounted, inputs, bridge: () => { if (!bridge) throw new Error('Missing effects'); return bridge; }, rerender: (value: EditorEffectsInputs) => { mounted.render(<Harness value={value} />); } };
}

describe('effect lifecycle', () => {
    it('persists toggles after their click, debounces restoration and cleans subscriptions/timers', async () => {
        const { wrapper, changed, editor, unmount, inputs, listeners } = setup();
        expect(inputs.toggleDropHandlerRef.current).toBeTypeOf('function');
        const button = document.createElement('button'); button.className = 'bn-toggle-button';
        const child = document.createElement('span'); button.appendChild(child); wrapper.appendChild(button);
        child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(saveToggleExpansionState).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(saveToggleExpansionState).toHaveBeenCalledWith('page', editor.document);
        expect(saveToggleDomExpansionState).toHaveBeenCalledWith('page', wrapper);
        await act(async () => { await vi.advanceTimersByTimeAsync(100); }); changed();
        await act(async () => { await vi.advanceTimersByTimeAsync(149); }); expect(restoreToggleDomExpansionState).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(restoreToggleDomExpansionState).toHaveBeenCalledOnce();
        changed(); unmount();
        expect(inputs.toggleDropHandlerRef.current).toBeNull(); expect(listeners.size).toBe(0);
        vi.mocked(saveToggleExpansionState).mockClear();
        child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await act(async () => { await vi.runAllTimersAsync(); });
        expect(saveToggleExpansionState).not.toHaveBeenCalled(); expect(restoreToggleDomExpansionState).toHaveBeenCalledOnce();
    });
    it('updates area CSS from model without mutating editor DOM/content, removes it at disposal', () => {
        const { inputs, rerender, wrapper, editor, changed, unmount } = setup([heading('blue', 1, [heading('gray', 2, [], 'Recursos')], 'Formació'), paragraph('other')]);
        const original = wrapper.innerHTML;
        rerender({ ...inputs, metadata: { table_id: 'areas' }, contextValue: { allTables: [{ id: 'areas', name: 'Àrees' }] } });
        const style = document.head.querySelector('style[data-gnosi-area-headings]');
        expect(style?.textContent).toContain('data-id="blue"'); expect(style?.textContent).toContain('var(--area-blue)'); expect(style?.textContent).toContain('var(--area-gray)');
        expect(wrapper.innerHTML).toBe(original); expect(editor.updateBlock).not.toHaveBeenCalled();
        editor.document = [heading('new', 1, [], 'Projectes')]; changed();
        expect(style?.textContent).toContain('var(--area-purple)'); expect(style?.textContent).not.toContain('data-id="blue"');
        unmount(); expect(document.head.querySelector('style[data-gnosi-area-headings]')).toBeNull();
    });
    it('registers/unregisters focus API and embed bridges, retaining current navigation callbacks', () => {
        const { inputs, rerender, bridge, editor, unmount } = setup([embed('view')]);
        const registration = vi.fn<(api: EditorFocusApi | null) => void>(); const up = vi.fn();
        rerender({ ...inputs, registerEditorApi: registration, onNavigateUp: up });
        const first = vi.fn(); bridge().registerEmbedNav('view', { focusFirstCell: first });
        const api = registration.mock.calls.at(-1)?.[0]; expect(api?.focusFirstBlock()).toBe(true); expect(first).toHaveBeenCalledOnce();
        bridge().exitEmbedToEditor('view', 'up'); expect(up).toHaveBeenCalledOnce();
        bridge().registerEmbedNav('view', null); expect(api?.focusFirstBlock()).toBe(true); expect(editor.focus).toHaveBeenCalledOnce();
        bridge().registerEmbedNav('', {}); expect(bridge().embedNavRef.current.size).toBe(0);
        unmount(); expect(registration).toHaveBeenLastCalledWith(null);
    });
    it('captures citation shortcut inside editor but leaves external inputs alone and unregisters', () => {
        const { inputs, wrapper, unmount } = setup();
        const outside = document.createElement('input'); document.body.appendChild(outside); cleanups.push(() => { outside.remove(); });
        const inside = document.createElement('textarea'); wrapper.appendChild(inside);
        const key = () => new KeyboardEvent('keydown', { key: 'I', metaKey: true, shiftKey: true, cancelable: true, bubbles: true });
        outside.focus(); const external = key(); outside.dispatchEvent(external); expect(external.defaultPrevented).toBe(false);
        inside.focus(); const internal = key(); inside.dispatchEvent(internal); expect(internal.defaultPrevented).toBe(true);
        expect(inputs.setIsCitePickerOpen).toHaveBeenCalledExactlyOnceWith(true);
        unmount(); inside.dispatchEvent(key()); expect(inputs.setIsCitePickerOpen).toHaveBeenCalledOnce();
    });
});
