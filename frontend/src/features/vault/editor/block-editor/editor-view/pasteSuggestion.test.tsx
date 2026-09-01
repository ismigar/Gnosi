import { act } from 'react';
import type { Toast, toast } from '../../../../../shared/notifications/toast';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import { suggestPastedFrame } from './pasteSuggestion';
import { translationsReady, viewInputs } from './test-support';

const notifications = vi.hoisted(() => ({ custom: vi.fn<typeof toast.custom>(), dismiss: vi.fn<typeof toast.dismiss>() }));
vi.mock('../../../../../shared/notifications/toast', () => ({ toast: notifications }));
beforeAll(async () => { await translationsReady; });

function paste(container: HTMLElement, text: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    act(() => { container.firstElementChild?.dispatchEvent(event); });
    return event;
}

function renderNotification() {
    const content = notifications.custom.mock.calls.at(-1)?.[0];
    if (typeof content !== 'function') throw new Error('Missing frame suggestion');
    const notification: Toast = { id: 'frame', type: 'custom', visible: true, dismissed: false,
        message: '', createdAt: 0, pauseDuration: 0, ariaProps: { role: 'status', 'aria-live': 'polite' } };
    return mountTestComponent(<>{content(notification)}</>);
}

describe('editor text-paste frame suggestion', () => {
    it('does not block text paste and inserts only after confirmation, using the current cursor', () => {
        const inputs = viewInputs(); inputs.detectEmbeddableUrl.mockReturnValue('pdf');
        const insert = vi.spyOn(inputs.editor, 'insertBlocks').mockImplementation(() => []);
        const { container } = mountTestComponent(<div onPaste={event => { suggestPastedFrame(event, inputs); }} />);
        const event = paste(container, ' https://example.test/document.pdf ');
        expect(event.defaultPrevented).toBe(false); expect(insert).not.toHaveBeenCalled();
        expect(notifications.custom.mock.calls.at(-1)?.[1]).toEqual({ duration: 8000 });
        const notification = renderNotification();
        expect(notification.container.textContent).toContain('PDF detected.');
        act(() => { notification.container.querySelector('button')?.click(); });
        expect(insert).toHaveBeenCalledWith([{ type: 'embed', props: { url: 'https://example.test/document.pdf', caption: '' } }], inputs.editor.document[0], 'after');
        expect(notifications.dismiss).toHaveBeenCalledWith('frame');
    });

    it('dismisses a video suggestion without inserting and leaves unsupported text untouched', () => {
        const inputs = viewInputs(); inputs.detectEmbeddableUrl.mockReturnValue('youtube');
        const insert = vi.spyOn(inputs.editor, 'insertBlocks').mockImplementation(() => []);
        const { container } = mountTestComponent(<div onPaste={event => { suggestPastedFrame(event, inputs); }} />);
        paste(container, 'https://youtu.be/fixture');
        const notification = renderNotification(); expect(notification.container.textContent).toContain('Video detected.');
        act(() => { notification.container.querySelectorAll('button')[1]?.click(); });
        expect(insert).not.toHaveBeenCalled();
        inputs.detectEmbeddableUrl.mockReturnValue(null); const count = notifications.custom.mock.calls.length;
        expect(paste(container, 'ordinary text').defaultPrevented).toBe(false);
        expect(notifications.custom.mock.calls).toHaveLength(count);
    });

    it('dismisses the notification and reports a failed insertion without throwing from the click', () => {
        const inputs = viewInputs(); inputs.detectEmbeddableUrl.mockReturnValue('vimeo');
        vi.spyOn(inputs.editor, 'insertBlocks').mockImplementation(() => { throw new Error('gone'); });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { container } = mountTestComponent(<div onPaste={event => { suggestPastedFrame(event, inputs); }} />);
        paste(container, 'https://vimeo.com/fixture'); const notification = renderNotification();
        act(() => { notification.container.querySelector('button')?.click(); });
        expect(warn).toHaveBeenCalledWith('paste→frame insert failed:', 'gone');
        expect(notifications.dismiss).toHaveBeenCalledWith('frame');
    });
});
