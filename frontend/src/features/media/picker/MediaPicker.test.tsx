import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { toast } from '../../../shared/notifications/toast';
import {
    fetchMediaPage,
    fetchMediaRoots,
    fetchMediaTree,
    type MediaItem,
    type MediaPage,
} from '../../../shared/api/media-browser';
import MediaPicker, { type MediaPickerProps } from './MediaPicker';


interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}


const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;


vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../../shared/api/media-browser', () => ({
    fetchMediaPage: vi.fn(),
    fetchMediaRoots: vi.fn(),
    fetchMediaTree: vi.fn(),
}));


function translate(key: string, fallback?: string): string {
    return fallback ?? key;
}


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: translate,
    }),
}));


const fetchMediaPageMock = vi.mocked(fetchMediaPage);
const fetchMediaRootsMock = vi.mocked(fetchMediaRoots);
const fetchMediaTreeMock = vi.mocked(fetchMediaTree);
const errorToastMock = vi.mocked(toast.error);


let container: HTMLDivElement;
let root: Root;


function mediaItem(
    filename: string,
    kind: string,
    url = `/api/vault/media/file/${filename}`,
): MediaItem {
    return {
        album: 'Trips',
        date_taken: null,
        description: '',
        extension: filename.split('.').at(-1) ?? '',
        filename,
        id: filename,
        kind,
        last_modified: '2026-08-29T00:00:00Z',
        location: null,
        path: `/vault/${filename}`,
        path_in_root: filename,
        root: 'images',
        size: 10,
        tags: [],
        url,
    };
}


function mediaPage(items: MediaItem[]): MediaPage {
    return {
        items,
        limit: 200,
        offset: 0,
        root: 'images',
        total: items.length,
    };
}


function requiredButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}


function requiredButtonByTitle(title: string): HTMLButtonElement {
    const button = document.body.querySelector(`button[title="${title}"]`);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${title}`);
    }
    return button;
}


function requiredInput(): HTMLInputElement {
    const input = document.body.querySelector('input[placeholder="Filter..."]');
    if (!(input instanceof HTMLInputElement)) {
        throw new Error('Missing filter input');
    }
    return input;
}


function click(element: HTMLElement): void {
    act(() => {
        element.click();
    });
}


function setInputValue(input: HTMLInputElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setValue) throw new Error('Missing native input value setter');
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


async function flushPromises(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}


async function renderPicker(
    overrides: Partial<MediaPickerProps> = {},
): Promise<{
    readonly onCancel: ReturnType<typeof vi.fn<() => void>>;
    readonly onSelect: ReturnType<typeof vi.fn<(item: MediaItem) => void>>;
}> {
    const onCancel = vi.fn<() => void>();
    const onSelect = vi.fn<(item: MediaItem) => void>();
    await act(async () => {
        root.render(
            <MediaPicker
                onCancel={onCancel}
                onSelect={onSelect}
                {...overrides}
            />,
        );
        await Promise.resolve();
    });
    await flushPromises();
    return { onCancel, onSelect };
}


beforeEach(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMediaRootsMock.mockReset().mockResolvedValue([
        { available: true, key: 'images', label: 'Images', url_prefix: '/images' },
        { available: false, key: 'vault', label: 'Vault', url_prefix: '/vault' },
    ]);
    fetchMediaTreeMock.mockReset().mockImplementation((_root, path) => (
        Promise.resolve(path
            ? [{ has_children: false, name: 'Paris', path: 'Trips/Paris' }]
            : [{ has_children: true, name: 'Trips', path: 'Trips' }])
    ));
    fetchMediaPageMock.mockReset().mockResolvedValue(mediaPage([
        mediaItem(
            'Sunset.jpg',
            'image',
            'https://localhost:5002/api/vault/media/file/Sunset.jpg',
        ),
        mediaItem('Notes.pdf', 'pdf'),
    ]));
    errorToastMock.mockReset();
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});


describe('MediaPicker', () => {
    it('shows only available roots and exposes the accessible close action', async () => {
        const { onCancel } = await renderPicker();
        expect(requiredButton('Images')).toBeInstanceOf(HTMLButtonElement);
        expect(document.body.textContent).not.toContain('Vault');
        const close = document.body.querySelector('button[aria-label="Close"]');
        if (!(close instanceof HTMLButtonElement)) throw new Error('Missing close button');
        click(close);
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('loads all content, normalizes previews and returns the full selected item', async () => {
        const { onSelect } = await renderPicker();
        click(requiredButton('All content'));
        await flushPromises();

        expect(fetchMediaPageMock).toHaveBeenCalledWith({
            limit: 200,
            offset: 0,
            root: 'images',
        });
        const image = document.body.querySelector('img[alt="Sunset.jpg"]');
        if (!(image instanceof HTMLImageElement)) throw new Error('Missing image preview');
        expect(image.getAttribute('src')).toBe('/api/vault/media/file/Sunset.jpg');
        click(requiredButtonByTitle('Sunset.jpg'));
        expect(onSelect.mock.calls[0]?.[0].filename).toBe('Sunset.jpg');
        expect(onSelect.mock.calls[0]?.[0].kind).toBe('image');
    });

    it('expands folders lazily and loads a selected album', async () => {
        await renderPicker();
        const expand = document.body.querySelector('button[aria-label="Expand"]');
        if (!(expand instanceof HTMLButtonElement)) throw new Error('Missing expand button');
        click(expand);
        await flushPromises();
        expect(fetchMediaTreeMock).toHaveBeenCalledWith('images', 'Trips');

        click(requiredButton('Paris'));
        await flushPromises();
        expect(fetchMediaPageMock).toHaveBeenCalledWith({
            album: 'Trips/Paris',
            limit: 200,
            offset: 0,
            root: 'images',
        });
    });

    it('combines kind and text filters without changing the source items', async () => {
        await renderPicker({ kindFilter: ['image'] });
        click(requiredButton('All content'));
        await flushPromises();
        expect(document.body.textContent).toContain('Sunset.jpg');
        expect(document.body.textContent).not.toContain('Notes.pdf');

        setInputValue(requiredInput(), 'missing');
        expect(document.body.textContent).toContain('No files found');
    });

    it('reports page-loading failures through the existing toast', async () => {
        fetchMediaPageMock.mockRejectedValue(new Error('offline'));
        await renderPicker();
        click(requiredButton('All content'));
        await flushPromises();
        expect(errorToastMock).toHaveBeenCalledWith('Files could not be loaded');
        expect(document.body.textContent).toContain('No files found');
    });
});
