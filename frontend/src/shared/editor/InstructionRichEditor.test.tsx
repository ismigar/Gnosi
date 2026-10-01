import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InstructionRichEditor from './InstructionRichEditor';

const mocks = vi.hoisted(() => ({
    serialize: vi.fn(() => 'Normalized original\n'),
    parse: vi.fn(() => [{ id: 'parsed', type: 'paragraph', content: [] }]),
    replace: vi.fn(),
    change: undefined as (() => void) | undefined,
    commands: undefined as ((query: string) => Promise<{ title: string; key: string }[]>) | undefined,
    editor: { document: [{ id: 'parsed', type: 'paragraph', content: [] }] },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ca' } }) }));
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ effectiveTheme: 'dark' }) }));
vi.mock('@blocknote/mantine', () => ({
    BlockNoteView: ({ onChange, editable, children }: { onChange: () => void; editable: boolean; children: ReactNode }) => {
        mocks.change = onChange;
        return <div data-editable={editable}>{children}</div>;
    },
}));
vi.mock('@blocknote/react', () => ({
    useCreateBlockNote: () => Object.assign(mocks.editor, { tryParseMarkdownToBlocks: mocks.parse,
        blocksToMarkdownLossy: mocks.serialize, replaceBlocks: mocks.replace }),
    BlockNoteViewEditor: () => <div role="textbox" />,
    FormattingToolbar: ({ children }: { children: ReactNode }) => <div role="toolbar">{children}</div>,
    BlockTypeSelect: () => <button>Type</button>,
    BasicTextStyleButton: ({ basicTextStyle }: { basicTextStyle: string }) => <button>{basicTextStyle}</button>,
    CreateLinkButton: () => <button>Link</button>,
    NestBlockButton: () => <button>Indent</button>,
    UnnestBlockButton: () => <button>Outdent</button>,
    getDefaultReactSlashMenuItems: () => [
        { key: 'heading', title: 'Heading' }, { key: 'code_block', title: 'Code' },
        { key: 'image', title: 'Image' }, { key: 'file', title: 'File' },
    ],
    SuggestionMenuController: ({ getItems }: { getItems: typeof mocks.commands }) => {
        mocks.commands = getItems;
        return null;
    },
}));

let host: HTMLDivElement;
let root: Root;
const change = vi.fn();
const original = 'Original  text\n\n```json\n{"source_segment_id":"a"}\n```\n';
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    change.mockClear();
    mocks.serialize.mockReturnValue('Normalized original\n');
    mocks.parse.mockReturnValue([{ id: 'parsed', type: 'paragraph', content: [] }]);
    mocks.replace.mockClear();
    mocks.commands = undefined;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });

async function render(props: { value?: string; disabled?: boolean; maxLength?: number } = {}) {
    await act(async () => { root.render(<InstructionRichEditor label="Instructions" value={original} onChange={change} {...props} />); await Promise.resolve(); });
}

it('shows format controls and limits slash commands to supported text structures', async () => {
    await render();
    expect(host.querySelector('[role="toolbar"]')?.textContent).toContain('bolditalicstrikecode');
    expect((await mocks.commands?.(''))?.map(item => item.key)).toEqual(['heading', 'code_block']);
});

it('keeps original Markdown on loading and non-content events; emits only edits and restores exact source on undo', async () => {
    await render();
    act(() => { mocks.change?.(); });
    expect(change).not.toHaveBeenCalled();
    mocks.serialize.mockReturnValue('**Edited**\n');
    act(() => { mocks.change?.(); });
    expect(change).toHaveBeenLastCalledWith('**Edited**\n');
    mocks.serialize.mockReturnValue('Normalized original\n');
    act(() => { mocks.change?.(); });
    expect(change).toHaveBeenLastCalledWith(original);
});

it('updates from externally edited Markdown without saving a converted document', async () => {
    await render();
    await render({ value: '# Changed in source\n' });
    expect(mocks.parse).toHaveBeenLastCalledWith('# Changed in source\n');
    expect(change).not.toHaveBeenCalled();
});

it('rejects edits exceeding the configured length and retains the previous document', async () => {
    await render({ maxLength: original.length });
    mocks.serialize.mockReturnValue('x'.repeat(original.length + 1));
    act(() => { mocks.change?.(); });
    expect(change).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('instruction_editor.too_long');
});

it('disables formatting and slash commands for a disabled field', async () => {
    await render({ disabled: true });
    expect(host.querySelector('[data-editable="false"]')).not.toBeNull();
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    expect(mocks.commands).toBeUndefined();
    mocks.serialize.mockReturnValue('Changed');
    act(() => { mocks.change?.(); });
    expect(change).not.toHaveBeenCalled();
});

it('never exposes an empty editable document or overwrites source after a parsing error', async () => {
    mocks.parse.mockImplementationOnce(() => { throw new Error('Invalid Markdown'); });
    await render();
    expect(host.querySelector('[data-editable="false"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('instruction_editor.source_required');
    act(() => { mocks.change?.(); });
    expect(change).not.toHaveBeenCalled();
});
