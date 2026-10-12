import { act, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { beforeEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { createVaultTablePage } from '../../../../shared/api/vault-table';
import { tableInputs } from './tableInputs';
import type { VaultTableProps } from './types';
import { useTableCreate } from './useTableCreate';

vi.mock('../../../../shared/api/vault-table', () => ({ createVaultTablePage: vi.fn() }));
vi.mock('../../../../shared/notifications/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('../../../../shared/notifications/toast', () => ({ toast: { success: vi.fn() } }));

type CreationModel = ReturnType<typeof useTableCreate> & {
    setNewRowTitle: (title: string) => void;
    setNewSubitemTitle: (title: string) => void;
};
function mountCreation(extra: Partial<VaultTableProps> = {}) {
    let current: CreationModel | undefined;
    const props: VaultTableProps = { notes: [], activeView: { table_id: 'fixture' }, onNoteSelect: vi.fn(), ...extra };
    function Probe({ input }: { input: VaultTableProps }) {
        const inputs = tableInputs(input);
        const { t } = useTranslation();
        const [newRowTitle, setNewRowTitle] = useState('');
        const [newSubitemTitle, setNewSubitemTitle] = useState('');
        const [, setAddingSubitemFor] = useState<string | null>(null);
        const [, setExpandedRows] = useState(new Set<string>());
        const actions = useTableCreate({ ...inputs, t, newRowTitle, setNewRowTitle, newSubitemTitle, setNewSubitemTitle,
            setAddingSubitemFor, setExpandedRows, safeNotes: inputs.notes,
            resolveNoteTableId: note => note?.resolved_table_id || note?.metadata?.table_id || note?.metadata?.database_table_id || null });
        useLayoutEffect(() => { current = { ...actions, setNewRowTitle, setNewSubitemTitle }; });
        return null;
    }
    const mounted = mountTestComponent(<Probe input={props} />);
    return { ...mounted,
        model: () => { if (!current) throw new Error('Missing creation model'); return current; },
        rerender: (input: Partial<VaultTableProps>) => { mounted.render(<Probe input={{ ...props, ...input }} />); },
    };
}
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createVaultTablePage).mockResolvedValue({ id: 'created', title: 'Task', content: '', folder: '', message: '', metadata: {}, status: 'success' });
});

it('creates an inline row in an empty view with its containing page before formula defaults', async () => {
    const table = mountCreation({ creationMetadata: { Projecte: 'project-a' },
        schema: { Projecte: 'relation', Projecte_config: { defaultFormula: 'template-project' },
            Status: 'status', Status_config: { defaultFormula: 'Pending' } } });
    act(() => { table.model().setNewRowTitle('  Task  '); });
    await act(async () => { await table.model().handleCreateRowRecord(); });
    expect(createVaultTablePage).toHaveBeenLastCalledWith({ title: 'Task', content: '',
        metadata: { title: 'Task', table_id: 'fixture', database_table_id: 'fixture', Projecte: 'project-a', Status: 'Pending' } });
    table.rerender({ creationMetadata: { Projecte: 'project-b' } });
    act(() => { table.model().setNewRowTitle('Another task'); });
    await act(async () => { await table.model().handleCreateRowRecord(); });
    const secondPayload: unknown = vi.mocked(createVaultTablePage).mock.calls.at(-1)?.[0];
    expect(secondPayload).toMatchObject({ metadata: { Projecte: 'project-b' } });
});

it('keeps the containing page and clicked parent when adding an inline subitem to any table', async () => {
    const table = mountCreation({ creationMetadata: { 'Col·lecció': 'collection-a' },
        notes: [{ id: 'parent', metadata: { table_id: 'resources' } }], activeView: { table_id: 'resources' } });
    act(() => { table.model().setNewSubitemTitle('Child resource'); });
    await act(async () => { await table.model().handleCreateSubitem('parent'); });
    const payload: unknown = vi.mocked(createVaultTablePage).mock.calls.at(-1)?.[0];
    expect(payload).toMatchObject({ title: 'Child resource', parent_id: 'parent',
        metadata: { 'Col·lecció': 'collection-a', parent_id: 'parent', table_id: 'resources' } });
});
