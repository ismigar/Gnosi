import {act, useEffect, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import MediaCenter from '../MediaCenter';
import {useMediaCenter, type MediaCenterState} from './useMediaCenter';
import * as api from '../../shared/api/media-browser';
import {uploadVaultAsset} from '../../shared/api/vault-specialized';
import {dispatchWindowEvent} from '../../shared/platform/browser-events';
import {MEDIA_ROOTS, mediaAsset, savedView} from './fixtures';
import {DEFAULT_FILTERS, DEFAULT_SORT} from './model';
import toast from '../../lib/toast';

vi.mock('react-i18next', () => {
    const t = (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key;
    return {useTranslation: () => ({t})};
});
vi.mock('../../hooks/useMediaQuery', () => ({useMediaQuery: () => false}));
vi.mock('../../components/AppHeader', () => ({AppHeader: ({children, title}: {children?: ReactNode; title: string}) => <header>{title}{children}</header>}));
vi.mock('../../lib/toast', () => ({default: {error: vi.fn(), success: vi.fn(), loading: vi.fn()}}));
vi.mock('../../shared/api/media-browser', () => ({
    fetchMediaPage: vi.fn(), fetchMediaRoots: vi.fn(), fetchMediaTree: vi.fn(), fetchMediaViews: vi.fn(),
    createMediaView: vi.fn(), updateMediaView: vi.fn(), deleteMediaView: vi.fn(),
    updateMediaMetadata: vi.fn(), uploadMediaFile: vi.fn(),
}));
vi.mock('../../shared/api/vault-specialized', () => ({uploadVaultAsset: vi.fn()}));
let root: Root;
let container: HTMLDivElement;
let current: MediaCenterState | null;
function state(): MediaCenterState {if (!current) throw new Error('Media center not mounted'); return current;}
function Harness() {
    const controller = useMediaCenter();
    useEffect(() => {current = controller;});
    return <output>{controller.filteredMedia.map(item => item.filename).join(',')}</output>;
}
async function run(action: () => void | Promise<void>) {await act(async () => {await action();});}
function button(label: string) {
    const result = [...container.querySelectorAll('button')].find(item =>
        item.getAttribute('aria-label') === label || item.title === label || item.textContent === label);
    if (!result) throw new Error('Missing button: ' + label);
    return result;
}
beforeAll(() => {(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;});
beforeEach(() => {
    vi.clearAllMocks(); current = null;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    vi.mocked(api.fetchMediaRoots).mockResolvedValue(MEDIA_ROOTS);
    vi.mocked(api.fetchMediaTree).mockResolvedValue([{path: 'Fixture album', name: 'Fixture album', has_children: true}]);
    vi.mocked(api.fetchMediaViews).mockResolvedValue([savedView()]);
    vi.mocked(api.fetchMediaPage).mockResolvedValue({items: [mediaAsset(), mediaAsset('second')], total: 2, limit: 50, offset: 0, root: 'images'});
    vi.mocked(api.updateMediaMetadata).mockResolvedValue({status: 'success'});
    vi.mocked(api.createMediaView).mockResolvedValue({...savedView(), id: 'created'});
    vi.mocked(api.updateMediaView).mockResolvedValue(savedView());
});
afterEach(async () => {await run(() => {root.unmount();}); container.remove(); vi.useRealTimers();});
describe('MediaCenter complete behavior', () => {
    it('loads available roots, preserves page timeout/offsets and resets pagination with filters', async () => {
        const firstPage = Array.from({length: 50}, (_, index) => mediaAsset(String(index)));
        vi.mocked(api.fetchMediaPage).mockResolvedValueOnce({items: firstPage, total: 51, limit: 50, offset: 0, root: 'images'});
        await run(() => {root.render(<Harness/>);});
        expect(state().roots.map(item => item.key)).toEqual(['images','assets','nextcloud']);
        expect(state().hasMore).toBe(true);
        await run(async () => {await state().fetchMedia(false);});
        expect(api.fetchMediaPage).toHaveBeenLastCalledWith({root: 'images', limit: 50, offset: 50}, undefined, 600_000);
        expect(state().media).toHaveLength(52);
        await run(() => {state().setFilters({...DEFAULT_FILTERS, kinds: ['video']});});
        expect(api.fetchMediaPage).toHaveBeenLastCalledWith({root: 'images', limit: 50, offset: 0, kinds: 'video'}, undefined, 600_000);
    });
    it('applies views across provider roots without losing their album or filters', async () => {
        await run(() => {root.render(<Harness/>);});
        await run(() => {state().applyView(savedView());});
        expect(state().activeRoot).toBe('nextcloud'); expect(state().activeAlbum).toBe('Photos/2026');
        expect(api.fetchMediaPage).toHaveBeenLastCalledWith({root: 'nextcloud', album: 'Photos/2026', limit: 50, offset: 0,
            kinds: 'image', tags_any: 'fixture', sort: 'filename', dir: 'asc'}, undefined, 600_000);
        await run(() => {state().resetFilters();});
        expect(state().filters).toEqual(DEFAULT_FILTERS); expect(state().sort).toEqual(DEFAULT_SORT);
        expect(state().activeViewId).toBeNull();
    });
    it('creates, updates and confirms deletion of saved views using exact sidecar payloads', async () => {
        await run(() => {root.render(<Harness/>);});
        await run(async () => {await state().submitNewView('A view');});
        expect(api.createMediaView).toHaveBeenCalledWith({label: 'A view', scope: {root: 'images', album: ''},
            filters: DEFAULT_FILTERS, sort: DEFAULT_SORT});
        expect(state().activeViewId).toBe('created');
        await run(async () => {await state().handleUpdateView();});
        expect(api.updateMediaView).toHaveBeenCalledWith('created', expect.objectContaining({scope: {root: 'images', album: ''}}));
        await run(() => {state().handleDeleteView('created');});
        expect(api.deleteMediaView).not.toHaveBeenCalled();
        await run(() => {state().confirmDialog?.onConfirm();});
        expect(api.deleteMediaView).toHaveBeenCalledWith('created'); expect(state().activeViewId).toBeNull();
    });
    it('does not save on opening an asset and debounces metadata changes for 600ms', async () => {
        vi.useFakeTimers(); await run(() => {root.render(<Harness/>);});
        await run(() => {state().handlePhotoClick(mediaAsset());});
        expect(api.updateMediaMetadata).not.toHaveBeenCalled();
        await run(() => {state().setEditingMetadata({tags: ['updated'], description: 'Changed fixture'});});
        await run(async () => {await vi.advanceTimersByTimeAsync(599);});
        expect(api.updateMediaMetadata).not.toHaveBeenCalled();
        await run(async () => {await vi.advanceTimersByTimeAsync(1);});
        expect(api.updateMediaMetadata).toHaveBeenCalledWith({root: 'images', path_in_root: 'Fixture album/fixture-image',
            filename: 'fixture-image.png', album: 'Fixture album', metadata: {tags: ['updated'], description: 'Changed fixture'}}, expect.any(AbortSignal));
        expect(state().saveStatus).toBe('saved'); expect(state().media[0]?.description).toBe('Changed fixture');
    });
    it('cancels pending autosave on navigation, reports errors and cleans timers on unmount', async () => {
        vi.useFakeTimers(); await run(() => {root.render(<Harness/>);});
        await run(() => {state().handlePhotoClick(mediaAsset());});
        await run(() => {state().setEditingMetadata({tags: [], description: 'Not saved'});});
        await run(() => {state().handlePhotoClick(mediaAsset('second'));});
        await run(async () => {await vi.advanceTimersByTimeAsync(600);});
        expect(api.updateMediaMetadata).not.toHaveBeenCalled();
        vi.mocked(api.updateMediaMetadata).mockRejectedValueOnce(new Error('read only'));
        await run(() => {state().setEditingMetadata({tags: [], description: 'Attempt'});});
        await run(async () => {await vi.advanceTimersByTimeAsync(600);});
        expect(state().saveStatus).toBe('error');
        await run(() => {root.unmount();}); expect(vi.getTimerCount()).toBe(0); root = createRoot(container);
    });
    it('keeps navigation, typing exclusions and finite slideshow playback', async () => {
        vi.useFakeTimers(); await run(() => {root.render(<Harness/>);});
        await run(() => {state().handlePhotoClick(mediaAsset());});
        const input = document.createElement('input'); container.append(input);
        await run(() => {input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));});
        expect(state().selectedPhoto?.id).toBe('fixture-image');
        await run(() => {document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));});
        expect(state().selectedPhoto?.id).toBe('second');
        await run(() => {state().goPrev(); state().setSlideshowActive(true);});
        await run(async () => {await vi.advanceTimersByTimeAsync(4000);});
        expect(state().selectedPhoto?.id).toBe('second');
        await run(async () => {await vi.advanceTimersByTimeAsync(4000);});
        expect(state().slideshowActive).toBe(false);
        await run(() => {document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));});
        expect(state().selectedPhoto).toBeNull();
    });
    it('renders gallery, search, layout and the image viewer using the real page', async () => {
        await run(() => {root.render(<MediaCenter/>);});
        expect(container.textContent).toContain('Nextcloud fixture');
        expect(container.querySelectorAll('img')).toHaveLength(2);
        await run(() => {button('List view').click();});
        expect(button('List view').getAttribute('aria-pressed')).toBe('true');
        const image = container.querySelector('img');
        if (!image) throw new Error('Missing media image');
        await run(() => {image.click();});
        expect(container.querySelector('textarea')).not.toBeNull();
        expect(container.textContent).toContain('1 / 2');
        await run(() => {button('media.close_esc').click();});
    });
    it('routes gallery uploads by root without applying an implicit timeout', async () => {
        await run(() => {root.render(<MediaCenter/>);});
        const file = new File(['synthetic'], 'fixture.txt', {type: 'text/plain'});
        async function upload() {
            const input = container.querySelector<HTMLInputElement>('input[type="file"]');
            if (!input) throw new Error('Missing upload input');
            Object.defineProperty(input, 'files', {value: [file], configurable: true});
            await run(() => {input.dispatchEvent(new Event('change', {bubbles: true}));});
        }
        await upload(); expect(api.uploadMediaFile).toHaveBeenCalledWith(file, 'General');
        await run(() => {button('media.root_assets').click();});
        await upload(); expect(uploadVaultAsset).toHaveBeenCalledWith(file);
        expect(toast.success).toHaveBeenCalledWith('media.upload_success', {id: 'upload'});
    });
    it.each([['image','img'], ['video','video'], ['audio','audio'], ['pdf','iframe'], ['other','a']] as const)(
        'renders the %s viewer with the original source and controls', async (kind, selector) => {
            const asset = mediaAsset('format-fixture', kind);
            vi.mocked(api.fetchMediaPage).mockResolvedValue({items: [asset], total: 1, limit: 50, offset: 0, root: 'images'});
            await run(() => {root.render(<MediaCenter/>);});
            const thumbnail = container.querySelector('.group.cursor-pointer');
            if (!(thumbnail instanceof HTMLElement)) throw new Error('Missing media card');
            await run(() => {thumbnail.click();});
            const viewer = container.querySelector('.fixed.inset-0');
            const element = viewer?.querySelector(selector);
            expect(element?.getAttribute(kind === 'other' ? 'href' : 'src')).toBe(asset.url);
            if (kind === 'audio' || kind === 'video') {
                expect(element?.hasAttribute('controls')).toBe(true);
                expect(element?.hasAttribute('autoplay')).toBe(true);
            }
            if (kind === 'pdf') expect(element?.getAttribute('title')).toBe(asset.filename);
        });
    it('retains media on loading failures and allows recovery', async () => {
        await run(() => {root.render(<Harness/>);});
        vi.mocked(api.fetchMediaPage).mockRejectedValueOnce(new Error('cloud file unavailable'));
        await run(async () => {await state().fetchMedia(true);});
        expect(state().media).toHaveLength(2); expect(state().loading).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('media.load_error');
        await run(() => {dispatchWindowEvent(new Event('resize'));});
        await run(async () => {await state().fetchMedia(true);});
        expect(state().media).toHaveLength(2);
    });
});
