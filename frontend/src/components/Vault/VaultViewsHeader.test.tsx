import {
    act,
    type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import { VaultViewsHeader } from './VaultViewsHeader';
import type {
    HeaderTemplate,
    HeaderView,
    VaultViewsHeaderProps,
} from './vault-views-header/types';
import {
    displayedTabViews,
    visibleTabViews,
} from './vault-views-header/viewModel';

vi.mock('@dnd-kit/core', () => ({
    closestCenter: (): null => null,
    DndContext: ({ children }: { readonly children: ReactNode }) => children,
    KeyboardSensor: (): null => null,
    PointerSensor: (): null => null,
    useSensor: (): Readonly<Record<string, never>> => ({}),
    useSensors: (...sensors: readonly unknown[]): readonly unknown[] => sensors,
}));

vi.mock('@dnd-kit/sortable', () => ({
    arrayMove: (
        items: readonly unknown[],
        from: number,
        to: number,
    ): unknown[] => {
        const moved = [...items];
        const item = moved.splice(from, 1).at(0);
        if (item !== undefined) moved.splice(to, 0, item);
        return moved;
    },
    horizontalListSortingStrategy: {},
    sortableKeyboardCoordinates: (): null => null,
    SortableContext: ({ children }: { readonly children: ReactNode }) => children,
    useSortable: () => ({
        attributes: {},
        isDragging: false,
        listeners: {},
        setNodeRef: (): void => {},
        transform: null,
        transition: undefined,
    }),
    verticalListSortingStrategy: {},
}));

vi.mock('@dnd-kit/utilities', () => ({
    CSS: { Transform: { toString: (): undefined => undefined } },
}));

vi.mock('./BrainInbox', () => ({ BrainInbox: (): null => null }));
vi.mock('./ReferenceImportExport', () => ({
    ReferenceImportExport: (): null => null,
}));
vi.mock('./IconRenderer', () => ({
    IconRenderer: ({ icon }: { readonly icon?: string | null }) => (
        <span data-testid="template-icon">{icon}</span>
    ),
}));

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

class TestResizeObserver implements ResizeObserver {
    disconnect(): void {}
    observe(_target: Element, _options?: ResizeObserverOptions): void {}
    unobserve(_target: Element): void {}
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const mountedRoots: MountedRoot[] = [];
const mainView: HeaderView = {
    id: 'default',
    is_main: true,
    name: 'Main Table',
    order: 0,
    type: 'table',
};
const filteredView: HeaderView = {
    filters: [{ field: 'status', operator: 'equals', value: 'done' }],
    id: 'filtered',
    name: 'Completed',
    order: 1,
    type: 'board',
};
const hiddenView: HeaderView = {
    hidden: true,
    id: 'hidden',
    name: 'Hidden',
    order: 2,
    type: 'list',
};
const views = [filteredView, hiddenView, mainView] as const;
const template: HeaderTemplate = {
    id: 'template-1',
    metadata: { is_default_template: false },
    title: 'Article template',
};

function displayValue(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '';
}

function translate(
    key: string,
    options?: string | Readonly<Record<string, unknown>>,
): string {
    if (typeof options === 'string') return options;
    if (typeof options?.defaultValue === 'string') return options.defaultValue;
    const count = displayValue(options?.count);
    const total = displayValue(options?.total);
    return total ? `${key}:${count}:${total}` : count ? `${key}:${count}` : key;
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

function mount(node: ReactNode): MountedRoot {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const mounted = { container, root };
    mountedRoots.push(mounted);
    act(() => {
        root.render(node);
    });
    return mounted;
}

function requiredButton(root: ParentNode, selector: string): HTMLButtonElement {
    const button = root.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing test button: ${selector}`);
    }
    return button;
}

function requiredInput(root: ParentNode, selector: string): HTMLInputElement {
    const input = root.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing test input: ${selector}`);
    }
    return input;
}

function click(button: HTMLButtonElement): void {
    act(() => {
        button.click();
    });
}

function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setter) throw new Error('Missing native input value setter');
    setter(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function renderHeader(
    overrides: Partial<VaultViewsHeaderProps> = {},
): MountedRoot {
    const props: VaultViewsHeaderProps = {
        activeViewId: 'filtered',
        notes: [
            { id: '1', metadata: { status: 'done' }, title: 'Done' },
            { id: '2', metadata: { status: 'todo' }, title: 'Todo' },
        ],
        onAddView: vi.fn<(viewType: string) => void>(),
        recordCount: 2,
        searchTerm: '',
        setSearchTerm: vi.fn<(value: string) => void>(),
        tableName: 'Tasks',
        templates: [template],
        views,
        ...overrides,
    };
    return mount(<VaultViewsHeader {...props} />);
}

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
});

afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    vi.clearAllMocks();
});

afterAll(() => {
    vi.unstubAllGlobals();
    delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
});

describe('VaultViewsHeader navigation and actions', () => {
    it('pins the main view, hides semantic hidden views and keeps the active tab visible', () => {
        const visible = visibleTabViews(views);
        expect(visible.map((view) => view.id)).toEqual(['default', 'filtered']);
        expect(displayedTabViews(visible, 'filtered', 1).map((view) => view.id)).toEqual([
            'filtered',
            'default',
        ]);
    });

    it('shows the active filtered count and routes tab selection', () => {
        const onViewSelect = vi.fn<(viewId: string) => void>();
        const { container } = renderHeader({ onViewSelect });
        expect(container.textContent).toContain(
            'views_header.records_count_in_view:1:2',
        );
        const mainTab = requiredButton(container, 'button[aria-label="views_header.add_view"]')
            .parentElement?.querySelector('[title="Main Table"]');
        if (!(mainTab instanceof HTMLElement)) throw new Error('Missing main tab');
        act(() => {
            mainTab.click();
        });
        expect(onViewSelect).toHaveBeenCalledWith('default');
    });

    it('opens and focuses search, then forwards typed changes', () => {
        const setSearchTerm = vi.fn<(value: string) => void>();
        const { container } = renderHeader({ setSearchTerm });
        click(requiredButton(container, 'button[title="views_header.search_title"]'));
        const input = requiredInput(container, 'input[placeholder="views_header.search_placeholder"]');
        expect(document.activeElement).toBe(input);
        act(() => {
            setInputValue(input, 'planning');
        });
        expect(setSearchTerm).toHaveBeenCalledWith('planning');
    });

    it('routes manage-view rename and add actions', () => {
        const onRenameView = vi.fn<(view: HeaderView) => void>();
        const onAddView = vi.fn<(viewType: string) => void>();
        const { container } = renderHeader({ onAddView, onRenameView });
        click(requiredButton(container, 'button[aria-label="views_header.add_view"]'));
        const actionButtons = document.body.querySelectorAll<HTMLButtonElement>(
            'button[aria-label="More actions"]',
        );
        const customActions = actionButtons.item(1);
        click(customActions);
        const rename = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
            .find((button) => button.textContent.includes('views_header.rename'));
        if (!rename) throw new Error('Missing rename action');
        click(rename);
        expect(onRenameView).toHaveBeenCalledWith(filteredView);

        const addBoard = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent.includes('Kanban'));
        if (!addBoard) throw new Error('Missing board action');
        click(addBoard);
        expect(onAddView).toHaveBeenCalledWith('board');
    });
});

describe('VaultViewsHeader creation menus', () => {
    it('creates from a template and routes its contextual duplicate action', () => {
        const onCreateRecord = vi.fn<(templateId?: string) => void>();
        const onDuplicateTemplate = vi.fn<(item: HeaderTemplate) => void>();
        const { container } = renderHeader({
            onCreateRecord,
            onDuplicateTemplate,
        });
        const menuToggle = requiredButton(
            container,
            'button[aria-label="Creation options"]',
        );
        click(menuToggle);
        const templateButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent.includes('Article template'));
        if (!templateButton) throw new Error('Missing template action');
        click(templateButton);
        expect(onCreateRecord).toHaveBeenCalledWith('template-1');

        click(menuToggle);
        click(requiredButton(container, 'button[aria-label="table.options"]'));
        const duplicate = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
            .find((button) => button.textContent.includes('table.duplicate'));
        if (!duplicate) throw new Error('Missing duplicate template action');
        click(duplicate);
        expect(onDuplicateTemplate).toHaveBeenCalledWith(template);
    });

    it('closes the creation menu with Escape', () => {
        const { container } = renderHeader();
        const menuToggle = requiredButton(
            container,
            'button[aria-label="Creation options"]',
        );
        click(menuToggle);
        expect(menuToggle.getAttribute('aria-expanded')).toBe('true');
        act(() => {
            dispatchWindowEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Escape',
            }));
        });
        expect(menuToggle.getAttribute('aria-expanded')).toBe('false');
    });
});
