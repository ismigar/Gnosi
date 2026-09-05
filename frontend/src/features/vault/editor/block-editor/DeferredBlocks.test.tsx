import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeferredBlock, InlineDatabase, DbViewEmbed, EmbedRenderer } from './DeferredBlocks';

const probes = vi.hoisted(() => ({
    databaseLoad: vi.fn(), viewLoad: vi.fn(), embedLoad: vi.fn(),
    databaseProps: vi.fn<(props: ComponentProps<typeof InlineDatabase>) => void>(),
    viewProps: vi.fn<(props: ComponentProps<typeof DbViewEmbed>) => void>(),
    embedProps: vi.fn<(props: ComponentProps<typeof EmbedRenderer>) => void>(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./InlineDatabase', () => {
    probes.databaseLoad();
    return { InlineDatabase: (props: ComponentProps<typeof InlineDatabase>) => {
        probes.databaseProps(props);
        return <button onClick={() => { props.onUpdateTable('new-table'); }}>database ready</button>;
    } };
});
vi.mock('../../views/DbViewEmbed', () => {
    probes.viewLoad();
    return { DbViewEmbed: (props: ComponentProps<typeof DbViewEmbed>) => {
        probes.viewProps(props);
        return <span>view ready</span>;
    } };
});
vi.mock('../EmbedRenderer', () => {
    probes.embedLoad();
    return { EmbedRenderer: (props: ComponentProps<typeof EmbedRenderer>) => {
        probes.embedProps(props);
        return <span>embed ready</span>;
    } };
});
let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });

it('keeps optional modules unloaded for ordinary content and forwards inputs when rendered', async () => {
    const container = document.createElement('div');
    root = createRoot(container);
    act(() => { root.render(<DeferredBlock><p>ordinary note</p></DeferredBlock>); });
    expect(container.textContent).toBe('ordinary note');
    expect(probes.databaseLoad).not.toHaveBeenCalled();
    expect(probes.viewLoad).not.toHaveBeenCalled();
    expect(probes.embedLoad).not.toHaveBeenCalled();

    const block = { props: { database_table_id: 'table' } };
    const onUpdateTable = vi.fn();
    act(() => { root.render(<DeferredBlock><InlineDatabase block={block} onUpdateTable={onUpdateTable} /></DeferredBlock>); });
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(container.textContent).toBe('database ready');
    act(() => container.querySelector('button')?.click());
    expect(probes.databaseProps.mock.lastCall?.[0].block).toBe(block);
    expect(onUpdateTable).toHaveBeenCalledExactlyOnceWith('new-table');
    expect(probes.viewLoad).not.toHaveBeenCalled();
    expect(probes.embedLoad).not.toHaveBeenCalled();

    const viewBlock = { props: { view_id: 'view' } };
    act(() => {
        root.render(<DeferredBlock><DbViewEmbed block={viewBlock} /></DeferredBlock>);
    });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(container.textContent).toBe('view ready');
    expect(probes.viewProps.mock.lastCall?.[0].block).toBe(viewBlock);
    expect(probes.embedLoad).not.toHaveBeenCalled();

    const embedBlock = { props: { url: 'https://example.invalid/resource' } };
    const editor = { updateBlock: vi.fn() };
    act(() => {
        root.render(<DeferredBlock><EmbedRenderer block={embedBlock} editor={editor} /></DeferredBlock>);
    });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(container.textContent).toBe('embed ready');
    expect(probes.embedProps.mock.lastCall?.[0].block).toBe(embedBlock);
    expect(probes.embedProps.mock.lastCall?.[0].editor).toBe(editor);
    expect(probes.databaseLoad).toHaveBeenCalledTimes(1);
    expect(probes.viewLoad).toHaveBeenCalledTimes(1);
    expect(probes.embedLoad).toHaveBeenCalledTimes(1);
});
