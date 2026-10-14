import { act, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { inFlightSaves } from '../editorState';
import { useEditorPersistence, type SaveStatus } from './useEditorPersistence';
import { useMarkdownCode } from './useMarkdownCode';

vi.mock('../../../../shared/api/vaults', () => ({ patchVaultPage: vi.fn() }));
vi.mock('react-i18next', () => {
    const t = (key: string) => key;
    return { useTranslation: () => ({ t }) };
});

afterEach(() => { inFlightSaves.clear(); vi.clearAllMocks(); });

it('keeps the current editor save available across mode switches before composing', async () => {
    let save: (() => Promise<boolean>) | null = null;
    let editSource: ((text: string) => void) | undefined;
    const registerSave = (next: typeof save) => { save = next; };
    const metadataRef = { current: { title: 'Document' } };
    const editor = {
        document: [{ id: 'paragraph', type: 'paragraph', content: [{ type: 'text', text: 'Original', styles: {} }] }],
        onChange: () => () => {},
    };
    function Visual() {
        const [, setSaveStatus] = useState<SaveStatus>('idle');
        useEditorPersistence({ editor, noteFilename: 'page', metadataRef, isParsing: false, editorReady: true, setSaveStatus, registerSave });
        return <div />;
    }
    function Source() {
        const session = useMarkdownCode({ noteFilename: 'page', initialContent: 'Original', registerSave });
        editSource = session.onChange;
        return <div>{session.text}</div>;
    }
    function Modes({ source }: { source: boolean }) { return source ? <Source /> : <Visual />; }
    const view = mountTestComponent(<Modes source={false} />);
    const flushCurrent = async () => {
        const current = save;
        expect(current).toBeTypeOf('function');
        if (!current) throw new Error('Current editor has no save controller');
        let settled = false;
        await act(async () => { settled = await current(); });
        expect(settled).toBe(true);
    };
    await flushCurrent();
    view.render(<Modes source />);
    await flushCurrent();
    vi.mocked(patchVaultPage).mockResolvedValue({ id: 'page', title: 'Document', content: '', metadata: {}, folder: '', message: '', status: 'ok' });
    act(() => { editSource?.('Latest source draft'); });
    await flushCurrent();
    expect(patchVaultPage).toHaveBeenCalledWith('page', expect.objectContaining({ content: 'Latest source draft' }));
    view.render(<Modes source={false} />);
    await flushCurrent();
    view.render(<Modes source />);
    await flushCurrent();
    view.unmount();
    expect(save).toBeNull();
});
