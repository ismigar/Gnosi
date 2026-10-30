import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { ScalarPropertyValue } from '../editor/block-editor/page-editor/ScalarPropertyValue';
import { PropertyValue } from '../editor/block-editor/page-editor/PropertyValue';
import { CellValue } from './vault-table/CellValue';
import { useTableMedia } from './vault-table/useTableMedia';
import { useVaultFeedPills } from './useVaultFeedPills';

type PageContext = ComponentProps<typeof ScalarPropertyValue>['context'];
type TableModel = ComponentProps<typeof CellValue>['model'];
type FeedInput = Parameters<typeof useVaultFeedPills>[0];
const source = 'https://example.test/image/123';
const localeSettings = { currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en-US', decimalSymbol: '.', numberLocale: 'en-US' } as const;
const note = { id: 'record', metadata: { Cover: { src: source, alt: 'Remote cover' } } };
const locale = createInstance();
const t = locale.getFixedT('en', 'translation');
beforeAll(async () => { await locale.init({ lng: 'en', resources: {} }); });

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Feed({ type, value }: { type: string; value: unknown }) {
    const input = { allNotes: [], columns: [['Cover', type]], idToTitle: {}, localeSettings, schema: {} } as FeedInput;
    const render = useVaultFeedPills(input);
    return <>{render({ ...note, metadata: { Cover: value } }).map(pill => <span key={pill.key}>{pill.node}</span>)}</>;
}

function pageContext(value: unknown, isEditor = false, edit = vi.fn()): PageContext {
    return { metadata: {}, getPropValue: () => value, getPropConfig: () => ({}), t, localeSettings, isEditor, setImagePickerProp: edit } as unknown as PageContext;
}
function tableModel(): TableModel {
    return { schema: {}, t, noteById: new Map(), isImageField: () => true } as unknown as TableModel;
}

function Table({ value, type = 'image' }: { value: unknown; type?: string }) {
    const input: Parameters<typeof useTableMedia>[0] = {
        t, schema: {}, allNotes: [], idToTitle: {}, activeView: undefined,
        resolveNoteTableId: () => '', setMediaPickerCell: () => {},
    };
    const media = useTableMedia(input);
    return <CellValue model={{ ...tableModel(), ...media }} value={value} type={type} field="Cover" originalMetaKey="Cover" noteId="record" />;
}

describe('image property preview routes', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.unstubAllGlobals();
    });
    const render = (node: ReactNode) => { act(() => { root.render(node); }); };
    function hover(element: Element) {
        act(() => { element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    }

    it.each(['page', 'table', 'feed'] as const)('previews declared extensionless image values in %s without changing thumbnail dimensions', route => {
        if (route === 'page') render(<ScalarPropertyValue prop={{ name: 'Cover', type: 'image' }} context={pageContext(note.metadata.Cover)} />);
        if (route === 'table') render(<Table value={note.metadata.Cover} />);
        if (route === 'feed') render(<Feed type="image" value={note.metadata.Cover} />);
        const thumbnail = container.querySelector('img');
        if (!thumbnail) throw new Error('Missing inline thumbnail');
        expect(thumbnail.getAttribute('src')).toBe(source);
        expect(thumbnail.className).toContain(route === 'feed' ? 'h-10 w-10' : 'w-14 h-10');
        hover(thumbnail);
        expect(document.body.querySelectorAll(`img[src="${source}"]`)).toHaveLength(2);
    });

    it.each(['image', 'text'])('retains the table selector’s first recognized image for %s arrays', type => {
        for (const leading of ['', 'Assets/paper.pdf', 'https://example.test/image/123']) {
            render(<Table type={type} value={[leading, { src: 'Assets/cover.jpg', alt: 'Local cover' }]} />);
            const thumbnail = container.querySelector('img');
            if (!thumbnail) throw new Error('Missing fallback thumbnail');
            expect(thumbnail.getAttribute('src')).toContain('/assets/cover.jpg');
            hover(thumbnail);
            expect(document.body.querySelectorAll('img')).toHaveLength(2);
            act(() => { thumbnail.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
        }
    });

    it.each(['image', 'text'])('preserves the table selector’s recognized CSV fallback for %s fields', type => {
        render(<Table type={type} value="not-an-image, https://example.test/cover.jpg" />);
        expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/cover.jpg');
    });

    it('uses extensionless declared image array sources when there is no recognized image', () => {
        render(<Table value={['', { src: source, alt: 'Remote cover' }]} />);
        const thumbnail = container.querySelector('img');
        if (!thumbnail) throw new Error('Missing extensionless array thumbnail');
        expect(thumbnail.getAttribute('src')).toBe(source);
        hover(thumbnail);
        expect(document.body.querySelectorAll(`img[src="${source}"]`)).toHaveLength(2);
    });

    it('keeps page editing on click and previews the edit button on keyboard focus', () => {
        const edit = vi.fn();
        render(<ScalarPropertyValue prop={{ name: 'Cover', type: 'image' }} context={pageContext(note.metadata.Cover, true, edit)} />);
        const button = container.querySelector('button');
        if (!button) throw new Error('Missing image editor');
        act(() => { button.focus(); button.click(); });
        expect(document.body.querySelectorAll('img')).toHaveLength(2);
        expect(edit).toHaveBeenCalledWith('Cover');
    });

    it.each(['page', 'feed'] as const)('previews image URL links in %s only after intent and leaves document links alone', route => {
        for (const value of ['https://example.test/cover.jpg', 'https://example.test/paper.pdf']) {
            if (route === 'page') render(<PropertyValue prop={{ name: 'Source', type: 'url' }} context={pageContext(value)} />);
            else render(<Feed type="url" value={value} />);
            const link = container.querySelector('a');
            if (!link) throw new Error('Missing URL link');
            expect(document.body.querySelector('img')).toBeNull();
            hover(link);
            expect(document.body.querySelectorAll('img')).toHaveLength(value.endsWith('.jpg') ? 1 : 0);
            expect(link.getAttribute('href')).toBe(value);
            act(() => { link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
        }
    });
});
