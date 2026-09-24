import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVaultPage, fetchVaultPage, fetchVaultPagesByTable } from '../../../shared/api/vaults';
import { uploadVaultInsertFile } from '../../../shared/api/vault-content';
import { uploadVaultCover } from '../../../shared/api/vault-icons';
import { createPdfCover } from '../../../shared/resources/pdfCover';
import { toast } from '../../../shared/notifications/toast';
import { useSources } from './useSources';

vi.mock('../../../shared/api/vaults');
vi.mock('../../../shared/api/vault-content');
vi.mock('../../../shared/api/vault-icons');
vi.mock('../../../shared/resources/pdfCover', () => ({ createPdfCover: vi.fn() }));
vi.mock('../../../shared/notifications/toast', () => ({
    toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

let controller: ReturnType<typeof useSources>;
let dispose: () => void;
let context: Parameters<typeof useSources>[0];
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
const sourceFile = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });
const coverFile = new File(['image'], 'cover.jpg', { type: 'image/jpeg' });
const template = (id: string, type: string) => ({
    id, title: `${type} template`, folder: '', is_database: false,
    last_modified: '2026-09-24', size: 1,
    metadata: { is_template: true, table_id: 'references', 'Item Type': type },
});

beforeEach(async () => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(toast.loading).mockReturnValue('creation-progress');
    vi.mocked(fetchVaultPagesByTable).mockResolvedValue([]);
    vi.mocked(createVaultPage).mockResolvedValue({
        id: 'created', metadata: {}, content: '', folder: '', title: 'Created',
        message: 'Created', status: 'created',
    });
    vi.mocked(uploadVaultInsertFile).mockResolvedValue({ url: 'Assets/Files/report.pdf', path: 'Assets/Files/report.pdf' });
    vi.mocked(createPdfCover).mockResolvedValue(coverFile);
    vi.mocked(uploadVaultCover).mockResolvedValue({ path: 'Assets/Covers/report.jpg', url: '/api/vault/assets/Covers/report.jpg' });
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: {}, showSupportNotice: false });
    context = {
        applySchemaDefaults: (_id, metadata) => ({ ...metadata }),
        fetchPages: vi.fn(() => Promise.resolve([])),
        getSchemaFromTableId: () => ({ PDF: 'files' }),
        loadPage: vi.fn(() => Promise.resolve()),
        t: i18n.t,
    };
    function Harness() { controller = useSources(context); return null; }
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => { root.render(<Harness />); });
    dispose = () => { act(() => { root.unmount(); }); };
});
afterEach(() => { dispose(); });

describe('source resource creation', () => {
    it('keeps one progress notification through upload, cover generation, saving and opening', async () => {
        const catalog = deferred<Awaited<ReturnType<typeof fetchVaultPagesByTable>>>();
        const upload = deferred<Awaited<ReturnType<typeof uploadVaultInsertFile>>>();
        const cover = deferred<File>();
        const create = deferred<Awaited<ReturnType<typeof createVaultPage>>>();
        const refresh = deferred<Awaited<ReturnType<typeof context.fetchPages>>>();
        const open = deferred<undefined>();
        vi.mocked(fetchVaultPagesByTable).mockReturnValueOnce(catalog.promise);
        vi.mocked(uploadVaultInsertFile).mockReturnValueOnce(upload.promise);
        vi.mocked(createPdfCover).mockReturnValueOnce(cover.promise);
        vi.mocked(createVaultPage).mockReturnValueOnce(create.promise);
        vi.mocked(context.fetchPages).mockReturnValueOnce(refresh.promise);
        vi.mocked(context.loadPage).mockReturnValueOnce(open.promise);

        const creating = controller.handleCreateFromSource('references', { Title: 'Report' }, sourceFile);
        expect(toast.loading).toHaveBeenLastCalledWith('Preparing the resource…');
        catalog.resolve([]);
        await vi.waitFor(() => { expect(toast.loading).toHaveBeenLastCalledWith('Saving the PDF…', { id: 'creation-progress' }); });
        upload.resolve({ url: 'Assets/Files/report.pdf', path: 'Assets/Files/report.pdf' });
        await vi.waitFor(() => { expect(createPdfCover).toHaveBeenCalled(); });
        expect(toast.loading).toHaveBeenLastCalledWith('Creating the cover…', { id: 'creation-progress' });
        cover.resolve(coverFile);
        await vi.waitFor(() => { expect(createVaultPage).toHaveBeenCalled(); });
        expect(toast.loading).toHaveBeenLastCalledWith('Saving the resource…', { id: 'creation-progress' });
        create.resolve({ id: 'created', metadata: {}, content: '', folder: '', title: 'Report', message: 'Created', status: 'created' });
        await vi.waitFor(() => { expect(context.fetchPages).toHaveBeenCalled(); });
        expect(toast.loading).toHaveBeenLastCalledWith('Opening the resource…', { id: 'creation-progress' });
        expect(toast.success).not.toHaveBeenCalled();
        refresh.resolve([]);
        await vi.waitFor(() => { expect(context.loadPage).toHaveBeenCalledWith('created'); });
        expect(toast.success).not.toHaveBeenCalled();
        open.resolve(undefined);
        await creating;
        expect(toast.success).toHaveBeenCalledWith('success.record_created', { id: 'creation-progress' });
    });

    it('shows progress for identifier imports without a file', async () => {
        await controller.handleCreateFromSource('references', { ISBN: '9780140449136', Title: 'Book' });
        expect(vi.mocked(toast.loading).mock.calls.map(([message]) => message)).toEqual([
            'Preparing the resource…', 'Saving the resource…', 'Opening the resource…',
        ]);
        expect(toast.success).toHaveBeenCalledWith('success.record_created', { id: 'creation-progress' });
        expect(uploadVaultInsertFile).not.toHaveBeenCalled();
    });

    it.each(['catalog', 'upload', 'create'])('replaces progress with an error if %s fails', async stage => {
        const failure = new Error('Unavailable');
        if (stage === 'catalog') vi.mocked(fetchVaultPagesByTable).mockRejectedValueOnce(failure);
        if (stage === 'upload') vi.mocked(uploadVaultInsertFile).mockRejectedValueOnce(failure);
        if (stage === 'create') vi.mocked(createVaultPage).mockRejectedValueOnce(failure);
        await controller.handleCreateFromSource('references', { Title: 'Report' }, sourceFile);
        expect(toast.error).toHaveBeenCalledWith('Error creating the record', { id: 'creation-progress' });
        expect(toast.success).not.toHaveBeenCalled();
        expect(context.loadPage).not.toHaveBeenCalled();
    });

    it.each([['book', 'Llibre'], ['report', 'Informe'], ['journalArticle', 'Article científic']])(
        'loads and applies the %s template even without cached dashboard pages', async (type, label) => {
            vi.mocked(fetchVaultPagesByTable).mockResolvedValue([
                template('another', 'document'), template('matching', label),
            ]);
            vi.mocked(fetchVaultPage).mockResolvedValue({
                id: 'matching', title: 'Template', content: '## Template content',
                etag: 'template-etag', folder: '',
                metadata: { 'Item Type': label, Status: 'To read', is_template: true, is_default_template: true },
            });
            await controller.handleCreateFromSource('references', {
                Title: 'Imported work', 'Item Type': type, DOI: '10.1234/work',
                cover: 'https://publisher.example/work.jpg',
            });
            expect(fetchVaultPagesByTable).toHaveBeenCalledWith('references', { include_templates: true });
            expect(fetchVaultPage).toHaveBeenCalledWith('matching');
            expect(vi.mocked(createVaultPage).mock.calls[0]?.[0]).toMatchObject({
                title: 'Imported work', content: '## Template content',
                metadata: {
                    'Item Type': type, Status: 'To read', DOI: '10.1234/work',
                    is_template: false, is_default_template: false,
                    cover: 'https://publisher.example/work.jpg',
                },
            });
        },
    );

    it('attaches the PDF and saves its rendered cover before creating the page', async () => {
        await controller.handleCreateFromSource('references', { Title: 'Report' }, sourceFile);
        expect(createPdfCover).toHaveBeenCalledWith(sourceFile);
        expect(uploadVaultCover).toHaveBeenCalledWith(coverFile);
        expect(vi.mocked(createVaultPage).mock.calls[0]?.[0].metadata).toMatchObject({
            PDF: 'Assets/Files/report.pdf', cover: 'Assets/Covers/report.jpg',
        });
    });

    it.each(['render', 'upload'])('still creates the reference if cover %s fails', async failure => {
        if (failure === 'render') vi.mocked(createPdfCover).mockRejectedValueOnce(new Error('unreadable'));
        else vi.mocked(uploadVaultCover).mockRejectedValueOnce(new Error('unavailable'));
        await controller.handleCreateFromSource('references', { Title: 'Report' }, sourceFile);
        expect(vi.mocked(createVaultPage).mock.calls[0]?.[0].metadata).toMatchObject({ PDF: 'Assets/Files/report.pdf' });
        expect(vi.mocked(createVaultPage).mock.calls[0]?.[0].metadata).not.toHaveProperty('cover');
    });

    it('preserves a template cover over automatic cover suggestions', async () => {
        vi.mocked(fetchVaultPagesByTable).mockResolvedValue([template('matching', 'report')]);
        vi.mocked(fetchVaultPage).mockResolvedValue({
            id: 'matching', title: 'Template', content: '', etag: 'template-etag', folder: '',
            metadata: { cover: 'Assets/Covers/chosen.jpg' },
        });
        await controller.handleCreateFromSource('references', {
            Title: 'Report', 'Item Type': 'report', cover: 'https://publisher.example/automatic.jpg',
        }, sourceFile);
        expect(vi.mocked(createVaultPage).mock.calls[0]?.[0].metadata).toMatchObject({ cover: 'Assets/Covers/chosen.jpg' });
        expect(createPdfCover).not.toHaveBeenCalled();
    });
});
