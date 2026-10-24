import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageHoverPreview } from './ImageHoverPreview';

describe('image hover triggers', () => {
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

    const popup = () => document.body.querySelector('img[src="https://example.test/cover.jpg"]');

    it('loads a link preview only on hover and preserves the link and its click handler', () => {
        const click = vi.fn();
        act(() => { root.render(<ImageHoverPreview src="https://example.test/cover.jpg" alt="Cover">
            <a href="https://example.test/cover.jpg" target="_blank" onClick={event => { event.preventDefault(); click(); }}>Cover link</a>
        </ImageHoverPreview>); });
        expect(popup()).toBeNull();
        const link = container.querySelector('a');
        if (!link) throw new Error('Missing link');
        expect(container.querySelectorAll('a')).toHaveLength(1);
        act(() => { link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        expect(popup()?.getAttribute('alt')).toBe('Cover');
        expect(popup()?.parentElement?.style.pointerEvents).toBe('none');
        act(() => { link.click(); });
        expect(click).toHaveBeenCalledOnce();
        expect(link.getAttribute('href')).toBe('https://example.test/cover.jpg');
        act(() => { link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
        expect(popup()).toBeNull();
    });

    it('retains a loaded popup when hover is followed by focus without another image load', () => {
        act(() => { root.render(<ImageHoverPreview src="https://example.test/cover.jpg"><a href="https://example.test/cover.jpg">Cover</a></ImageHoverPreview>); });
        const link = container.querySelector('a');
        if (!link) throw new Error('Missing link');
        act(() => { link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        const image = popup();
        if (!image) throw new Error('Missing preview');
        expect(image.parentElement?.textContent).toContain('…');
        act(() => { image.dispatchEvent(new Event('load')); });
        expect(image.parentElement?.textContent).not.toContain('…');
        act(() => { link.focus(); });
        expect(popup()).toBe(image);
        expect(image.parentElement?.textContent).not.toContain('…');
    });

    it('previews keyboard focus, dismisses with Escape and blur, and keeps an edit button working', () => {
        const edit = vi.fn();
        act(() => { root.render(<ImageHoverPreview src="https://example.test/cover.jpg"><button onClick={edit}>Edit cover</button></ImageHoverPreview>); });
        const button = container.querySelector('button');
        if (!button) throw new Error('Missing edit button');
        act(() => { button.focus(); });
        expect(popup()).not.toBeNull();
        act(() => { button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })); });
        expect(popup()).toBeNull();
        act(() => { button.click(); button.blur(); button.focus(); });
        expect(edit).toHaveBeenCalledOnce();
        expect(popup()).not.toBeNull();
        act(() => { button.blur(); });
        expect(popup()).toBeNull();
    });

    it('dismisses a broken preview while retaining the trigger for opening or retrying', () => {
        act(() => { root.render(<ImageHoverPreview src="https://example.test/cover.jpg"><a href="https://example.test/cover.jpg">Cover</a></ImageHoverPreview>); });
        const link = container.querySelector('a');
        if (!link) throw new Error('Missing link');
        act(() => { link.focus(); });
        const image = popup();
        if (!image) throw new Error('Missing preview');
        act(() => { image.dispatchEvent(new Event('error')); });
        expect(popup()).toBeNull();
        expect(link.textContent).toBe('Cover');
        act(() => { link.blur(); link.focus(); });
        expect(popup()).not.toBeNull();
    });

    it('retains thumbnail sizing and adds focus support without requiring a link', () => {
        act(() => { root.render(<ImageHoverPreview src="/api/vault/assets/cover.png" alt="Local cover" thumbClassName="h-9 w-9 rounded object-cover" />); });
        expect(container.querySelector('img')?.className).toBe('h-9 w-9 rounded object-cover');
        const trigger = container.querySelector('span');
        if (!trigger) throw new Error('Missing thumbnail trigger');
        act(() => { trigger.focus(); });
        expect(document.body.querySelectorAll('img[src="/api/vault/assets/cover.png"]')).toHaveLength(2);
        act(() => { trigger.blur(); });
        expect(document.body.querySelectorAll('img[src="/api/vault/assets/cover.png"]')).toHaveLength(1);
    });
});
