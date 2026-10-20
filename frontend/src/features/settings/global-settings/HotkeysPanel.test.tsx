import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { hotkeysKey } from '../../../shared/commands/hotkeys';
import { readStorage, removeStorage } from '../../../shared/platform/browser-storage';
import { HotkeysPanel } from './HotkeysPanel';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/plugins/usePluginHost', () => ({ usePluginHost: () => ({ commands: [] }) }));
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => false }) }));
afterEach(() => { removeStorage(hotkeysKey); });

it('records a shortcut, prevents conflicts and lets the user clear and reset it', () => {
    const mounted = mountTestComponent(<HotkeysPanel />);
    const input = mounted.container.querySelector<HTMLInputElement>('#hotkey-act-search');
    if (!input) throw new Error('Missing shortcut recorder');
    const press = (key: string) => { act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); }); };
    press('p');
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toBe('settings.hotkeys.conflict');
    expect(readStorage(hotkeysKey)).toBeUndefined();
    press('f');
    expect(readStorage(hotkeysKey)?.['act-search']).toBe('Mod+Shift+f');
    expect(input.value).toBe('Mod+Shift+f');
    const clear = input.parentElement?.querySelector('button');
    act(() => { clear?.click(); });
    expect(readStorage(hotkeysKey)?.['act-search']).toBe('');
    const reset = Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent.includes('settings.hotkeys.reset'));
    act(() => { reset?.click(); });
    expect(mounted.container.querySelector<HTMLInputElement>('#hotkey-command-palette')?.value).toBe('Mod+Shift+p');
});
