import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { RecordSubitemProvider } from './RecordSubitemProvider';
import { RecordSubitemAction } from '../../../shared/record-views/RecordSubitemAction';

const createPage = vi.hoisted(() => vi.fn());
const prompt = vi.hoisted(() => ({ submit: undefined as undefined | ((title: string) => Promise<void>) }));
vi.mock('../../../shared/api/vault-table', () => ({ createVaultTablePage: createPage }));
vi.mock('../../../shared/notifications/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('../../../shared/notifications/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('../../../shared/ui/dialogs/PromptModal', () => ({ default: (props: { isOpen: boolean; onSubmit: (title: string) => Promise<void> }) => {
    prompt.submit = props.isOpen ? props.onSubmit : undefined;
    return null;
} }));
const parent = { id: 'parent', title: 'Parent', resolved_table_id: 'tasks', metadata: { database_id: 'database' } };

function actionButton(container: HTMLElement): HTMLButtonElement {
    const button = container.querySelector('button');
    if (!button) throw new Error('Missing subitem action');
    return button;
}
function submit(title: string): Promise<void> {
    if (!prompt.submit) throw new Error('Missing creation editor');
    return prompt.submit(title);
}

it('creates a child of the clicked record without opening its parent', async () => {
        createPage.mockReset().mockResolvedValue({ id: 'child' });
        const refreshed = vi.fn(); const open = vi.fn();
        const view = mountTestComponent(<RecordSubitemProvider enabled records={[parent]} schema={{}} onSaved={refreshed}>
            <div onClick={open}><span>{parent.title}</span><RecordSubitemAction recordId={parent.id} /></div>
        </RecordSubitemProvider>);
        act(() => { actionButton(view.container).click(); });
        expect(open).not.toHaveBeenCalled();
        await act(async () => { await submit('Child'); });
        const payload: unknown = createPage.mock.calls[0]?.[0];
        expect(payload).toMatchObject({ title: 'Child', parent_id: 'parent',
            metadata: { parent_id: 'parent', table_id: 'tasks', database_table_id: 'tasks', database_id: 'database' } });
        expect(refreshed).toHaveBeenCalledOnce(); expect(prompt.submit).toBeUndefined();
    });

it('hides the action when subitems are disabled', () => {
    const view = mountTestComponent(<RecordSubitemProvider enabled={false} records={[parent]} schema={{}} onSaved={vi.fn()}>
        <RecordSubitemAction recordId={parent.id} />
    </RecordSubitemProvider>);
    expect(view.container.querySelector('button')).toBeNull();
});

it('keeps the entered title editable on failure and does not refresh', async () => {
    createPage.mockReset().mockRejectedValue(new Error('save failed')); const refreshed = vi.fn();
    const view = mountTestComponent(<RecordSubitemProvider enabled records={[parent]} schema={{}} onSaved={refreshed}>
        <RecordSubitemAction recordId={parent.id} />
    </RecordSubitemProvider>);
    act(() => { actionButton(view.container).click(); });
    await act(async () => { await expect(submit('Child')).rejects.toThrow('save failed'); });
    expect(refreshed).not.toHaveBeenCalled(); expect(prompt.submit).toBeDefined();
});
