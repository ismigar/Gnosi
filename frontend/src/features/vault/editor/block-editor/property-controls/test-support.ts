import { act } from 'react';

export function click(element: HTMLElement) {
    act(() => { element.click(); });
}

export function inputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Missing native input setter');
    act(() => {
        descriptor.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

export function key(input: HTMLInputElement, value: string) {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(event); });
    return event;
}

export function mouseDown(element: Element) {
    act(() => { element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
}

export function requiredElement<T extends HTMLElement>(elementType: new () => T, selector: string, root: ParentNode = document): T {
    const element = root.querySelector(selector);
    if (!(element instanceof elementType)) throw new Error(`Missing fixture element ${selector}`);
    return element;
}

export function portal() {
    return requiredElement(HTMLDivElement, '[data-property-dropdown]');
}

export function search() {
    return requiredElement(HTMLInputElement, 'input', portal());
}

export async function openPicker(container: HTMLElement) {
    click(requiredElement(HTMLDivElement, '.cursor-pointer', container));
    await act(async () => {
        await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve(); }); });
    });
    return portal();
}

export function option(text: string) {
    const options = [...portal().querySelectorAll<HTMLElement>('[data-idx]')];
    const match = options.find(item => item.textContent.includes(text));
    if (!match) throw new Error(`Missing fixture option ${text}`);
    return match;
}
