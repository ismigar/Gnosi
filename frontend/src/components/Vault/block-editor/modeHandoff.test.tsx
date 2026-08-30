import { act, useCallback, useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../test/mount-react';
import { patchVaultPage } from '../../../shared/api/vaults';
import { inFlightSaves } from '../editorState';
import { blocksToRichMarkdown } from '../markdown-mapper';
import { MarkdownCodeEditor } from './MarkdownCodeEditor';
import { useInitialDocument, type InitialDocumentOptions } from './useInitialDocument';
import { createEditorSchema, type PartialEditorBlock } from './schema';
import type { VaultEditorContextValue } from '../VaultEditorContext';

vi.mock(import('../../../shared/api/vaults'), async importOriginal => ({ ...await importOriginal(), patchVaultPage: vi.fn() }));
const context: VaultEditorContextValue = { allTables: [], idToTitle: {}, pageId: null, registry: { databases: [], tables: [], views: [] }, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null };
const schema = createEditorSchema(context);
const metadata = { title: 'Fixture' };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); inFlightSaves.clear(); });
afterEach(() => { inFlightSaves.clear(); });

function FakeVisual({ source }: { source: string }) {
    const [blocks, setBlocks] = useState<PartialEditorBlock[] | null>(null);
    const [isParsing, setIsParsing] = useState(true);
    const [editor] = useState<InitialDocumentOptions['editor']>(() => ({
        document: [{ id: 'initial', type: 'paragraph', props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' }, content: [], children: [] }],
        replaceBlocks: vi.fn<InitialDocumentOptions['editor']['replaceBlocks']>(),
    }));
    const error = useInitialDocument({ editor, schema, initialContent: source, noteFilename: 'page', setBlocks, setIsParsing });
    return <output aria-label="Visual document">{error ? 'error' : isParsing ? 'parsing' : blocksToRichMarkdown(blocks)}</output>;
}
function ModeSwitch() {
    const [code, setCode] = useState(true);
    const [content, setContent] = useState('Original');
    const onUpdate = useCallback((_id: string, text: string) => { setContent(text); }, []);
    return <><button onClick={() => { setCode(false); }}>Visual</button>
        {code ? <MarkdownCodeEditor noteFilename="page" initialContent={content} metadata={metadata} onUpdate={onUpdate} /> : <FakeVisual source={content} />}
        <output aria-label="Parent document">{content}</output></>;
}

describe('Markdown to visual mode handoff', () => {
    it('loads a closing dirty draft before the delayed save response updates parent props', async () => {
        let resolve: ((value: Awaited<ReturnType<typeof patchVaultPage>>) => void) | undefined;
        vi.mocked(patchVaultPage).mockReturnValue(new Promise(done => { resolve = done; }));
        const view = mountTestComponent(<ModeSwitch />);
        const textarea = view.container.querySelector('textarea'); const button = view.container.querySelector('button');
        if (!textarea || !button) throw new Error('Missing mode fixture controls');
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (!descriptor?.set) throw new Error('Missing textarea setter');
        act(() => { descriptor.set?.call(textarea, '# New section\n\nUnsaved draft'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
        await act(async () => { button.click(); await Promise.resolve(); });
        expect(view.container.querySelector('[aria-label="Parent document"]')?.textContent).toBe('Original');
        expect(view.container.querySelector('[aria-label="Visual document"]')?.textContent).toBe('# New section\n\nUnsaved draft');
        expect(patchVaultPage).toHaveBeenCalledOnce();
        await act(async () => { resolve?.({ id: 'page', content: '', metadata: {}, title: 'Fixture', folder: '', message: '', status: 'ok' }); await Promise.resolve(); });
        expect(view.container.querySelector('[aria-label="Parent document"]')?.textContent).toBe('# New section\n\nUnsaved draft');
        expect(view.container.querySelector('[aria-label="Visual document"]')?.textContent).toBe('# New section\n\nUnsaved draft');
        view.unmount();
    });
});
