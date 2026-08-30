import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {Thumb} from './Thumb';
import {TreeNode} from './TreeNode';
import {ViewNamePromptModal} from './ViewNamePromptModal';
import {fetchMediaTree} from '../../../shared/api/media-browser';
import {enterMediaFullscreen, exitMediaFullscreen} from './fullscreen';

vi.mock('react-i18next', () => {const t = (key: string) => key; return {useTranslation: () => ({t})};});
vi.mock('../../../shared/api/media-browser', () => ({fetchMediaTree: vi.fn()}));
let container: HTMLDivElement;
let root: Root;
async function run(action: () => void | Promise<void>) {await act(async () => {await action();});}
beforeAll(() => {(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;});
beforeEach(() => {vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);});
afterEach(async () => {await run(() => {root.unmount();}); container.remove(); vi.useRealTimers();});

describe('media leaf components', () => {
    it.each(['video', 'audio', 'pdf', 'other', 'future-format'])('does not load %s files as images', async kind => {
        await run(() => {root.render(<Thumb src="/synthetic" alt="Fixture" viewMode="list" kind={kind}/>);});
        expect(container.querySelector('img')).toBeNull(); expect(container.textContent).toContain('Fixture');
    });
    it('retries a cloud-hydrated image after 4s and 8s then displays the unavailable placeholder', async () => {
        vi.useFakeTimers();
        await run(() => {root.render(<Thumb src="/synthetic?token=fake" alt="Fixture" viewMode="grid" kind="image"/>);});
        const fail = () => {
            const image = container.querySelector('img');
            if (!image) throw new Error('Missing thumbnail');
            image.dispatchEvent(new Event('error'));
        };
        await run(fail); await run(async () => {await vi.advanceTimersByTimeAsync(4000);});
        expect(container.querySelector('img')?.getAttribute('src')).toBe('/synthetic?token=fake&_r=1');
        await run(fail); await run(async () => {await vi.advanceTimersByTimeAsync(8000);});
        expect(container.querySelector('img')?.getAttribute('src')).toBe('/synthetic?token=fake&_r=2');
        await run(fail); expect(container.textContent).toContain('media.not_downloaded');
        expect(vi.getTimerCount()).toBe(0);
    });
    it('loads recursive folders only on first expansion and preserves the provider root', async () => {
        const select = vi.fn();
        vi.mocked(fetchMediaTree).mockResolvedValue([{name: 'Child', path: 'Parent/Child', has_children: false}]);
        await run(() => {root.render(<TreeNode node={{name: 'Parent', path: 'Parent', has_children: true}}
            depth={0} activeAlbum={null} onSelect={select} root="google-drive"/>);});
        expect(fetchMediaTree).not.toHaveBeenCalled();
        const expand = container.querySelector('button');
        if (!expand) throw new Error('Missing folder disclosure');
        await run(() => {expand.click();});
        expect(fetchMediaTree).toHaveBeenCalledWith('google-drive', 'Parent');
        const child = [...container.querySelectorAll('button')].find(button => button.title === 'Child');
        if (!child) throw new Error('Missing child folder');
        await run(() => {child.click();});
        expect(select).toHaveBeenCalledWith('Parent/Child');
        await run(() => {expand.click();}); await run(() => {expand.click();});
        expect(fetchMediaTree).toHaveBeenCalledTimes(1);
    });
    it('recovers a failed folder expansion with an empty cached child list', async () => {
        vi.mocked(fetchMediaTree).mockRejectedValue(new Error('offline'));
        await run(() => {root.render(<TreeNode node={{name: 'Parent', path: 'Parent', has_children: true}}
            depth={0} activeAlbum="" onSelect={() => {}}/>);});
        const expand = container.querySelector('button');
        if (!expand) throw new Error('Missing folder disclosure');
        await run(() => {expand.click();});
        expect(expand.getAttribute('aria-label')).toBe('common.collapse');
    });
    it('trims view names, keeps Enter/Escape behavior and disables empty names', async () => {
        const confirm = vi.fn(), cancel = vi.fn();
        await run(() => {root.render(<ViewNamePromptModal open defaultValue=" A view " onConfirm={confirm} onCancel={cancel}/>);});
        const input = container.querySelector('input');
        if (!input) throw new Error('Missing view name input');
        await run(() => {input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));});
        expect(confirm).toHaveBeenCalledWith('A view');
        await run(() => {input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));});
        expect(cancel).toHaveBeenCalledOnce();
        await run(() => {root.render(<ViewNamePromptModal open defaultValue=" " onConfirm={confirm} onCancel={cancel}/>);});
        expect(container.querySelector('button:last-child')?.hasAttribute('disabled')).toBe(true);
    });
    it('tolerates missing fullscreen support and keeps successful fullscreen calls bound to their target', async () => {
        expect(() => {enterMediaFullscreen({}); exitMediaFullscreen({});}).not.toThrow();
        const target = {requestFullscreen: vi.fn(() => Promise.resolve())};
        const documentTarget = {exitFullscreen: vi.fn(() => Promise.resolve())};
        enterMediaFullscreen(target); exitMediaFullscreen(documentTarget); await Promise.resolve();
        expect(target.requestFullscreen).toHaveBeenCalledOnce(); expect(documentTarget.exitFullscreen).toHaveBeenCalledOnce();
    });
});
