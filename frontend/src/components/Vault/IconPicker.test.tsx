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

import { toast } from '../../lib/toast';
import {
    fetchCustomIcons,
    importVaultIconUrl,
    saveCustomIcons,
    uploadVaultIcon,
} from '../../shared/api/vault-icons';
import { readStorage, removeStorage, writeStorage } from '../../shared/platform/browser-storage';
import { IconPicker, type IconPickerProps } from './IconPicker';
import { customIconStorageKey } from './icon-picker/storage';


interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}


interface MockEmojiPickerProps {
    readonly onEmojiClick: (data: { readonly emoji: string }) => void;
    readonly theme: string;
}


const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;


vi.mock('emoji-picker-react', () => ({
    default: ({ onEmojiClick, theme }: MockEmojiPickerProps) => (
        <button
            data-emoji-theme={theme}
            onClick={() => {
                onEmojiClick({ emoji: '🧠' });
            }}
            type="button"
        >
            mock emoji
        </button>
    ),
    Theme: { DARK: 'dark', LIGHT: 'light' },
}));


vi.mock('lucide-react/dynamic', () => ({
    DynamicIcon: ({
        color,
        name,
    }: {
        readonly color?: string;
        readonly name: string;
    }) => <span data-color={color} data-icon-name={name} />,
    iconNames: ['file-text', 'book-open', 'camera'],
}));


vi.mock('../../hooks/useTheme', () => ({
    useTheme: () => ({
        effectiveTheme: 'dark',
        isDark: true,
        themePreference: 'dark',
    }),
}));


vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../lib/fileResource', () => ({
    withActiveVault: (value: string): string => `active:${value}`,
}));


vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));


vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../shared/api/vault-icons', () => ({
    fetchCustomIcons: vi.fn(),
    importVaultIconUrl: vi.fn(),
    saveCustomIcons: vi.fn(),
    uploadVaultIcon: vi.fn(),
}));


const fetchCustomIconsMock = vi.mocked(fetchCustomIcons);
const importVaultIconUrlMock = vi.mocked(importVaultIconUrl);
const saveCustomIconsMock = vi.mocked(saveCustomIcons);
const uploadVaultIconMock = vi.mocked(uploadVaultIcon);
const successToastMock = vi.mocked(toast.success);


let container: HTMLDivElement;
let root: Root;


function translate(key: string, fallback?: string): string {
    return fallback ?? key;
}


vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));


function requiredButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}


function requiredButtonBySelector(selector: string): HTMLButtonElement {
    const button = document.body.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${selector}`);
    }
    return button;
}


function requiredInput(selector: string): HTMLInputElement {
    const input = document.body.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing input: ${selector}`);
    }
    return input;
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


function click(button: HTMLButtonElement): void {
    act(() => {
        button.click();
    });
}


async function renderPicker(
    overrides: Partial<IconPickerProps> = {},
): Promise<{
    readonly onClose: ReturnType<typeof vi.fn<() => void>>;
    readonly onSelectIcon: ReturnType<typeof vi.fn<(icon: string) => void>>;
}> {
    const onClose = vi.fn<() => void>();
    const onSelectIcon = vi.fn<(icon: string) => void>();
    const props: IconPickerProps = {
        anchorRect: { bottom: 108, left: 100, top: 80 },
        isOpen: true,
        onClose,
        onSelectIcon,
        ...overrides,
    };
    await act(async () => {
        root.render(<IconPicker {...props} />);
        await Promise.resolve();
        await Promise.resolve();
    });
    return { onClose, onSelectIcon };
}


function iconAsset(url: string) {
    return {
        path: `Assets/${url.split('/').at(-1) ?? 'icon.png'}`,
        thumbnail_path: null,
        thumbnail_url: null,
        url,
    };
}


beforeEach(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    removeStorage(customIconStorageKey);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchCustomIconsMock.mockReset().mockResolvedValue({ icons: [] });
    importVaultIconUrlMock.mockReset();
    saveCustomIconsMock.mockReset().mockResolvedValue({ icons: [] });
    uploadVaultIconMock.mockReset();
    successToastMock.mockReset();
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    removeStorage(customIconStorageKey);
    delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
});


describe('IconPicker', () => {
    it('uses local persistence as fallback and keeps outside-close behavior', async () => {
        writeStorage(customIconStorageKey, [' https://icons.test/local.png ']);
        fetchCustomIconsMock.mockRejectedValue(new Error('offline'));
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        const { onClose } = await renderPicker({ triggerRef: { current: trigger } });

        click(requiredButton('icon_picker.tabs.custom'));
        const customImage = document.body.querySelector('img');
        expect(customImage?.getAttribute('src')).toBe(
            'active:https://icons.test/local.png',
        );

        act(() => {
            trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(onClose).not.toHaveBeenCalled();
        act(() => {
            container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledOnce();
        trigger.remove();
    });

    it('filters Lucide icons, applies color, and preserves selection format', async () => {
        const { onClose, onSelectIcon } = await renderPicker();
        const panel = document.body.querySelector('.fixed');
        if (!(panel instanceof HTMLDivElement)) throw new Error('Missing picker panel');
        expect(panel.style.left).toBe('100px');
        expect(panel.style.top).toBe('116px');

        click(requiredButton('icon_picker.tabs.icons'));
        setInputValue(
            requiredInput('input[placeholder="icon_picker.search_placeholder"]'),
            'book',
        );
        expect(document.body.querySelector('button[title="FileText"]')).toBeNull();
        click(requiredButtonBySelector('button[title="Purple"]'));
        click(requiredButtonBySelector('button[title="BookOpen"]'));

        expect(onSelectIcon).toHaveBeenCalledWith('lucide:BookOpen:purple');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('preserves emoji theme and selection', async () => {
        const { onClose, onSelectIcon } = await renderPicker();
        const emojiButton = requiredButton('mock emoji');
        expect(emojiButton.dataset.emojiTheme).toBe('dark');
        click(emojiButton);
        expect(onSelectIcon).toHaveBeenCalledWith('🧠');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('imports a URL, persists it, selects it, and reports success', async () => {
        const importedUrl = 'https://icons.test/imported.png';
        importVaultIconUrlMock.mockResolvedValue(iconAsset(importedUrl));
        const { onClose, onSelectIcon } = await renderPicker();
        click(requiredButton('icon_picker.tabs.custom'));
        setInputValue(requiredInput('input[placeholder="https://..."]'), importedUrl);

        await act(async () => {
            requiredButton('icon_picker.import_button').click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(importVaultIconUrlMock).toHaveBeenCalledWith(importedUrl);
        expect(saveCustomIconsMock).toHaveBeenCalledWith([importedUrl]);
        expect(readStorage(customIconStorageKey)).toEqual([importedUrl]);
        expect(onSelectIcon).toHaveBeenCalledWith(importedUrl);
        expect(onClose).toHaveBeenCalledOnce();
        expect(successToastMock).toHaveBeenCalledWith(
            'icon_picker.toast.import_success',
        );
    });

    it('uploads a file, remembers it, and selects the stored URL', async () => {
        const uploadedUrl = 'https://icons.test/uploaded.png';
        uploadVaultIconMock.mockResolvedValue(iconAsset(uploadedUrl));
        const { onSelectIcon } = await renderPicker();
        click(requiredButton('icon_picker.tabs.custom'));
        const input = requiredInput('input[type="file"]');
        const file = new File(['icon'], 'icon.png', { type: 'image/png' });
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: {
                0: file,
                item: (index: number): File | null => index === 0 ? file : null,
                length: 1,
            },
        });

        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(uploadVaultIconMock).toHaveBeenCalledWith(file);
        expect(onSelectIcon).toHaveBeenCalledWith(uploadedUrl);
        expect(readStorage(customIconStorageKey)).toEqual([uploadedUrl]);
    });

    it('clears the current icon through the public callback contract', async () => {
        const { onClose, onSelectIcon } = await renderPicker({ currentIcon: '🧠' });
        click(requiredButton('icon_picker.delete_button'));
        expect(onSelectIcon).toHaveBeenCalledWith('');
        expect(onClose).toHaveBeenCalledOnce();
    });
});
